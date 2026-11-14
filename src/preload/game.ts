import { installFlashQuality } from '../compat/flash-quality';
import { ipcRenderer, webFrame } from 'electron';
import { isBrazilLoginPage, LoginNetworkFailure } from '../shared/brazil-login';
import { installBrazilLoginCompatibility } from '../compat/brazil-login';

// This preload never exposes a bridge to the website. Only these narrowly scoped
// messages can cross into the main process; it validates the actual WebContents origin.
const brazilLogin = isBrazilLoginPage(location.href);
if (brazilLogin) {
  const blocked = (target: EventTarget | null, keyboard: boolean) => target instanceof Element &&
    (keyboard ? target.matches('input[name="oasun"],input[name="oaspd"]') : !!target.closest('.login_btn')) &&
    !['ready', 'server-error'].includes(document.documentElement?.getAttribute('data-naruto-login') ?? '');
  document.addEventListener('click', event => { if (blocked(event.target, false)) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Enter' && blocked(event.target, true)) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  ipcRenderer.on('game:login-network-error', (_event, detail: LoginNetworkFailure) => {
    // Only fixed, non-secret metadata flows from main to the page; there is no
    // website-to-main API, and the page cannot invoke this IPC receiver.
    if (!isBrazilLoginPage(location.href)) return;
    void webFrame.executeJavaScript(`window.dispatchEvent(new CustomEvent('naruto:login-network-error',{detail:${JSON.stringify(detail)}}))`).catch(() => {});
  });
}
type Pair = { username: HTMLInputElement; password: HTMLInputElement };
let current: Pair | null = null;
let host: HTMLDivElement | null = null;
let panel: ShadowRoot | null = null;
let request = 0;
let typedTimer: ReturnType<typeof setTimeout>;
let lastSubmission = '';
let lastSubmissionAt = 0;
let suppressFocus = false;
const watched = new WeakSet<Document>();
async function invoke(channel: string, data: unknown) {
  const response = await ipcRenderer.invoke(channel, data);
  if (!response?.ok) throw new Error('请求未完成');
  return response.value;
}
function visible(input: Element) { const rect = input.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }
function pairFor(doc: Document, target?: HTMLInputElement): Pair | null {
  const passwords = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(p => visible(p) && p.autocomplete !== 'new-password');
  for (const password of passwords) {
    const scope = password.form ?? password.closest('[role="dialog"], .login, .login_box, .loginbox') ?? doc;
    const fields = Array.from(scope.querySelectorAll<HTMLInputElement>('input')).filter(p => p !== password && visible(p) && !p.disabled && !p.readOnly && ['text', 'email', 'tel', ''].includes(p.type));
    const username = fields.find(p => /username|email|account|login|user|conta/i.test(p.name + ' ' + p.id + ' ' + p.autocomplete)) ?? fields[0];
    if (username && (!target || target === username || target === password)) return { username, password };
  }
  return null;
}
function dismiss() { request++; host?.remove(); host = null; panel = null; }
function place(input: HTMLInputElement) {
  if (!host) return;
  const rect = input.getBoundingClientRect();
  let left = rect.left; let top = rect.bottom;
  let doc = input.ownerDocument;
  while (doc.defaultView?.frameElement) {
    const frame = doc.defaultView.frameElement; const bounds = frame.getBoundingClientRect();
    left += bounds.left; top += bounds.top; doc = frame.ownerDocument;
  }
  const width = Math.min(Math.max(260, rect.width), window.innerWidth - 24);
  host.style.left = `${Math.max(12, Math.min(left, window.innerWidth - width - 12))}px`;
  host.style.top = `${Math.min(top + 6, window.innerHeight - 210)}px`; host.style.width = `${width}px`;
}
async function showCandidates(pair: Pair) {
  current = pair;
  const sequence = ++request;
  const username = pair.username.value;
  try {
    const records: { id: string; username: string }[] = await invoke('game:candidates', { origin: location.origin, query: username });
    if (sequence !== request || !pair.username.isConnected || !pair.password.isConnected || ![pair.username, pair.password].includes(pair.username.ownerDocument.activeElement as HTMLInputElement)) return;
    host?.remove(); host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
    panel = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `:host{color-scheme:light dark}*{box-sizing:border-box}.box{font:13px "Helvetica Neue","PingFang SC",sans-serif;background:#fafafa;color:#292929;border:1px solid #e4e4e4;border-radius:10px;box-shadow:0 8px 28px #00000020;padding:7px;max-height:210px;overflow:auto}.caption{font-size:10px;color:#747474;padding:6px 8px 8px}button{font:inherit;width:100%;display:flex;align-items:center;gap:10px;border:0;background:transparent;text-align:left;color:inherit;padding:10px 8px;border-radius:5px;cursor:pointer}button:hover,button:focus-visible{background:#ededed;outline:2px solid #747474}.avatar{background:#e2e2e2;color:#292929;border-radius:5px;width:27px;height:27px;display:grid;place-items:center}.note{font-size:11px;color:#747474;padding:7px 8px}.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@media(prefers-color-scheme:dark){.box{background:#202020;color:#e5e5e5;border-color:#383838}.caption,.note{color:#aaa}button:hover,button:focus-visible{background:#303030}.avatar{background:#3c3c3c;color:#e5e5e5}}`;
    const box = document.createElement('div'); box.className = 'box'; box.setAttribute('role', 'listbox'); box.setAttribute('aria-label', '已保存的账号');
    const caption = document.createElement('div'); caption.className = 'caption'; caption.textContent = 'NARUTO OS · 已保存的账号'; box.append(caption);
    for (const record of records) {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'option');
      const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = record.username.slice(0, 1).toLocaleUpperCase();
      const name = document.createElement('span'); name.className = 'name'; name.textContent = record.username; button.append(avatar, name);
      button.addEventListener('mousedown', event => event.preventDefault());
      const choose = async (event: Event) => {
        if (!event.isTrusted) return;
        try {
          const selected = await invoke('game:choose', { origin: location.origin, id: record.id });
          if (current !== pair || !pair.username.isConnected || !pair.password.isConnected) return;
          setValue(pair.username, selected.username); setValue(pair.password, selected.password);
          dismiss(); suppressFocus = true; pair.password.focus(); suppressFocus = false;
        } catch { dismiss(); }
      };
      button.addEventListener('click', event => void choose(event));
      button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void choose(event); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); const buttons = Array.from(box.querySelectorAll('button')); const index = buttons.indexOf(button);
          buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
      }); box.append(button);
    }
    const note = document.createElement('div'); note.className = 'note';
    note.textContent = records.length ? '选择后填充，不会自动登录' : username ? '没有匹配的已保存账号' : '尚无已保存账号，登录后可选择保存'; box.append(note);
    panel.append(style, box); document.documentElement.append(host); place(pair.username);
  } catch { dismiss(); }
}
function setValue(input: HTMLInputElement, value: string) {
  const view = input.ownerDocument.defaultView!;
  const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new view.Event('input', { bubbles: true })); input.dispatchEvent(new view.Event('change', { bubbles: true }));
}
function remember(pair: Pair) {
  const username = pair.username.value.trim(); const password = pair.password.value;
  if (!username || !password || (`${username}\0${password}` === lastSubmission && Date.now() - lastSubmissionAt < 800)) return;
  lastSubmission = `${username}\0${password}`;
  lastSubmissionAt = Date.now();
  void invoke('game:submit', { origin: location.origin, username, password }).catch(() => {});
  dismiss();
}
function watch(doc: Document) {
  if (watched.has(doc)) return; watched.add(doc);
  doc.addEventListener('focusin', event => {
    if (suppressFocus) return;
    if (!event.isTrusted || !(event.target instanceof (doc.defaultView!.HTMLInputElement))) return;
    const pair = pairFor(doc, event.target as HTMLInputElement);
    if (pair) void showCandidates(pair); else dismiss();
  });
  doc.addEventListener('input', event => {
    if (!event.isTrusted || !current) return;
    if (event.target === current.password) { clearTimeout(typedTimer); dismiss(); return; }
    if (event.target !== current.username) return;
    clearTimeout(typedTimer); typedTimer = setTimeout(() => { if (current) void showCandidates(current); }, 120);
  });
  doc.addEventListener('submit', event => { if (event.isTrusted) { const pair = pairFor(doc); if (pair) remember(pair); } }, true);
  doc.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const target = event.target as Element;
    const button = target.closest('button, input[type="submit"], a, [role="button"], .login_btn, .login-btn');
    if (!button) { if (!host || !event.composedPath().includes(host)) dismiss(); return; }
    if (/log.?in|entrar|acessar|sign.?in|登录/i.test(button.textContent + ' ' + button.getAttribute('id') + ' ' + button.getAttribute('class') + ' ' + button.getAttribute('type'))) {
      const pair = pairFor(doc); if (pair) remember(pair);
    }
  }, true);
  doc.addEventListener('keydown', event => {
    if (event.key === 'Escape') dismiss();
    if (event.isTrusted && event.key === 'Enter') { const pair = pairFor(doc, doc.activeElement as HTMLInputElement); if (pair) remember(pair); }
    if (event.key === 'ArrowDown' && panel && (doc.activeElement === current?.username || doc.activeElement === current?.password)) { const first = panel.querySelector('button'); if (first) { event.preventDefault(); first.focus(); } }
  // The Brazil compatibility handler consumes Enter during capture. Remember
  // the trusted submission first; other sites keep their existing event order.
  }, brazilLogin);
}
function scan(doc: Document): boolean {
  watch(doc);
  let hasPassword = !!pairFor(doc);
  for (const frame of Array.from(doc.querySelectorAll('iframe'))) {
    try { if (frame.contentDocument?.documentElement) hasPassword = scan(frame.contentDocument) || hasPassword; } catch { /* Cross-origin frames remain isolated. */ }
  }
  // The website owns Flash layout. Credential scans must not overwrite its
  // responsive sizing every 800ms.
  return hasPassword;
}
document.addEventListener('DOMContentLoaded', () => {
  scan(document);
  if (brazilLogin) {
    // webContents.executeJavaScript waits for all resources in Electron 11.
    // Capture runs before the website's jQuery DOM-ready cookie restoration.
    // webFrame runs now, so a stalled social SDK cannot delay the login guard.
    void webFrame.executeJavaScript(`(${installBrazilLoginCompatibility.toString()})()`).catch(() => {
      const button = document.querySelector('.login_btn');
      button?.setAttribute('aria-disabled', 'true');
      const note = document.createElement('p'); note.setAttribute('role', 'status');
      note.textContent = '登录组件未能加载，请刷新页面重试。'; button?.parentElement?.append(note);
    });
    const style = document.createElement('style');
    style.textContent = '.login_btn[aria-disabled="true"]{opacity:.55;cursor:default}.login_btn[aria-disabled="true"] a{cursor:default}';
    document.head?.append(style);
  }
  setInterval(() => {
    const hasPassword = scan(document);
    void invoke('game:form-state', { hasPassword }).catch(() => {});
    if (current && host) { if (!visible(current.username)) dismiss(); else place(current.username); }
  }, 800);
}, { capture: true });
window.addEventListener('blur', () => { setTimeout(() => { if (!document.hasFocus()) dismiss(); }, 120); });
window.addEventListener('pagehide', () => { lastSubmission = ''; dismiss(); });

function applyDefaultQuality(value: unknown) {
  if (value === 'low' || value === 'medium' || value === 'high') {
    void webFrame.executeJavaScript(`(${installFlashQuality.toString()})(${JSON.stringify(value)})`).catch(() => {});
  }
}
ipcRenderer.on('game:quality', (_event, value) => applyDefaultQuality(value));
void invoke('game:quality', {}).then(applyDefaultQuality).catch(() => {});
