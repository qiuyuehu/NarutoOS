import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
export interface FlashRuntime { path: string; version: string; available: boolean }
export function findFlash(root: string, preferred: '34' | '31'): FlashRuntime {
  const plugin = path.join(root, 'runtime', `flash-${preferred}`, 'PepperFlashPlayer.plugin');
  try {
    const version = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(plugin, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
    if (version.split('.')[0] !== preferred || !fs.existsSync(path.join(plugin, 'Contents/MacOS/PepperFlashPlayer'))) throw new Error();
    return { path: plugin, version, available: true };
  } catch { return { path: plugin, version: preferred, available: false }; }
}
