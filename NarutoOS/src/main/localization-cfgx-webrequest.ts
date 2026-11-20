import { net, Session } from 'electron';

export type CfgxResource = { url: string; bytes: Buffer; contentType: string };

export type CfgxDiagnostic = (kind: string, data: object) => void;

type SessionState = {
  lookup: Map<string, CfgxResource>;
  onHit: (resourceURL: string) => void;
  diagnostics?: CfgxDiagnostic;
};

const installed = new WeakSet<Session>();
const states = new WeakMap<Session, SessionState>();

export function resourceKey(url: string) {
  const target = new URL(url);
  return target.origin + target.pathname;
}

function urlPatterns(lookup: Map<string, CfgxResource>) {
  return [...lookup.values()].map(item => `${resourceKey(item.url)}*`);
}

function installOnce(session: Session, state: SessionState) {
  const patterns = urlPatterns(state.lookup);
  if (!patterns.length) return;
  session.webRequest.onHeadersReceived({ urls: patterns }, (details, callback) => {
    const report = (stage: string, data: object) => state.diagnostics?.(`cfgx-${stage}`,
      { resourceURL: details.url, method: details.method, statusCode: details.statusCode, ...data });
    let hit: CfgxResource | undefined;
    try { hit = state.lookup.get(resourceKey(details.url)); } catch { /* non-URL */ }
    report('headers', { matched: !!hit, filter: false });
    if (!hit || details.method !== 'GET' || (details.statusCode && details.statusCode >= 400)) {
      callback({ cancel: false });
      return;
    }
    const headers = { ...details.responseHeaders };
    headers['content-length'] = [String(hit.bytes.length)];
    headers['content-type'] = [hit.contentType];
    callback({ cancel: false, responseHeaders: headers });
    try {
      const filter = (session.webRequest as any).filterResponseData(details.id) as any;
      report('filter', { matched: true });
      filter.on('data', () => { /* discard */ });
      filter.on('end', () => {
        filter.write(hit!.bytes);
        filter.end();
        report('override', { matched: true, bytes: hit!.bytes.length });
        state.onHit(resourceKey(hit!.url));
      });
      filter.on('error', (error: Error) => {
        report('filter-error', { matched: true, error: String(error) });
        try { filter.end(); } catch { /* closed */ }
      });
    } catch (error) {
      report('filter-unavailable', { matched: true, error: String(error) });
    }
  });
}

export function registerCfgxWebRequestOverrides(session: Session, resources: CfgxResource[],
  onHit: (resourceURL: string) => void, diagnostics?: CfgxDiagnostic) {
  if (!resources.length) return;
  let state = states.get(session);
  if (!state) {
    state = { lookup: new Map(), onHit, diagnostics };
    states.set(session, state);
  } else {
    state.onHit = onHit;
    state.diagnostics = diagnostics;
  }
  for (const item of resources) state.lookup.set(resourceKey(item.url), item);
  if (!installed.has(session)) {
    installed.add(session);
    installOnce(session, state);
  }
}

export function prefetchCfgx(session: Session, resources: CfgxResource[], diagnostics?: CfgxDiagnostic) {
  return Promise.all(resources.map(item => new Promise<void>((resolve, reject) => {
    diagnostics?.('cfgx-prefetch-start', { resourceURL: item.url });
    const request = net.request({ method: 'GET', url: item.url, session });
    request.on('response', response => {
      diagnostics?.('cfgx-prefetch-response', { resourceURL: item.url, statusCode: response.statusCode });
      response.on('data', () => { /* body replaced by filter */ });
      response.on('end', () => resolve());
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  })));
}