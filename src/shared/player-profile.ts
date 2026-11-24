export const defaultProfileNickname = 'PokeTokenBar Windows';
export const profileIconCount = 251;

export interface PlayerProfile {
  nickname: string;
  icon?: number;
}

export function profileIcon(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= profileIconCount
    ? value : undefined;
}

export function playerProfile(nickname: string, icon?: unknown): PlayerProfile {
  return { nickname: nickname.trim().slice(0, 40) || defaultProfileNickname, icon: profileIcon(icon) };
}
