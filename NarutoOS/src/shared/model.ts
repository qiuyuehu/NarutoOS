import { msg, Language } from './i18n';
export const ENTRY_URL = 'https://naruto.narutowebgame.com/pt/serverlist';
export const REGIONS = {
  br: { label: msg('region.br'), url: ENTRY_URL },
  cn: { label: msg('region.cn'), url: 'https://minigame.qq.com/plat/social_hall/app_frame/index_v4.html?appid=10190', officialUrl: 'https://huoying.qq.com/server/website/' }
} as const;
export type Region = keyof typeof REGIONS;
export const validRegion = (value: unknown): value is Region => value === 'br' || value === 'cn';
export type CnEntry = 'qq' | 'official';
export const validCnEntry = (value: unknown): value is CnEntry => value === 'qq' || value === 'official';
export const cnEntryURL = (cnEntry: CnEntry): string => cnEntry === 'official' ? REGIONS.cn.officialUrl : REGIONS.cn.url;
export type LoadState = 'idle' | 'loading' | 'ready' | 'failed' | 'crashed';
export type RecoveryStage = 'login' | 'loading' | 'confirming';
export interface SavedTab { id: string; name: string; region?: Region; profileId?: string }
export const CHROME_HEIGHT = 42;
export const SAVE_PROMPT_HEIGHT = 44;
export const RECOVERY_PROMPT_HEIGHT = 44;
export type Theme = 'system' | 'light' | 'dark';
export type FlashQuality = 'low' | 'medium' | 'high';
export interface Preferences {
  language: Language; muted: boolean; flash: '34' | '31'; theme: Theme; titleBarColor: string | null; region: Region;
  lobbyBackground: string | null; lobbyMotion: boolean; localization: boolean; assistsEnabled: boolean; quality: FlashQuality;
  cnEntry: CnEntry;
}
export interface Layout {
  version: 1; tabs: SavedTab[]; activeId: string | null; preferences: Preferences;
  bounds: { x?: number; y?: number; width: number; height: number }; maximized: boolean; fullscreen: boolean;
}
export interface TabInfo extends SavedTab { state: LoadState; title: string; profileName?: string; recoveryStage?: RecoveryStage; closeDisabled?: boolean }
export interface Credential { id: string; origin: string; username: string; password: string; updatedAt: string }
export type CredentialInfo = Omit<Credential, 'password'> & { version?: string };
export interface CredentialSiteOption { id: string; label: string }
export type CredentialAddResult =
  | { status: 'saved' | 'unchanged' }
  | { status: 'confirm-update'; id: string; version: string }
  | { status: 'stale' };
export interface SavePrompt { tabId: string; username: string; origin: string; update: boolean }
export interface AppState {
  tabs: TabInfo[]; activeId: string | null; preferences: Preferences; settingsOpen: boolean;
  prompt: SavePrompt | null; recovery: { originalId: string; candidateId: string } | null;
  refresh: { enabled: boolean; label: string };
  flash: { version: string; available: boolean }; localizationActive: boolean; assistsActive: boolean; notice: string;
  profiles: Array<{ id: string; region: Region; name: string; serverNote: string; identityNeedsConfirmation: boolean;
    cleanupStatus: 'deleting' | 'pending' | null; cleanupStage: string; deleteBlockedReason: string }>;
  selectedProfileId: string | null; profileDiscovery: 'idle' | 'loading' | 'ready' | 'failed';
  profileError: string; canCreateProfile: boolean; profilePickerOpen: boolean; profilePickerIntent: 'select' | 'open';
}
export type Command =
  | { type: 'new' | 'profile-start' | 'home' | 'refresh' | 'mute' | 'settings' | 'dismiss-prompt' | 'save-password' | 'profiles-picker' | 'profiles-close-picker' | 'profiles-retry' | 'open-github' | 'check-update' }
  | { type: 'region'; value: Region }
  | { type: 'language'; value: Language }
  | { type: 'select' | 'close' | 'complete-recovery' | 'cancel-recovery'; id: string }
  | { type: 'profile-select' | 'profile-open' | 'profile-edit'; id: string }
  | { type: 'profile-delete'; id: string }
  | { type: 'profile-create'; name: string; serverNote: string }
  | { type: 'profile-update'; id: string; name: string; serverNote: string }
  | { type: 'rename'; id: string; name: string }
  | { type: 'flash'; version: '34' | '31' }
  | { type: 'theme'; value: Theme }
  | { type: 'title-color'; value: string | null }
  | { type: 'lobby-background'; value: string | null }
  | { type: 'lobby-motion'; value: boolean }
  | { type: 'localization'; value: boolean }
  | { type: 'assists'; value: boolean }
  | { type: 'quality'; value: FlashQuality }
  | { type: 'cn-entry'; value: CnEntry }
  | { type: 'overlay'; shown: boolean };
export interface ShellAPI {
  state(): Promise<AppState>;
  command(command: Command): Promise<void | boolean>;
  onState(callback: (state: AppState) => void): () => void;
  credentials(): Promise<CredentialInfo[]>;
  credentialSites(): Promise<CredentialSiteOption[]>;
  addCredential(siteId: string, username: string, password: string, expected?: { id: string; version: string }): Promise<CredentialAddResult>;
  reveal(id: string): Promise<string>;
  edit(id: string, username: string, password: string, expectedVersion?: string): Promise<void>;
  remove(id: string): Promise<void>;
}
declare global { interface Window { naruto: ShellAPI } }
