import{systemPowerSaver}from'../system-state.js';
import {petPanelSize,petOrigin,petSurfaceSize,petSurfaceShape} from '../../shared/pet-presentation.js';
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
  private reduceMotion = false;private noticeVisible=false;private positionTimer?:ReturnType<typeof setTimeout>;
  private attached = new WeakSet<BrowserWindow>();
  private dragging?:{x:number;y:number;origin:{x:number;y:number}};
  private suppressDoneRun=false;
  private repaintTimer?:ReturnType<typeof setTimeout>;
  private shapes=new WeakMap<BrowserWindow,string>();
  private surfaceSizes=new WeakMap<BrowserWindow,{width:number;height:number}>();

  constructor(private pet: () => BrowserWindow | undefined, private settings: SettingsStore) {
    const authorize = (event: Electron.IpcMainInvokeEvent) => {
      const window = pet();
      if (!window || window.isDestroyed() || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unexpected pet activity request');
    };
    ipcMain.handle('pet:layout',(event,value:unknown)=>{authorize(event);if(typeof value!=='boolean')throw new Error('Invalid pet layout');if(this.noticeVisible!==value){this.noticeVisible=value;this.publish();}});
    ipcMain.handle('pet:repaint',event=>{authorize(event);this.repaint(pet()!);});
    ipcMain.handle('pet:drag',(event,phase:unknown,point:unknown)=>{
      authorize(event);const value=point as {x?:unknown;y?:unknown};
      if(!['start','move','end'].includes(String(phase))||typeof value?.x!=='number'||typeof value?.y!=='number'||!Number.isFinite(value.x)||!Number.isFinite(value.y)||Math.abs(value.x)>100000||Math.abs(value.y)>100000)throw new Error('Invalid pet drag');
      const window=pet()!,size=settings.get().petSize;
      if(phase==='start'){clearInterval(this.animation);this.moving=false;this.away=false;this.home=undefined;this.suppressDoneRun=true;this.dragging={x:value.x,y:value.y,origin:petOrigin(window.getBounds(),size)};}
      if(!this.dragging)return;
      const bounds=window.getBounds(),area=screen.getDisplayNearestPoint({x:value.x,y:value.y}).workArea;
      const x=this.dragging.origin.x+value.x-this.dragging.x-(bounds.width-size)/2,y=this.dragging.origin.y+value.y-this.dragging.y-(bounds.height-size);
      window.setPosition(Math.round(Math.max(area.x,Math.min(x,area.x+area.width-bounds.width))),Math.round(Math.max(area.y,Math.min(y,area.y+area.height-bounds.height))));
      if(phase==='end'){this.dragging=undefined;this.home=window.getBounds();void settings.change({petPosition:petOrigin(this.home,size)}).catch(console.error);}
    });
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
    if(event.state==='done')this.suppressDoneRun=false;
    this.tracker.apply(event, Date.now());
    this.publish();
  }

  sync(): void { this.publish(); }

  dismiss(): void { this.tracker.dismiss(); this.publish(); }

  private repaint(window:BrowserWindow):void {
    clearTimeout(this.repaintTimer);
    if(window.isDestroyed()||window.webContents.isDestroyed())return;
    window.webContents.invalidate();
    // A transparent HWND may receive its new bounds before Chromium commits the resized surface.
    // Clear the full surface again after that commit, including when no GIF frame is due yet.
    this.repaintTimer=setTimeout(()=>{if(!window.isDestroyed()&&!window.webContents.isDestroyed())window.webContents.invalidate();},32);
    this.repaintTimer.unref();
  }

  private setBounds(window:BrowserWindow,target:Bounds):void {
    const before=window.getBounds();
    this.surfaceSizes.set(window,{width:target.width,height:target.height});
    if(before.x===target.x&&before.y===target.y&&Math.abs(before.width-target.width)<=1&&Math.abs(before.height-target.height)<=1)return;
    window.setBounds(target);
    if(before.width!==target.width||before.height!==target.height)this.repaint(window);
  }

  private move(window: BrowserWindow, target: Bounds, animated: boolean): void {
    clearInterval(this.animation);
    this.moving = true;
    if (!animated) {
      this.setBounds(window,target);
      this.moving = false;
      return;
    }
    const start = window.getBounds();
    const began = Date.now();
    this.animation = setInterval(() => {
      if (window.isDestroyed()) { clearInterval(this.animation); this.moving = false; return; }
      const fraction = Math.min(1, (Date.now() - began) / 600);
      const eased = fraction * fraction * (3 - 2 * fraction);
      this.setBounds(window,{
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
      window.on('resize',()=>this.repaint(window));
      window.on('show',()=>this.repaint(window));
      window.on('will-move', () => {
        if (!this.moving) {
          clearInterval(this.animation);
          this.away = false;
          this.home = undefined;
        }
      });
      window.on('moved', () => {if(!this.moving&&!this.away&&!this.dragging){this.home=window.getBounds();clearTimeout(this.positionTimer);this.positionTimer=setTimeout(()=>{if(window.isDestroyed()||this.moving||this.away||this.dragging)return;const saved=this.settings.get().petPosition,position=petOrigin(window.getBounds(),this.settings.get().petSize);if(saved?.x!==position.x||saved?.y!==position.y)void this.settings.change({petPosition:position}).catch(console.error);},200);}});
      window.once('closed', () => {
        clearInterval(this.animation);
        clearTimeout(this.expiry);
        clearTimeout(this.positionTimer);
        clearTimeout(this.repaintTimer);
        this.noticeVisible=false;
        this.tracker.reset();
        this.home = undefined;
        this.away = false;
      });
    }
    const summary = this.tracker.summary();
    if(!summary.done)this.suppressDoneRun=false;
    window.webContents.send('pet:agent-updated', summary);
    const size = this.settings.get().petSize;
    const bubble = this.noticeVisible||Boolean(summary.waiting || summary.done);
    // Resizing a transparent HWND on hover can retain subpixel compositor remnants.
    // Windows keeps one surface; its native region hides the unused area and passes clicks through.
    const dimensions = process.platform==='win32'?petSurfaceSize(size):petPanelSize(size,bubble);
    const bounds = window.getBounds();
    const motion = this.settings.get().animated && !this.reduceMotion && !systemPowerSaver();
    if (summary.done && motion && window.isVisible()&&!this.dragging&&!this.suppressDoneRun) {
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
      const requested=this.surfaceSizes.get(window);
      // Fractional display scales can report a DIP one smaller than requested.
      // Reapplying that nominal size would move the bottom edge by a DIP on each update.
      if(!requested||requested.width!==dimensions.width||requested.height!==dimensions.height){
        if(!requested&&Math.abs(bounds.width-dimensions.width)<=1&&Math.abs(bounds.height-dimensions.height)<=1)this.surfaceSizes.set(window,dimensions);
        else this.setBounds(window,{ x: Math.round(bounds.x + (bounds.width - dimensions.width) / 2),
          y: bounds.y + bounds.height - dimensions.height, ...dimensions });
      }
    }
    if(process.platform==='win32'){
      const surface=window.getBounds(),scale=screen.getDisplayMatching(surface).scaleFactor;
      const key=[size,bubble,surface.width,surface.height,scale].join(':');
      if(this.shapes.get(window)!==key){window.setShape(petSurfaceShape(size,bubble,surface));this.shapes.set(window,key);this.repaint(window);}
    }
  }
}
