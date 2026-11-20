import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Region, validRegion } from '../shared/model';

export interface AccountProfile { id: string; region: Region; slot: number; name: string; serverNote: string }
interface ProfileData {
  version: 1; profiles: AccountProfile[]; selectedByRegion: Record<Region, string | null>;
  pendingDeletes: string[]; deletedIds: string[];
}
const slotPartition = /^persist:naruto-(br|cn)-([1-9]\d*)$/;
const directoryPartition = /^naruto-(br|cn)-([1-9]\d*)$/;
const profileId = /^(br|cn)-([1-9]\d*)$/;

export function accountProfileId(region: Region, slot: number) { return `${region}-${slot}`; }
function parseSlot(value: string, pattern: RegExp): { region: Region; slot: number } | null {
  const match = pattern.exec(value);
  if (!match) return null;
  const slot = Number(match[2]);
  return Number.isSafeInteger(slot) && slot > 0 ? { region: match[1] as Region, slot } : null;
}
export function parseStoredPartitionNames(serialized: string): string[] {
  let raw: unknown;
  try { raw = JSON.parse(serialized || '[]'); } catch { throw new Error('钥匙串中的登录槽位信息格式异常'); }
  if (!Array.isArray(raw) || raw.some(item => typeof item !== 'string' || !parseSlot(item, slotPartition))) {
    throw new Error('钥匙串中的登录槽位信息格式异常');
  }
  return [...new Set(raw as string[])];
}
export function profilesFromLegacySources(directoryNames: string[], storedPartitions: string[]): AccountProfile[] {
  const slots = new Map<string, AccountProfile>();
  for (const name of directoryNames) {
    const match = parseSlot(name, directoryPartition);
    if (match) slots.set(accountProfileId(match.region, match.slot), legacyProfile(match.region, match.slot));
  }
  for (const name of storedPartitions) {
    const match = parseSlot(name, slotPartition);
    if (match) slots.set(accountProfileId(match.region, match.slot), legacyProfile(match.region, match.slot));
  }
  return [...slots.values()].sort((a, b) => a.region.localeCompare(b.region) || a.slot - b.slot);
}
function legacyProfile(region: Region, slot: number): AccountProfile {
  return { id: accountProfileId(region, slot), region, slot, name: `历史登录槽位${slot}`, serverNote: '' };
}
export function readPartitionDirectoryNames(userDataDirectory: string): string[] {
  const partitions = path.join(userDataDirectory, 'Partitions');
  try { return fs.readdirSync(partitions, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error('无法读取旧登录槽位目录，请重试');
  }
}

function profileIds(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !profileId.test(id)) || new Set(value).size !== value.length) {
    throw new Error(`账号档案文件中的${field}无效`);
  }
  return value as string[];
}
function emptyData(): ProfileData { return { version: 1, profiles: [], selectedByRegion: { br: null, cn: null }, pendingDeletes: [], deletedIds: [] }; }
function validateData(raw: unknown): ProfileData {
  if (!raw || typeof raw !== 'object') throw new Error('账号档案文件格式异常');
  const value = raw as Partial<ProfileData>;
  if (value.version !== 1 || !Array.isArray(value.profiles) || !value.selectedByRegion || typeof value.selectedByRegion !== 'object') {
    throw new Error('账号档案文件格式异常');
  }
  const seen = new Set<string>();
  const profiles = value.profiles.map((item): AccountProfile => {
    if (!item || typeof item !== 'object' || !validRegion(item.region) || !Number.isSafeInteger(item.slot) || item.slot < 1 ||
      item.id !== accountProfileId(item.region, item.slot) || !profileId.test(item.id) || seen.has(item.id) ||
      typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 40 ||
      typeof item.serverNote !== 'string' || item.serverNote.trim().length > 40) throw new Error('账号档案文件格式异常或存在重复槽位映射');
    seen.add(item.id);
    return { id: item.id, region: item.region, slot: item.slot, name: item.name.trim(), serverNote: item.serverNote.trim() };
  });
  const pendingDeletes = profileIds(value.pendingDeletes, '待清理状态');
  const deletedIds = profileIds(value.deletedIds, '已删除记录');
  if (pendingDeletes.some(id => !seen.has(id)) || deletedIds.some(id => seen.has(id) || pendingDeletes.includes(id))) {
    throw new Error('账号档案文件中的清理状态与档案不一致');
  }
  const pending = new Set(pendingDeletes);
  const selected = value.selectedByRegion as Record<string, unknown>;
  const selectedByRegion: Record<Region, string | null> = { br: null, cn: null };
  for (const region of ['br', 'cn'] as const) {
    const id = selected[region];
    if (id !== null && id !== undefined && (typeof id !== 'string' || pending.has(id) || !profiles.some(item => item.id === id && item.region === region))) {
      throw new Error('账号档案文件中的上次选择无效');
    }
    selectedByRegion[region] = typeof id === 'string' ? id : null;
  }
  return { version: 1, profiles, selectedByRegion, pendingDeletes, deletedIds };
}

export class AccountProfileStore {
  readonly file: string;
  loadError: string | null = null;
  private data: ProfileData | null = null;
  constructor(userDataDirectory: string) {
    this.file = path.join(userDataDirectory, 'account-profiles.json');
    this.reload();
  }
  reload() {
    let error: string | null = null, loaded: ProfileData | null = null;
    try {
      if (!fs.existsSync(this.file)) loaded = emptyData();
      else loaded = validateData(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch { error = '账号档案资料无法读取，原文件已保留。恢复该文件后可重试。'; }
    this.data = loaded; this.loadError = error;
  }
  profiles() { return this.data?.profiles.map(profile => ({ ...profile })) ?? []; }
  selected(region: Region) { return this.data?.selectedByRegion[region] ?? null; }
  get(id: string) { return this.data?.profiles.find(profile => profile.id === id); }
  pendingDeletes() { return [...(this.data?.pendingDeletes ?? [])]; }
  deletedIds() { return [...(this.data?.deletedIds ?? [])]; }
  isPendingDelete(id: string) { return this.data?.pendingDeletes.includes(id) ?? false; }
  isDeleted(id: string) { return this.data?.deletedIds.includes(id) ?? false; }
  private current(): ProfileData {
    if (this.loadError || !this.data) throw new Error(this.loadError ?? '账号档案资料无法读取');
    return this.data;
  }
  private save(next: ProfileData) {
    const directory = path.dirname(this.file), temp = `${this.file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    let fd: number | undefined;
    try {
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(next, null, 2), 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temp, this.file);
      this.data = next;
    } catch {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* Preserve the original write failure. */ } }
      try { fs.unlinkSync(temp); } catch { /* A missing temporary file is harmless. */ }
      throw new Error(`账号档案保存失败，原资料保持不变。请检查磁盘空间后重试。(${directory})`);
    }
  }
  select(profile: AccountProfile) {
    const current = this.current();
    if (!profile || !validRegion(profile.region) || profile.id !== accountProfileId(profile.region, profile.slot)) throw new Error('账号档案无效');
    if (current.pendingDeletes.includes(profile.id) || current.deletedIds.includes(profile.id)) throw new Error('该档案正在清理，暂时无法选择');
    const profiles = current.profiles.some(item => item.id === profile.id) ? current.profiles : [...current.profiles, { ...profile }];
    const next: ProfileData = { ...current, profiles: profiles.map(item => ({ ...item })), selectedByRegion: { ...current.selectedByRegion, [profile.region]: profile.id } };
    this.save(next);
  }
  remember(profile: AccountProfile) {
    const current = this.current();
    if (!profile || !validRegion(profile.region) || !Number.isSafeInteger(profile.slot) || profile.slot < 1 ||
      profile.id !== accountProfileId(profile.region, profile.slot)) throw new Error('账号档案无效');
    if (current.pendingDeletes.includes(profile.id) || current.deletedIds.includes(profile.id)) throw new Error('该档案正在清理，暂时无法使用');
    if (current.profiles.some(item => item.id === profile.id)) return;
    this.save({ ...current, profiles: [...current.profiles, { ...profile }] });
  }
  create(region: Region, slot: number, name: string, serverNote: string): AccountProfile {
    const current = this.current();
    const normalizedName = name.trim(), normalizedNote = serverNote.trim();
    if (!validRegion(region) || !Number.isSafeInteger(slot) || slot < 1 || !normalizedName || normalizedName.length > 40 || normalizedNote.length > 40) {
      throw new Error('账号名称需为1–40个字符，区服备注最多40个字符');
    }
    const id = accountProfileId(region, slot);
    if (current.pendingDeletes.includes(id) || current.deletedIds.includes(id)) throw new Error('该登录槽位正在清理或已删除，不能重新分配');
    if (current.profiles.some(profile => profile.id === id)) throw new Error('该登录槽位已关联账号档案');
    const profile = { id, region, slot, name: normalizedName, serverNote: normalizedNote };
    this.save({ ...current, profiles: [...current.profiles, profile], selectedByRegion: { ...current.selectedByRegion, [region]: id } });
    return { ...profile };
  }
  update(id: string, name: string, serverNote: string): AccountProfile {
    const current = this.current(), normalizedName = name.trim(), normalizedNote = serverNote.trim();
    if (current.pendingDeletes.includes(id) || current.deletedIds.includes(id)) throw new Error('该档案正在清理，暂时无法编辑');
    if (!normalizedName || normalizedName.length > 40 || normalizedNote.length > 40) throw new Error('账号名称需为1–40个字符，区服备注最多40个字符');
    const previous = current.profiles.find(profile => profile.id === id);
    if (!previous) throw new Error('账号档案已不存在');
    const profile = { ...previous, name: normalizedName, serverNote: normalizedNote };
    this.save({ ...current, profiles: current.profiles.map(item => item.id === id ? profile : item) });
    return { ...profile };
  }
  beginDelete(profile: AccountProfile, fallback?: AccountProfile) {
    const current = this.current();
    if (!profile || !validRegion(profile.region) || profile.id !== accountProfileId(profile.region, profile.slot)) throw new Error('账号档案无效');
    if (current.deletedIds.includes(profile.id)) throw new Error('该档案已经删除');
    if (current.pendingDeletes.includes(profile.id)) return;
    if (fallback && (fallback.region !== profile.region || current.pendingDeletes.includes(fallback.id) || current.deletedIds.includes(fallback.id))) {
      throw new Error('备用选择的账号档案无效');
    }
    const profiles = new Map(current.profiles.map(item => [item.id, { ...item }]));
    profiles.set(profile.id, { ...profile });
    if (fallback) profiles.set(fallback.id, { ...fallback });
    const selectedByRegion = { ...current.selectedByRegion };
    if (selectedByRegion[profile.region] === profile.id) selectedByRegion[profile.region] = fallback?.id ?? null;
    this.save({ ...current, profiles: [...profiles.values()], selectedByRegion,
      pendingDeletes: [...current.pendingDeletes, profile.id] });
  }
  completeDelete(id: string) {
    const current = this.current();
    if (!current.pendingDeletes.includes(id)) throw new Error('该档案没有待完成的清理');
    const profile = current.profiles.find(item => item.id === id);
    if (!profile) throw new Error('待清理档案资料已不存在');
    const selectedByRegion = { ...current.selectedByRegion };
    if (selectedByRegion[profile.region] === id) selectedByRegion[profile.region] = null;
    this.save({ ...current, profiles: current.profiles.filter(item => item.id !== id), selectedByRegion,
      pendingDeletes: current.pendingDeletes.filter(item => item !== id), deletedIds: [...current.deletedIds, id] });
  }
}

export type DiscoveryStatus = 'idle' | 'loading' | 'ready' | 'failed';
export class AccountProfiles {
  private discovered: AccountProfile[] = [];
  private discoveryStatus: DiscoveryStatus = 'idle';
  private discoveryError = '';
  private pending?: Promise<void>;
  constructor(private store: AccountProfileStore, private userDataDirectory: string,
    private listStoredPartitions: () => Promise<string[]>) {}
  get status() { return this.store.loadError ? 'failed' : this.discoveryStatus; }
  get error() { return this.store.loadError ?? this.discoveryError; }
  get canCreate() { return !this.store.loadError && this.discoveryStatus === 'ready'; }
  list(): AccountProfile[] {
    const profiles = new Map<string, AccountProfile>();
    for (const profile of this.discovered) if (!this.store.isDeleted(profile.id)) profiles.set(profile.id, { ...profile });
    for (const profile of this.store.profiles()) if (!this.store.isDeleted(profile.id)) profiles.set(profile.id, { ...profile });
    return [...profiles.values()].sort((a, b) => a.region.localeCompare(b.region) || a.slot - b.slot);
  }
  get(id: string) { return this.list().find(profile => profile.id === id); }
  selected(region: Region) { return this.store.selected(region); }
  async discover(retry = false) {
    if (retry) {
      this.store.reload(); this.discovered = []; this.discoveryStatus = 'idle'; this.discoveryError = '';
    }
    if (this.store.loadError) throw new Error(this.store.loadError);
    if (!retry && this.discoveryStatus === 'ready') return;
    if (this.pending) return this.pending;
    this.discoveryStatus = 'loading'; this.discoveryError = '';
    this.pending = (async () => {
      try {
        const [stored, directories] = await Promise.all([
          this.listStoredPartitions(), Promise.resolve(readPartitionDirectoryNames(this.userDataDirectory))
        ]);
        this.discovered = profilesFromLegacySources(directories, stored).filter(profile => !this.store.isDeleted(profile.id));
        this.discoveryStatus = 'ready'; this.discoveryError = '';
      } catch (error) {
        this.discoveryStatus = 'failed';
        this.discoveryError = error instanceof Error ? error.message : '无法读取旧登录槽位，请重试';
        throw new Error(this.discoveryError);
      } finally { this.pending = undefined; }
    })();
    return this.pending;
  }
  select(id: string) {
    const profile = this.get(id);
    if (!profile) throw new Error('账号档案已不存在，请刷新列表后重试');
    if (this.store.isPendingDelete(id)) throw new Error('该档案正在清理，暂时无法选择');
    this.store.select(profile);
    return { ...profile };
  }
  create(region: Region, name: string, serverNote: string) {
    if (!this.canCreate) throw new Error(this.error || '请先完成旧登录槽位检查');
    const known = [...this.list().filter(profile => profile.region === region).map(profile => profile.slot),
      ...this.store.deletedIds().map(id => parseSlot(id, profileId)).filter((slot): slot is { region: Region; slot: number } => !!slot && slot.region === region).map(slot => slot.slot)];
    const slot = known.length ? Math.max(...known) + 1 : 1;
    if (!Number.isSafeInteger(slot)) throw new Error('无法安全分配新的登录槽位');
    return this.store.create(region, slot, name, serverNote);
  }
  update(id: string, name: string, serverNote: string) {
    if (this.store.loadError) throw new Error(this.store.loadError);
    const profile = this.get(id);
    if (!profile) throw new Error('账号档案已不存在');
    this.store.remember(profile);
    return this.store.update(id, name, serverNote);
  }
  isPendingDelete(id: string) { return this.store.isPendingDelete(id); }
  beginDelete(id: string) {
    if (this.store.loadError) throw new Error(this.store.loadError);
    const profile = this.get(id);
    if (!profile) throw new Error('账号档案已不存在');
    if (this.store.isPendingDelete(id)) return { ...profile };
    const fallback = this.selected(profile.region) === id
      ? this.list().find(item => item.region === profile.region && item.id !== id && !this.store.isPendingDelete(item.id))
      : undefined;
    this.store.beginDelete(profile, fallback);
    return { ...profile };
  }
  completeDelete(id: string) {
    this.store.completeDelete(id);
    this.discovered = this.discovered.filter(profile => profile.id !== id);
  }
}
