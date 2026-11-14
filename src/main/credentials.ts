import { spawn } from 'child_process';
import crypto from 'crypto';
import { Credential, CredentialAddResult, CredentialInfo } from '../shared/model';
import { credentialStorageOrigin, manualCredentialSiteForOrigin } from './policy';

export type VaultTransport = (action: 'read' | 'write' | 'list-partitions', value?: string) => Promise<string>;
export function keychainTransport(binary: string, service = 'cn.youye.naruto-os.credentials'): VaultTransport {
  return (action, value) => new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = ''; const timeout = setTimeout(() => { child.kill(); reject(new Error('钥匙串响应超时，请重试')); }, 60000);
    child.stdout.on('data', bytes => { output += bytes; });
    child.on('error', () => { clearTimeout(timeout); reject(new Error('无法启动钥匙串组件，请先构建项目')); });
    child.on('close', () => { clearTimeout(timeout); try {
      const response = JSON.parse(output);
      if (!response.ok) throw new Error(); resolve(response.value ?? '');
    } catch { reject(new Error('无法访问钥匙串，请检查系统授权后重试')); } });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ action, service, value }));
  });
}
export class CredentialVault {
  private queue = Promise.resolve();
  private readonly revisionSecret = crypto.randomBytes(32);
  constructor(private transport: VaultTransport) {}
  private revision(record: Credential) {
    return crypto.createHmac('sha256', this.revisionSecret).update(`${record.id}\0${record.updatedAt}\0${record.password}`).digest('hex');
  }
  private async read(): Promise<Credential[]> {
    const serialized = await this.transport('read');
    let records: Credential[];
    try { records = JSON.parse(serialized); } catch { throw new Error('钥匙串数据格式异常'); }
    if (!Array.isArray(records) || records.some(r => !r || typeof r.id !== 'string' || !credentialStorageOrigin(r.origin) || typeof r.username !== 'string' || typeof r.password !== 'string')) throw new Error('钥匙串数据格式异常');
    return records;
  }
  private async change(update: (records: Credential[]) => Credential[]) {
    const task = this.queue.then(async () => { await this.transport('write', JSON.stringify(update(await this.read()))); });
    this.queue = task.catch(() => {}); await task;
  }
  async list(origin?: string, query = ''): Promise<CredentialInfo[]> {
    await this.queue;
    return (await this.read()).filter(r => (!origin || r.origin === origin) && r.username.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      .map(({ password: _, ...info }) => info);
  }
  async selected(id: string, origin: string) { await this.queue; return (await this.read()).find(r => r.id === id && r.origin === origin) ?? null; }
  async needsSave(origin: string, username: string, password: string) {
    const normalizedUsername = username.trim();
    await this.queue; const record = (await this.read()).find(r => r.origin === origin && r.username.trim() === normalizedUsername);
    return { needed: record?.password !== password, update: !!record };
  }
  async save(origin: string, username: string, password: string, id?: string) {
    const normalizedUsername = username.trim();
    if (!credentialStorageOrigin(origin) || !normalizedUsername || normalizedUsername.length > 320 || !password || password.length > 4096) throw new Error('账号或网站信息无效');
    await this.change(records => {
      const previous = id ? records.find(r => r.id === id && r.origin === origin) : records.find(r => r.origin === origin && r.username.trim() === normalizedUsername);
      if (id && !previous) throw new Error('账号已不存在');
      if (records.some(r => r.origin === origin && r.username.trim() === normalizedUsername && r.id !== previous?.id)) throw new Error('该网站已保存同名账号');
      const record: Credential = { id: previous?.id ?? crypto.randomBytes(16).toString('hex'), origin, username: normalizedUsername, password, updatedAt: new Date().toISOString() };
      return [...records.filter(r => r.id !== record.id), record];
    });
  }
  async addManual(origin: string, username: string, password: string, expected?: { id: string; version: string }): Promise<CredentialAddResult> {
    const normalizedUsername = username.trim();
    if (!manualCredentialSiteForOrigin(origin) || !normalizedUsername || normalizedUsername.length > 320 || !password || password.length > 4096) throw new Error('账号或网站信息无效');
    const task = this.queue.then(async (): Promise<CredentialAddResult> => {
      const records = await this.read();
      const existing = records.find(record => record.origin === origin && record.username.trim() === normalizedUsername);
      if (existing?.password === password) return { status: 'unchanged' };
      if (existing && (!expected || expected.id !== existing.id || expected.version !== this.revision(existing))) {
        return { status: 'confirm-update', id: existing.id, version: this.revision(existing) };
      }
      if (!existing && expected) return { status: 'stale' };
      const record: Credential = {
        id: existing?.id ?? crypto.randomBytes(16).toString('hex'), origin,
        username: normalizedUsername, password, updatedAt: new Date().toISOString(),
      };
      await this.transport('write', JSON.stringify([...records.filter(item => item.id !== record.id), record]));
      return { status: 'saved' };
    });
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }
  async remove(id: string) { await this.change(records => records.filter(r => r.id !== id)); }
  async reveal(id: string) { await this.queue; const item = (await this.read()).find(r => r.id === id); if (!item) throw new Error('账号已不存在'); return item.password; }
}
