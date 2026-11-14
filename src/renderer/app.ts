import { svg } from './icons';
import { installFocusModality } from './focus';
import { LOBBY_PRESETS, LobbyView } from './lobby';
import { titlePalette } from '../shared/appearance';
import { AppState, Command, CredentialInfo, CredentialSiteOption, Preferences, Theme, REGIONS, CHROME_HEIGHT, SAVE_PROMPT_HEIGHT } from '../shared/model';
installFocusModality();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function fitSettingSelect(select: HTMLSelectElement) {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  if (!context) return;
  const style = getComputedStyle(select);
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  select.style.width = `${Math.ceil(context.measureText(select.selectedOptions[0]?.textContent ?? '').width) + 38}px`;
}
const api = window.naruto;
$('new-tab').innerHTML = svg('plus'); $('refresh').innerHTML = svg('refresh'); $('settings').innerHTML = svg('settings');
let latest: AppState;
type SettingsPage = 'game' | 'appearance' | 'accounts';
let activeSettingsPage: SettingsPage = 'game';
let displayedTabs = '';
let settingsWasOpen = false;
let toastTimer: ReturnType<typeof setTimeout>;
let lobbyBackgroundTimer: ReturnType<typeof setTimeout> | undefined;
let pendingLobbyBackground: string | null | undefined;
let lobbyBackgroundRevision = 0;
let customLobbyColorMode = false;
let dialogAction: ((name: string, password: string, serverNote: string) => Promise<boolean | void>) | null = null;
let dialogSequence = 0;
let lastFocus: HTMLElement | null = null;
let profileListSignature = '';
let profilePickerSignature = '';
let profilePickerWasOpen = false;
const secretTimers = new Set<ReturnType<typeof setTimeout>>();
let credentialLoad = 0;

function toast(message: string) {
  $('status-text').textContent = message; $('status-text').parentElement!.hidden = false;
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; if (latest) render(latest); }, 5000);
}
async function command(input: Command): Promise<void | boolean> { try { return await api.command(input); } catch (error) { toast((error as Error).message); return false; } }
const lobby = new LobbyView(command);
function queueLobbyBackground(value: string | null, delay = 180) {
  lobbyBackgroundRevision++;
  pendingLobbyBackground = value;
  lobby.previewBackground(value);
  if (lobbyBackgroundTimer) clearTimeout(lobbyBackgroundTimer);
  lobbyBackgroundTimer = setTimeout(() => { lobbyBackgroundTimer = undefined; void flushLobbyBackground(); }, delay);
}
async function flushLobbyBackground() {
  if (lobbyBackgroundTimer) clearTimeout(lobbyBackgroundTimer);
  lobbyBackgroundTimer = undefined;
  if (pendingLobbyBackground === undefined) return;
  const revision = lobbyBackgroundRevision;
  const value = pendingLobbyBackground; pendingLobbyBackground = undefined;
  const result = await command({ type: 'lobby-background', value });
  if (revision === lobbyBackgroundRevision) {
    lobby.clearBackgroundPreview();
    if (latest) renderLobbyPreferences(latest);
  }
  return result;
}
function scrubSecrets() {
  for (const timer of secretTimers) clearTimeout(timer); secretTimers.clear();
  for (const element of Array.from(document.querySelectorAll('.credential-password'))) element.remove();
  $('edit-password').setAttribute('value', ''); ($('edit-password') as HTMLInputElement).value = '';
}
function editProfile(profile?: AppState['profiles'][number]) {
  const create = !profile;
  void openDialog({ title: create ? '新建登录档案' : '编辑登录档案', label: '档案名称', value: profile?.name ?? '',
    serverNote: profile?.serverNote ?? '', serverNoteLabel: '常用区服备注（仅供提醒）', submit: create ? '创建' : '保存',
    action: async (name, _password, serverNote) => {
      if (create) await api.command({ type: 'profile-create', name, serverNote });
      else await api.command({ type: 'profile-update', id: profile!.id, name, serverNote });
    } });
}
function confirmDeleteProfile(profile: AppState['profiles'][number]) {
  void openDialog({ title: '删除登录档案', label: '', hideInput: true,
    description: `将清除${REGIONS[profile.region].label}「${profile.name}」在本机保存的 Cookie、网站数据和会话登录快照。不会注销官网账号，已保存的密码会保留。此操作无法撤销。`,
    submit: '删除档案', dangerSubmit: true,
    action: async () => api.command({ type: 'profile-delete', id: profile.id }) });
}
function profileNotes(profile: AppState['profiles'][number]) {
  const notes: string[] = [];
  if (profile.identityNeedsConfirmation) notes.push('登录身份待自行确认');
  if (profile.serverNote) notes.push(`常用区服：${profile.serverNote}`);
  return notes;
}
function renderProfileControls(state: AppState) {
  const regionProfiles = state.profiles.filter(profile => profile.region === state.preferences.region);
  const signature = JSON.stringify([state.profiles, state.profileDiscovery, state.profileError, state.canCreateProfile]);
  if (signature !== profileListSignature) {
    profileListSignature = signature;
    const list = $('profile-list'); list.replaceChildren();
    for (const profile of state.profiles) {
      const row = document.createElement('div'); row.className = 'profile-row'; row.dataset.id = profile.id;
      const info = document.createElement('div'); info.className = 'profile-info';
      const name = document.createElement('div'); name.className = 'profile-name'; name.textContent = `${REGIONS[profile.region].label} · ${profile.name}`;
      const detail = document.createElement('div'); detail.className = 'profile-detail';
      if (profile.cleanupStatus === 'deleting') detail.textContent = profile.cleanupStage || '正在清理…';
      else if (profile.cleanupStatus === 'pending') detail.textContent = '清理未完成 · 点击重试清理';
      else detail.textContent = profileNotes(profile).join(' · ') || '区服备注未设置';
      info.append(name, detail);
      const actions = document.createElement('div'); actions.className = 'profile-actions';
      if (profile.cleanupStatus) {
        row.dataset.cleanup = profile.cleanupStatus;
        const retry = document.createElement('button'); retry.className = 'quiet small'; retry.type = 'button'; retry.textContent = profile.cleanupStatus === 'deleting' ? '清理中…' : '重试清理';
        retry.dataset.action = 'retry-delete';
        retry.disabled = profile.cleanupStatus === 'deleting' || !!profile.deleteBlockedReason;
        retry.title = profile.deleteBlockedReason || '';
        if (profile.cleanupStatus === 'pending') retry.addEventListener('click', () => void command({ type: 'profile-delete', id: profile.id }));
        actions.append(retry);
      } else {
        const edit = document.createElement('button'); edit.className = 'quiet small'; edit.type = 'button'; edit.textContent = '编辑';
        edit.dataset.action = 'edit';
        edit.addEventListener('click', () => editProfile(profile));
        const remove = document.createElement('button'); remove.className = 'quiet small danger'; remove.type = 'button'; remove.textContent = '删除';
        remove.dataset.action = 'delete';
        remove.disabled = !!profile.deleteBlockedReason; remove.title = profile.deleteBlockedReason || '';
        remove.addEventListener('click', () => confirmDeleteProfile(profile));
        actions.append(edit, remove);
      }
      row.append(info, actions); list.append(row);
    }
    if (!state.profiles.length && state.profileDiscovery === 'ready') {
      const empty = document.createElement('div'); empty.className = 'profile-row'; empty.textContent = '还没有登录档案'; list.append(empty);
    }
  }
  $('profile-error').textContent = state.profileError;
  $('profile-error').hidden = !state.profileError;
  $('profile-retry').hidden = !state.profileError || state.profileDiscovery !== 'failed';
  ($('profile-create') as HTMLButtonElement).disabled = !state.canCreateProfile;

  const picker = $('profile-picker-backdrop'); picker.hidden = !state.profilePickerOpen;
  if (state.profilePickerOpen) {
    $('profile-picker-title').textContent = state.profilePickerIntent === 'open' ? '打开账号档案' : '选择登录档案';
    $('profile-picker-help').textContent = `${REGIONS[state.preferences.region].label} · 每个档案保留独立登录状态`;
    const pickerStatus = $('profile-picker-status');
    pickerStatus.className = state.profileDiscovery === 'failed' || !!state.profileError || !!state.notice ? 'error' : '';
    pickerStatus.textContent = state.profileDiscovery === 'loading' ? '正在读取本地登录档案和历史槽位…' : state.profileError || state.notice || '';
    const pickerSignature = JSON.stringify([state.profiles, state.profileDiscovery, state.profileError, state.selectedProfileId, state.preferences.region, state.profilePickerIntent]);
    if (pickerSignature !== profilePickerSignature) {
      profilePickerSignature = pickerSignature;
      const list = $('profile-picker-list'); list.replaceChildren();
      for (const profile of regionProfiles) {
        const row = document.createElement('div'); row.className = 'profile-option'; row.dataset.id = profile.id;
        const info = document.createElement('div'); info.className = 'profile-option-info';
        const name = document.createElement('div'); name.className = 'profile-option-name';
        name.textContent = `${profile.name}${profile.id === state.selectedProfileId ? ' · 当前选择' : ''}`;
        info.append(name);
        const notes = profile.cleanupStatus ? ['清理未完成，请在设置中重试'] : profileNotes(profile);
        if (notes.length) { const note = document.createElement('div'); note.className = 'profile-option-note'; note.textContent = notes.join(' · '); info.append(note); }
        if (state.profilePickerIntent === 'select') {
          const choose = document.createElement('button'); choose.className = 'quiet small'; choose.type = 'button'; choose.textContent = '选择';
          choose.disabled = !!profile.cleanupStatus;
          choose.addEventListener('click', () => void command({ type: 'profile-select', id: profile.id }));
          row.append(info, choose);
        } else row.append(info);
        const open = document.createElement('button'); open.className = 'primary small'; open.type = 'button'; open.textContent = '打开';
        open.disabled = !!profile.cleanupStatus;
        open.addEventListener('click', () => void command({ type: 'profile-open', id: profile.id }));
        row.append(open); list.append(row);
      }
      if (state.profileDiscovery === 'ready' && !regionProfiles.length) {
        const empty = document.createElement('div'); empty.className = 'profile-row'; empty.textContent = '这个地区还没有登录档案'; list.append(empty);
      }
    }
    ($('profile-picker-create') as HTMLButtonElement).disabled = !state.canCreateProfile;
    $('profile-picker-create').hidden = !state.canCreateProfile;
    $('profile-picker-retry').hidden = state.profileDiscovery !== 'failed';
    if (!profilePickerWasOpen) {
      const first = $('profile-picker-list').querySelector<HTMLElement>('button') ?? $('profile-picker-create'); first.focus();
    }
  } else { profilePickerSignature = ''; }
  profilePickerWasOpen = state.profilePickerOpen;
}
function render(state: AppState) {
  latest = state;
  document.documentElement.classList.toggle('on-lobby', !state.activeId && !state.settingsOpen);
  document.documentElement.classList.toggle('settings-open', state.settingsOpen);
  document.documentElement.dataset.region = state.preferences.region;
  applyAppearance(state.preferences);
  const signature = JSON.stringify([state.tabs, state.activeId]);
  if (signature !== displayedTabs) {
    displayedTabs = signature; const nav = $('tabs'); nav.setAttribute('role', 'tablist'); nav.replaceChildren();
    state.tabs.forEach((tab, index) => {
      const item = document.createElement('div'); item.className = `tab ${tab.state}`;
      item.setAttribute('role', 'tab'); item.setAttribute('aria-selected', String(tab.id === state.activeId));
      item.tabIndex = tab.id === state.activeId || (!state.activeId && index === 0) ? 0 : -1; item.dataset.id = tab.id;
      const regionLabel = REGIONS[tab.region ?? 'br'].label;
      item.title = `${regionLabel} · ${tab.profileName ?? `游戏 ${index + 1}`}${tab.name ? ` · 标签备注：${tab.name}` : ''} · 双击修改备注`;
      const dot = document.createElement('span'); dot.className = 'tab-icon';
      const name = document.createElement('span'); name.className = 'tab-name'; name.textContent = tab.name ? `${regionLabel} · ${tab.name}` : `${regionLabel} · ${tab.profileName ?? `游戏 ${index + 1}`}`;
      const close = document.createElement('button'); close.className = 'tab-close'; close.innerHTML = svg('close'); close.title = '关闭标签'; close.setAttribute('aria-label', `关闭${name.textContent}`);
      close.disabled = tab.closeDisabled === true;
      if (close.disabled) close.title = '请先取消恢复，再关闭原游戏';
      close.addEventListener('click', event => { event.stopPropagation(); void command({ type: 'close', id: tab.id }); });
      if (tab.state === 'loading') item.append(dot);
      item.append(name, close);
      item.addEventListener('click', () => void command({ type: 'select', id: tab.id }));
      item.addEventListener('dblclick', () => void rename(tab.id, tab.name));
      item.addEventListener('contextmenu', event => { event.preventDefault(); void rename(tab.id, tab.name); });
      item.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void command({ type: 'select', id: tab.id }); }
        if (event.key === 'F2') void rename(tab.id, tab.name);
        if (['ArrowRight', 'ArrowLeft'].includes(event.key)) {
          event.preventDefault(); const next = state.tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + state.tabs.length) % state.tabs.length];
          void command({ type: 'select', id: next.id });
        }
      }); nav.append(item);
    });
    const activeElement = nav.querySelector<HTMLElement>('[aria-selected=true]'); activeElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const active = state.tabs.find(tab => tab.id === state.activeId);
  const status: Record<string, string> = { idle: '', loading: '正在加载…', ready: '', failed: '加载失败', crashed: '画面已停止' };
  if (active?.recoveryStage === 'login') status.loading = '正在获取游戏入口…';
  if (active?.recoveryStage === 'loading') status.loading = '正在重新进入…';
  if (active?.recoveryStage === 'confirming') status.ready = '请确认新游戏';
  $('status-dot').className = `status-dot ${active?.state ?? ''}`;
  $('status-dot').hidden = !state.notice && (!active || active.state === 'ready' || state.settingsOpen);
  $('status-text').textContent = state.notice || (state.settingsOpen ? '' : active ? status[active.state] : '');
  $('status-text').parentElement!.hidden = !$('status-text').textContent;
  const refresh = $('refresh') as HTMLButtonElement;
  refresh.disabled = !state.refresh.enabled; refresh.title = `${state.refresh.label} ⌘R`; refresh.setAttribute('aria-label', state.refresh.label);
  $('mute').innerHTML = svg(state.preferences.muted ? 'muted' : 'volume');
  $('mute').setAttribute('aria-pressed', String(state.preferences.muted)); $('mute').title = state.preferences.muted ? '取消总静音 ⇧⌘M' : '总静音 ⇧⌘M';
  $('settings-mute').setAttribute('aria-checked', String(state.preferences.muted));
  $('settings-localization').setAttribute('aria-checked', String(state.preferences.localization));
  $('localization-detail').textContent = state.preferences.localization !== state.localizationActive
    ? '巴西服 · 已保存，重启应用后生效' : '巴西服 · 重启应用后生效';
  $('settings').setAttribute('aria-expanded', String(state.settingsOpen));
  const showSavePrompt = !!state.prompt && !state.settingsOpen;
  $('save-prompt').hidden = !showSavePrompt;
  if (state.prompt) { $('save-text').textContent = `${state.prompt.update ? '更新' : '保存'} ${state.prompt.username} 的密码到钥匙串？`; $('save-password').textContent = state.prompt.update ? '更新' : '保存'; }
  const showRecoveryPrompt = !!state.recovery && !state.settingsOpen;
  $('recovery-prompt').hidden = !showRecoveryPrompt;
  $('recovery-prompt').style.top = `${CHROME_HEIGHT + (showSavePrompt ? SAVE_PROMPT_HEIGHT : 0)}px`;
  $('lobby').hidden = !!active || state.settingsOpen;
  $('home').hidden = !state.tabs.length;
  $('home').setAttribute('aria-pressed', String(!active && !state.settingsOpen));
  $('new-tab').hidden = !state.tabs.length;
  $('refresh').hidden = !state.tabs.length;
  $('mute').hidden = !state.tabs.length;
  renderProfileControls(state);
  $('placeholder').hidden = !active || !['failed', 'crashed'].includes(active.state) || state.settingsOpen;
  if (!active) { $('placeholder-title').textContent = ''; $('placeholder-detail').textContent = ''; }
  else {
    $('placeholder-title').textContent = active.state === 'crashed' ? '游戏画面已停止' : '游戏页面加载失败';
    $('placeholder-detail').textContent = active.region === 'br' ? '可以重新进入游戏获取新的登录入口。' : '请刷新页面重试。';
  }
  const retry = $('placeholder-recover') as HTMLButtonElement;
  retry.hidden = !active || !['failed', 'crashed'].includes(active.state) || state.settingsOpen;
  retry.disabled = !state.refresh.enabled; retry.textContent = state.refresh.label;
  $('open-game').hidden = !!active;
  $('settings-panel').hidden = !state.settingsOpen;
  lobby.render(state);
  renderLobbyPreferences(state);
  ($('quality-select') as HTMLSelectElement).value = state.preferences.quality;
  ($('flash-select') as HTMLSelectElement).value = state.preferences.flash;
  const flashChanged = state.preferences.flash !== state.flash.version.split('.')[0];
  $('flash-detail').textContent = !state.flash.available ? '组件尚未准备' : flashChanged ? '下次启动生效' : '';
  $('flash-detail').hidden = state.flash.available && !flashChanged;
  if (state.settingsOpen && !settingsWasOpen) { void loadCredentials(); $('close-settings').focus(); }
  if (!state.settingsOpen && settingsWasOpen) { void flushLobbyBackground(); credentialLoad++; scrubSecrets(); $('credentials').replaceChildren(); if (!$('dialog-backdrop').hidden) void closeDialog(); }
  settingsWasOpen = state.settingsOpen;
}
function selectSettingsPage(page: string | undefined) {
  if (page !== 'game' && page !== 'appearance' && page !== 'accounts') return;
  activeSettingsPage = page;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-settings-page]')) {
    if (button.dataset.settingsPage === activeSettingsPage) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-settings-content]')) {
    panel.hidden = panel.dataset.settingsContent !== activeSettingsPage;
  }
  $('settings-main').scrollTop = 0;
}
async function loadCredentials() {
  const sequence = ++credentialLoad; scrubSecrets(); $('credentials').textContent = '读取中…'; $('reload-credentials').hidden = true;
  try {
    const items = await api.credentials(); if (sequence !== credentialLoad || !latest.settingsOpen) return;
    $('vault-count').textContent = String(items.length); $('credentials').replaceChildren();
    if (!items.length) { const empty = document.createElement('div'); empty.className = 'vault-empty'; empty.textContent = '暂无账号'; $('credentials').append(empty); }
    for (const item of items) $('credentials').append(credentialRow(item));
  } catch (error) { if (sequence === credentialLoad && latest.settingsOpen) { $('reload-credentials').hidden = false; const failure = document.createElement('div'); failure.className = 'vault-empty error'; failure.textContent = (error as Error).message; $('credentials').replaceChildren(failure); } }
}
function confirmCredentialUpdate(siteId: string, siteLabel: string, username: string, password: string, current: { id: string; version: string }) {
  $('dialog-title').textContent = '更新已保存密码？';
  $('dialog-description').textContent = `“${username}”在${siteLabel}已有记录。确认后会用当前输入替换旧密码。`;
  $('dialog-description').hidden = false;
  $('credential-site-label').hidden = true; $('credential-site').hidden = true; $('credential-site').replaceChildren();
  $('name-label').hidden = true; $('edit-name').hidden = true; ($('edit-name') as HTMLInputElement).value = '';
  $('password-label').hidden = true; $('edit-password').hidden = true; ($('edit-password') as HTMLInputElement).value = '';
  $('server-note-label').hidden = true; $('edit-server-note').hidden = true;
  ($('edit-server-note') as HTMLInputElement).value = '';
  $('dialog-save').hidden = false; $('dialog-save').textContent = '确认更新'; $('dialog-cancel').textContent = '取消';
  $('dialog-error').textContent = '';
  let expected = current;
  dialogAction = async () => {
    const result = await api.addCredential(siteId, username, password, expected);
    if (result.status === 'confirm-update') {
      expected = { id: result.id, version: result.version };
      $('dialog-description').textContent = '这条密码记录在确认期间发生了变化。请再次确认是否用当前输入覆盖。';
      return false;
    }
    if (result.status === 'stale') {
      $('dialog-description').textContent = '原记录已被删除，请取消后重新新增。';
      $('dialog-save').hidden = true;
      return false;
    }
    await loadCredentials();
    toast(result.status === 'unchanged' ? '该网站已保存相同密码' : '密码已更新');
    return true;
  };
}
async function createCredential() {
  const sites = await api.credentialSites();
  if (!latest?.settingsOpen) return;
  if (!sites.length) throw new Error('当前没有可新增密码的登录站点');
  const siteSelect = $('credential-site') as HTMLSelectElement;
  await openDialog({ title: '新增已保存密码', label: '用户名', password: '', submit: '保存',
    siteOptions: sites, siteId: sites[0].id,
    action: async (username, password) => {
      const siteId = siteSelect.value;
      const result = await api.addCredential(siteId, username, password);
      if (result.status === 'confirm-update') {
        confirmCredentialUpdate(siteId, sites.find(site => site.id === siteId)?.label ?? '该网站', username.trim(), password, result);
        return false;
      }
      if (result.status === 'stale') throw new Error('密码记录已变化，请重新打开新增表单');
      await loadCredentials();
      toast(result.status === 'unchanged' ? '该网站已保存相同密码' : '已保存到 macOS 钥匙串');
      return true;
    } });
}
function credentialRow(item: CredentialInfo) {
  const row = document.createElement('div'); row.className = 'credential';
  const avatar = document.createElement('span'); avatar.className = 'credential-avatar'; avatar.textContent = item.username[0]?.toLocaleUpperCase() || '·';
  const info = document.createElement('div'); info.className = 'credential-info';
  const name = document.createElement('div'); name.className = 'credential-name'; name.textContent = item.username;
  const origin = document.createElement('div'); origin.className = 'credential-origin'; origin.textContent = new URL(item.origin).hostname;
  info.append(name, origin);
  const actions = document.createElement('div'); actions.className = 'credential-actions';
  const button = (label: string, action: () => Promise<void>) => {
    const btn = document.createElement('button'); btn.className = 'quiet'; btn.textContent = label;
    btn.addEventListener('click', () => { btn.disabled = true; void action().catch(error => toast(error.message)).finally(() => { btn.disabled = false; }); }); actions.append(btn); return btn;
  };
  const reveal = button('查看', async () => {
    const existing = info.querySelector('.credential-password'); if (existing) { existing.remove(); reveal.textContent = '查看'; return; }
    const value = await api.reveal(item.id); if (!latest.settingsOpen || !row.isConnected) return;
    const secret = document.createElement('code'); secret.className = 'credential-password'; secret.textContent = value; info.append(secret); reveal.textContent = '隐藏';
    const timer = setTimeout(() => { secret.remove(); reveal.textContent = '查看'; secretTimers.delete(timer); }, 20000); secretTimers.add(timer);
  });
  button('修改', async () => {
    const password = await api.reveal(item.id); if (!latest.settingsOpen) return;
    await openDialog({ title: '修改已保存的账号', label: '账号', value: item.username, password,
      action: async (username, secret) => { await api.edit(item.id, username, secret, item.version); await loadCredentials(); } });
  });
  const remove = button('删除', () => openDialog({ title: '删除这个已保存账号？', label: item.username, hideInput: true, submit: '删除',
    action: async () => { await api.remove(item.id); await loadCredentials(); } })); remove.classList.add('danger');
  row.append(avatar, info, actions); return row;
}
async function openDialog(options: { title: string; label: string; value?: string; password?: string; hideInput?: boolean; serverNote?: string; serverNoteLabel?: string; submit?: string; description?: string; dangerSubmit?: boolean; siteOptions?: CredentialSiteOption[]; siteId?: string; action: (name: string, password: string, serverNote: string) => Promise<boolean | void> }) {
  const sequence = ++dialogSequence;
  lastFocus = document.activeElement as HTMLElement;
  await api.command({ type: 'overlay', shown: true });
  if (sequence !== dialogSequence) return;
  $('dialog-title').textContent = options.title; $('name-label').textContent = options.label;
  $('name-label').hidden = !!options.hideInput;
  $('dialog-description').textContent = options.description ?? ''; $('dialog-description').hidden = !options.description;
  const siteSelect = $('credential-site') as HTMLSelectElement;
  const siteOptions = options.siteOptions ?? [];
  $('credential-site-label').hidden = !siteOptions.length; siteSelect.hidden = !siteOptions.length; siteSelect.replaceChildren();
  for (const site of siteOptions) { const option = document.createElement('option'); option.value = site.id; option.textContent = site.label; siteSelect.append(option); }
  if (siteOptions.length) siteSelect.value = options.siteId ?? siteOptions[0].id;
  const input = $('edit-name') as HTMLInputElement; input.value = options.value ?? ''; input.hidden = !!options.hideInput; input.maxLength = options.password !== undefined ? 320 : 40;
  const secret = $('edit-password') as HTMLInputElement; secret.value = options.password ?? ''; secret.hidden = options.password === undefined;
  const serverNote = $('edit-server-note') as HTMLInputElement; serverNote.value = options.serverNote ?? ''; serverNote.hidden = options.serverNote === undefined; serverNote.maxLength = 40;
  $('server-note-label').textContent = options.serverNoteLabel ?? '常用区服备注'; $('server-note-label').hidden = serverNote.hidden;
  $('password-label').hidden = secret.hidden; $('dialog-save').hidden = false; $('dialog-cancel').textContent = '取消'; $('dialog-save').textContent = options.submit ?? '保存'; $('dialog-save').classList.toggle('danger', !!options.dangerSubmit); $('dialog-error').textContent = '';
  $('dialog-backdrop').hidden = false; dialogAction = options.action;
  for (const id of ['edit-name', 'edit-password', 'edit-server-note', 'credential-site', 'dialog-save']) ($(id) as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = false;
  if (input.hidden) $('dialog-cancel').focus(); else { input.focus(); input.select(); }
}
async function closeDialog() {
  const sequence = ++dialogSequence;
  const restoreFocus = lastFocus;
  lastFocus = null;
  $('dialog-backdrop').hidden = true; ($('edit-name') as HTMLInputElement).value = ''; ($('edit-password') as HTMLInputElement).value = ''; ($('edit-server-note') as HTMLInputElement).value = ''; ($('credential-site') as HTMLSelectElement).replaceChildren(); $('credential-site-label').hidden = true; $('credential-site').hidden = true; $('dialog-description').textContent = ''; $('dialog-description').hidden = true; $('name-label').hidden = false; $('dialog-save').hidden = false; $('dialog-cancel').textContent = '取消'; $('dialog-save').classList.remove('danger'); dialogAction = null;
  for (const id of ['edit-name', 'edit-password', 'edit-server-note', 'credential-site', 'dialog-save']) ($(id) as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = false;
  await command({ type: 'overlay', shown: false });
  if (sequence === dialogSequence && latest?.settingsOpen && restoreFocus?.isConnected && !restoreFocus.closest('[hidden]')) restoreFocus.focus();
}
async function rename(id: string, name: string) { await openDialog({ title: '标签备注', label: '备注 · 留空恢复默认', value: name, action: value => api.command({ type: 'rename', id, name: value }) }); }
$('edit-form').addEventListener('submit', event => {
  event.preventDefault(); if (!dialogAction) return;
  const sequence = dialogSequence;
  const submit = $('dialog-save') as HTMLButtonElement; const action = dialogAction;
  for (const id of ['edit-name', 'edit-password', 'edit-server-note', 'credential-site', 'dialog-save']) ($(id) as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = true;
  void action(($('edit-name') as HTMLInputElement).value, ($('edit-password') as HTMLInputElement).value, ($('edit-server-note') as HTMLInputElement).value)
    .then(close => { if (sequence === dialogSequence && close !== false) return closeDialog(); })
    .catch(error => { if (sequence === dialogSequence) $('dialog-error').textContent = error.message; })
    .finally(() => { if (sequence === dialogSequence) for (const id of ['edit-name', 'edit-password', 'edit-server-note', 'credential-site', 'dialog-save']) ($(id) as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = false; });
});
document.addEventListener('keydown', event => {
  if (!$('dialog-backdrop').hidden) {
    if (event.key === 'Escape') { event.preventDefault(); void closeDialog(); }
    if (event.key === 'Tab') {
      const focusable = Array.from($('edit-form').querySelectorAll<HTMLElement>('button:not(:disabled):not([hidden]),input:not([hidden]),select:not([hidden])'));
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  } else if (!$('profile-picker-backdrop').hidden) {
    if (event.key === 'Escape') { event.preventDefault(); void command({ type: 'profiles-close-picker' }); }
    if (event.key === 'Tab') {
      const focusable = Array.from($('profile-picker-backdrop').querySelectorAll<HTMLElement>('button:not(:disabled):not([hidden])'));
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  } else if (event.key === 'Escape' && latest?.settingsOpen) void command({ type: 'settings' });
});
const bind = (id: string, type: Command['type']) => $(id).addEventListener('click', () => void command({ type } as Command));
bind('new-tab', 'new'); bind('home', 'home'); bind('refresh', 'refresh'); bind('placeholder-recover', 'refresh'); bind('mute', 'mute'); bind('settings-mute', 'mute');
$('profile-create').addEventListener('click', () => editProfile());
$('lobby-create-profile').addEventListener('click', () => editProfile());
$('lobby-profile-retry').addEventListener('click', () => void command({ type: 'profiles-retry' }));
$('profile-picker-create').addEventListener('click', () => editProfile());
$('profile-picker-cancel').addEventListener('click', () => void command({ type: 'profiles-close-picker' }));
$('profile-picker-retry').addEventListener('click', () => void command({ type: 'profiles-retry' }));
$('profile-retry').addEventListener('click', () => void command({ type: 'profiles-retry' }));
bind('settings', 'settings'); bind('close-settings', 'settings'); bind('save-password', 'save-password'); bind('dismiss-password', 'dismiss-prompt');
$('dialog-cancel').addEventListener('click', () => void closeDialog());
$('credential-create').addEventListener('click', () => void createCredential().catch(error => toast(error.message)));
$('reload-credentials').addEventListener('click', () => void loadCredentials());
$('complete-recovery').addEventListener('click', () => { if (latest?.recovery) void command({ type: 'complete-recovery', id: latest.recovery.candidateId }); });
$('cancel-recovery').addEventListener('click', () => { if (latest?.recovery) void command({ type: 'cancel-recovery', id: latest.recovery.candidateId }); });
$('flash-select').addEventListener('change', event => void command({ type: 'flash', version: (event.target as HTMLSelectElement).value as '34' | '31' }));
document.addEventListener('visibilitychange', () => { if (document.hidden) scrubSecrets(); });
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const bar = document.querySelector<HTMLElement>('.chrome')!;
function paintTitle(color: string | null) {
  const palette = color ? titlePalette(color) : null;
  for (const key of ['bg', 'fg', 'secondary', 'hover', 'selected', 'border']) {
    if (palette) bar.style.setProperty('--bar-' + key, palette[key as keyof typeof palette]);
    else bar.style.removeProperty('--bar-' + key);
  }
}
function applyAppearance(preferences: Preferences) {
  document.documentElement.dataset.dark = String(preferences.theme === 'dark' || (preferences.theme === 'system' && systemTheme.matches));
  ($('theme-select') as HTMLSelectElement).value = preferences.theme;
  ($('title-mode') as HTMLSelectElement).value = preferences.titleBarColor ? 'custom' : 'default';
  $('title-color').hidden = !preferences.titleBarColor;
  if (preferences.titleBarColor) ($('title-color') as HTMLInputElement).value = preferences.titleBarColor;
  fitSettingSelect($('theme-select') as HTMLSelectElement);
  fitSettingSelect($('title-mode') as HTMLSelectElement);
  paintTitle(preferences.titleBarColor);
}
function renderLobbyPreferences(state: AppState) {
  const selected = pendingLobbyBackground !== undefined ? pendingLobbyBackground : state.preferences.lobbyBackground;
  const mode = customLobbyColorMode ? 'custom' : selected === null ? 'theme' : LOBBY_PRESETS.some(preset => preset.color === selected) ? selected : 'custom';
  ($('lobby-bg-mode') as HTMLSelectElement).value = mode;
  fitSettingSelect($('lobby-bg-mode') as HTMLSelectElement);
  const custom = $('lobby-bg-custom') as HTMLInputElement;
  custom.hidden = mode !== 'custom';
  custom.value = mode === 'custom' ? selected! : lobby.backgroundFor(state);
  $('lobby-motion').setAttribute('aria-checked', String(state.preferences.lobbyMotion));
}
systemTheme.addEventListener('change', () => {
  if (latest) { applyAppearance(latest.preferences); lobby.refreshTheme(); renderLobbyPreferences(latest); }
});
$('theme-select').addEventListener('change', event => void command({ type: 'theme', value: (event.target as HTMLSelectElement).value as Theme }));
$('theme-select').addEventListener('change', event => fitSettingSelect(event.target as HTMLSelectElement));
$('title-mode').addEventListener('change', event => { fitSettingSelect(event.target as HTMLSelectElement); void command({ type: 'title-color', value: (event.target as HTMLSelectElement).value === 'custom' ? ($('title-color') as HTMLInputElement).value : null }); });
const lobbyBackgroundMode = $('lobby-bg-mode') as HTMLSelectElement;
const lobbyCustomBackground = $('lobby-bg-custom') as HTMLInputElement;
lobbyBackgroundMode.addEventListener('change', () => {
  fitSettingSelect(lobbyBackgroundMode);
  if (lobbyBackgroundMode.value === 'theme') { customLobbyColorMode = false; queueLobbyBackground(null, 0); return; }
  if (lobbyBackgroundMode.value === 'custom') {
    customLobbyColorMode = true;
    const selected = pendingLobbyBackground !== undefined ? pendingLobbyBackground : latest.preferences.lobbyBackground;
    const customColor = selected && !LOBBY_PRESETS.some(preset => preset.color === selected) ? selected : selected ?? lobby.backgroundFor(latest);
    lobbyCustomBackground.value = customColor;
    lobbyCustomBackground.hidden = false;
    return;
  }
  if (LOBBY_PRESETS.some(preset => preset.color === lobbyBackgroundMode.value)) {
    customLobbyColorMode = false;
    queueLobbyBackground(lobbyBackgroundMode.value, 0);
  }
});
lobbyCustomBackground.addEventListener('input', () => queueLobbyBackground(lobbyCustomBackground.value));
lobbyCustomBackground.addEventListener('change', () => { customLobbyColorMode = false; queueLobbyBackground(lobbyCustomBackground.value, 0); void flushLobbyBackground(); });
$('lobby-motion').addEventListener('click', () => {
  if (latest) void command({ type: 'lobby-motion', value: !latest.preferences.lobbyMotion });
});
$('title-color').addEventListener('input', event => paintTitle((event.target as HTMLInputElement).value));
$('title-color').addEventListener('change', event => void command({ type: 'title-color', value: (event.target as HTMLInputElement).value }));
api.onState(render); void api.state().then(render).catch(error => toast(error.message));

$('settings-localization').addEventListener('click', () => {
  if (latest) void command({ type: 'localization', value: !latest.preferences.localization });
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-settings-page]')) {
  button.addEventListener('click', () => selectSettingsPage(button.dataset.settingsPage));
}
selectSettingsPage(activeSettingsPage);

$('quality-select').addEventListener('change', event => void command({ type: 'quality', value: (event.target as HTMLSelectElement).value as 'low' | 'medium' | 'high' }));
