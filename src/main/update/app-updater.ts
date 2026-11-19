import { existsSync, readFileSync } from 'node:fs';
import { app } from 'electron';
import electronUpdater from 'electron-updater';
import { join } from 'node:path';
import { isInstalledBuild } from './installed-build.js';
import { UpdateInstaller, sha512File } from './installer.js';
import { productionUpdateSource, resolveUpdateSource, type UpdateSource } from './update-source.js';

// Reads the packaged package.json once; an unreadable file falls back to the production feed and keys.
export function readUpdateSource(): UpdateSource {
  try {
    return resolveUpdateSource(JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')));
  } catch (error) {
    console.error('Update source unreadable; using production feed:', error);
    return productionUpdateSource;
  }
}

// Returns the signed-release installer for NSIS installs, or undefined so the UI opens the release page.
export function createAppUpdateInstaller(blocked: () => boolean, prepare: () => Promise<void>, recover: () => void, source: UpdateSource): UpdateInstaller | undefined {
  const installed = isInstalledBuild({
    platform: process.platform,
    packaged: app.isPackaged,
    executablePath: process.execPath,
    appPath: app.getAppPath(),
    exists: existsSync,
    readText: path => readFileSync(path, 'utf8'),
  });
  if (!installed) return undefined;
  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.setFeedURL({ provider: 'generic', url: source.feed });
  return new UpdateInstaller({ updater: autoUpdater, blocked, prepare, recover, hashFile: sha512File });
}
