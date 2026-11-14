import { session, Session, Cookie } from 'electron';
import { Region } from '../shared/model';
import { VaultTransport } from './credentials';
import { parseStoredPartitionNames } from './account-profiles';

interface StoredCookies { version: 1; partitions: Record<string, Cookie[]> }
interface CookieChange { revision: number; cookie: Cookie | null }
type CookieChanged = (event: Electron.Event, cookie: Cookie, cause: string, removed: boolean) => void;
interface Profile {
  session: Session; ready: Promise<void>; readyStatus: 'pending' | 'ready' | 'failed'; leases: number;
  changed: CookieChanged; timer?: ReturnType<typeof setTimeout>;
  restorePending: boolean; mergeRequired: boolean; applyingStored: boolean;
  revision: number; persistedRevision: number; forceDirty: boolean; changes: Map<string, CookieChange>;
  ignoredRestoreChanges: Map<string, number>;
}
export interface LoginProfile {
  partition: string; session: Session; ready: Promise<void>; release: () => void;
  updateCookies: (change: (session: Session) => Promise<void>) => Promise<void>;
}

function cookieIdentity(cookie: Cookie): string {
  return JSON.stringify([cookie.name, (cookie.domain ?? '').replace(/^\./, '').toLowerCase(), cookie.path, cookie.hostOnly === true]);
}
function restoreEventIdentity(cookie: Cookie, removed: boolean): string {
  return JSON.stringify([cookieIdentity(cookie), cookie.value, removed]);
}
function sameCookie(a: Cookie, b: Cookie): boolean {
  return JSON.stringify([a.name, a.value, a.domain, a.path, a.secure, a.httpOnly, a.sameSite,
    a.session, a.hostOnly, a.expirationDate]) === JSON.stringify([b.name, b.value, b.domain, b.path,
    b.secure, b.httpOnly, b.sameSite, b.session, b.hostOnly, b.expirationDate]);
}
function changedCookies(before: Cookie[], after: Cookie[]): Array<{ cookie: Cookie; removed: boolean }> {
  const oldById = new Map(before.filter(cookie => cookie.session).map(cookie => [cookieIdentity(cookie), cookie]));
  const nextById = new Map(after.filter(cookie => cookie.session).map(cookie => [cookieIdentity(cookie), cookie]));
  const result: Array<{ cookie: Cookie; removed: boolean }> = [];
  for (const id of new Set([...oldById.keys(), ...nextById.keys()])) {
    const oldCookie = oldById.get(id), nextCookie = nextById.get(id);
    if (oldCookie && nextCookie && sameCookie(oldCookie, nextCookie)) continue;
    if (nextCookie) result.push({ cookie: nextCookie, removed: false });
    else if (oldCookie) result.push({ cookie: oldCookie, removed: true });
  }
  return result;
}
function mergeCookieChanges(base: Cookie[], changes: Map<string, CookieChange>): Cookie[] {
  if (!changes.size) return base;
  const result: Cookie[] = [], applied = new Set<string>();
  for (const cookie of base) {
    const id = cookieIdentity(cookie), change = changes.get(id);
    if (!change) { result.push(cookie); continue; }
    if (applied.has(id)) continue;
    if (change.cookie) result.push(change.cookie);
    applied.add(id);
  }
  for (const [id, change] of changes) if (!applied.has(id) && change.cookie) result.push(change.cookie);
  return result;
}

// Stable per-region slots preserve independent accounts in simultaneous tabs.
// Chromium persists site storage; session-only cookies live in the macOS Keychain.
export class LoginSessions {
  private profiles = new Map<string, Profile>();
  private deleting = new Set<string>();
  private blockedDeletes = new Set<string>();
  private stored?: Promise<StoredCookies>;
  private failedRead?: Promise<StoredCookies>;
  private serialized?: string;
  private queue: Promise<void> = Promise.resolve();
  private pendingPreparations = 0;
  private failureReported = false;
  constructor(private transport: VaultTransport, private report: () => void) {}

  async listStoredPartitions(): Promise<string[]> {
    return parseStoredPartitionNames(await this.transport('list-partitions'));
  }

  leaseCount(region: Region, slot: number) {
    return this.profiles.get(`persist:naruto-${region}-${slot}`)?.leases ?? 0;
  }

  acquire(region: Region): LoginProfile {
    let slot = 1;
    while ((this.profiles.get(`persist:naruto-${region}-${slot}`)?.leases ?? 0) > 0 ||
      this.deleting.has(`persist:naruto-${region}-${slot}`) || this.blockedDeletes.has(`persist:naruto-${region}-${slot}`)) slot++;
    return this.acquirePartition(`persist:naruto-${region}-${slot}`);
  }

  acquireSlot(region: Region, slot: number): LoginProfile {
    if (!Number.isSafeInteger(slot) || slot < 1 || (region !== 'br' && region !== 'cn')) throw new Error('账号登录槽位无效');
    const partition = `persist:naruto-${region}-${slot}`;
    if (this.deleting.has(partition) || this.blockedDeletes.has(partition)) throw new Error('该账号档案正在清理，请先完成清理');
    if ((this.profiles.get(partition)?.leases ?? 0) > 0) throw new Error('该账号档案已有打开中的标签');
    return this.acquirePartition(partition);
  }

  private acquirePartition(partition: string): LoginProfile {
    if (this.deleting.has(partition) || this.blockedDeletes.has(partition)) throw new Error('该账号档案正在清理，请先完成清理');
    let profile = this.profiles.get(partition);
    if (!profile) {
      const ses = session.fromPartition(partition);
      profile = { session: ses, leases: 0, ready: Promise.resolve(), readyStatus: 'pending', changed: () => {},
        restorePending: true, mergeRequired: false, applyingStored: false, revision: 0, persistedRevision: 0, forceDirty: false,
        changes: new Map(), ignoredRestoreChanges: new Map() };
      const current = profile;
      current.changed = (_event, cookie, _cause, removed) => {
        const restoreKey = restoreEventIdentity(cookie, removed), ignored = current.ignoredRestoreChanges.get(restoreKey) ?? 0;
        if (ignored > 0) {
          if (ignored === 1) current.ignoredRestoreChanges.delete(restoreKey);
          else current.ignoredRestoreChanges.set(restoreKey, ignored - 1);
          return;
        }
        if (current.applyingStored || !cookie.session) return;
        if (current.restorePending || current.mergeRequired) {
          if (this.recordChange(current, cookie, removed) && current.mergeRequired) this.scheduleSave(partition, current);
          return;
        }
        current.revision++;
        this.scheduleSave(partition, current);
      };
      this.profiles.set(partition, current);
      this.prepare(partition, current);
    } else if (profile.leases === 0 && ((profile.restorePending && profile.readyStatus === 'failed') || profile.mergeRequired || this.hasPendingChanges(profile))) {
      if (profile.mergeRequired) profile.restorePending = true;
      this.prepare(partition, profile);
    }
    return this.lease(partition, profile);
  }

  retain(partition: string): LoginProfile {
    const profile = this.profiles.get(partition);
    if (!/^persist:naruto-(br|cn)-[1-9]\d*$/.test(partition) || this.deleting.has(partition) || this.blockedDeletes.has(partition) || !profile || profile.leases === 0) throw new Error('profile-not-active');
    return this.lease(partition, profile);
  }

  async clearProfile(region: Region, slot: number, onStage: (stage: string) => void = () => {}) {
    if ((region !== 'br' && region !== 'cn') || !Number.isSafeInteger(slot) || slot < 1) throw new Error('账号登录槽位无效');
    const partition = `persist:naruto-${region}-${slot}`;
    if (this.deleting.has(partition)) throw new Error('该账号档案正在清理，请稍后重试');
    const profile = this.profiles.get(partition);
    if ((profile?.leases ?? 0) > 0) throw new Error('该账号档案仍有打开中的标签或登录任务，请先结束后重试');

    // Keep the partition unavailable after any partial failure. The profile metadata
    // remains pending until every cleanup stage has succeeded and the user retries.
    this.blockedDeletes.add(partition);
    this.deleting.add(partition);
    if (profile) {
      this.cancelTimer(profile);
      profile.session.cookies.removeListener('changed', profile.changed);
    }
    let stage = '清理 Chromium 网站数据';
    try {
      await this.enqueue(async () => {
        if ((this.profiles.get(partition)?.leases ?? 0) > 0) throw new Error('该账号档案仍有打开中的标签或登录任务');
        onStage(stage);
        const target = profile?.session ?? session.fromPartition(partition);
        await target.clearStorageData();
        await target.clearCache();
        target.flushStorageData();

        // Drop all in-memory cookie snapshots before attempting the Keychain write.
        // A later queued flush can no longer restore a cleared partition.
        if (profile) {
          this.cancelTimer(profile);
          profile.session.cookies.removeListener('changed', profile.changed);
          profile.changes.clear(); profile.ignoredRestoreChanges.clear();
          profile.restorePending = false; profile.mergeRequired = false; profile.forceDirty = false;
          profile.revision = profile.persistedRevision;
          this.profiles.delete(partition);
        }

        stage = '清理钥匙串登录快照'; onStage(stage);
        const stored = await this.read();
        const next: StoredCookies = { version: 1, partitions: { ...stored.partitions } };
        delete next.partitions[partition];
        const serialized = JSON.stringify(next);
        if (serialized !== this.serialized) await this.transport('write', serialized);
        this.serialized = serialized; this.stored = Promise.resolve(next); this.failedRead = undefined;
        this.failureReported = false;
      });
      this.blockedDeletes.delete(partition);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误';
      throw new Error(`${stage}失败：${detail}`);
    } finally {
      this.deleting.delete(partition);
    }
  }

  private lease(partition: string, current: Profile): LoginProfile {
    current.leases++;
    current.session.cookies.removeListener('changed', current.changed);
    current.session.cookies.on('changed', current.changed);
    let released = false;
    return { partition, session: current.session, ready: current.ready, updateCookies: change => {
      const task = this.enqueue(async () => {
        this.cancelTimer(current);
        const before = await current.session.cookies.get({ session: true });
        current.session.cookies.removeListener('changed', current.changed);
        let changed: Array<{ cookie: Cookie; removed: boolean }> = [];
        try {
          await change(current.session);
          changed = changedCookies(before, await current.session.cookies.get({ session: true }));
        } finally {
          if (current.leases > 0) current.session.cookies.on('changed', current.changed);
        }
        if (current.restorePending || current.mergeRequired) {
          for (const item of changed) this.recordChange(current, item.cookie, item.removed);
        } else if (changed.some(item => item.cookie.session)) {
          current.revision++;
        }
        if (changed.some(item => item.cookie.session) && !current.restorePending) this.scheduleSave(partition, current);
      });
      return task;
    }, release: () => {
      if (released) return; released = true;
      current.leases = Math.max(0, current.leases - 1);
      if (current.leases === 0) {
        current.session.cookies.removeListener('changed', current.changed);
        if (!current.restorePending) current.forceDirty = true;
        this.cancelTimer(current); this.save(partition, current);
      }
    } };
  }

  private prepare(partition: string, profile: Profile) {
    profile.readyStatus = 'pending';
    this.pendingPreparations++;
    const task = this.enqueue(async () => {
      if (this.deleting.has(partition) || this.blockedDeletes.has(partition)) return;
      if (profile.mergeRequired) {
        await this.persist([[partition, profile]]);
        profile.restorePending = true;
      } else if (this.hasPendingChanges(profile)) await this.persist([[partition, profile]]);
      const stored = await this.read();
      if (this.deleting.has(partition) || this.blockedDeletes.has(partition)) return;
      if (!profile.restorePending) return;
      if (profile.changes.size) {
        profile.restorePending = false;
        profile.mergeRequired = true;
        return;
      }
      profile.applyingStored = true;
      try {
        for (const cookie of stored.partitions[partition] ?? []) {
          if (this.deleting.has(partition) || this.blockedDeletes.has(partition)) return;
          // Keep the website's domain/path/security attributes and session lifetime.
          const url = `${cookie.secure ? 'https' : 'http'}://${(cookie.domain ?? '').replace(/^\./, '')}${cookie.path}`;
          const restoreKey = restoreEventIdentity(cookie, false);
          profile.ignoredRestoreChanges.set(restoreKey, (profile.ignoredRestoreChanges.get(restoreKey) ?? 0) + 1);
          try {
            await profile.session.cookies.set({ url, name: cookie.name, value: cookie.value, path: cookie.path,
              ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
              secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite });
          } catch (error) {
            const ignored = profile.ignoredRestoreChanges.get(restoreKey) ?? 0;
            if (ignored <= 1) profile.ignoredRestoreChanges.delete(restoreKey);
            else profile.ignoredRestoreChanges.set(restoreKey, ignored - 1);
            throw error;
          }
        }
        profile.restorePending = false;
        profile.mergeRequired = false;
        profile.changes.clear();
        profile.persistedRevision = profile.revision; profile.forceDirty = false;
      } finally { profile.applyingStored = false; }
    });
    const preparationFinished = () => {
      this.pendingPreparations = Math.max(0, this.pendingPreparations - 1);
      this.clearFailedRead();
    };
    void task.then(preparationFinished, preparationFinished);
    profile.ready = task.then(() => {
      profile.readyStatus = 'ready'; this.failureReported = false;
    }, error => {
      profile.readyStatus = 'failed'; this.reportFailure(); throw error;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.catch(() => {}).then(operation);
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  private recordChange(profile: Profile, cookie: Cookie, removed: boolean): boolean {
    if (!cookie.session) return false;
    profile.revision++;
    profile.changes.set(cookieIdentity(cookie), { revision: profile.revision, cookie: removed ? null : { ...cookie } });
    return true;
  }

  private read(): Promise<StoredCookies> {
    if (!this.stored) {
      this.failedRead = undefined;
      const task = Promise.resolve().then(() => this.transport('read')).then(value => {
        const parsed = JSON.parse(value || '[]');
        if (Array.isArray(parsed) && parsed.length === 0) return { version: 1 as const, partitions: {} };
        if (parsed?.version !== 1 || !parsed.partitions || typeof parsed.partitions !== 'object' || Array.isArray(parsed.partitions) ||
          Object.entries(parsed.partitions).some(([key, cookies]) => !/^persist:naruto-(br|cn)-[1-9]\d*$/.test(key) || !Array.isArray(cookies) || cookies.some(c =>
            !c || c.session !== true || typeof c.name !== 'string' || typeof c.value !== 'string' || typeof c.domain !== 'string' || typeof c.path !== 'string'))) {
          throw new Error('登录状态格式异常');
        }
        const stored = parsed as StoredCookies;
        if (this.serialized === undefined) this.serialized = JSON.stringify(stored);
        return stored;
      });
      this.stored = task;
      void task.catch(() => {
        this.failedRead = task;
        this.clearFailedRead();
      });
    }
    return this.stored;
  }

  private clearFailedRead() {
    if (this.pendingPreparations !== 0 || !this.failedRead) return;
    if (this.stored === this.failedRead) this.stored = undefined;
    this.failedRead = undefined;
  }

  private cancelTimer(profile: Profile) { if (profile.timer) clearTimeout(profile.timer); profile.timer = undefined; }
  private scheduleSave(partition: string, profile: Profile) {
    if (this.deleting.has(partition) || this.blockedDeletes.has(partition)) return;
    this.cancelTimer(profile);
    profile.timer = setTimeout(() => { profile.timer = undefined; this.save(partition, profile); }, 500);
  }
  private save(partition: string, profile: Profile) {
    if (this.deleting.has(partition) || this.blockedDeletes.has(partition)) return;
    const task = this.enqueue(() => this.persist([[partition, profile]]));
    void task.catch(() => this.reportFailure());
  }

  private async persist(entries: Array<[string, Profile]>) {
    entries = entries.filter(([partition, profile]) => !this.deleting.has(partition) && !this.blockedDeletes.has(partition) && this.profiles.get(partition) === profile);
    if (!entries.length) return;
    for (const [partition, profile] of entries) {
      this.cancelTimer(profile);
      if (profile.restorePending && !profile.changes.size) continue;
      await profile.session.cookies.flushStore();
      profile.session.flushStorageData();
    }

    // One read per save operation, including flush across several partitions.
    const stored = await this.read();
    const next: StoredCookies = { version: 1, partitions: { ...stored.partitions } };
    const snapshots: Array<{ profile: Profile; changes: Map<string, CookieChange>; revision: number }> = [];
    for (const [partition, profile] of entries) {
      if (profile.restorePending) {
        if (!profile.changes.size) continue;
        profile.restorePending = false;
        profile.mergeRequired = true;
      }
      const cookies = await profile.session.cookies.get({ session: true });
      const changes = new Map(profile.changes);
      const revision = profile.revision;
      next.partitions[partition] = profile.mergeRequired
        ? mergeCookieChanges(stored.partitions[partition] ?? [], changes)
        : cookies;
      snapshots.push({ profile, changes, revision });
    }

    const serialized = JSON.stringify(next);
    if (serialized !== this.serialized) {
      for (const snapshot of snapshots) snapshot.profile.forceDirty = true;
      await this.transport('write', serialized);
      this.serialized = serialized;
      this.stored = Promise.resolve(next);
      this.failedRead = undefined;
    }
    for (const snapshot of snapshots) {
      for (const [identity, change] of snapshot.changes) {
        if (snapshot.profile.changes.get(identity)?.revision === change.revision) snapshot.profile.changes.delete(identity);
      }
      if (snapshot.profile.revision === snapshot.revision) {
        snapshot.profile.persistedRevision = snapshot.revision;
        snapshot.profile.forceDirty = false;
      }
    }
    this.failureReported = false;
  }

  private reportFailure() {
    if (this.failureReported) return;
    this.failureReported = true; this.report();
  }

  async flush() {
    const entries = Array.from(this.profiles.entries()).filter(([partition]) => !this.deleting.has(partition) && !this.blockedDeletes.has(partition));
    for (const [, profile] of entries) this.cancelTimer(profile);
    if (!entries.length) return;
    const task = this.enqueue(async () => {
      await this.persist(entries);
      const current = () => entries.filter(([partition, profile]) => this.profiles.get(partition) === profile && !this.deleting.has(partition) && !this.blockedDeletes.has(partition));
      if (current().some(([, profile]) => this.hasPendingChanges(profile))) await this.persist(entries);
      if (current().some(([, profile]) => this.hasPendingChanges(profile))) throw new Error('登录状态仍有尚未保存的 Cookie 变更');
    });
    try { await task; } catch (error) { this.reportFailure(); throw error; }
  }

  private hasPendingChanges(profile: Profile) {
    return profile.forceDirty || profile.revision !== profile.persistedRevision || (profile.mergeRequired && profile.changes.size > 0);
  }
}
