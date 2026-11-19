import test from 'node:test';
import assert from 'node:assert/strict';
import { isInstalledBuild } from '../dist/main/update/installed-build.js';

const installDirectory = 'C:\\Users\\me\\AppData\\Local\\Programs\\PokeTokenBar Windows';
const environment = (overrides = {}) => ({
  platform: 'win32',
  packaged: true,
  executablePath: installDirectory + '\\PokeTokenBar Windows.exe',
  appPath: installDirectory + '\\resources\\app.asar',
  exists: path => path === installDirectory + '\\Uninstall PokeTokenBar Windows.exe',
  readText: path => {
    assert.equal(path, installDirectory + '\\resources\\app.asar\\package.json');
    return JSON.stringify({ version: '1.0.3' });
  },
  ...overrides,
});

test('a packaged NSIS install with an uninstaller and no portable flag is an installed build', () => {
  assert.equal(isInstalledBuild(environment()), true);
});

test('portable, development, non-Windows and uninstaller-less builds fall back to the browser', () => {
  assert.equal(isInstalledBuild(environment({ platform: 'darwin' })), false);
  assert.equal(isInstalledBuild(environment({ packaged: false })), false);
  assert.equal(isInstalledBuild(environment({ exists: () => false })), false);
  assert.equal(isInstalledBuild(environment({ readText: () => JSON.stringify({ portableBuild: true }) })), false);
});

test('an unreadable or malformed app package is not treated as installed', () => {
  assert.equal(isInstalledBuild(environment({ readText: () => { throw new Error('missing'); } })), false);
  assert.equal(isInstalledBuild(environment({ readText: () => '{not json' })), false);
});
