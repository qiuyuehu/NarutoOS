import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import type { ResourceOverride, ResourceOverrideStatus } from './battle-memory-experiment';

// 游戏变速（国服/巴西服 Flash 34 双调用点墙钟挂钩 + naruto.core 移动补丁）的内置资源装载。
// 挂钩注入由原生核心在生成游戏宿主时完成；这里只负责校验并装载两区的移动补丁资源，
// 以及提供「当前能否升档」的纯决策。详细证据链见 .test-artifacts/global-2x-first-round/report.md。

export const SPEED_PATCH_ID = 'game-speed-v1';
export type SpeedRegion = 'cn' | 'br';
export type SpeedPatch = { region: SpeedRegion; override: ResourceOverride };

export const SPEED_PATCH_DEFINITIONS: Array<{ region: SpeedRegion; url: string; patchSha256: string; baseSha256: string }> = [
  { region: 'cn', url: 'https://res.huoying.qq.com/NarutoBeta11.38Build301/flash/core/naruto.core.swf',
    patchSha256: '8df0432de1d4abce5c13f4f9b12f29a9a9fe41d730427ad056c2e529eb880e3d',
    baseSha256: 'f3c155b87390db20a6463b7a9c07cdfa760a5a5703b2bb72f0f596f2be622799' },
  { region: 'br', url: 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.17Build302/flash/core/naruto.core.swf',
    patchSha256: '2e352c31cd421f0222943d7ad39a6a0b9dbc258a07e6042e815ffa948a2ce6cd',
    baseSha256: '2fda57b8b1f00da944f1bce83c0fb0ee062c33203cd3768658291079980de2e9' },
];

export function speedPatchPath(project: string, region: SpeedRegion) {
  return path.join(project, 'assets', 'assists', 'global2x', region === 'cn' ? 'naruto-core-patched.swf' : 'naruto-core-br-patched.swf');
}

// 返回当前可用的移动补丁资源（按区）。某区缺失只影响该区升档，挂钩与其余域不受影响。
export function loadSpeedPatches(project: string): SpeedPatch[] {
  const patches: SpeedPatch[] = [];
  for (const definition of SPEED_PATCH_DEFINITIONS) {
    try {
      const bytes = fs.readFileSync(speedPatchPath(project, definition.region));
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== definition.patchSha256 || !/^[FCZ]WS$/.test(bytes.subarray(0, 3).toString('latin1'))) continue;
      patches.push({ region: definition.region,
        override: { url: definition.url, bytes, contentType: 'application/x-shockwave-flash', baseSha256: definition.baseSha256 } });
    } catch {}
  }
  return patches;
}

export function speedSites() {
  return 'PepperFlashPlayer@1a7143,PepperFlashPlayer@1a70f5';
}

export type SpeedPolicyState = {
  activePages: ResourceOverrideStatus[];
  suspended: boolean;
  rate: 1 | 2;
};

export type SpeedDecision = { allowRaise: boolean; revertToOne: boolean };

// 插件进程共享倍率，每个游戏页本次加载都要确认对应补丁已替换。
export function speedPolicy(state: SpeedPolicyState): SpeedDecision {
  const raiseable = !state.suspended && state.activePages.length > 0
    && state.activePages.every(status => status === 'verified');
  return { allowRaise: raiseable, revertToOne: state.rate === 2 && !raiseable };
}
