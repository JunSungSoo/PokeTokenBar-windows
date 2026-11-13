const qa = process.env.POKE_WINDOWS_QA === '1';
const repo = process.env.POKE_UPDATE_REPOSITORY || process.env.GITHUB_REPOSITORY;
if (!qa && !/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) {
  throw new Error('Set POKE_UPDATE_REPOSITORY to the public GitHub owner/repo, or set POKE_WINDOWS_QA=1 for local testing.');
}
if (!qa && (!process.env.CSC_LINK || !process.env.POKE_WINDOWS_PUBLISHER)) {
  throw new Error('A release build requires CSC_LINK and the certificate subject name in POKE_WINDOWS_PUBLISHER.');
}

module.exports = {
  appId: 'com.poketokenbar.windows',
  productName: 'PokeTokenBar Windows',
  executableName: 'PokeTokenBar',
  directories: { output: process.env.POKE_WINDOWS_OUTPUT || 'release' },
  files: ['dist/**/*', 'package.json'],
  protocols: [{ name: 'PokeTokenBar agent activity', schemes: ['poketokenbar'] }],
  asar: true,
  npmRebuild: false,
  forceCodeSigning: !qa,
  artifactName: 'PokeTokenBar-Windows-${version}-${arch}-Setup.${ext}',
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/windows-icon.png',
    verifyUpdateCodeSignature: !qa,
    ...(qa ? {} : { signtoolOptions: { publisherName: [process.env.POKE_WINDOWS_PUBLISHER] } }),
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
    runAfterFinish: false,
    createDesktopShortcut: false,
    shortcutName: 'PokeTokenBar Windows',
    include: 'scripts/windows-installer.nsh',
  },
  publish: qa
    ? { provider: 'generic', url: 'http://127.0.0.1:4173/', useMultipleRangeRequest: false }
    : { provider: 'github', owner: repo.split('/')[0], repo: repo.split('/')[1], private: false },
};
