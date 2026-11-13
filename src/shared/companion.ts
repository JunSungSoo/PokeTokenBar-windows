export interface Species {
  number: number;
  name: string;
  type: string;
  form?: string;
  spriteID?: string;
  animated?: string;
}

export interface CompanionProfile {
  id: string;
  hatchedAt: number;
  nature: string;
  shiny: boolean;
  species: Species[];
  graduatedAt?: number;
  championAchievedAt?:number;
  battleDefaultItem?:string;
  releasedAt?: number;
  rarity?: Rarity;
  form?: string;
  level?: number;
  totalForms?: number;
  repeatGrowth?: boolean;
  ivs?: Record<string, number>;
  ability?: string;
  abilityIsHidden?: boolean;
  gender?: 'male' | 'female' | 'genderless';
  moves?: string[];
  hasCustomMoves?: boolean;
}

export interface CompanionView {
  current: Species | null;
  progress: number;
  threshold: number;
  next: Species | null;
  evolutionPathMissing?: boolean;
  raised: number;
  active: CompanionProfile | null;
  collection: Species[];
  captures: CompanionProfile[];
  planned: Species[];
  evolutionPreview?: { species: Species | null; reached: boolean; current: boolean }[];
  pet: { species: Species | null; shiny: boolean };
  prayers: number;
  dittoReveal?: { id: string; disguise: string; shiny: boolean };
  economy: CompanionEconomy;
}

export const rarities = ['common', 'uncommon', 'rare', 'legendary'] as const;
export type Rarity = typeof rarities[number];

export interface SaveImportPreview {
  token: string;
  file: string;
  appVersion: string;
  sourceDevice: string;
  exportedAt: number;
  current: CompanionView;
  incoming: CompanionView;
}

export interface SaveImportResult {
  companion: CompanionView;
  backupPath: string | null;
}

export const shopCatalog = {
  mint: { name: '민트', icon: '🌿', price: 100_000_000, description: '현재 포켓몬의 성격을 랜덤으로 바꿔줘요.' },
  redMaple: { name: '붉은 단풍', icon: '🍁', price: 100_000_000, description: '선택한 포켓몬의 종족값을 랜덤하게 변경해요.' },
  rareCandy: { name: '이상한 사탕', icon: '🍬', sprite: 'rare-candy', price: 500_000_000, description: '현재 포켓몬의 경험치를 100M 올려줘요.' },
  shinyCharm: { name: '이로치 부적', icon: '✨', sprite: 'shiny-charm', price: 3_000_000_000, description: '보유하면 이로치 포켓몬이 태어날 확률이 올라가요.' },
  egg: { name: '포켓몬 알', icon: '🥚', sprite: 'egg', price: 1_000_000_000, description: '지금 포켓몬을 놓아주고 새 알로 다시 시작해요.' },
  eggUncommon: { name: '고급 알', icon: '🥚', sprite: 'egg', price: 2_500_000_000, description: '지금 포켓몬을 놓아주고 고급 이상이 확정으로 나오는 알을 받아요.' },
  eggRare: { name: '희귀 알', icon: '🥚', sprite: 'egg', price: 4_000_000_000, description: '지금 포켓몬을 놓아주고 희귀 이상이 확정으로 나오는 알을 받아요.' },
} as const;
export type Product = keyof typeof shopCatalog;
export type BagItem = Exclude<Product, 'egg' | 'eggUncommon' | 'eggRare'>;
export type EggTier = Extract<Rarity, 'uncommon' | 'rare'>;
export const bagItems: BagItem[] = ['rareCandy', 'mint', 'redMaple', 'shinyCharm'];
export const candyXP = 100_000_000;

export type CompanionAction =
  | { kind:'battle-default-item';id:string;item:string }
  | { kind: 'difficulty'; growth: number; shop: number }
  | { kind: 'buy'; product: Product; quantity: number; activeID?: string }
  | { kind: 'use'; item: BagItem; quantity: number; id: string }
  | { kind: 'representative'; speciesID: number | null; form?: string };

export interface CompanionEconomy {
  growthDifficulty: number;
  shopDifficulty: number;
  prices: Record<Product, number>;
  wallet: number;
  spent: number;
  inventory: Partial<Record<BagItem, number>>;
  eggTier?: EggTier;
  maxCandy: number;
  candyStages: { threshold: number; species: Species | null }[];
  representative: { speciesID: number; form?: string } | null;
  representativeShiny: boolean;
}
