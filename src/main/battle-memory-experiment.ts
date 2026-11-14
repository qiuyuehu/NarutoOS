import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

export const BATTLE_PATCH_ID = 'naruto-load-manager-gc-v2';
type BridgeState = { contents: Electron.WebContents; attached: boolean; overrides: number; contexts: Set<number>; busy: boolean; eligible: boolean };
type ResourceOverride = { url: string; bytes: Buffer; contentType: string };
type ResourceBridgeOptions = { patchId?: string; observeOnly?: boolean; observeTiming?: boolean; observeNinjaRequests?: boolean; resourceOverrides?: ResourceOverride[] };

// Replaces selected game-resource responses while Chromium handles every other
// request normally and the original resource URL remains unchanged.
export class BattleMemoryBridge {
  private states = new Map<number, BridgeState>();
  private sequence = 0;
  private readonly digest: string;
  private readonly resources: ResourceOverride[];
  get observeOnly() { return this.options.observeOnly === true; }
  constructor(private entryURL: string, private swf: Buffer, private output: string,
    private changed: () => void = () => {}, private options: ResourceBridgeOptions = {}) {
    this.digest = createHash('sha256').update(swf).digest('hex');
    this.resources = [{ url: entryURL, bytes: swf, contentType: 'application/x-shockwave-flash' }, ...(options.resourceOverrides ?? [])];
    fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  }
  private resource(value: string): ResourceOverride | undefined {
    try {
      const request = new URL(value);
      if (request.username || request.password) return undefined;
      return this.resources.find(item => {
        const target = new URL(item.url);
        return request.origin === target.origin && request.pathname === target.pathname;
      });
    } catch { return undefined; }
  }
  private matches(value: string) {
    return !!this.resource(value);
  }
  private save(kind: string, data: object) {
    const event = { time: new Date().toISOString(), kind, patchId: this.options.patchId || BATTLE_PATCH_ID, swfSha256: this.digest, ...data };
    fs.writeFileSync(path.join(this.output, `${Date.now()}-${++this.sequence}-${kind}.json`), JSON.stringify(event, null, 2), { mode: 0o600 });
  }
  async attach(contents: Electron.WebContents) {
    if (this.states.has(contents.id)) return;
    // Electron 11 has no renderer for a fresh BrowserView yet. Runtime.enable
    // can otherwise wait forever while the game navigation waits for this hook.
    if (!contents.getURL()) await contents.loadURL('about:blank');
    const state: BridgeState = { contents, attached: false, overrides: 0, contexts: new Set(), busy: false, eligible: false };
    const debug = contents.debugger;
    debug.attach('1.3');
    this.states.set(contents.id, state);
    const timing = new Map<string, { started: number; cached: boolean }>();
    const message = (_event: Electron.Event, method: string, params: any) => {
      if (this.options.observeTiming) {
        if (this.options.observeNinjaRequests && method === 'Network.requestWillBeSent') {
          try {
            const requestURL = new URL(params.request.url);
            if (/^\/PT_Naruto[^/]*\/config\/(?:[^/]+\/)*[^/]*(?:ninja|skill)[^/]*\.cfg$/i.test(requestURL.pathname)) {
              this.save('asset-request', { webContentsId: contents.id,
                resourceURL: requestURL.origin + requestURL.pathname, resourceType: params.type });
            }
          } catch { /* Ignore non-URL and non-config requests. */ }
        }
        if (method === 'Network.requestWillBeSent' && this.matches(params.request.url)) timing.set(params.requestId, { started: params.timestamp, cached: false });
        if (method === 'Network.responseReceived' && timing.has(params.requestId)) timing.get(params.requestId)!.cached = !!params.response.fromDiskCache;
        if (method === 'Network.loadingFinished' && timing.has(params.requestId)) {
          const sample = timing.get(params.requestId)!; timing.delete(params.requestId);
          this.save('resource-timing', { webContentsId: contents.id, milliseconds: (params.timestamp - sample.started) * 1000,
            fromDiskCache: sample.cached, encodedDataLength: params.encodedDataLength, mode: this.options.observeOnly ? 'original' : 'localized' });
        }
        if (method === 'Network.loadingFailed') timing.delete(params.requestId);
      }
      if (method === 'Runtime.executionContextCreated' && params.context.auxData?.isDefault) state.contexts.add(params.context.id);
      if (method === 'Runtime.executionContextDestroyed') state.contexts.delete(params.executionContextId);
      if (method === 'Runtime.executionContextsCleared') state.contexts.clear();
      if (method !== 'Fetch.requestPaused') return;
      void (async () => {
        const { requestId, request } = params;
        const started = process.hrtime.bigint();
        try {
          const resource = this.resource(request.url);
          if (request.method !== 'GET' || !resource) {
            await debug.sendCommand('Fetch.continueRequest', { requestId }); return;
          }
          await debug.sendCommand('Fetch.fulfillRequest', { requestId, responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: resource.contentType },
              { name: 'Content-Length', value: String(resource.bytes.length) },
              { name: 'Cache-Control', value: 'no-store' }
            ], body: resource.bytes.toString('base64') });
          state.overrides++;
          this.save('override', { webContentsId: contents.id, overrides: state.overrides,
            resourceURL: new URL(resource.url).origin + new URL(resource.url).pathname,
            resourceSha256: createHash('sha256').update(resource.bytes).digest('hex'),
            fulfillMilliseconds: Number(process.hrtime.bigint() - started) / 1e6 });
          this.changed();
        } catch {
          this.save('override-error', { webContentsId: contents.id });
          // A failed override must not leave the original request paused.
          await debug.sendCommand('Fetch.continueRequest', { requestId }).catch(() => {});
        }
      })();
    };
    debug.on('message', message);
    debug.on('detach', () => {
      state.attached = false; state.eligible = false;
      this.save('detached', { webContentsId: contents.id }); this.changed();
    });
    contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) { state.eligible = false; state.overrides = 0; this.changed(); }
    });
    contents.once('destroyed', () => {
      debug.removeListener('message', message); this.states.delete(contents.id); this.changed();
    });
    try {
      await debug.sendCommand('Runtime.enable');
      if (this.options.observeTiming) {
        await debug.sendCommand('Network.enable');
        if (this.options.observeNinjaRequests) await debug.sendCommand('Network.setCacheDisabled', { cacheDisabled: true });
      }
      if (!this.options.observeOnly) await debug.sendCommand('Fetch.enable', { patterns: this.resources.map(resource => ({
        urlPattern: resource.url + '*', requestStage: 'Request'
      })) });
      state.attached = true;
      this.save('attached', { webContentsId: contents.id });
    } catch (error) {
      debug.detach(); this.states.delete(contents.id); throw error;
    }
  }
  available(contents?: Electron.WebContents) {
    const state = contents && this.states.get(contents.id);
    return !!state?.attached && state.overrides > 0 && !state.busy;
  }
  canCollect(contents?: Electron.WebContents) {
    return this.available(contents) && !!contents && !!this.states.get(contents.id)?.eligible;
  }
  status(contents?: Electron.WebContents) {
    const state = contents && this.states.get(contents.id);
    return !state?.attached ? '未连接' : state.busy ? '调用中' : !state.overrides ? '等待入口' : '已替换入口';
  }
  private cleanStatus(raw: any) {
    if (!raw || raw.patchId !== BATTLE_PATCH_ID) throw new Error('实验补丁标识不匹配');
    if (!this.matches(raw.loaderURL)) throw new Error('Flash 入口 URL 未保持原始地址');
    const result: Record<string, unknown> = { patchId: raw.patchId, loaderURLMatches: true };
    for (const key of ['classIdentity', 'battleKnown', 'battleActive', 'loading', 'ready']) {
      if (typeof raw[key] !== 'boolean') throw new Error('Flash 状态字段不完整');
      result[key] = raw[key];
    }
    for (const key of ['resourceCount', 'zeroReferenceCount', 'totalMemory', 'freeMemory', 'privateMemory']) {
      if (!Number.isFinite(raw[key]) || raw[key] < 0) throw new Error('Flash 计数字段不完整');
      result[key] = raw[key];
    }
    return result;
  }
  private eligible(status: Record<string, unknown>) {
    return status.classIdentity === true && status.battleKnown === true && status.battleActive === false
      && status.loading === false && status.ready === true && Number(status.resourceCount) > 0;
  }
  async inspect(contents: Electron.WebContents, collect = false) {
    const state = this.states.get(contents.id);
    if (!state?.attached || !state.overrides) throw new Error('实验桥尚未替换入口，或已因开发者工具打开而断开');
    if (state.busy) throw new Error('实验调用正在进行');
    state.busy = true; this.changed();
    try {
      const candidates: { contextId: number; index: number; status: Record<string, unknown> }[] = [];
      const expression = `Array.from(document.querySelectorAll('object,embed')).map((el,index)=>{
        if(typeof el.narutoExperimentStatus!=='function')return null;
        try{return {index,status:el.narutoExperimentStatus()}}catch(e){return null}
      }).filter(Boolean)`;
      for (const contextId of state.contexts) {
        const response = await contents.debugger.sendCommand('Runtime.evaluate', { contextId, expression, returnByValue: true, timeout: 5000 });
        const values = response.result?.value;
        if (Array.isArray(values)) for (const value of values) {
          if (!Number.isSafeInteger(value.index) || value.index < 0) throw new Error('Flash 对象索引无效');
          candidates.push({ contextId, index: value.index, status: this.cleanStatus(value.status) });
        }
      }
      if (candidates.length !== 1) throw new Error(`找到 ${candidates.length} 个实验 Flash，需恰好一个`);
      const target = candidates[0];
      state.eligible = this.eligible(target.status);
      if (!collect) {
        this.save('inspect', { webContentsId: contents.id, rendererPid: contents.getOSProcessId(), status: target.status, eligible: this.eligible(target.status) });
        return target.status;
      }
      if (!this.eligible(target.status)) throw new Error('请退出战斗及结算，等待资源加载完成后再清理');
      const response = await contents.debugger.sendCommand('Runtime.evaluate', { contextId: target.contextId, returnByValue: true, timeout: 10000,
        expression: `document.querySelectorAll('object,embed')[${target.index}].narutoExperimentLoadManagerGc()` });
      if (response.exceptionDetails) throw new Error('Flash 清理回调执行异常');
      const raw = response.result?.value;
      if (raw?.called !== true) throw new Error('Flash 拒绝清理：状态已变化');
      const result = { called: true, before: this.cleanStatus(raw.before), after: this.cleanStatus(raw.after) };
      this.save('gc', { webContentsId: contents.id, rendererPid: contents.getOSProcessId(), result });
      return result;
    } catch (error) {
      state.eligible = false;
      this.save('call-error', { webContentsId: contents.id, operation: collect ? 'gc' : 'inspect' });
      throw error;
    } finally { state.busy = false; if (collect) state.eligible = false; this.changed(); }
  }
}
