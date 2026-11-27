import{validBattleDefaultItem}from'./battle-items.js';
import { parseMacJSON, readMacProfile } from './mac-profile.js';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { object, timestamp, type Row } from '../usage/jsonl.js';
import { bagItems, rarities, type Rarity } from '../../shared/companion.js';
import { families, natures, speciesFor } from './catalog.js';
import type { Individual, ImportedProgress } from './store.js';

const maxBytes = 8 * 1024 * 1024;
const maxTokens = 1_000_000_000_000_000;
const natureKeys = ('hardy lonely brave adamant naughty bold docile relaxed impish lax timid hasty serious jolly naive ' +
  'modest mild quiet bashful rash calm gentle sassy careful quirky').split(' ');

export class SaveImportError extends Error {}

function invalid(): never {
  throw new SaveImportError('손상되었거나 지원하지 않는 PokeTokenBar v2 저장 파일입니다.');
}

function integer(value: unknown, min: number, max: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    ? value : invalid();
}

function string(value: unknown, max = 256): string {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : invalid();
}

function optionalDate(value: unknown): number | undefined {
  if (value == null) return;
  const parsed = timestamp(value);
  if (parsed === undefined || !Number.isSafeInteger(parsed) || parsed < 0) invalid();
  return parsed;
}

function ids(raw: unknown): number[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 12) invalid();
  const parsed = raw.map(id => integer(id, 1, 100000));
  if (new Set(parsed).size !== parsed.length) invalid();
  return parsed;
}

function optionalBoolean(value: unknown): boolean {
  if (value == null) return false;
  return typeof value === 'boolean' ? value : invalid();
}

function formOf(value: unknown): string | undefined {
  if (value == null) return;
  return string(typeof value === 'string' ? value : object(value)?.rawValue, 80);
}

function individual(row: Row, route: number[], stage: number, identity: string, names: Map<number, string>): Individual {
  const rarity = row.rarity;
  if (typeof rarity !== 'string' || !rarities.includes(rarity as Rarity)) invalid();
  const profile = row.profile == null ? undefined : object(row.profile);
  if (row.profile != null && !profile) invalid();
  const name = row.nature == null ? '미상' : natures[natureKeys.indexOf(string(row.nature))];
  if (!name) invalid();
  if(row.battleDefaultItem!=null&&!validBattleDefaultItem(route[stage],formOf(row.form ?? row.unownForm),row.battleDefaultItem))invalid();
  const stableID = identity || createHash('sha256').update(JSON.stringify(row)).digest('hex');
  return {
    id: stableID, family: -1, stage, hatchedAt: optionalDate(row.hatchedAt) ?? 0, nature: name,
    shiny: optionalBoolean(row.isShiny), repeat: optionalBoolean(row.hasGrowthBoost),
    route: route.map(id => speciesFor(id, names.get(id))), rarity: rarity as Rarity,
    form: formOf(row.form ?? row.unownForm),
    prayers:object(row.prayers)?.count==null?undefined:integer(object(row.prayers)!.count,0,maxTokens),
    battleDefaultItem:typeof row.battleDefaultItem==='string'&&row.battleDefaultItem?row.battleDefaultItem:undefined,
    macProfile: readMacProfile(profile),
    level: profile?.level == null ? undefined : integer(profile.level, 1, 100),
  };
}

function knownNames(records: Row[]): Map<number, string> {
  const result = new Map<number, string>();
  for (const row of records) {
    const names = object(row.names);
    if (!names) continue;
    for (const [key, raw] of Object.entries(names)) {
      const id = Number(key);
      const localized = object(raw);
      const name = localized?.ko ?? localized?.en;
      if (Number.isSafeInteger(id) && id > 0 && typeof name === 'string' && name.length && name.length <= 120) {
        result.set(id, name);
      }
    }
  }
  return result;
}

export function decodeMacSave(data: Uint8Array): {
  progress: ImportedProgress; appVersion: string; sourceDevice: string; exportedAt: number;
} {
  if (data.length > maxBytes) throw new SaveImportError('저장 파일이 8MB를 초과합니다.');
  let raw: unknown;
  try { raw = parseMacJSON(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
  catch { return invalid(); }

  const envelope = object(raw);
  if (envelope?.format !== 'poketokenbar.save') invalid();
  if (envelope.schema !== 2) throw new SaveImportError('poketokenbar.save v2 파일을 선택해 주세요.');
  const appVersion = string(envelope.appVersion);
  const sourceDevice = string(envelope.sourceDevice);
  const exportedAt = optionalDate(envelope.exportedAt);
  const state = object(envelope.state);
  if (exportedAt === undefined || !state || !Array.isArray(state.dex)) invalid();
  const raised = integer(state.usedSinceInstall, 0, maxTokens);
  const egg = integer(state.eggUsage, 0, maxTokens);
  const records = state.dex.map(row => object(row) ?? invalid());
  const activeRow = object(state.active);
  const names = knownNames(activeRow ? [...records, activeRow] : records);
  const captureIDs = new Set<string>();
  const graduated = records.map(row => {
    const route = ids(row.chainOrder);
    if (route[0] !== row.baseID || route.at(-1) !== row.finalID) invalid();
    const id = string(row.id);
    if (captureIDs.has(id)) invalid();
    captureIDs.add(id);
    const releasedAt = optionalDate(row.releasedAt);
    const caughtAt = optionalDate(row.caughtAt);
    return { ...individual(row, route, route.length - 1, id, names), releasedAt,championAchievedAt:optionalDate(row.championAchievedAt), graduatedAt: caughtAt ?? releasedAt ?? 0 };
  });

  let active: Individual | null = null;
  let progress = egg;
  if (state.active != null) {
    const row = object(state.active) ?? invalid();
    const realized = ids(row.pathIDs);
    const stage = integer(row.stageIndex, 0, realized.length - 1);
    const totalForms = integer(row.totalForms, realized.length, 12);
    if (row.baseID !== realized[0] || stage + 1 !== realized.length) invalid();
    let route = row.plannedPathIDs == null ? realized : ids(row.plannedPathIDs);
    if (route.length > totalForms || realized.some((id, index) => route[index] !== id)) invalid();
    if (route.length < totalForms) {
      const starter = families.find(line => line.length === totalForms && route.every((id, index) => line[index].number === id));
      if (starter) route = starter.map(species => species.number);
    }
    const rawID = object(row.profile)?.instanceID;
    const id = rawID == null ? '' : string(rawID);
    if (id && captureIDs.has(id)) invalid();
    active = { ...individual(row, route, stage, id, names), totalForms,
      dittoDisguise: row.dittoDisguise == null ? undefined : integer(row.dittoDisguise, 1, 649),
      dittoRevealed: row.dittoRevealed == null ? undefined : optionalBoolean(row.dittoRevealed) };
    progress = integer(row.usedAtStage, 0, maxTokens);
  }
  const sourceInventory = state.inventory == null ? {} : object(state.inventory) ?? invalid();
  const inventory = Object.fromEntries(bagItems.flatMap(item =>
    sourceInventory[item] == null ? [] : [[item, integer(sourceInventory[item], 0, maxTokens)]]));
  const spentTokens = state.spentTokens == null ? 0 : integer(state.spentTokens, 0, maxTokens);
  const eggTier = state.eggTier == null || state.eggTier === 'common' ? undefined : state.eggTier;
  if (eggTier !== undefined && eggTier !== 'uncommon' && eggTier !== 'rare') invalid();
  const pendingHatchID = state.pendingHatchID == null ? undefined : integer(state.pendingHatchID, 1, 649);
  const prayers = object(state.eggPrayers)?.count;
  const eggPrayers = prayers == null ? undefined : integer(prayers, 0, maxTokens);
  const representativeSpeciesID = state.representativeSpeciesID == null ? undefined : integer(state.representativeSpeciesID, 1, 649);
  const claims = state.challengeCashClaims == null ? {} : object(state.challengeCashClaims) ?? invalid();
  const challengeCashClaims = Object.fromEntries(Object.entries(claims).map(([key, amount]) =>
    [key, integer(amount, 0, maxTokens)]));
  const tiers = state.candyGrantTier == null ? {} : object(state.candyGrantTier) ?? invalid();
  const epochs = state.candyWindowEpoch == null ? {} : object(state.candyWindowEpoch) ?? invalid();
  const candyGrantTier = Object.fromEntries(Object.entries(tiers).map(([key, tier]) => [key, integer(tier, 0, maxTokens)]));
  const candyWindowEpoch = Object.fromEntries(Object.entries(epochs).map(([key, epoch]) => [key, string(epoch)]));
  return { progress: { raised, progress, active, graduated, spentTokens, inventory, eggTier, pendingHatchID,
    pendingForm: formOf(state.pendingForm), eggPrayers, representativeSpeciesID, representativeForm: formOf(state.representativeForm),
    challengeCashClaims,challengeShinyClaims:object(state.challengeShinyClaims) as Record<string,string>|undefined,collectedFinals:Array.isArray(state.collectedFinals)?state.collectedFinals.map(value=>string(value)):undefined, candyFeatureSeeded: optionalBoolean(state.candyFeatureSeeded), candyGrantTier, candyWindowEpoch }, appVersion, sourceDevice, exportedAt };
}

export async function readMacSave(path: string): Promise<ReturnType<typeof decodeMacSave>> {
  return decodeMacSave(await readSaveBytes(path));
}

// Reads an exported save at most once and within the size limit.
export async function readSaveBytes(path: string): Promise<Uint8Array> {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile()) invalid();
    if (info.size > maxBytes) throw new SaveImportError('저장 파일이 8MB를 초과합니다.');
    // Bound the read even if another process grows the file after stat().
    const data = Buffer.alloc(Math.min(info.size + 1, maxBytes + 1));
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await file.read(data, offset, data.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== info.size) throw new SaveImportError('읽는 동안 저장 파일이 변경되었습니다. 다시 선택해 주세요.');
    return data.subarray(0, offset);
  } finally { await file.close(); }
}

// Tells a Mac export from a Windows backup by the file's own format field.
export function detectSaveFormat(data: Uint8Array): 'mac' | 'windows' {
  let text = '';
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { /* reported below as an unknown file */ }
  let format: unknown;
  try { format = object(JSON.parse(text))?.format; } catch { format = /"format"\s*:\s*"([^"]+)"/.exec(text)?.[1]; }
  if (format === 'poketokenbar.save') return 'mac';
  if (format === 'poketokenbar.windows.backup') return 'windows';
  throw new SaveImportError('PokeTokenBar에서 내보낸 저장 파일이 아닙니다. Mac 또는 Windows 앱에서 내보낸 파일을 선택해 주세요.');
}
