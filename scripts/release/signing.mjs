import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign as signBytes } from 'node:crypto';

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const versionPattern = /^\d+\.\d+\.\d+$/;
const passphraseGroupSize = 4;

// Generates an encrypted PKCS#8 Ed25519 key; the public key is raw 32-byte base64 like the app expects.
export const generateKey = passphrase => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase },
  });
  return { pem: privateKey, publicKey: publicKeyOf(createPrivateKey({ key: privateKey, passphrase })) };
};

export const loadKey = (pem, passphrase) => {
  try {
    return createPrivateKey({ key: pem, format: 'pem', passphrase });
  } catch {
    throw new Error('비밀번호가 틀렸거나 키 파일이 손상되었습니다.');
  }
};

export const publicKeyOf = privateKey =>
  Buffer.from(createPublicKey(privateKey).export({ format: 'jwk' }).x, 'base64url').toString('base64');

export const sign = (bytes, privateKey) => signBytes(null, bytes, privateKey).toString('base64');

const encodeBase32 = bytes => {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += base32Alphabet[(value << (5 - bits)) & 31];
  return output;
};

// 128-bit passphrase in grouped base32 so it is easy to copy onto paper.
export const randomPassphrase = () =>
  encodeBase32(randomBytes(16)).match(new RegExp(`.{1,${passphraseGroupSize}}`, 'g')).join('-');

export const assertVersionRule = (version, packageVersion) => {
  if (!versionPattern.test(version)) throw new Error(`버전 형식이 올바르지 않습니다: ${version} (예: 1.0.3)`);
  if (version !== packageVersion) {
    throw new Error(`package.json 버전(${packageVersion})과 입력한 버전(${version})이 다릅니다.`);
  }
};

export const assertSigningKeyTrusted = (publicKey, trustedKeys) => {
  if (!trustedKeys.includes(publicKey)) {
    throw new Error('이 서명 키의 공개 키가 앱의 updatePublicKeys 에 없습니다. 이대로 서명하면 설치된 앱이 업데이트를 거부합니다.');
  }
};

export const assertDraftRelease = (release, version) => {
  if (!release.isDraft) throw new Error(`v${version} 릴리스가 초안이 아닙니다. 이미 공개되었거나 CI 초안이 없습니다.`);
  const names = new Set(release.assets.map(asset => asset.name));
  const installerName = `PokeTokenBar-Windows-${version}-x64-Setup.exe`;
  if (!names.has(installerName)) throw new Error(`초안에 ${installerName} 이 없습니다. CI 빌드를 확인하세요.`);
  if (!names.has('latest.yml')) throw new Error('초안에 latest.yml 이 없습니다. CI 빌드를 확인하세요.');
};

// Ensures the key list being trusted is the one compiled into the tagged release build.
export const assertSourceMatchesTag = ({ tag, headCommit, tagCommit, keysStatus }) => {
  if (!tagCommit) throw new Error(`로컬에 ${tag} 태그가 없습니다. 'git fetch --tags' 후 다시 실행하세요.`);
  if (headCommit !== tagCommit) {
    throw new Error(`현재 HEAD(${headCommit.slice(0, 7)})가 ${tag} 태그 커밋(${tagCommit.slice(0, 7)})과 다릅니다. 'git checkout ${tag}' 후 서명하세요.`);
  }
  if (keysStatus.trim()) {
    throw new Error('src/main/update/public-keys.ts 에 커밋되지 않은 변경이 있습니다. 태그에 포함된 공개 키 목록으로만 서명할 수 있습니다.');
  }
};
