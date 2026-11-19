import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { readPassphrase } from './passphrase-input.mjs';
import { assertDraftRelease, assertSigningKeyTrusted, assertSourceMatchesTag, assertVersionRule, loadKey, publicKeyOf, sign } from './signing.mjs';

const runFile = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const keyPath = process.env.PTB_SIGNING_KEY || join(homedir(), '.poketokenbar', 'windows-update-signing.pem');
const dryRun = process.env.PTB_DRY_RUN === '1';

const fail = message => {
  console.error(message);
  process.exit(1);
};

const importBuilt = async relativePath => {
  const filePath = join(projectRoot, 'dist', relativePath);
  if (!existsSync(filePath)) fail("빌드 결과(dist)가 없습니다. 'pnpm build' 를 먼저 실행하세요 ('pnpm release:sign' 은 자동으로 빌드합니다).");
  return import(pathToFileURL(filePath).href);
};

const runGh = async (repository, args) => {
  try {
    const { stdout } = await runFile('gh', [...args, '-R', repository], { maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    throw new Error(`gh 명령이 실패했습니다 (gh ${args.slice(0, 2).join(' ')}): ${error.stderr?.trim() || error.message}`);
  }
};

const runGit = async args => {
  try {
    const { stdout } = await runFile('git', args, { cwd: projectRoot });
    return stdout.trim();
  } catch (error) {
    throw new Error(`git 명령이 실패했습니다 (git ${args.join(' ')}): ${error.stderr?.trim() || error.message}`);
  }
};

// Returns the tag's commit, or an empty string when the tag does not exist locally.
const readTagCommit = tag => runGit(['rev-parse', '--verify', '--quiet', `${tag}^{commit}`]).catch(() => '');

// Confirms the checkout is exactly the tagged commit before trusting its public key list.
const assertCheckoutAtTag = async tag => {
  const headCommit = await runGit(['rev-parse', 'HEAD']);
  const tagCommit = await readTagCommit(tag);
  const keysStatus = await runGit(['status', '--porcelain', '--', 'src/main/update/public-keys.ts']);
  assertSourceMatchesTag({ tag, headCommit, tagCommit, keysStatus });
};

const main = async () => {
  const version = process.argv[2];
  const packageVersion = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).version;
  assertVersionRule(version ?? '', packageVersion);
  const tag = `v${version}`;
  const installerName = `PokeTokenBar-Windows-${version}-x64-Setup.exe`;
  await assertCheckoutAtTag(tag);

  const { windowsReleaseRepository: repository } = await importBuilt('shared/github-release.js');
  const { parseUpdateManifest, verifyManifest } = await importBuilt('main/update/manifest.js');
  const { updatePublicKeys } = await importBuilt('main/update/public-keys.js');
  if (!existsSync(keyPath)) fail(`서명 키 파일이 없습니다: ${keyPath}`);

  const release = JSON.parse(await runGh(repository, ['release', 'view', tag, '--json', 'isDraft,assets']));
  assertDraftRelease(release, version);

  const workDirectory = await mkdtemp(join(tmpdir(), 'ptb-sign-'));
  try {
    await runGh(repository, ['release', 'download', tag, '--dir', workDirectory, '--pattern', 'latest.yml', '--pattern', installerName]);
    const manifestBytes = await readFile(join(workDirectory, 'latest.yml'));
    const manifest = parseUpdateManifest(manifestBytes.toString('utf8'));
    if (!manifest) throw new Error('latest.yml 형식이 올바르지 않습니다 (버전·파일명·sha512 확인).');
    if (manifest.version !== version) throw new Error(`latest.yml 버전(${manifest.version})이 ${version} 과 다릅니다.`);
    const installerDigest = createHash('sha512').update(await readFile(join(workDirectory, installerName))).digest('base64');
    if (installerDigest !== manifest.sha512) throw new Error('설치 파일의 SHA-512 가 latest.yml 과 다릅니다.');

    const privateKey = loadKey(readFileSync(keyPath, 'utf8'), await readPassphrase());
    assertSigningKeyTrusted(publicKeyOf(privateKey), updatePublicKeys);
    const signature = sign(manifestBytes, privateKey);
    if (!verifyManifest(manifestBytes, signature, updatePublicKeys)) throw new Error('서명 재검증에 실패했습니다. 업로드하지 않습니다.');

    if (dryRun) {
      console.log(`[DRY RUN] ${tag} 검증과 서명이 모두 통과했습니다. latest.yml.sig 업로드와 릴리스 공개는 건너뜁니다.`);
      return;
    }
    const signaturePath = join(workDirectory, 'latest.yml.sig');
    await writeFile(signaturePath, signature);
    await runGh(repository, ['release', 'upload', tag, signaturePath, '--clobber']);
    await runGh(repository, ['release', 'edit', tag, '--draft=false']);
    console.log(`${tag} 에 latest.yml.sig 를 올리고 릴리스를 공개했습니다.`);
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
};

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
