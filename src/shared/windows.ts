export const windowsAppID = 'com.poketokenbar.windows';

export interface WindowsSettings {
  supported: boolean;
  version: string;
  openAtLogin: boolean;
}

export interface UpdateStatus {
  state: 'current' | 'available' | 'downloaded';
  version: string;
}

export interface WindowsAPI {
  openSettings(): Promise<void>;
  quit(): Promise<void>;
  settings(): Promise<WindowsSettings>;
  login(enabled: boolean): Promise<WindowsSettings>;
  checkUpdate(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
  togglePet(): Promise<boolean>;
}
