import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPassphrase } from './passphrase-input.mjs';
import { generateKey, loadKey, publicKeyOf, randomPassphrase } from './signing.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const keyPath = process.env.PTB_SIGNING_KEY || join(homedir(), '.poketokenbar', 'windows-update-signing.pem');

const fail = message => {
  console.error(message);
  process.exit(1);
};

const readKeyFile = () => {
  if (!existsSync(keyPath)) fail(`서명 키 파일이 없습니다: ${keyPath}\n먼저 'pnpm release:key init' 을 실행하세요.`);
  return readFileSync(keyPath, 'utf8');
};

const loadPrivateKey = async () => {
  const pem = readKeyFile();
  return loadKey(pem, await readPassphrase());
};

const init = () => {
  if (existsSync(keyPath)) fail(`이미 서명 키가 있습니다: ${keyPath}\n덮어쓰지 않습니다. 새 키가 정말 필요하면 파일을 직접 옮긴 뒤 다시 실행하세요.`);
  const passphrase = randomPassphrase();
  const { pem, publicKey } = generateKey(passphrase);
  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
  writeFileSync(keyPath, pem, { mode: 0o600, flag: 'wx' });
  console.log(`서명 키를 만들었습니다: ${keyPath}\n`);
  console.log('=== 비밀번호 (지금 한 번만 표시됩니다. 종이에 적어 두세요) ===');
  console.log(passphrase);
  console.log('\n=== 공개 키 (src/main/update/public-keys.ts 의 updatePublicKeys 에 넣을 값) ===');
  console.log(publicKey);
  console.log(`
보관 안내
- 비밀번호는 종이에 적어 안전한 곳에 보관하세요. 파일·채팅·git 에 남기지 마세요.
- 암호화된 키 파일(${keyPath})은 비공개 클라우드와 USB 등 2곳 이상에 백업하세요.
- 키 파일이나 비밀번호를 잃으면 이미 설치된 앱은 더 이상 업데이트할 수 없습니다.`);
};

const showPublic = async () => {
  console.log(publicKeyOf(await loadPrivateKey()));
};

const verify = async () => {
  const publicKey = publicKeyOf(await loadPrivateKey());
  console.log('비밀번호가 맞습니다. 키 파일을 읽을 수 있습니다.');
  const publicKeysPath = join(projectRoot, 'dist', 'main', 'update', 'public-keys.js');
  if (!existsSync(publicKeysPath)) fail("빌드 결과(dist)가 없어 앱 키 목록을 확인하지 못했습니다. 'pnpm build' 후 다시 실행하세요.");
  const { updatePublicKeys } = await import(pathToFileURL(publicKeysPath).href);
  if (updatePublicKeys.includes(publicKey)) console.log('공개 키가 앱의 updatePublicKeys 에 포함되어 있습니다.');
  else fail(`공개 키가 앱의 updatePublicKeys 에 없습니다. 아래 값을 추가하세요.\n${publicKey}`);
};

const commands = { init, public: showPublic, verify };
const command = commands[process.argv[2]];
if (!command) fail('사용법: node scripts/release/key.mjs <init|public|verify>');
try {
  await command();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
