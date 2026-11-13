import Foundation
import AppKit

@main struct RuntimeOracle {
    static func main() throws {
        let input = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [String: Any]
        var output: [String: Any] = [:]
        if let urls = input["urls"] as? [String] {
            output["events"] = urls.map { raw -> Any in
                guard let url = URL(string: raw), let event = AgentActivityEvent(url: url) else { return NSNull() }
                var result: [String: Any] = [:]
                switch event.activity {
                case .idle: result["state"] = "idle"
                case .working: result["state"] = "working"
                case .waiting(let message): result["state"] = "waiting"; result["message"] = message
                case .done(let message): result["state"] = "done"; result["message"] = message
                }
                result["label"] = event.label
                return result
            }
        }
        if let operations = input["operations"] as? [[String: Any]] {
            var tracker = AgentActivityTracker()
            output["summaries"] = operations.map { operation -> [String: Any] in
                let now = Date(timeIntervalSince1970: (operation["now"] as? Double ?? 0) / 1000)
                if let raw = operation["url"] as? String, let url = URL(string: raw), let event = AgentActivityEvent(url: url) { tracker.apply(event, now: now) }
                if operation["expire"] as? Bool == true { tracker.expire(now: now) }
                if operation["dismiss"] as? Bool == true { tracker.dismissBubble() }
                if operation["reset"] as? Bool == true { tracker.reset() }
                let summary = tracker.summary
                var result: [String: Any] = ["working": summary.working, "otherWaitingCount": summary.otherWaitingCount]
                for (key, note) in [("waiting", summary.waiting), ("done", summary.done)] {
                    if let note { var row: [String: String] = [:]; row["label"] = note.label; row["message"] = note.message; result[key] = row }
                }
                return result
            }
        }
        if let summaries = input["statuses"] as? [[String: Any]] {
            output["statuses"] = summaries.map { row -> Any in
                let data = try! JSONSerialization.data(withJSONObject: row["raw"]!)
                return StatuspageStatusProvider.parseComponent(data, named: row["name"] as! String)?.indicator.rawValue as Any? ?? NSNull()
            }
        }
        if let cases = input["frames"] as? [[String: Any]] {
            output["frames"] = cases.map { row -> [[String: Any]] in
                let durations = row["durations"] as! [Double]
                let images = durations.map { _ in NSImage(size: NSSize(width: 1, height: 1)) }
                let frames = zip(images, durations).map { (image: $0, delay: $1 < 0.02 ? 0.1 : $1) }
                return GIFDecoder.capFrameRate(frames, floor: row["floor"] as! Double).map { frame in
                    ["index": images.firstIndex(where: { $0 === frame.image })!, "duration": frame.delay]
                }
            }
        }
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]))
    }
}
