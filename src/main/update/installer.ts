import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { AppUpdater } from 'electron-updater';
import type { SignedRelease } from './manifest.js';

const blockedMessage = '배틀·챌린지·교환 중에는 업데이트할 수 없습니다.';
const verificationFailedMessage = '업데이트 파일을 검증하지 못했습니다.';
const installFailedMessage = '업데이트 설치를 시작하지 못했습니다. 앱을 다시 실행합니다.';
const defaultQuitTimeoutMs = 15_000;

export type UpdateInstallerDependencies = {
  updater: Pick<AppUpdater, 'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall' | 'once' | 'removeListener'>;
  blocked: () => boolean;
  prepare: () => Promise<void>;
  hashFile: (path: string) => Promise<string>;
  // Restores a usable app after prepare() suspended usage; production relaunches the process.
  recover: () => void;
  quitTimeoutMs?: number;
};

// Streams a file through SHA-512 and returns the base64 digest.
export const sha512File = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha512');
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')));
  });

// Installs only after every updater step matches the signed release; concurrent calls share one run.
export class UpdateInstaller {
  private inFlight: Promise<void> | undefined;

  constructor(private readonly dependencies: UpdateInstallerDependencies) {}

  install(release: SignedRelease): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const run = this.run(release).finally(() => {
      this.inFlight = undefined;
    });
    this.inFlight = run;
    return run;
  }

  private async run(release: SignedRelease): Promise<void> {
    const { updater, blocked, prepare, hashFile } = this.dependencies;
    if (blocked()) throw new Error(blockedMessage);

    const checkResult = await updater.checkForUpdates();
    const info = checkResult?.updateInfo;
    if (!info || info.version !== release.version || info.path !== release.path || info.sha512 !== release.sha512) {
      throw new Error(verificationFailedMessage);
    }

    const downloadedPath = (await updater.downloadUpdate())[0];
    if (!downloadedPath || (await hashFile(downloadedPath)) !== release.sha512) {
      throw new Error(verificationFailedMessage);
    }

    if (blocked()) throw new Error(blockedMessage);
    await prepare();
    try {
      this.quitAndInstall();
    } catch (error) {
      this.dependencies.recover();
      throw error;
    }
    this.scheduleQuitFallback();
  }

  // electron-updater reports install failures through its 'error' event instead of throwing.
  private quitAndInstall(): void {
    const { updater } = this.dependencies;
    let installError: unknown;
    const capture = (error: unknown) => {
      installError ??= error;
    };
    updater.once('error', capture);
    try {
      updater.quitAndInstall(true, true);
    } finally {
      updater.removeListener('error', capture);
    }
    if (installError !== undefined) throw new Error(installFailedMessage, { cause: installError });
  }

  // Recovers when the app is still running long after quitAndInstall asked it to quit.
  private scheduleQuitFallback(): void {
    const { recover, quitTimeoutMs = defaultQuitTimeoutMs } = this.dependencies;
    const timer = setTimeout(() => {
      console.error('Update install did not quit the app in time; relaunching.');
      recover();
    }, quitTimeoutMs);
    timer.unref?.();
  }
}
