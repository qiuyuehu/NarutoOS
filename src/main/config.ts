import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Layout, SavedTab, Region, validRegion } from '../shared/model';
import { validTheme, validTitleColor } from '../shared/appearance';

export const newTab = (region: Region = 'br'): SavedTab => ({ id: crypto.randomBytes(12).toString('hex'), name: '', region });
export function defaultLayout(): Layout {
  return { version: 1, tabs: [], activeId: null, preferences: { muted: false, flash: '34', theme: 'system', titleBarColor: null, region: 'br', lobbyBackground: null, lobbyMotion: true, localization: false, quality: 'high' }, bounds: { width: 1280, height: 850 }, maximized: false, fullscreen: false };
}
export function normalizeLayout(raw: unknown): Layout {
  if (!raw || typeof raw !== 'object' || (raw as Layout).version !== 1) return defaultLayout();
  const value = raw as Layout; const seen = new Set<string>();
  const tabs = Array.isArray(value.tabs) ? value.tabs.filter(tab => tab && typeof tab.id === 'string' && /^[a-f0-9]{24}$/.test(tab.id) && !seen.has(tab.id) && !!seen.add(tab.id))
    .map(tab => {
      const region = validRegion(tab.region) ? tab.region : 'br' as Region;
      return { id: tab.id, name: typeof tab.name === 'string' ? tab.name.trim().slice(0, 40) : '', region,
        ...(typeof tab.profileId === 'string' && tab.profileId.startsWith(`${region}-`) && /^(br|cn)-[1-9]\d*$/.test(tab.profileId) ? { profileId: tab.profileId } : {}) };
    }) : [];
  const bounds = value.bounds;
  return { version: 1, tabs, activeId: value.activeId === null ? null : tabs.some(t => t.id === value.activeId) ? value.activeId : tabs[0]?.id ?? null,
    preferences: { muted: value.preferences?.muted === true, flash: value.preferences?.flash === '31' ? '31' : '34',
      theme: validTheme(value.preferences?.theme) ? value.preferences.theme : 'system',
      titleBarColor: validTitleColor(value.preferences?.titleBarColor) ? value.preferences.titleBarColor.toLowerCase() : null,
      region: validRegion(value.preferences?.region) ? value.preferences.region : 'br',
      lobbyBackground: validTitleColor(value.preferences?.lobbyBackground) ? value.preferences.lobbyBackground.toLowerCase() : null,
      lobbyMotion: value.preferences?.lobbyMotion !== false, localization: value.preferences?.localization === true,
      quality: value.preferences?.quality === 'low' || value.preferences?.quality === 'medium' ? value.preferences.quality : 'high' },
    bounds: { width: Math.round(Math.max(800, Math.min(3840, Number(bounds?.width) || 1280))), height: Math.round(Math.max(560, Math.min(2160, Number(bounds?.height) || 850))),
      ...(Number.isFinite(bounds?.x) && Number.isFinite(bounds?.y) ? { x: Math.round(bounds.x!), y: Math.round(bounds.y!) } : {}) }, maximized: value.maximized === true, fullscreen: value.fullscreen === true };
}
export class ConfigStore {
  private file: string;
  constructor(directory: string) { fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); this.file = path.join(directory, 'layout.json'); }
  read(): Layout { try { return normalizeLayout(JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { return defaultLayout(); } }
  write(layout: Layout) {
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(layout, null, 2), { mode: 0o600 }); fs.renameSync(temporary, this.file);
  }
}
