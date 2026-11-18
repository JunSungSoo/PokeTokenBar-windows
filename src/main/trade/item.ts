import { wireMacProfile } from '../companion/mac-profile.js';
import type { Individual } from '../companion/store.js';
import { decodeMacSave } from '../companion/mac-save.js';
import { natureKey } from '../companion/catalog.js';
import { object, type Row } from '../usage/jsonl.js';
import type { Species } from '../../shared/companion.js';
import type { TradePreview } from '../../shared/trade.js';
import { appearance } from '../companion/forms.js';

export interface OfferedItem {
  item: Individual;
  active: boolean;
  progress: number;
  route: Species[];
  graduatedAt?: number;
}

const rarityNames = { common: '일반', uncommon: '고급', rare: '희귀', legendary: '전설' };

export function tradePreview(offer: OfferedItem): TradePreview {
  const {item,route}=offer;
  const species=route[item.stage];
  return {id:item.id,label:tradeLabel(offer),species:{...species,...appearance(species.number,item.form)},
    active:offer.active,shiny:item.shiny && !(item.dittoDisguise && !item.dittoRevealed),
    rarity:item.rarity ?? 'common',form:item.form,level:item.level,nature:item.nature,progress:offer.progress};
}

export function tradeLabel(offer: OfferedItem): string {
  const item = offer.item;
  const species = offer.route[item.stage];
  const labels = ['#' + species.number + ' ' + species.name, rarityNames[item.rarity ?? 'common']];
  if (item.form) labels.push(item.form + ' 폼');
  if (item.shiny && (!item.dittoDisguise || item.dittoRevealed)) labels.push('이로치');
  if (item.level) labels.push('Lv. ' + item.level);
  labels.push(offer.active ? '육성 중 · ' + offer.progress.toLocaleString('ko-KR') + ' 토큰' : '도감');
  return labels.join(' · ');
}

export function wireItem(offer: OfferedItem): Row {
  const { item, route } = offer;
  const ids = route.map(species => species.number);
  const common = {
    baseID: ids[0], rarity: item.rarity ?? 'common', isShiny: item.shiny,
    nature: natureKey(item.nature), form: item.form, profile: wireMacProfile(item.macProfile, item.id),
    prayers:item.prayers===undefined?undefined:{count:item.prayers},
  };
  if (offer.active) {
    return { activeMon: { _0: { ...common, pathIDs: ids.slice(0, item.stage + 1),
      plannedPathIDs: ids, stageIndex: item.stage, totalForms: item.totalForms ?? ids.length,
      usedAtStage: offer.progress, hasGrowthBoost: item.repeat,
      dittoDisguise: item.dittoDisguise, dittoRevealed: item.dittoRevealed,
      windowsIdentity: { id: item.id, hatchedAt: item.hatchedAt, level: item.level } } } };
  }
  return { dexEntry: { _0: { ...common, id: item.id, finalID: ids.at(-1), chainOrder: ids,
    battleDefaultItem:item.battleDefaultItem,
    championAchievedAt:item.championAchievedAt===undefined?undefined:(item.championAchievedAt-978307200000)/1000,
    caughtAt: offer.graduatedAt ? (offer.graduatedAt - 978307200000) / 1000 : undefined,
    names: Object.fromEntries(route.map(species => [species.number, { ko: species.name }])) } } };
}

export function readTradeItem(value: unknown): OfferedItem {
  const row = object(value);
  const keys = Object.keys(row ?? {});
  const active = keys[0] === 'activeMon';
  if (keys.length !== 1 || (!active && keys[0] !== 'dexEntry')) throw new Error('알 수 없는 교환 개체');
  const wire = object(object(row?.[keys[0]])?._0);
  if (!wire) throw new Error('잘못된 교환 개체');
  const item: Row = { ...wire };
  // Swift's TCP protocol uses default Codable dates, in seconds since 2001.
  for (const key of ['caughtAt', 'releasedAt','championAchievedAt']) {
    if (item[key] == null) continue;
    const seconds = item[key];
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new Error('잘못된 교환 날짜');
    item[key] = new Date(978307200000 + seconds * 1000).toISOString();
  }
  if (item.releasedAt) throw new Error('놓아준 개체는 교환할 수 없습니다.');
  if (!active && item.id == null) throw new Error('교환 개체 ID가 없습니다.');
  const { progress } = decodeMacSave(Buffer.from(JSON.stringify({
    format: 'poketokenbar.save', schema: 2, appVersion: 'trade', sourceDevice: 'LAN',
    exportedAt: '2026-01-01T00:00:00Z',
    state: { usedSinceInstall: 0, eggUsage: 0, active: active ? item : undefined, dex: active ? [] : [item] },
  })));
  const incoming = active ? progress.active! : progress.graduated[0];
  const identity = active ? object(item.windowsIdentity) : undefined;
  if (identity && typeof identity.id === 'string' && identity.id.length > 0 && identity.id.length <= 256 &&
      typeof identity.hatchedAt === 'number' && Number.isSafeInteger(identity.hatchedAt) && identity.hatchedAt >= 0 &&
      identity.hatchedAt <= 8.64e15) {
    incoming.id = identity.id;
    incoming.hatchedAt = identity.hatchedAt;
    if (typeof identity.level === 'number' && Number.isInteger(identity.level) && identity.level >= 1 && identity.level <= 100) {
      incoming.level = identity.level;
    }
  }
  return { item: incoming, active, progress: progress.progress, route: incoming.route!, graduatedAt: progress.graduated[0]?.graduatedAt };
}
