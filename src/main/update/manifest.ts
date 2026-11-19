import { createPublicKey, verify } from 'node:crypto';

export type SignedRelease = { version: string; path: string; sha512: string };

const versionPattern = /^\d+\.\d+\.\d+$/;
const sha512ByteLength = 64;

const unquote = (value: string): string => value.replace(/^(['"])(.*)\1$/, '$2');

const readTopLevelValues = (yml: string): Map<string, string> => {
  const values = new Map<string, string>();
  for (const line of yml.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_]+):[ \t]*(.*?)[ \t]*$/.exec(line);
    if (match && !values.has(match[1])) values.set(match[1], unquote(match[2]));
  }
  return values;
};

const isStrictBase64 = (value: string): boolean =>
  /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, 'base64').toString('base64') === value;

// Reads only top-level version/path/sha512 and enforces the fixed installer file name.
export const parseUpdateManifest = (yml: string): SignedRelease | undefined => {
  const values = readTopLevelValues(yml);
  const version = values.get('version');
  const path = values.get('path');
  const sha512 = values.get('sha512');
  if (!version || !path || !sha512) return undefined;
  if (!versionPattern.test(version)) return undefined;
  if (path !== `PokeTokenBar-Windows-${version}-x64-Setup.exe`) return undefined;
  if (!isStrictBase64(sha512) || Buffer.from(sha512, 'base64').length !== sha512ByteLength) return undefined;
  return { version, path, sha512 };
};

const verifyWithKey = (bytes: Buffer, signature: Buffer, rawPublicKeyBase64: string): boolean => {
  try {
    const rawPublicKey = Buffer.from(rawPublicKeyBase64, 'base64');
    if (rawPublicKey.length !== 32) return false;
    const publicKey = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: rawPublicKey.toString('base64url') },
      format: 'jwk',
    });
    return verify(null, bytes, publicKey, signature);
  } catch {
    return false;
  }
};

// Returns true when any listed key validates the Ed25519 signature; never throws.
export const verifyManifest = (bytes: Buffer, signatureBase64: string, keys: readonly string[]): boolean => {
  if (!isStrictBase64(signatureBase64)) return false;
  const signature = Buffer.from(signatureBase64, 'base64');
  return keys.some(key => verifyWithKey(bytes, signature, key));
};
