import Foundation
@testable import PokeTokenBar

let args = CommandLine.arguments
let provider = args[1]
let root = URL(fileURLWithPath: args[2])
let now = ISO8601Parser.date(from: args[3])!
let since = LocalUsageReader.enrichmentScanStart(now: now)
let fmt = LocalUsageReader.localDayFormatter()
let today = fmt.string(from: now)
let week = fmt.string(from: LocalUsageReader.startOfWeek(now))
let month = fmt.string(from: LocalUsageReader.startOfMonth(now))

func load(_ since: Date) -> [LocalUsageReader.Entry] {
    switch provider {
    case "codex": LocalUsageReader.codexEntries(modifiedSince: since, root: root)
    case "claude": LocalUsageReader.claudeEntries(modifiedSince: since, root: root)
    case "gemini": LocalUsageReader.geminiEntries(modifiedSince: since, root: root)
    case "grok": LocalUsageReader.grokEntries(modifiedSince: since, root: root)
    case "pi": LocalUsageReader.piEntries(modifiedSince: since, roots: [root])
    case "omp": LocalUsageReader.ompEntries(modifiedSince: since, roots: [root])
    case "omo": LocalUsageReader.omoEntries(modifiedSince: since, roots: [root])
    case "kimi": LocalUsageReader.kimiEntries(modifiedSince: since, roots: [root])
    case "antigravity": LocalAntigravityUsageReader.entries(modifiedSince: since, roots: [root])
    case "aside": LocalAsideUsageReader.entries(modifiedSince: since, roots: [root])
    case "opencode": LocalAdditionalUsageReader.openCodeEntries(modifiedSince: since, roots: [root])
    case "hermes": LocalAdditionalUsageReader.hermesEntries(modifiedSince: since, roots: [root])
    case "copilot": LocalAdditionalUsageReader.copilotEntries(modifiedSince: since, roots: [root]).entries
    case "devin": LocalAdditionalUsageReader.devinEntries(modifiedSince: since, roots: [root]).entries
    case "cursor": LocalAdditionalUsageReader.cursorEntries(modifiedSince: since, roots: [root]).entries
    case "kiro": LocalAdditionalUsageReader.kiroEntries(modifiedSince: since, roots: [root])
    default: fatalError("Unknown provider")
    }
}

func printJSON(_ value: Any) throws {
    print(String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self))
}

if args.count > 4 && args[4] == "limits" {
    let data = try Data(contentsOf: root)
    let decoder = JSONDecoder()
    typealias Window = (Double?, Date?)
    var values: [Window] = []
    switch provider {
    case "codex":
        for row in try decoder.decode(CodexRateLimitStatus.self, from: data).visibleSnapshots {
            if let primary = row.primary { values.append((Double(primary.usedPercent), primary.resetDate)) }
            if let secondary = row.secondary { values.append((Double(secondary.usedPercent), secondary.resetDate)) }
            if let spend = row.individualLimit { values.append((Double(spend.usedPercent), spend.resetDate)) }
        }
    case "claude":
        let status = try decoder.decode(LimitStatus.self, from: data)
        values = [status.fiveHour, status.sevenDay, status.sevenDayOpus, status.sevenDaySonnet]
            .compactMap { $0 }.map { ($0.utilization, $0.resetDate) }
        values += status.scopedLimitEntries.map { ($0.percent, $0.resetDate) }
    case "antigravity":
        values = try decoder.decode(AntigravityRateLimitStatus.self, from: data).groups
            .flatMap { $0.buckets }.map { ($0.usedPercent, $0.resetDate) }
    case "opencode":
        let status = try decoder.decode(OpenCodeGoRateLimitStatus.self, from: data)
        values = [status.rolling, status.weekly, status.monthly].compactMap { $0 }
            .map { ($0.utilization(now: now), $0.activeReset(now: now)) }
    case "grok":
        let status = try decoder.decode(GrokCreditStatus.self, from: data)
        values = [(status.utilization(now: now), status.activeReset(now: now))]
    case "cursor":
        let status = try decoder.decode(CursorRateLimitStatus.self, from: data)
        values = [(status.planUsage?.usedPercent, status.billingCycleEndDate)]
    default: fatalError("Unknown quota provider")
    }
    try printJSON(values.compactMap { used, reset -> [String: Double]? in
        guard let used else { return nil }
        var window = ["usedPercent": used]
        if let reset { window["resetsAt"] = reset.timeIntervalSince1970 * 1000 }
        return window
    })
} else {
    let entries = load(since)
    let dailyEntries = load(Calendar.current.startOfDay(for: now))
    func tally(_ entries: [LocalUsageReader.Entry], from: String) -> LocalUsageReader.Bucket {
        var bucket = LocalUsageReader.Bucket()
        for entry in entries where entry.localDay >= from && entry.localDay <= today { bucket.add(entry) }
        return bucket
    }
    let buckets = ["today": tally(dailyEntries, from: today),
                   "week": tally(entries, from: week), "month": tally(entries, from: month)]
    var snapshot: [String: Any] = buckets.mapValues { bucket in
        ["input": bucket.input, "output": bucket.output, "cacheWrite": bucket.cacheWrite,
         "cacheRead": bucket.cacheRead, "total": bucket.total]
    }
    snapshot["lastFiveHours"] = LocalUsageReader.activeBlock(entries: entries, now: now)?.totalTokens ?? 0
    snapshot["cost"] = buckets.mapValues { bucket -> [String: Any] in
        ["amount": bucket.cost, "reported": bucket.costCoverage.reported, "estimated": bucket.costCoverage.estimated,
         "unknown": bucket.costCoverage.unknown]
    }
    try printJSON(snapshot)
}
