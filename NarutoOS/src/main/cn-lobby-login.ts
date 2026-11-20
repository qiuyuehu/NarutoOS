import type { Cookie } from 'electron';
import type { LoginProfile } from './login-sessions';

const lobby = new URL('https://app.lobby.minigame.qq.com/cgi-bin/qqgame_launchapp');
const qqConnectConfig = 'https://huoying.qq.com/webgame_login/commonConfig/qqConnectConfig.js';
const keepUin = { url: lobby.href, name: 'uin', path: lobby.pathname, secure: true, httpOnly: true };

function isLobbyUin(cookie: Cookie) {
  return cookie.name === 'uin' && cookie.hostOnly && cookie.domain === lobby.hostname && cookie.path === lobby.pathname;
}

function hasMatchingLogin(cookies: Cookie[], uin: string) {
  return cookies.some(c => c.name === 'p_uin' && c.domain === '.minigame.qq.com' && c.value === uin) &&
    cookies.some(c => c.name === 'p_skey' && c.domain === '.minigame.qq.com' && c.value) &&
    cookies.some(c => c.name === 'skey' && c.domain === '.qq.com' && c.value);
}

export function keepCnLobbyLogin(profile: LoginProfile) {
  const { session } = profile;
  let gameLoginAt = -Infinity;
  const changed = (_event: Electron.Event, cookie: Cookie, cause: string, removed: boolean) => {
    if (cookie.path !== '/') return;
    if (removed && cause === 'expired-overwrite' && cookie.name === 'uin' && cookie.domain === '.qq.com' &&
        Date.now() - gameLoginAt <= 5000) {
      gameLoginAt = -Infinity;
      // The game's QQ Connect script clears the shared identity on entry.
      // Keep the same identity at the lobby endpoint only, so the game still sees its own cookie.
      void profile.updateCookies(async () => {
        const cookies = await session.cookies.get({ url: lobby.href });
        if (cookies.some(c => c.name === 'uin') || !hasMatchingLogin(cookies, cookie.value)) return;
        await session.cookies.set({ ...keepUin, value: cookie.value, sameSite: cookie.sameSite,
          ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }) });
      }).catch(() => {});
      return;
    }
    const changedLogin = cookie.domain === '.minigame.qq.com' && ['p_uin', 'p_skey'].includes(cookie.name) ||
      cookie.domain === '.qq.com' && ['uin', 'skey'].includes(cookie.name);
    if (!changedLogin || (removed && cause === 'overwrite')) return;
    void profile.updateCookies(async () => {
      const cookies = await session.cookies.get({ url: lobby.href });
      const saved = cookies.find(isLobbyUin);
      // A new broad uin takes precedence. Reject a saved uin after sign-out or account switching.
      if (saved && (cookies.some(c => c.name === 'uin' && c.domain === '.qq.com') ||
          !hasMatchingLogin(cookies, saved.value))) {
        await session.cookies.set({ ...keepUin, value: '', expirationDate: 1 });
      }
    }).catch(() => {});
  };

  session.cookies.on('changed', changed);
  return {
    observeResponse(url: string, status: number) {
      if (url.split('?')[0] === qqConnectConfig && (status === 200 || status === 304)) gameLoginAt = Date.now();
    },
    dispose() { session.cookies.removeListener('changed', changed); }
  };
}
