import { msg } from '../shared/i18n';
import { REGIONS, type AppState, type ShellAPI } from '../shared/model';
import { setAttr, setText } from './i18n-dom';
import type { DialogAction } from './credentials-view';

type Profile = AppState['profiles'][number];
type ProfileDialogOptions = {
  title: string;
  label: string;
  value?: string;
  hideInput?: boolean;
  serverNote?: string;
  serverNoteLabel?: string;
  submit: string;
  description?: string;
  dangerSubmit?: boolean;
  action: DialogAction;
};
type Dependencies = {
  api: Pick<ShellAPI, 'command'>;
  command: ShellAPI['command'];
  openDialog: (options: ProfileDialogOptions) => Promise<void>;
};

const $ = (id: string) => document.getElementById(id)!;

export function createProfilesView({ api, command, openDialog }: Dependencies) {
  let profileListSignature = '';
  let profilePickerSignature = '';
  let profilePickerWasOpen = false;

  function editProfile(profile?: Profile) {
    const create = !profile;
    void openDialog({ title: create ? msg('ui.new_login_profile') : msg('ui.edit_login_profile'), label: msg('ui.profile_name'), value: profile?.name ?? '',
      serverNote: profile?.serverNote ?? '', serverNoteLabel: msg('ui.usual_server_note_reminder_only'), submit: create ? msg('ui.create') : msg('common.save'),
      action: async (name, _password, serverNote) => {
        if (create) await api.command({ type: 'profile-create', name, serverNote });
        else await api.command({ type: 'profile-update', id: profile!.id, name, serverNote });
      } });
  }
  function confirmDeleteProfile(profile: Profile) {
    void openDialog({ title: msg('ui.delete_login_profile'), label: '', hideInput: true,
      description: msg('ui.delete_local_cookies_website_data_and_login', { p0: REGIONS[profile.region].label, p1: profile.name }),
      submit: msg('ui.delete_profile'), dangerSubmit: true,
      action: async () => api.command({ type: 'profile-delete', id: profile.id }) });
  }
  function profileNotes(profile: Profile) {
    const notes: string[] = [];
    if (profile.identityNeedsConfirmation) notes.push(msg('ui.login_identity_needs_confirmation'));
    if (profile.serverNote) notes.push(msg('ui.usual_server', { p0: profile.serverNote }));
    return notes;
  }
  function renderProfileList(state: AppState) {
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
  }

  function renderProfilePicker(state: AppState) {
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
        const regionProfiles = state.profiles.filter(profile => profile.region === state.preferences.region);
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

  function renderProfileControls(state: AppState) {
    renderProfileList(state);
    renderProfilePicker(state);
  }

  function handlePickerKeydown(event: KeyboardEvent) {
    if ($('profile-picker-backdrop').hidden) return false;
    if (event.key === 'Escape') { event.preventDefault(); void command({ type: 'profiles-close-picker' }); }
    if (event.key === 'Tab') {
      const focusable = Array.from($('profile-picker-backdrop').querySelectorAll<HTMLElement>('button:not(:disabled):not([hidden])'));
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    return true;
  }

  function bind() {
    $('profile-create').addEventListener('click', () => editProfile());
    $('lobby-create-profile').addEventListener('click', () => editProfile());
    $('lobby-profile-retry').addEventListener('click', () => void command({ type: 'profiles-retry' }));
    $('profile-picker-create').addEventListener('click', () => editProfile());
    $('profile-picker-cancel').addEventListener('click', () => void command({ type: 'profiles-close-picker' }));
    $('profile-picker-retry').addEventListener('click', () => void command({ type: 'profiles-retry' }));
    $('profile-retry').addEventListener('click', () => void command({ type: 'profiles-retry' }));
  }

  return { renderProfileControls, handlePickerKeydown, bind };
}
