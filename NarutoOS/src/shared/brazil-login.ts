export function isBrazilLoginPage(value: string): boolean {
  try { const url = new URL(value); return !url.username && !url.password && url.origin === 'https://naruto.narutowebgame.com' && /^\/pt\/serverlist\/?$/.test(url.pathname); }
  catch { return false; }
}
export type LoginStage = 'auth' | 'userinfo' | 'servers';
export interface LoginNetworkFailure { stage: LoginStage; callback: string; cache: string; status: number; retryAfter: number }
// Only return non-secret correlation fields, never the credential-bearing URL.
export function loginRequestKey(value: string): { stage: LoginStage; callback: string; cache: string } | null {
  try {
    const url = new URL(value); let stage: LoginStage;
    if (url.origin === 'https://passport.oasgames.com' && /^\/(?:index.php)?$/.test(url.pathname) && url.searchParams.get('m') === 'login') stage = 'auth';
    else if (url.origin === 'https://passport.oasgames.com' && /^\/(?:index.php)?$/.test(url.pathname) && url.searchParams.get('m') === 'getLoginUser') stage = 'userinfo';
    else if (url.origin === 'https://odp3.oasgames.com' && url.pathname === '/api/game/get-user-servers') stage = 'servers';
    else return null;
    const callback = url.searchParams.get('callback') ?? ''; const cache = url.searchParams.get('_') ?? '';
    return /^[A-Za-z_$][\w$]{0,119}$/.test(callback) && /^\d{1,20}$/.test(cache) ? { stage, callback, cache } : null;
  } catch { return null; }
}
export function retryAfterSeconds(value: string | undefined, now = Date.now()): number {
  if (!value) return 30;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - now) / 1000);
  return Number.isFinite(seconds) ? Math.max(1, Math.min(300, seconds)) : 30;
}
