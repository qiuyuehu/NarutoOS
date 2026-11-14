import { ENTRY_URL, REGIONS } from '../shared/model';

const internalHosts = ['naruto.narutowebgame.com', 'naruto.oasgames.com', 'passport.oasgames.com', 'passport.narutowebgame.com'];
const gameServerHost = /^(?:s\d+-naruto(?:pt|br)?|naruto-(?:pt|br)(?:-s?\d+)?)\.oasgames\.com$/;
const manualCredentialSites = [
  { id: 'br', label: '巴西服', origin: new URL(REGIONS.br.url).origin },
  { id: 'cn', label: '国服', origin: new URL(REGIONS.cn.url).origin },
] as const;
export function webURL(value: string): URL | null {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null; }
  catch { return null; }
}
export function internalURL(value: string): boolean {
  const url = webURL(value);
  if (!url) return false;
  // Game servers use sNN-naruto and naruto-pt server hostnames. Do not allow unrelated OAS games.
  return internalHosts.includes(url.hostname) ||
    gameServerHost.test(url.hostname);
}
export function credentialOrigin(value: string): string | null {
  const url = webURL(value);
  return url?.protocol === 'https:' && internalURL(value) ? url.origin : null;
}
export function manualCredentialSite(id: unknown) {
  return typeof id === 'string' ? manualCredentialSites.find(site => site.id === id) ?? null : null;
}
export function manualCredentialSiteForOrigin(origin: unknown) {
  return typeof origin === 'string' ? manualCredentialSites.find(site => site.origin === origin) ?? null : null;
}
export function manualCredentialSiteOptions() {
  return manualCredentialSites.map(({ id, label }) => ({ id, label }));
}
export function credentialStorageOrigin(value: string): boolean {
  return credentialOrigin(value) === value || manualCredentialSiteForOrigin(value) !== null;
}
// This preserves a user's pending SAVE decision during the Brazil login flow.
// It never grants another origin permission to retrieve or fill the password.
export function savePromptDestination(origin: string, value: string): boolean {
  const target = webURL(value);
  if (!target || target.protocol !== 'https:') return false;
  if (credentialOrigin(value) === origin) return true;
  return ['https://naruto.narutowebgame.com', 'https://naruto.oasgames.com'].includes(origin) &&
    !target.port && gameServerHost.test(target.hostname);
}
export function fitRectangle(width: number, height: number, ratio: number) {
  const w = Math.min(width, height * ratio); const h = w / ratio;
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), width: Math.floor(w), height: Math.floor(h) };
}
export { ENTRY_URL };
