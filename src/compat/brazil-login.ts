// Serialized into the page's main world by the isolated preload. Keep this
// function self-contained: no Electron, Node, IPC, imports, or password storage.
export function installBrazilLoginCompatibility() {
  if (location.origin !== 'https://naruto.narutowebgame.com' || !/^\/pt\/serverlist\/?$/.test(location.pathname)) return;
  const page = window as unknown as { __narutoBrazilLogin?: boolean; jQuery?: any; ajax_login?: () => void; GameCode?: string };
  if (page.__narutoBrazilLogin) return;
  page.__narutoBrazilLogin = true;
  const timeout = 15000;
  let hooked: any = null;
  let mode = 'preparing', message = '', cooldownUntil = 0;
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
    const text = mode === 'cooldown' ? `请求过于频繁，请在 ${Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1000))} 秒后重试。` : message;
    if (note.textContent !== text) note.textContent = text;
    note.hidden = !text;
    note.style.display = text ? 'block' : 'none';
  }
  function finish(next: string, text = '', seconds = 0) {
    const previous = attempt; attempt = null;
    if (previous) {
      clearTimeout(previous.watchdog);
      for (const request of previous.requests) if (request.xhr.readyState !== 4) request.xhr.abort('naruto-finished');
    }
    mode = next; message = text; cooldownUntil = seconds ? Date.now() + seconds * 1000 : 0; render();
  }
  function serverFailure(text: string) {
    finish('server-error', `${text}可重新登录，或稍后手动刷新。`);
  }
  function failed(stage: Stage, status: number, timedOut = false, retryAfter = 30) {
    if (!attempt) return;
    if (stage === 'userinfo') {
      serverFailure(timedOut ? '登录状态读取超时。' : `登录状态读取失败${status >= 400 ? `（${status}）` : ''}。`);
    } else if (stage === 'servers' || attempt.authenticated) {
      serverFailure(timedOut ? '登录已通过，区服列表加载超时。' : `登录已通过，区服列表加载失败${status >= 400 ? `（${status}）` : ''}。`);
    } else if (status === 429) finish('cooldown', '', Math.max(1, Math.min(300, retryAfter)));
    else finish('ready', timedOut ? '登录请求超时，请稍后重试。' : status === 403 ? '登录请求被拒绝（403），请稍后重试。' : '登录请求未完成，请稍后重试。');
  }
  function begin(restoring = false) {
    mode = 'busy'; message = restoring ? '正在读取登录状态…' : '正在登录…';
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
            finish('ready', stage === 'userinfo' ? '登录状态已失效，请重新登录。' : data?.err_code === 1 ? '账号不存在，请检查。' : data?.err_code === 3 ? '密码不正确，请重试。' : '登录未成功，请检查账号或稍后重试。'); return;
          }
          current.authenticated = true; message = '正在加载区服…'; render(); clearTimeout(current.watchdog);
          current.watchdog = setTimeout(() => { if (attempt === current) failed('servers', 0, true); }, timeout);
        } else {
          // Website success callbacks update the DOM after this early observer.
          setTimeout(() => {
            if (attempt !== current) return;
            if (form().password) serverFailure('登录已通过，区服页面未能更新。');
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
    if (mode === 'cooldown' && Date.now() >= cooldownUntil) { mode = 'ready'; message = ''; }
    if (!attempt && mode !== 'cooldown' && mode !== 'server-error') {
      const ready = hooked === jq && !!jq?.ajaxPrefilter && typeof page.ajax_login === 'function' && typeof page.GameCode === 'string';
      mode = ready ? 'ready' : 'preparing';
      if (mode === 'preparing') message = Date.now() - readinessStarted >= timeout ? '登录组件未能加载，请刷新页面重试。' : '正在准备登录…';
      else if (/^(正在准备登录|登录组件未能加载)/.test(message)) message = '';
    }
    render();
  }
  function submit() {
    tick(); if (mode !== 'ready' && mode !== 'server-error') return;
    const fields = form(); if (!fields.username || !fields.password) return;
    if (!fields.username.value.trim()) { message = '请输入账号。'; render(); fields.username.focus(); return; }
    if (!fields.password.value) { message = '请输入密码。'; render(); fields.password.focus(); return; }
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
