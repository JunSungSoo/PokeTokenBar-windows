import { ipcMain, screen, type BrowserWindow } from 'electron';
import type { SettingsStore } from '../settings.js';
import { AgentTracker, parseAgentURL } from './agent-activity.js';

interface Bounds { x: number; y: number; width: number; height: number }
export function cursorDestination(cursor: { x: number; y: number }, size: { width: number; height: number }, area: Bounds) {
  const x = cursor.x + 16 + size.width <= area.x + area.width ? cursor.x + 16 : cursor.x - 16 - size.width;
  const y = cursor.y + 16 + size.height <= area.y + area.height ? cursor.y + 16 : cursor.y - 16 - size.height;
  return { x: Math.max(area.x, Math.min(x, area.x + area.width - size.width)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - size.height)) };
}

export class PetAgentController {
  private tracker = new AgentTracker();
  private expiry?: ReturnType<typeof setTimeout>;
  private animation?: ReturnType<typeof setInterval>;
  private home?: Bounds;
  private away = false;
  private moving = false;
  private reduceMotion = false;
  private attached = new WeakSet<BrowserWindow>();

  constructor(private pet: () => BrowserWindow | undefined, private settings: SettingsStore) {
    const authorize = (event: Electron.IpcMainInvokeEvent) => {
      const window = pet();
      if (!window || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unexpected pet activity request');
    };
    ipcMain.handle('pet:agent-read', event => { authorize(event); return this.tracker.summary(); });
    ipcMain.handle('pet:agent-dismiss', event => { authorize(event); this.dismiss(); });
    ipcMain.handle('pet:motion', (event, reduced: unknown) => {
      authorize(event);
      if (typeof reduced === 'boolean') { this.reduceMotion = reduced; this.publish(); }
    });
    settings.subscribe(value => {
      if (!value.petEnabled || !value.petAgentActivity) this.tracker.reset();
      this.publish();
    });
  }

  accept(raw: string): void {
    const event = parseAgentURL(raw);
    const settings = this.settings.get();
    if (!event || !settings.petEnabled || !settings.petAgentActivity || !this.pet()) return;
    this.tracker.apply(event, Date.now());
    this.publish();
  }

  sync(): void { this.publish(); }

  dismiss(): void { this.tracker.dismiss(); this.publish(); }

  private move(window: BrowserWindow, target: Bounds, animated: boolean): void {
    clearInterval(this.animation);
    this.moving = true;
    if (!animated) {
      window.setBounds(target);
      this.moving = false;
      return;
    }
    const start = window.getBounds();
    const began = Date.now();
    this.animation = setInterval(() => {
      if (window.isDestroyed()) { clearInterval(this.animation); this.moving = false; return; }
      const fraction = Math.min(1, (Date.now() - began) / 600);
      const eased = fraction * fraction * (3 - 2 * fraction);
      window.setBounds({
        x: Math.round(start.x + (target.x - start.x) * eased),
        y: Math.round(start.y + (target.y - start.y) * eased),
        width: target.width, height: target.height,
      });
      if (fraction === 1) { clearInterval(this.animation); this.animation = undefined; this.moving = false; }
    }, 60);
    this.animation.unref();
  }

  private publish(): void {
    clearTimeout(this.expiry);
    const deadline = this.tracker.deadline();
    if (deadline !== undefined) {
      this.expiry = setTimeout(() => { this.tracker.expire(Date.now()); this.publish(); }, Math.max(1, deadline - Date.now()));
      this.expiry.unref();
    }
    const window = this.pet();
    if (!window || window.isDestroyed()) {
      clearInterval(this.animation);
      this.home = undefined;
      this.away = false;
      return;
    }
    if (!this.attached.has(window)) {
      this.attached.add(window);
      window.on('will-move', () => {
        if (!this.moving) {
          clearInterval(this.animation);
          this.away = false;
          this.home = undefined;
        }
      });
      window.on('moved', () => { if (!this.moving && !this.away) this.home = window.getBounds(); });
      window.once('closed', () => {
        clearInterval(this.animation);
        clearTimeout(this.expiry);
        this.tracker.reset();
        this.home = undefined;
        this.away = false;
      });
    }
    const summary = this.tracker.summary();
    window.webContents.send('pet:agent-updated', summary);
    const size = this.settings.get().petSize;
    const bubble = Boolean(summary.waiting || summary.done);
    const dimensions = { width: bubble ? Math.max(size + 40, 200) : size + 40, height: size + (bubble ? 112 : 40) };
    const bounds = window.getBounds();
    const motion = this.settings.get().animated && !this.reduceMotion;
    if (summary.done && motion && window.isVisible()) {
      if (!this.away) {
        this.home = bounds;
        this.away = true;
        const cursor = screen.getCursorScreenPoint();
        const destination = cursorDestination(cursor, dimensions, screen.getDisplayNearestPoint(cursor).workArea);
        this.move(window, { ...destination, ...dimensions }, true);
      }
    } else if (this.away && this.home) {
      this.away = false;
      const origin = { x: this.home.x + (this.home.width - dimensions.width) / 2,
        y: this.home.y + this.home.height - dimensions.height };
      this.move(window, { x: Math.round(origin.x), y: Math.round(origin.y), ...dimensions }, motion);
    } else if (!this.moving) {
      window.setBounds({ x: Math.round(bounds.x + (bounds.width - dimensions.width) / 2),
        y: bounds.y + bounds.height - dimensions.height, ...dimensions });
    }
  }
}
