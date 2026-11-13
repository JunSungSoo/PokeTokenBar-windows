import type { Product, BagItem } from './companion.js';
/** Reference: ItemKind.allCases and CompanionStore.shopEntries, Mac deaf07e. */
export const itemOrder: BagItem[] = ['rareCandy', 'mint', 'redMaple', 'shinyCharm'];
export const productOrder: Product[] = [...itemOrder, 'egg', 'eggUncommon', 'eggRare'];
export function sortedShop(prices: Record<Product, number>, inventory: Partial<Record<BagItem, number>>): Product[] {
  return [...productOrder].sort((a,b) => Number(a === 'shinyCharm' && Boolean(inventory.shinyCharm)) - Number(b === 'shinyCharm' && Boolean(inventory.shinyCharm)) || prices[a] - prices[b]);
}
export const typeColors: Record<string, string> = {
  normal:'#AAAA99',fire:'#FF4422',water:'#3399FF',electric:'#FFCC33',grass:'#77CC55',ice:'#66CCFF',fighting:'#BB5544',poison:'#AA5599',ground:'#DDBB55',flying:'#8899FF',psychic:'#FF5599',bug:'#AABB22',rock:'#BBAA66',ghost:'#6666BB',dragon:'#7766EE',dark:'#775544',steel:'#AAAABB',fairy:'#EE99EE',
};
export function activityState(active: boolean, today: number, burn: number, lastUsageAt: number | undefined, limitWarning: boolean, now: number) {
  if (!active) return 'egg';
  if (limitWarning) return 'tired';
  if (lastUsageAt !== undefined && now-lastUsageAt >= 3*3600000) return 'sulk';
  if (lastUsageAt === undefined || today === 0) return 'sleep';
  return burn <= 1000 ? 'idle' : burn < 100000 ? 'working' : 'focus';
}
