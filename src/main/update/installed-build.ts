import { win32 } from 'node:path';

export const uninstallerName = 'Uninstall PokeTokenBar Windows.exe';

export type InstalledBuildEnvironment = {
  platform: string;
  packaged: boolean;
  executablePath: string;
  appPath: string;
  exists: (path: string) => boolean;
  readText: (path: string) => string;
};

const isPortablePackage = (environment: InstalledBuildEnvironment): boolean => {
  try {
    return JSON.parse(environment.readText(win32.join(environment.appPath, 'package.json'))).portableBuild === true;
  } catch {
    return true;
  }
};

// True only for a packaged Windows NSIS install whose app package is not marked portable.
export const isInstalledBuild = (environment: InstalledBuildEnvironment): boolean =>
  environment.platform === 'win32' &&
  environment.packaged &&
  environment.exists(win32.join(win32.dirname(environment.executablePath), uninstallerName)) &&
  !isPortablePackage(environment);
