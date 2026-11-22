import { setText, setAttr, applyLanguage } from './i18n-dom';
import { msg, setLanguage } from '../shared/i18n';
import { svg } from './icons';
import { installFocusModality } from './focus';
import { LOBBY_PRESETS, LobbyView } from './lobby';
import { titlePalette } from '../shared/appearance';
import { AppState, Command, CredentialInfo, CredentialSiteOption, Preferences, Theme, REGIONS, CHROME_HEIGHT, SAVE_PROMPT_HEIGHT, CnEntry } from '../shared/model';
installFocusModality();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function fitSettingSelect(select: HTMLSelectElement) {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  if (!context) return;
  const style = getComputedStyle(select);
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  select.style.width = `${Math.ceil(context.measureText(select.selectedOptions[0]?.textContent ?? '').width) + 38}px`;
}
declare const __APP_VERSION__: string;
const api = window.naruto;
$('new-tab').innerHTML = svg('plus'); $('refresh').innerHTML = svg('refresh'); $('settings').innerHTML = svg('settings');
let latest: AppState;
type SettingsPage = 'game' | 'appearance' | 'accounts' | 'about';
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
  setText($('status-text'), message); $('status-text').parentElement!.hidden = false;
  setText($('toast'), message); $('toast').hidden = false;
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
  void openDialog({ title: create ? msg('ui.new_login_profile') : msg('ui.edit_login_profile'), label: msg('ui.profile_name'), value: profile?.name ?? '',
    serverNote: profile?.serverNote ?? '', serverNoteLabel: msg('ui.usual_server_note_reminder_only'), submit: create ? msg('ui.create') : msg('common.save'),
    action: async (name, _password, serverNote) => {
      if (create) await api.command({ type: 'profile-create', name, serverNote });
      else await api.command({ type: 'profile-update', id: profile!.id, name, serverNote });
    } });
}
function confirmDeleteProfile(profile: AppState['profiles'][number]) {
  void openDialog({ title: msg('ui.delete_login_profile'), label: '', hideInput: true,
    description: msg('ui.delete_local_cookies_website_data_and_login', { p0: REGIONS[profile.region].label, p1: profile.name }),
    submit: msg('ui.delete_profile'), dangerSubmit: true,
    action: async () => api.command({ type: 'profile-delete', id: profile.id }) });
}
function profileNotes(profile: AppState['profiles'][number]) {
  const notes: string[] = [];
  if (profile.identityNeedsConfirmation) notes.push(msg('ui.login_identity_needs_confirmation'));
  if (profile.serverNote) notes.push(msg('ui.usual_server', { p0: profile.serverNote }));
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
      const name = document.createElement('div'); name.className = 'profile-name'; setText(name, `${REGIONS[profile.region].label} · ${profile.name}`);
      const detail = document.createElement('div'); detail.className = 'profile-detail';
      if (profile.cleanupStatus === 'deleting') setText(detail, profile.cleanupStage || msg('ui.cleaning_up'));
      else if (profile.cleanupStatus === 'pending') setText(detail, msg('ui.cleanup_incomplete_click_to_retry'));
      else setText(detail, profileNotes(profile).join(' · ') || msg('ui.no_server_note'));
      info.append(name, detail);
      const actions = document.createElement('div'); actions.className = 'profile-actions';
      if (profile.cleanupStatus) {
        row.dataset.cleanup = profile.cleanupStatus;
        const retry = document.createElement('button'); retry.className = 'quiet small'; retry.type = 'button'; setText(retry, profile.cleanupStatus === 'deleting' ? msg('ui.cleaning') : msg('ui.retry_cleanup'));
        retry.dataset.action = 'retry-delete';
        retry.disabled = profile.cleanupStatus === 'deleting' || !!profile.deleteBlockedReason;
        setAttr(retry, 'title', profile.deleteBlockedReason || '');
        if (profile.cleanupStatus === 'pending') retry.addEventListener('click', () => void command({ type: 'profile-delete', id: profile.id }));
        actions.append(retry);
      } else {
        const edit = document.createElement('button'); edit.className = 'quiet small'; edit.type = 'button'; setText(edit, msg('ui.edit'));
        edit.dataset.action = 'edit';
        edit.addEventListener('click', () => editProfile(profile));
        const remove = document.createElement('button'); remove.className = 'quiet small danger'; remove.type = 'button'; setText(remove, msg('ui.delete'));
        remove.dataset.action = 'delete';
        remove.disabled = !!profile.deleteBlockedReason; setAttr(remove, 'title', profile.deleteBlockedReason || '');
        remove.addEventListener('click', () => confirmDeleteProfile(profile));
        actions.append(edit, remove);
      }
      row.append(info, actions); list.append(row);
    }
    if (!state.profiles.length && state.profileDiscovery === 'ready') {
      const empty = document.createElement('div'); empty.className = 'profile-row'; setText(empty, msg('ui.no_login_profiles_yet')); list.append(empty);
    }
  }
  setText($('profile-error'), state.profileError);
  $('profile-error').hidden = !state.profileError;
  $('profile-retry').hidden = !state.profileError || state.profileDiscovery !== 'failed';
  ($('profile-create') as HTMLButtonElement).disabled = !state.canCreateProfile;

  const picker = $('profile-picker-backdrop'); picker.hidden = !state.profilePickerOpen;
  if (state.profilePickerOpen) {
    setText($('profile-picker-title'), state.profilePickerIntent === 'open' ? msg('ui.open_account_profile') : msg('ui.select_login_profile'));
    setText($('profile-picker-help'), msg('ui.each_profile_keeps_its_own_login_session', { p0: REGIONS[state.preferences.region].label }));
    const pickerStatus = $('profile-picker-status');
    pickerStatus.className = state.profileDiscovery === 'failed' || !!state.profileError || !!state.notice ? 'error' : '';
    setText(pickerStatus, state.profileDiscovery === 'loading' ? msg('ui.reading_local_login_profiles_and_old_slots') : state.profileError || state.notice || '');
    const pickerSignature = JSON.stringify([state.profiles, state.profileDiscovery, state.profileError, state.selectedProfileId, state.preferences.region, state.profilePickerIntent]);
    if (pickerSignature !== profilePickerSignature) {
      profilePickerSignature = pickerSignature;
      const list = $('profile-picker-list'); list.replaceChildren();
      for (const profile of regionProfiles) {
        const row = document.createElement('div'); row.className = 'profile-option'; row.dataset.id = profile.id;
        const info = document.createElement('div'); info.className = 'profile-option-info';
        const name = document.createElement('div'); name.className = 'profile-option-name';
        setText(name, profile.id === state.selectedProfileId ? msg('profiles.selectedName',{name:profile.name}) : profile.name);
        info.append(name);
        const notes = profile.cleanupStatus ? [msg('ui.cleanup_incomplete_retry_in_settings')] : profileNotes(profile);
        if (notes.length) { const note = document.createElement('div'); note.className = 'profile-option-note'; setText(note, notes.join(' · ')); info.append(note); }
        if (state.profilePickerIntent === 'select') {
          const choose = document.createElement('button'); choose.className = 'quiet small'; choose.type = 'button'; setText(choose, msg('ui.select'));
          choose.disabled = !!profile.cleanupStatus;
          choose.addEventListener('click', () => void command({ type: 'profile-select', id: profile.id }));
          row.append(info, choose);
        } else row.append(info);
        const open = document.createElement('button'); open.className = 'primary small'; open.type = 'button'; setText(open, msg('ui.open'));
        open.disabled = !!profile.cleanupStatus;
        open.addEventListener('click', () => void command({ type: 'profile-open', id: profile.id }));
        row.append(open); list.append(row);
      }
      if (state.profileDiscovery === 'ready' && !regionProfiles.length) {
        const empty = document.createElement('div'); empty.className = 'profile-row'; setText(empty, msg('ui.no_login_profiles_in_this_region_yet')); list.append(empty);
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
  setLanguage(state.preferences.language);
  applyLanguage();
  ($("language-select") as HTMLSelectElement).value = state.preferences.language || "zh-CN";
  fitSettingSelect($("language-select") as HTMLSelectElement);
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
      setAttr(item, 'title', msg('ui.double_click_to_edit_note', { p0: regionLabel, p1: tab.profileName ?? msg('ui.game', { p0: index + 1 }), p2: tab.name ? msg('ui.tab_note', { p0: tab.name }) : '' }));
      const dot = document.createElement('span'); dot.className = 'tab-icon';
      const name = document.createElement('span'); name.className = 'tab-name'; setText(name, tab.name ? `${regionLabel} · ${tab.name}` : `${regionLabel} · ${tab.profileName ?? msg('ui.game', { p0: index + 1 })}`);
      const close = document.createElement('button'); close.className = 'tab-close'; close.innerHTML = svg('close'); setAttr(close, 'title', msg('ui.close_tab')); setAttr(close, 'aria-label', msg('ui.close', { p0: tab.name || tab.profileName || msg('ui.game', { p0: index + 1 }) }));
      close.disabled = tab.closeDisabled === true;
      if (close.disabled) setAttr(close, 'title', msg('ui.cancel_recovery_before_closing_the_original_game'));
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
  const status: Record<string, string> = { idle: '', loading: msg('ui.loading'), ready: '', failed: msg('ui.load_failed'), crashed: msg('ui.display_stopped') };
  if (active?.recoveryStage === 'login') status.loading = msg('ui.getting_game_entry');
  if (active?.recoveryStage === 'loading') status.loading = msg('ui.re_entering');
  if (active?.recoveryStage === 'confirming') status.ready = msg('ui.please_confirm_the_new_game');
  $('status-dot').className = `status-dot ${active?.state ?? ''}`;
  $('status-dot').hidden = !state.notice && (!active || active.state === 'ready' || state.settingsOpen);
  setText($('status-text'), state.notice || (state.settingsOpen ? '' : active ? status[active.state] : ''));
  $('status-text').parentElement!.hidden = !$('status-text').textContent;
  const refresh = $('refresh') as HTMLButtonElement;
  refresh.disabled = !state.refresh.enabled; setAttr(refresh, 'title', `${state.refresh.label} ⌘R`); setAttr(refresh, 'aria-label', state.refresh.label);
  $('mute').innerHTML = svg(state.preferences.muted ? 'muted' : 'volume');
  $('mute').setAttribute('aria-pressed', String(state.preferences.muted)); setAttr($('mute'), 'title', state.preferences.muted ? msg('ui.unmute_all_m') : msg('ui.mute_all_m'));
  $('settings-mute').setAttribute('aria-checked', String(state.preferences.muted));
  $('settings-localization').setAttribute('aria-checked', String(state.preferences.localization));
  setText($('localization-detail'), state.preferences.localization !== state.localizationActive
    ? msg('ui.brazil_saved_applies_after_restarting_the_app') : msg('ui.brazil_applies_after_restarting_the_app'));
  $('settings-assists').setAttribute('aria-checked', String(state.preferences.assistsEnabled));
  setText($('assists-detail'), state.preferences.assistsEnabled !== state.assistsActive
    ? msg('ui.assist_scripts_saved_reenter_hint') : msg('ui.assist_scripts_reenter_hint'));
  $('settings-game-speed').setAttribute('aria-checked', String(state.preferences.gameSpeed));
  setText($('game-speed-detail'), state.preferences.gameSpeed !== state.speedActive
    ? msg('ui.game_speed_saved_reenter_hint') : msg('ui.game_speed_reenter_hint'));
  $('settings').setAttribute('aria-expanded', String(state.settingsOpen));
  const showSavePrompt = !!state.prompt && !state.settingsOpen;
  $('save-prompt').hidden = !showSavePrompt;
  if (state.prompt) { setText($('save-text'), msg(state.prompt.update ? 'password.updateKeychainPrompt' : 'password.saveKeychainPrompt', { username: state.prompt.username })); setText($('save-password'), state.prompt.update ? msg('ui.update') : msg('common.save')); }
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
  if (!active) { setText($('placeholder-title'), ''); setText($('placeholder-detail'), ''); }
  else {
    setText($('placeholder-title'), active.state === 'crashed' ? msg('ui.game_display_stopped') : msg('ui.game_page_failed_to_load'));
    setText($('placeholder-detail'), active.region === 'br' ? msg('ui.re_enter_the_game_to_get_a') : msg('ui.refresh_the_page_and_try_again'));
  }
  const retry = $('placeholder-recover') as HTMLButtonElement;
  retry.hidden = !active || !['failed', 'crashed'].includes(active.state) || state.settingsOpen;
  retry.disabled = !state.refresh.enabled; setText(retry, state.refresh.label);
  $('open-game').hidden = !!active;
  $('settings-panel').hidden = !state.settingsOpen;
  lobby.render(state);
  renderLobbyPreferences(state);
  ($('quality-select') as HTMLSelectElement).value = state.preferences.quality;
  ($('cn-entry-select') as HTMLSelectElement).value = state.preferences.cnEntry ?? 'qq';
  ($('flash-select') as HTMLSelectElement).value = state.preferences.flash;
  const flashChanged = state.preferences.flash !== state.flash.version.split('.')[0];
  setText($('flash-detail'), !state.flash.available ? msg('ui.component_not_ready') : flashChanged ? msg('ui.applies_on_next_launch') : '');
  $('flash-detail').hidden = state.flash.available && !flashChanged;
  if (state.settingsOpen && !settingsWasOpen) { void loadCredentials(); $('close-settings').focus(); }
  if (!state.settingsOpen && settingsWasOpen) { void flushLobbyBackground(); credentialLoad++; scrubSecrets(); $('credentials').replaceChildren(); if (!$('dialog-backdrop').hidden) void closeDialog(); }
  settingsWasOpen = state.settingsOpen;
  document.documentElement.classList.remove('interface-pending');
}
function selectSettingsPage(page: string | undefined) {
  if (page !== 'game' && page !== 'appearance' && page !== 'accounts' && page !== 'about') return;
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
  const sequence = ++credentialLoad; scrubSecrets();
  const loading = document.createElement('div'); loading.className = 'vault-empty'; setText(loading, msg('ui.reading')); $('credentials').replaceChildren(loading); $('reload-credentials').hidden = true;
  try {
    const items = await api.credentials(); if (sequence !== credentialLoad || !latest.settingsOpen) return;
    setText($('vault-count'), String(items.length)); $('credentials').replaceChildren();
    if (!items.length) { const empty = document.createElement('div'); empty.className = 'vault-empty'; setText(empty, msg('ui.no_accounts_yet')); $('credentials').append(empty); }
    for (const item of items) $('credentials').append(credentialRow(item));
  } catch (error) { if (sequence === credentialLoad && latest.settingsOpen) { $('reload-credentials').hidden = false; const failure = document.createElement('div'); failure.className = 'vault-empty error'; setText(failure, (error as Error).message); $('credentials').replaceChildren(failure); } }
}
function confirmCredentialUpdate(siteId: string, siteLabel: string, username: string, password: string, current: { id: string; version: string }) {
  setText($('dialog-title'), msg('ui.update_saved_password'));
  setText($('dialog-description'), msg('ui.already_has_a_record_on_confirm_to', { p0: username, p1: siteLabel }));
  $('dialog-description').hidden = false;
  $('credential-site-label').hidden = true; $('credential-site').hidden = true; $('credential-site').replaceChildren();
  $('name-label').hidden = true; $('edit-name').hidden = true; ($('edit-name') as HTMLInputElement).value = '';
  $('password-label').hidden = true; $('edit-password').hidden = true; ($('edit-password') as HTMLInputElement).value = '';
  $('server-note-label').hidden = true; $('edit-server-note').hidden = true;
  ($('edit-server-note') as HTMLInputElement).value = '';
  $('dialog-save').hidden = false; setText($('dialog-save'), msg('ui.confirm_update')); setText($('dialog-cancel'), msg('common.cancel'));
  setText($('dialog-error'), '');
  let expected = current;
  dialogAction = async () => {
    const result = await api.addCredential(siteId, username, password, expected);
    if (result.status === 'confirm-update') {
      expected = { id: result.id, version: result.version };
      setText($('dialog-description'), msg('ui.this_password_record_changed_while_you_were'));
      return false;
    }
    if (result.status === 'stale') {
      setText($('dialog-description'), msg('ui.the_original_record_was_deleted_cancel_and'));
      $('dialog-save').hidden = true;
      return false;
    }
    await loadCredentials();
    toast(result.status === 'unchanged' ? msg('ui.this_site_already_has_the_same_password') : msg('ui.password_updated'));
    return true;
  };
}
async function createCredential() {
  const sites = await api.credentialSites();
  if (!latest?.settingsOpen) return;
  if (!sites.length) throw new Error(msg('ui.no_login_sites_are_available_for_adding'));
  const siteSelect = $('credential-site') as HTMLSelectElement;
  await openDialog({ title: msg('ui.add_saved_password'), label: msg('ui.username'), password: '', submit: msg('common.save'),
    siteOptions: sites, siteId: sites[0].id,
    action: async (username, password) => {
      const siteId = siteSelect.value;
      const result = await api.addCredential(siteId, username, password);
      if (result.status === 'confirm-update') {
        confirmCredentialUpdate(siteId, sites.find(site => site.id === siteId)?.label ?? msg('ui.this_site'), username.trim(), password, result);
        return false;
      }
      if (result.status === 'stale') throw new Error(msg('ui.password_records_changed_reopen_the_form'));
      await loadCredentials();
      toast(result.status === 'unchanged' ? msg('ui.this_site_already_has_the_same_password') : msg('ui.saved_to_macos_keychain'));
      return true;
    } });
}
function credentialRow(item: CredentialInfo) {
  const row = document.createElement('div'); row.className = 'credential';
  const avatar = document.createElement('span'); avatar.className = 'credential-avatar'; setText(avatar, item.username[0]?.toLocaleUpperCase() || '·');
  const info = document.createElement('div'); info.className = 'credential-info';
  const name = document.createElement('div'); name.className = 'credential-name'; setText(name, item.username);
  const origin = document.createElement('div'); origin.className = 'credential-origin'; setText(origin, new URL(item.origin).hostname);
  info.append(name, origin);
  const actions = document.createElement('div'); actions.className = 'credential-actions';
  const button = (label: string, action: () => Promise<void>) => {
    const btn = document.createElement('button'); btn.className = 'quiet'; setText(btn, label);
    btn.addEventListener('click', () => { btn.disabled = true; void action().catch(error => toast(error.message)).finally(() => { btn.disabled = false; }); }); actions.append(btn); return btn;
  };
  const reveal = button(msg('ui.show'), async () => {
    const existing = info.querySelector('.credential-password'); if (existing) { existing.remove(); setText(reveal, msg('ui.show')); return; }
    const value = await api.reveal(item.id); if (!latest.settingsOpen || !row.isConnected) return;
    const secret = document.createElement('code'); secret.className = 'credential-password'; setText(secret, value); info.append(secret); setText(reveal, msg('ui.hide'));
    const timer = setTimeout(() => { secret.remove(); setText(reveal, msg('ui.show')); secretTimers.delete(timer); }, 20000); secretTimers.add(timer);
  });
  button(msg('ui.modify'), async () => {
    const password = await api.reveal(item.id); if (!latest.settingsOpen) return;
    await openDialog({ title: msg('ui.edit_saved_account'), label: msg('ui.account'), value: item.username, password,
      action: async (username, secret) => { await api.edit(item.id, username, secret, item.version); await loadCredentials(); } });
  });
  const remove = button(msg('ui.delete'), () => openDialog({ title: msg('ui.delete_this_saved_account'), label: item.username, hideInput: true, submit: msg('ui.delete'),
    action: async () => { await api.remove(item.id); await loadCredentials(); } })); remove.classList.add('danger');
  row.append(avatar, info, actions); return row;
}
async function openDialog(options: { title: string; label: string; value?: string; password?: string; hideInput?: boolean; serverNote?: string; serverNoteLabel?: string; submit?: string; description?: string; dangerSubmit?: boolean; siteOptions?: CredentialSiteOption[]; siteId?: string; action: (name: string, password: string, serverNote: string) => Promise<boolean | void> }) {
  const sequence = ++dialogSequence;
  lastFocus = document.activeElement as HTMLElement;
  await api.command({ type: 'overlay', shown: true });
  if (sequence !== dialogSequence) return;
  setText($('dialog-title'), options.title); setText($('name-label'), options.label);
  $('name-label').hidden = !!options.hideInput;
  setText($('dialog-description'), options.description ?? ''); $('dialog-description').hidden = !options.description;
  const siteSelect = $('credential-site') as HTMLSelectElement;
  const siteOptions = options.siteOptions ?? [];
  $('credential-site-label').hidden = !siteOptions.length; siteSelect.hidden = !siteOptions.length; siteSelect.replaceChildren();
  for (const site of siteOptions) { const option = document.createElement('option'); option.value = site.id; setText(option, site.label); siteSelect.append(option); }
  if (siteOptions.length) siteSelect.value = options.siteId ?? siteOptions[0].id;
  const input = $('edit-name') as HTMLInputElement; input.value = options.value ?? ''; input.hidden = !!options.hideInput; input.maxLength = options.password !== undefined ? 320 : 40;
  const secret = $('edit-password') as HTMLInputElement; secret.value = options.password ?? ''; secret.hidden = options.password === undefined;
  const serverNote = $('edit-server-note') as HTMLInputElement; serverNote.value = options.serverNote ?? ''; serverNote.hidden = options.serverNote === undefined; serverNote.maxLength = 40;
  setText($('server-note-label'), options.serverNoteLabel ?? msg('ui.usual_server_note')); $('server-note-label').hidden = serverNote.hidden;
  $('password-label').hidden = secret.hidden; $('dialog-save').hidden = false; setText($('dialog-cancel'), msg('common.cancel')); setText($('dialog-save'), options.submit ?? msg('common.save')); $('dialog-save').classList.toggle('danger', !!options.dangerSubmit); setText($('dialog-error'), '');
  $('dialog-backdrop').hidden = false; dialogAction = options.action;
  for (const id of ['edit-name', 'edit-password', 'edit-server-note', 'credential-site', 'dialog-save']) ($(id) as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = false;
  if (input.hidden) $('dialog-cancel').focus(); else { input.focus(); input.select(); }
}
async function closeDialog() {
  const sequence = ++dialogSequence;
  const restoreFocus = lastFocus;
  lastFocus = null;
  $('dialog-backdrop').hidden = true; ($('edit-name') as HTMLInputElement).value = ''; ($('edit-password') as HTMLInputElement).value = ''; ($('edit-server-note') as HTMLInputElement).value = ''; ($('credential-site') as HTMLSelectElement).replaceChildren(); $('credential-site-label').hidden = true; $('credential-site').hidden = true; setText($('dialog-description'), ''); $('dialog-description').hidden = true; $('name-label').hidden = false; $('dialog-save').hidden = false; setText($('dialog-cancel'), msg('common.cancel')); $('dialog-save').classList.remove('danger'); dialogAction = null;
  for (const id of ['edit-name', 'edit-password', 'edit-server-note', 'credential-site', 'dialog-save']) ($(id) as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = false;
  await command({ type: 'overlay', shown: false });
  if (sequence === dialogSequence && latest?.settingsOpen && restoreFocus?.isConnected && !restoreFocus.closest('[hidden]')) restoreFocus.focus();
}
async function rename(id: string, name: string) { await openDialog({ title: msg('ui.tab_note_75'), label: msg('ui.note_leave_blank_for_default'), value: name, action: value => api.command({ type: 'rename', id, name: value }) }); }
$('edit-form').addEventListener('submit', event => {
  event.preventDefault(); if (!dialogAction) return;
  const sequence = dialogSequence;
  const submit = $('dialog-save') as HTMLButtonElement; const action = dialogAction;
  for (const id of ['edit-name', 'edit-password', 'edit-server-note', 'credential-site', 'dialog-save']) ($(id) as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = true;
  void action(($('edit-name') as HTMLInputElement).value, ($('edit-password') as HTMLInputElement).value, ($('edit-server-note') as HTMLInputElement).value)
    .then(close => { if (sequence === dialogSequence && close !== false) return closeDialog(); })
    .catch(error => { if (sequence === dialogSequence) setText($('dialog-error'), error.message); })
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
$('settings-assists').addEventListener('click', () => {
  if (latest) void command({ type: 'assists', value: !latest.preferences.assistsEnabled });
});
$('settings-game-speed').addEventListener('click', () => {
  if (latest) void command({ type: 'game-speed', value: !latest.preferences.gameSpeed });
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-settings-page]')) {
  button.addEventListener('click', () => selectSettingsPage(button.dataset.settingsPage));
}
const aboutVersion = $('about-version');
if (aboutVersion) setText(aboutVersion, msg('ui.version_mit_license', { p0: __APP_VERSION__ }));
$('about-github').addEventListener('click', () => {
  void command({ type: 'open-github' }).catch(() => { window.open('https://github.com/qiuyuehu/NarutoOS', '_blank'); });
});
$('about-check-update').addEventListener('click', () => { void command({ type: 'check-update' }).catch(() => {}); });
selectSettingsPage(activeSettingsPage);

$('quality-select').addEventListener('change', event => void command({ type: 'quality', value: (event.target as HTMLSelectElement).value as 'low' | 'medium' | 'high' }));
$('cn-entry-select').addEventListener('change', event => void command({ type: 'cn-entry', value: (event.target as HTMLSelectElement).value as CnEntry }));

$('language-select').addEventListener('change', async event => {
  const select = event.target as HTMLSelectElement;
  select.disabled = true;
  try { await command({ type: 'language', value: select.value as Preferences['language'] }); }
  finally { select.value = latest.preferences.language || 'zh-CN'; select.disabled = false; fitSettingSelect(select); }
});
