import fs from 'fs';
import path from 'path';

// Development-only observer for a real game session. It records every resource
// URL the Flash plugin asks for so a new update target can be located from the
// actual build instead of guessed CDN paths. Never enabled by the product.
export class ResourceProbe {
  private attached = new Set<number>();
  constructor(private output: string) {
    fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  }
  private async record(data: Record<string, unknown>) {
    const body = JSON.stringify({ time: new Date().toISOString(), ...data });
    fs.appendFileSync(path.join(this.output, 'requests.ndjson'), body + '\n', { mode: 0o600 });
  }
  async attach(contents: Electron.WebContents) {
    if (this.attached.has(contents.id)) return;
    if (!contents.getURL()) await contents.loadURL('about:blank');
    const debug = contents.debugger;
    debug.attach('1.3');
    this.attached.add(contents.id);
    const requests = new Map<string, { url: string; type: string; started: number }>();
    const message = (_event: Electron.Event, method: string, params: any) => {
      try {
        if (method === 'Network.requestWillBeSent') {
          const target = new URL(params.request.url);
          if (!/^https?:$/.test(target.protocol)) return;
          requests.set(params.requestId, { url: target.origin + target.pathname, type: params.type, started: params.timestamp });
          void this.record({ kind: 'request', webContentsId: contents.id, url: target.origin + target.pathname,
            type: params.type, hasQuery: !!target.search, hasCredentials: !!target.username || !!target.password });
        } else if (method === 'Network.responseReceived') {
          const pending = requests.get(params.requestId);
          if (!pending) return;
          void this.record({ kind: 'response', webContentsId: contents.id, url: pending.url, type: params.type,
            status: params.response.status, mimeType: params.response.mimeType, fromDiskCache: !!params.response.fromDiskCache,
            headers: (params.response.headers || {})['content-length'] ?? null });
        } else if (method === 'Network.loadingFinished') {
          const pending = requests.get(params.requestId);
          requests.delete(params.requestId);
          if (!pending) return;
          void this.record({ kind: 'finished', webContentsId: contents.id, url: pending.url, type: pending.type,
            encodedDataLength: params.encodedDataLength });
        } else if (method === 'Network.loadingFailed') {
          requests.delete(params.requestId);
        } else if (method === 'Network.responseReceivedExtraInfo') {
          const pending = requests.get(params.requestId);
          if (pending) void this.record({ kind: 'headers', webContentsId: contents.id, url: pending.url,
            statusCode: params.statusCode });
        }
      } catch { /* A malformed URL must never interrupt the session. */ }
    };
    debug.on('message', message);
    contents.once('destroyed', () => {
      debug.removeListener('message', message);
      this.attached.delete(contents.id);
    });
    await debug.sendCommand('Runtime.enable');
    await debug.sendCommand('Network.enable');
    await this.record({ kind: 'attached', webContentsId: contents.id });
  }
}
