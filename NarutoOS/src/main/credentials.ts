import { msg } from '../shared/i18n';
import { spawn } from 'child_process';

export type VaultTransport = (action: 'read' | 'write' | 'list-partitions', value?: string) => Promise<string>;
export function keychainTransport(binary: string, service = 'cn.youye.naruto-os.credentials'): VaultTransport {
  return (action, value) => new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = ''; const timeout = setTimeout(() => { child.kill(); reject(new Error(msg('error.keychainTimeout'))); }, 60000);
    child.stdout.on('data', bytes => { output += bytes; });
    child.on('error', () => { clearTimeout(timeout); reject(new Error(msg('error.keychainStart'))); });
    child.on('close', () => { clearTimeout(timeout); try {
      const response = JSON.parse(output);
      if (!response.ok) throw new Error(); resolve(response.value ?? '');
    } catch { reject(new Error(msg('error.keychainAccess'))); } });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ action, service, value }));
  });
}
