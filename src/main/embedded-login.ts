import { BrowserWindow, CookiesSetDetails } from 'electron';
import { cookieDetails } from '../../scripts/webkit-handoff.cjs';
import { validateHandoff } from '../../scripts/webkit-handoff.cjs';
interface NativeLogin { open(handle: Buffer, config: string, event: (json: string) => void): boolean; close(): void; dispose(): void; focus(): void; hide(hidden: boolean): void; reload(): void; respond(json: string): void; attached(): boolean; visible(): boolean }
export function startEmbeddedLogin(binary: string, window: BrowserWindow, options: {
  independent?: boolean; fixture?: string; initialCookies: unknown[]; timeout?: number; onSnapshot: (cookies: CookiesSetDetails[]) => Promise<void>;
  onStatus?: (code: string) => void;
  onCredentialQuery?: (requestId: string, origin: string, query: string) => Promise<Array<{ id: string; username: string }>>;
  onCredentialSelect?: (requestId: string, origin: string, id: string) => Promise<{ username: string; password: string }>;
}) {
  const addon = require(binary);
  const native: NativeLogin = options.independent ? addon.create() : addon;
  let checkpoint: Promise<void> = Promise.resolve();
  let settled = false, cancelled = false, cancelTimer: ReturnType<typeof setTimeout> | undefined;
  let finish: (error?: Error, value?: { url: string; cookies: CookiesSetDetails[] }, records?: unknown[]) => void;
  const result = new Promise<{ url: string; cookies: CookiesSetDetails[] }>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('timeout')), options.timeout ?? 900000);
    finish = (error, value, records) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(cancelTimer);
      checkpoint.then(async () => {
        if (records !== undefined) await options.onSnapshot(cookieDetails(records, options.fixture));
      }).then(() => { native.dispose(); if (error) reject(error); else resolve(value!); }, failure => {
        const code = failure?.message;
        options.onStatus?.('SNAPSHOT_' + (/^[a-zA-Z0-9_-]{1,100}$/.test(code) ? code : 'FAILED'));
        native.dispose(); reject(new Error('snapshot-failed'));
      });
    };
    try {
      native.open(window.getNativeWindowHandle(), JSON.stringify({ fixture: options.fixture, checkpointCookies: !!options.independent, cookies: options.initialCookies }), json => {
        if (settled) return;
        try {
          const event = JSON.parse(json);
          if ((event.type === 'credential-query' || event.type === 'credential-select') &&
              typeof event.requestId === 'string' && typeof event.origin === 'string' && Number.isInteger(event.page)) {
            void (async () => {
              try {
                if (event.type === 'credential-query' && typeof event.query === 'string' && options.onCredentialQuery) {
                  const accounts = await options.onCredentialQuery(event.requestId, event.origin, event.query);
                  native.respond(JSON.stringify({ requestId: event.requestId, query: event.query, accounts }));
                } else if (event.type === 'credential-select' && typeof event.id === 'string' && options.onCredentialSelect) {
                  const selected = await options.onCredentialSelect(event.requestId, event.origin, event.id);
                  native.respond(JSON.stringify({ type: 'fill', requestId: event.requestId, ...selected }));
                }
              } catch {
                native.respond(JSON.stringify({ requestId: event.requestId, query: typeof event.query === 'string' ? event.query : '', accounts: [], error: event.type === 'credential-query' ? '读取已保存账号失败，请检查钥匙串后重试' : '账号已失效，请重新选择' }));
              }
            })();
            return;
          }
          if (event.type === 'cookie-snapshot' && options.independent) {
            const cookies = cookieDetails(event.cookies, options.fixture);
            checkpoint = checkpoint.then(() => options.onSnapshot(cookies)).catch(() => options.onStatus?.('SNAPSHOT_FAILED'));
            return;
          }
          if (event.type === 'cookie-scope' && Number.isInteger(event.partitionedExcluded) && event.partitionedExcluded > 0 && event.partitionedExcluded <= 256) {
            options.onStatus?.('PARTITIONED_EXCLUDED_' + event.partitionedExcluded);
            return;
          }
          if (event.type === 'result' && Number.isInteger(event.result?.status) && event.result.status >= 400 && event.result.status <= 599) {
            options.onStatus?.('HTTP_' + event.result.status);
            return;
          }
          if (event.type === 'handoff') {
            options.onStatus?.('HANDOFF_RECEIVED');
            const value = validateHandoff(event, options.fixture);
            if (!Array.isArray(event.sessionCookies)) throw new Error('missing-snapshot');
            finish(cancelled ? new Error('cancelled') : undefined, value, event.sessionCookies);
          } else if (event.type === 'cancelled') finish(new Error('cancelled'), undefined, event.cookies);
          else if (event.type === 'error' || (event.type === 'result' && !event.result?.ok)) {
            const code = Number.isInteger(event.result?.errorCode) ? 'NAVIGATION_' + event.result.errorCode
              : /^[a-z-]{1,40}$/.test(event.code || '') ? event.code : 'login-failed';
            finish(new Error(code));
          }
        } catch { finish(new Error('invalid-response')); }
      });
    } catch { finish(new Error('native-load-failed')); }
  });
  return { result, visible: () => native.visible(), focus: () => native.focus(), hide: (value: boolean) => native.hide(value), reload: () => native.reload(),
    cancel: () => { if (settled || cancelled) return; cancelled = true; native.close(); cancelTimer = setTimeout(() => finish(new Error('cancelled')), 4000); } };
}
