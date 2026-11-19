import { windowsReleaseBase } from '../../shared/github-release.js';
import { updatePublicKeys } from './public-keys.js';

export type UpdateSource = { feed: string; keys: readonly string[] };

export const productionUpdateSource: UpdateSource = { feed: windowsReleaseBase, keys: updatePublicKeys };

const isQAOverride = (value: unknown): value is { feed: string; publicKey: string } => {
  if (!value || typeof value !== 'object') return false;
  const { feed, publicKey } = value as Record<string, unknown>;
  return typeof feed === 'string' && /^https?:\/\/[^\s]+\/$/.test(feed) && typeof publicKey === 'string' && publicKey.length > 0;
};

// Uses package.json updateQA (injected only into QA builds) for the feed and key; otherwise the production source.
export const resolveUpdateSource = (packageMetadata: unknown, fallback: UpdateSource = productionUpdateSource): UpdateSource => {
  const override = packageMetadata && typeof packageMetadata === 'object'
    ? (packageMetadata as Record<string, unknown>).updateQA
    : undefined;
  return isQAOverride(override) ? { feed: override.feed, keys: [override.publicKey] } : fallback;
};
