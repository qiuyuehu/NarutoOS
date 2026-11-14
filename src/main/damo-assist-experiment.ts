import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { BattleMemoryBridge } from './battle-memory-experiment';

const TARGET = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.39Build301/flash/operatingActivity/OperatingActivityPlugin.swf';
const DIGEST = 'f67723450e6b3d6d37f62709fde4d0a64754b560e811d2a48076af484616ed01';

export function createDamoAssistExperiment(project: string) {
  const packaged = app.isPackaged;
  if (!packaged && process.env.NARUTO_DAMO_ASSIST !== '1') return undefined;
  const data = path.resolve(app.getPath('userData'));
  if (!packaged && !data.startsWith(path.join(project, '.test-artifacts') + path.sep)) {
    throw new Error('开发态达摩辅助仅允许在隔离数据目录中启用');
  }
  const file = packaged
    ? path.join(project, 'assets/damo-assist-9.39Build301/OperatingActivityPlugin.damo-assist.swf')
    : path.join(project, '.test-artifacts/damo-assist-9.39Build301/OperatingActivityPlugin.damo-assist.swf');
  const bytes = fs.readFileSync(file);
  if (createHash('sha256').update(bytes).digest('hex') !== DIGEST) throw new Error('达摩辅助补丁校验失败');
  const resource = { url: TARGET, bytes, contentType: 'application/x-shockwave-flash' };
  const output = path.join(data, 'damo-assist');
  const fallback = new BattleMemoryBridge(TARGET, bytes, path.join(output, 'overrides'), () => {}, { patchId: 'damo-as3-assist-v1' });
  return {
    resource,
    async attach(contents: Electron.WebContents, shared?: BattleMemoryBridge) {
      await (shared ?? fallback).attach(contents);
    }
  };
}
