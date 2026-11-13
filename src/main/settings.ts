import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, dialog, ipcMain, nativeTheme, shell, type BrowserWindow } from 'electron';
import { providers, type Provider } from '../shared/usage.js';
import type { AppSettings } from '../shared/settings.js';
import { writeSaveAtomically } from './companion/store.js';
import { object } from './usage/jsonl.js';

export class SettingsStore {
  private queue: Promise<unknown> = Promise.resolve();
  private value: AppSettings = {
    language: 'system', animationQuality: 'powerSaver', statusChecks: true, petAgentActivity: true,
    activityVisualization:'bars',theme: 'light', animated: true, back: false, refreshSeconds: 300, trend: '14', limitMode: 'used',
    providers: [...providers], petEnabled: false, petSize: 96, companionNotifications: true,
    limitNotifications: true, warnThreshold: 80, criticalThreshold: 95, updateNotifications: true,
    trayTokens: true, trayCost: false, trayGrowth: false, trayLimits: true, tradeNickname: '', claudeRoots: [],
  };
  private listeners: ((settings: AppSettings) => void)[] = [];

  constructor(private path: string) {}
  get(): AppSettings { return structuredClone(this.value); }
  subscribe(listener: (settings: AppSettings) => void) { this.listeners.push(listener); }

  async load(): Promise<void> {
    try {
      const patch: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      this.value = { ...this.value, ...this.validate(patch) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    nativeTheme.themeSource = this.value.theme;
  }

  private validate(raw: unknown): Partial<AppSettings> {
    const patch = object(raw);
    if (!patch) throw new Error('설정 형식을 확인해 주세요.');
    for (const [key, value] of Object.entries(patch)) {
      const checks = {
        language: typeof value === 'string' && ['system', 'ko', 'en', 'ja', 'es', 'fr', 'pt', 'de', 'ru'].includes(value),
        animationQuality: typeof value === 'string' && ['powerSaver', 'balanced', 'smooth'].includes(value),
        statusChecks: typeof value === 'boolean',
        petAgentActivity: typeof value === 'boolean',
        theme: ['system', 'light', 'dark'].includes(String(value)),
        animated: typeof value === 'boolean',
        back: typeof value === 'boolean',
        refreshSeconds: [0, 60, 120, 300, 600, 900].includes(Number(value)) && typeof value === 'number',
        activityVisualization: ['bars','heatmap'].includes(String(value)),
        trend: typeof value === 'string' && ['14', '30', 'month'].includes(value),
        limitMode: ['used', 'remaining'].includes(String(value)),
        providers: Array.isArray(value) && value.every(id => providers.includes(id as Provider)) && new Set(value).size === value.length,
        petEnabled: typeof value === 'boolean',
        petSize: typeof value === 'number' && Number.isInteger(value) && value >= 48 && value <= 384 && value % 8 === 0,
        companionNotifications: typeof value === 'boolean',
        limitNotifications: typeof value === 'boolean',
        warnThreshold: typeof value === 'number' && [50,55,60,65,70,75,80,85,90,95].includes(value),
        criticalThreshold: typeof value === 'number' && [80,85,90,95,100].includes(value),
        updateNotifications: typeof value === 'boolean',
        trayTokens: typeof value === 'boolean',
        trayCost: typeof value === 'boolean',
        trayGrowth: typeof value === 'boolean',
        trayLimits: typeof value === 'boolean',
        claudeRoots: Array.isArray(value) && value.length <= 8 && value.every(path => typeof path === 'string' &&
          path.length > 0 && path.length <= 1024) && new Set(value).size === value.length,
        tradeNickname: typeof value === 'string' && value.trim().length <= 40,
      };
      if (!Object.hasOwn(checks, key) || !checks[key as keyof typeof checks]) throw new Error('지원하지 않는 설정 값입니다.');
    }
    return patch;
  }

  change(patch: unknown): Promise<AppSettings> {
    const valid = this.validate(patch);
    const result = this.queue.then(async () => {
      const next = { ...this.value, ...valid };
      if (next.warnThreshold >= next.criticalThreshold) {
        if (valid.criticalThreshold !== undefined) next.warnThreshold = next.criticalThreshold - 5;
        else next.criticalThreshold = next.warnThreshold + 5;
      }
      next.tradeNickname = next.tradeNickname.trim();
      await writeSaveAtomically(this.path, JSON.stringify(next));
      this.value = next;
      nativeTheme.themeSource = next.theme;
      for (const listener of this.listeners) listener(this.get());
      return this.get();
    });
    this.queue = result.catch(() => {});
    return result;
  }

  finishWrites() { return this.queue; }
}

export function registerSettingsIPC(store: SettingsStore, windows: () => (BrowserWindow | undefined)[],
  finishWrites: () => Promise<void>): void {
  function authorized(event: Electron.IpcMainInvokeEvent): BrowserWindow {
    const owner = windows().find(window => window && !window.isDestroyed() && event.senderFrame === window.webContents.mainFrame);
    if (!owner) throw new Error('Unexpected settings request');
    return owner;
  }
  store.subscribe(settings => {
    for (const window of windows()) {
      if (window && !window.isDestroyed()) window.webContents.send('settings:changed', settings);
    }
  });
  ipcMain.handle('settings:add-claude-root', async event => {
    const owner = authorized(event);
    const selected = await dialog.showOpenDialog(owner, { title: 'Claude Code 로그인 폴더 선택', properties: ['openDirectory'] });
    const root = selected.filePaths[0];
    if (selected.canceled || !root) return null;
    try {
      const credentials = object(JSON.parse(await readFile(join(root, '.credentials.json'), 'utf8')));
      if (!object(credentials?.claudeAiOauth)) throw new Error('Missing OAuth login');
    } catch {
      throw new Error('선택한 폴더에서 Claude Code 로그인 파일을 읽을 수 없습니다.');
    }
    return store.change({ claudeRoots: [...new Set([...store.get().claudeRoots, root])] });
  });
  ipcMain.handle('settings:open-data-folder', async event => {
    authorized(event);
    const error = await shell.openPath(app.getPath('userData'));
    if (error) throw new Error('저장 폴더를 열지 못했습니다.');
  });
  ipcMain.handle('settings:read', event => { authorized(event); return store.get(); });
  ipcMain.handle('settings:change', (event, patch: unknown) => { authorized(event); return store.change(patch); });
  ipcMain.handle('settings:backup', async event => {
    const owner = authorized(event);
    const destination = await dialog.showSaveDialog(owner, {
      title: 'Windows 저장 백업', defaultPath: 'poketokenbar-windows-backup.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!destination.filePath || destination.canceled) return null;
    await finishWrites();
    const files: Record<string, unknown> = {};
    for (const name of ['companion-v1.json', 'settings-v1.json', 'challenge-singles-v1.json', 'challenge-doubles-v1.json']) {
      try { files[name] = JSON.parse(await readFile(join(app.getPath('userData'), name), 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    await writeSaveAtomically(destination.filePath, JSON.stringify({ format: 'poketokenbar.windows.backup', version: 1, files }, null, 2));
    return destination.filePath;
  });
}
