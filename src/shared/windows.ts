export const windowsAppID = 'com.poketokenbar.windows';

export interface WindowsSettings {
  supported: boolean;
  updatesSupported?:boolean;
  version: string;
  openAtLogin: boolean;
}

export interface UpdateStatus {
  state: 'current' | 'available' | 'downloaded' | 'skipped' | 'downloading' | 'failed';
  version: string;
  delivery?:'browser'|'installer';
  opened?:boolean;
  error?:string;
}

export interface WindowsAPI {
  support(action:'log'|'github'):Promise<void>;
  onUpdate(handler:(state:UpdateStatus)=>void):void;
  updateState():Promise<UpdateStatus>;
  skipUpdate(restore?:boolean):Promise<UpdateStatus>;
  onRefresh(handler:()=>void):void;
  onOpenDex(handler:()=>void):void;
  openSettings(): Promise<void>;
  quit(): Promise<void>;
  minimizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  settings(): Promise<WindowsSettings>;
  login(enabled: boolean): Promise<WindowsSettings>;
  checkUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<UpdateStatus>;
  openUpdatePage(): Promise<void>;
  togglePet(): Promise<boolean>;
}
