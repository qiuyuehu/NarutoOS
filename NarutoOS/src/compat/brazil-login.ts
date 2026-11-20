// Serialized into the page's main world by the isolated preload. Keep this
// function self-contained: no Electron, Node, IPC, imports, or password storage.
export function installBrazilLoginCompatibility(strings: Record<string, string> = {}) {
  if (location.origin !== 'https://naruto.narutowebgame.com' || !/^\/pt\/serverlist\/?$/.test(location.pathname)) return;
  const page = window as unknown as { __narutoBrazilLogin?: boolean; jQuery?: any; ajax_login?: () => void; GameCode?: string };
  if (page.__narutoBrazilLogin) return;
  page.__narutoBrazilLogin = true;
  type CopyMessage = { key: string; params: Record<string, string | number | CopyMessage> };
  const msg = (key: string, params: CopyMessage['params'] = {}): CopyMessage => ({key, params});
  function format(value: CopyMessage | null): string {
    if(!value)return '';
    return (strings[value.key] || `[${value.key}]`).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
      const param=value.params[key];return typeof param==='object' ? format(param) : String(param ?? `{${key}}`);
    });
  }
  window.addEventListener('naruto:interface-language', event => {const next=(event as CustomEvent).detail;if(next&&typeof next==='object'){strings=next;render()}});
  const timeout = 15000;
  let hooked: any = null;
  let mode = 'preparing', cooldownUntil = 0;
  let message: CopyMessage | null = null;
  const readinessStarted = Date.now();
  type Stage = 'auth' | 'userinfo' | 'servers';
  type Request = { xhr: any; stage: Stage; key: string };
  type Attempt = { authenticated: boolean; restoring: boolean; requests: Request[]; watchdog: ReturnType<typeof setTimeout> };
  let attempt: Attempt | null = null;
  const form = () => ({ button: document.querySelector<HTMLElement>('.login_btn'),
    username: document.querySelector<HTMLInputElement>('input[name="oasun"]'), password: document.querySelector<HTMLInputElement>('input[name="oaspd"]') });
  function render() {
    document.documentElement?.setAttribute('data-naruto-login', mode);
    const { button } = form();
    if (!button) { document.querySelector('[data-naruto-login-message]')?.remove(); return; }
    button.setAttribute('aria-busy', String(mode === 'busy'));
    button.setAttribute('aria-disabled', String(mode !== 'ready' && mode !== 'server-error'));
    let note = document.querySelector<HTMLElement>('[data-naruto-login-message]');
    if (!note) {
      note = document.createElement('p'); note.setAttribute('data-naruto-login-message', ''); note.setAttribute('role', 'status');
      note.style.cssText = 'all:initial;display:none;clear:both;float:none;position:static;box-sizing:border-box;max-width:100%;font:12px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;margin:6px auto;color:inherit;text-align:left;white-space:normal;overflow-wrap:break-word;';
      // The official columns float inside fixed-height login containers. Place
      // feedback after the whole box, with its own full row in normal flow.
      const box = button.closest<HTMLElement>('.login') ?? button.closest<HTMLElement>('.login_cont');
      if (box?.parentElement) { note.style.width = `${box.clientWidth}px`; box.after(note); }
      else { note.style.width = '100%'; button.parentElement?.append(note); }
    }
    const seconds=Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1000));
    const text = format(mode === 'cooldown' ? msg(seconds===1?'login.cooldown.one':'login.cooldown.other', {seconds}) : message);
    if (note.textContent !== text) note.textContent = text;
    note.hidden = !text;
    note.style.display = text ? 'block' : 'none';
  }
  function finish(next: string, text: CopyMessage | null = null, seconds = 0) {
    const previous = attempt; attempt = null;
    if (previous) {
      clearTimeout(previous.watchdog);
      for (const request of previous.requests) if (request.xhr.readyState !== 4) request.xhr.abort('naruto-finished');
    }
    mode = next; message = text; cooldownUntil = seconds ? Date.now() + seconds * 1000 : 0; render();
  }
  function serverFailure(text: CopyMessage) {
    finish('server-error', msg('login.retryHint', {detail:text}));
  }
  function failed(stage: Stage, status: number, timedOut = false, retryAfter = 30) {
    if (!attempt) return;
    if (stage === 'userinfo') {
      serverFailure(timedOut ? msg('login.statusTimeout') : msg('login.statusFailed', {status:status>=400?msg('login.statusCode',{status}):''}));
    } else if (stage === 'servers' || attempt.authenticated) {
      serverFailure(timedOut ? msg('login.serversTimeout') : msg('login.serversFailed', {status:status>=400?msg('login.statusCode',{status}):''}));
    } else if (status === 429) finish('cooldown', null, Math.max(1, Math.min(300, retryAfter)));
    else finish('ready', timedOut ? msg('login.requestTimeout') : status === 403 ? msg('login.requestRefused') : msg('login.requestFailed'));
  }
  function begin(restoring = false) {
    mode = 'busy'; message = restoring ? msg('login.restoring') : msg('login.loggingIn');
    const current: Attempt = { authenticated: false, restoring, requests: [], watchdog: setTimeout(() => { if (attempt === current) failed(current.authenticated ? 'servers' : current.restoring ? 'userinfo' : 'auth', 0, true); }, timeout) };
    attempt = current; render(); return current;
  }
  function stageOf(options: any): Stage | null {
    try {
      const url = new URL(options.url, location.href);
      const auth = url.searchParams.get('m') === 'login' || (typeof options.data === 'string' && /(?:^|&)m=login(?:&|$)/.test(options.data));
      if (url.origin === 'https://passport.oasgames.com' && /^\/(?:index.php)?$/.test(url.pathname) && auth) return 'auth';
      if (url.origin === 'https://passport.oasgames.com' && /^\/(?:index.php)?$/.test(url.pathname) && (url.searchParams.get('m') === 'getLoginUser' || (typeof options.data === 'string' && /(?:^|&)m=getLoginUser(?:&|$)/.test(options.data)))) return 'userinfo';
      if (url.origin === 'https://odp3.oasgames.com' && url.pathname === '/api/game/get-user-servers') return 'servers';
    } catch { /* Not an eligible website request. */ }
    return null;
  }
  function requestKey(value: string) {
    try {
      const url = new URL(value, location.href); const callback = url.searchParams.get('callback') ?? ''; const cache = url.searchParams.get('_') ?? '';
      return /^[A-Za-z_$][\w$]{0,119}$/.test(callback) && /^\d{1,20}$/.test(cache) ? callback + ':' + cache : '';
    } catch { return ''; }
  }
  function hook(jq: any) {
    if (hooked === jq) return;
    hooked = jq;
    jq.ajaxPrefilter((options: any, _original: any, xhr: any) => {
      const stage = stageOf(options); if (!stage) return;
      if (stage === 'userinfo' && !attempt && mode !== 'server-error') begin(true);
      if (stage === 'userinfo' && !attempt?.restoring) return;
      if (stage === 'auth' && !attempt) {
        if (mode === 'ready' || mode === 'server-error') begin();
        else { xhr.abort('naruto-blocked'); return; }
      }
      const current = attempt; if (!current) return;
      if (current.requests.some(request => request.stage === stage)) { xhr.abort('naruto-duplicate'); return; }
      const request: Request = { stage, xhr, key: '' }; current.requests.push(request);
      options.timeout = timeout;
      const success = options.success;
      options.success = function (this: unknown, data: any, ...args: any[]) {
        // Official error branches use a hoisted-but-uninitialized `data`
        // variable. Own their feedback; retain the original success transition.
        if (stage === 'auth' && data?.status !== 'ok') return;
        if (typeof success === 'function') success.call(this, data, ...args);
      };
      const before = options.beforeSend;
      options.beforeSend = function (this: unknown, active: any, settings: any) {
        request.key = requestKey(settings.url);
        return before ? before.call(this, active, settings) : undefined;
      };
      xhr.done((data: any) => {
        if (attempt !== current) return;
        if (stage === 'auth' || stage === 'userinfo') {
          if (data?.status !== 'ok') {
            finish('ready', stage === 'userinfo' ? msg('login.expired') : data?.err_code === 1 ? msg('login.noAccount') : data?.err_code === 3 ? msg('login.badPassword') : msg('login.authFailed')); return;
          }
          current.authenticated = true; message = msg('login.loadingServers'); render(); clearTimeout(current.watchdog);
          current.watchdog = setTimeout(() => { if (attempt === current) failed('servers', 0, true); }, timeout);
        } else {
          // Website success callbacks update the DOM after this early observer.
          setTimeout(() => {
            if (attempt !== current) return;
            if (form().password) serverFailure(msg('login.pageUnchanged'));
            else finish('ready');
          }, 0);
        }
      });
      xhr.fail((_xhr: any, reason: string) => { if (attempt === current) failed(stage, xhr.status || 0, reason === 'timeout'); });
    });
  }
  function tick() {
    const jq = page.jQuery;
    if (jq?.ajaxPrefilter) hook(jq);
    // The site's cookie restoration may start before our AJAX hook. Its visible
    // success transition is also sufficient to end the login-state watchdog.
    if (attempt?.restoring && !form().password && document.querySelector('.login_aft')) { finish('ready'); return; }
    if (mode === 'cooldown' && Date.now() >= cooldownUntil) { mode = 'ready'; message = null; }
    if (!attempt && mode !== 'cooldown' && mode !== 'server-error') {
      const ready = hooked === jq && !!jq?.ajaxPrefilter && typeof page.ajax_login === 'function' && typeof page.GameCode === 'string';
      mode = ready ? 'ready' : 'preparing';
      if (mode === 'preparing') message = Date.now() - readinessStarted >= timeout ? msg('error.loginComponent') : msg('login.preparing');
      else if (['login.preparing','error.loginComponent'].includes(message?.key ?? '')) message = null;
    }
    render();
  }
  function submit() {
    tick(); if (mode !== 'ready' && mode !== 'server-error') return;
    const fields = form(); if (!fields.username || !fields.password) return;
    if (!fields.username.value.trim()) { message = msg('login.enterAccount'); render(); fields.username.focus(); return; }
    if (!fields.password.value) { message = msg('login.enterPassword'); render(); fields.password.focus(); return; }
    const current = begin();
    try { page.ajax_login!(); }
    catch { if (attempt === current) failed('auth', 0); }
  }
  // Capture replaces the buggy inline login() / keyLogin() flow without touching
  // social buttons, other pages, or the site's own AJAX success callbacks.
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('.login_btn')) return;
    event.preventDefault(); event.stopImmediatePropagation(); submit();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !(event.target instanceof Element) || !event.target.matches('input[name="oasun"],input[name="oaspd"]')) return;
    event.preventDefault(); event.stopImmediatePropagation(); submit();
  }, true);
  window.addEventListener('naruto:login-network-error', event => {
    const detail = (event as CustomEvent).detail;
    if (!attempt || !detail || !['auth', 'userinfo', 'servers'].includes(detail.stage) || ![403, 429, 500, 502, 503, 504].includes(detail.status)) return;
    const key = detail.callback + ':' + detail.cache;
    if (attempt.requests.some(request => request.stage === detail.stage && request.key && request.key === key)) failed(detail.stage, detail.status, false, detail.retryAfter);
  });
  tick();
  const interval = setInterval(tick, 250);
  window.addEventListener('pagehide', () => { clearInterval(interval); if (attempt) clearTimeout(attempt.watchdog); attempt = null; }, { once: true });
}
