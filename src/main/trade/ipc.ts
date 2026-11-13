import type { CompanionView } from '../../shared/companion.js';
import { app, ipcMain, shell, type BrowserWindow } from 'electron';
import type { CompanionStore } from '../companion/store.js';
import { LanTrade } from './session.js';

export function registerTradeIPC(companion: CompanionStore, mainWindow: () => BrowserWindow | undefined, notifyCompanion: (state: CompanionView) => void): LanTrade {
  const send = (channel: string, value: unknown) => {
    const window = mainWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, value);
  };
  const trade = new LanTrade(companion, state => send('trade:state-changed', state),
    notifyCompanion);
  const bound = new WeakSet<BrowserWindow>();

  function handle(channel: string, callback: (...values: unknown[]) => unknown): void {
    ipcMain.handle('trade:' + channel, (event, ...values) => {
      const window = mainWindow();
      if (!window || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unexpected trade request');
      if (!bound.has(window)) {
        bound.add(window);
        window.once('closed', () => trade.close());
      }
      return callback(...values);
    });
  }

  handle('state', () => trade.state());
  handle('choices', () => trade.choices());
  handle('host', nickname => {
    if (typeof nickname !== 'string') throw new Error('잘못된 별명입니다.');
    return trade.host(nickname);
  });
  handle('connect', (code, nickname) => {
    if (typeof code !== 'string' || typeof nickname !== 'string') throw new Error('잘못된 연결 코드입니다.');
    return trade.connect(code, nickname);
  });
  handle('offer', id => {
    if (typeof id !== 'string') throw new Error('교환할 개체를 골라 주세요.');
    return trade.offer(id);
  });
  handle('withdraw', () => trade.withdraw());
  handle('reject', () => trade.reject());
  handle('accept', replaceCurrent => {
    if (replaceCurrent !== undefined && typeof replaceCurrent !== 'boolean') throw new Error('잘못된 교환 확인입니다.');
    return trade.accept(replaceCurrent === true);
  });
  handle('reveal-backup', () => {
    const path=trade.state().backupPath;
    if (!path) throw new Error('교환 백업이 없습니다.');
    shell.showItemInFolder(path);
  });
  handle('close', () => trade.close());
  app.once('before-quit', () => trade.close());
  return trade;
}
