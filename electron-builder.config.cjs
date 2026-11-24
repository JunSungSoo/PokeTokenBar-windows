const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const qa = process.env.POKE_WINDOWS_QA === '1';
const portable = process.env.POKE_PORTABLE_BUILD === '1';
const qaFeed = 'http://127.0.0.1:4173/';
const qaPublicKey = process.env.POKE_UPDATE_QA_PUBLIC_KEY;
// Must match windowsReleaseBase in src/shared/github-release.ts.
const releaseFeed = 'https://github.com/JunSungSoo/PokeTokenBar-windows/releases/latest/download/';

if (!qa) {
  const keysSource = readFileSync(join(__dirname, 'src/main/update/public-keys.ts'), 'utf8');
  const keyList = keysSource.match(/updatePublicKeys[^=]*=\s*\[([^\]]*)\]/)?.[1];
  // Requires at least one raw 32-byte Ed25519 key (43 base64 chars + '=') and no placeholder.
  const hasRealKey = keyList !== undefined && /'[A-Za-z0-9+/]{43}='/.test(keyList);
  if (!hasRealKey || /REPLACE_WITH_RELEASE_KEY|placeholderKey/.test(keyList)) {
    throw new Error('업데이트 공개 키가 없거나 자리표시자이거나 형식이 올바르지 않습니다. `pnpm release:key init` 으로 만든 공개 키(44자 base64)를 src/main/update/public-keys.ts 에 넣거나, 로컬 테스트라면 POKE_WINDOWS_QA=1 로 빌드하세요.');
  }
}

module.exports = {
  appId: 'com.poketokenbar.windows',
  productName: 'PokeTokenBar Windows',
  extraMetadata: {
    portableBuild: portable,
    instanceHandoff: 1,
    ...(qa && qaPublicKey ? { updateQA: { feed: qaFeed, publicKey: qaPublicKey } } : {}),
  },
  executableName: 'PokeTokenBar',
  directories: { output: process.env.POKE_WINDOWS_OUTPUT || 'release' },
  files: ['dist/**/*', 'package.json'],
  protocols: [{ name: 'PokeTokenBar agent activity', schemes: ['poketokenbar'] }],
  asar: true,
  asarUnpack: ['dist/main/power-monitor.ps1','dist/main/instance-bridge.ps1'],
  npmRebuild: false,
  forceCodeSigning: false,
  artifactName: 'PokeTokenBar-Windows-${version}-${arch}-Setup.${ext}',
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/windows-icon.png',
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: 'PokeTokenBar Windows',
    include: 'scripts/windows-installer.nsh',
  },
  publish: portable ? null : qa
    ? { provider: 'generic', url: qaFeed, useMultipleRangeRequest: false }
    : { provider: 'generic', url: releaseFeed },
};
