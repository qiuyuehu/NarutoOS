import { msg } from '../shared/i18n';
import type { CredentialInfo, CredentialSiteOption, ShellAPI } from '../shared/model';
import { setText } from './i18n-dom';

export type DialogAction = (name: string, password: string, serverNote: string) => Promise<boolean | void>;

type CredentialDialog = {
  title: string;
  label: string;
  value?: string;
  password?: string;
  hideInput?: boolean;
  submit?: string;
  siteOptions?: CredentialSiteOption[];
  siteId?: string;
  action: DialogAction;
};
type Dependencies = {
  api: Pick<ShellAPI, 'credentials' | 'credentialSites' | 'addCredential' | 'reveal' | 'edit' | 'remove'>;
  isSettingsOpen: () => boolean;
  openDialog: (options: CredentialDialog) => Promise<void>;
  replaceDialogAction: (action: DialogAction) => void;
  toast: (message: string) => void;
};

const $ = (id: string) => document.getElementById(id)!;

export function createCredentialsView({ api, isSettingsOpen, openDialog, replaceDialogAction, toast }: Dependencies) {
  const secretTimers = new Set<ReturnType<typeof setTimeout>>();
  let credentialLoad = 0;

  function scrubSecrets() {
    for (const timer of secretTimers) clearTimeout(timer); secretTimers.clear();
    for (const element of Array.from(document.querySelectorAll('.credential-password'))) element.remove();
    $('edit-password').setAttribute('value', ''); ($('edit-password') as HTMLInputElement).value = '';
  }

  async function loadCredentials() {
    const sequence = ++credentialLoad; scrubSecrets();
    const loading = document.createElement('div'); loading.className = 'vault-empty'; setText(loading, msg('ui.reading')); $('credentials').replaceChildren(loading); $('reload-credentials').hidden = true;
    try {
      const items = await api.credentials(); if (sequence !== credentialLoad || !isSettingsOpen()) return;
      setText($('vault-count'), String(items.length)); $('credentials').replaceChildren();
      if (!items.length) { const empty = document.createElement('div'); empty.className = 'vault-empty'; setText(empty, msg('ui.no_accounts_yet')); $('credentials').append(empty); }
      for (const item of items) $('credentials').append(credentialRow(item));
    } catch (error) { if (sequence === credentialLoad && isSettingsOpen()) { $('reload-credentials').hidden = false; const failure = document.createElement('div'); failure.className = 'vault-empty error'; setText(failure, (error as Error).message); $('credentials').replaceChildren(failure); } }
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
    replaceDialogAction(async () => {
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
    });
  }
  async function createCredential() {
    const sites = await api.credentialSites();
    if (!isSettingsOpen()) return;
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
      const value = await api.reveal(item.id); if (!isSettingsOpen() || !row.isConnected) return;
      const secret = document.createElement('code'); secret.className = 'credential-password'; setText(secret, value); info.append(secret); setText(reveal, msg('ui.hide'));
      const timer = setTimeout(() => { secret.remove(); setText(reveal, msg('ui.show')); secretTimers.delete(timer); }, 20000); secretTimers.add(timer);
    });
    button(msg('ui.modify'), async () => {
      const password = await api.reveal(item.id); if (!isSettingsOpen()) return;
      await openDialog({ title: msg('ui.edit_saved_account'), label: msg('ui.account'), value: item.username, password,
        action: async (username, secret) => { await api.edit(item.id, username, secret, item.version); await loadCredentials(); } });
    });
    const remove = button(msg('ui.delete'), () => openDialog({ title: msg('ui.delete_this_saved_account'), label: item.username, hideInput: true, submit: msg('ui.delete'),
      action: async () => { await api.remove(item.id); await loadCredentials(); } })); remove.classList.add('danger');
    row.append(avatar, info, actions); return row;
  }

  function close() {
    credentialLoad++;
    scrubSecrets();
    $('credentials').replaceChildren();
  }

  function bind() {
    document.addEventListener('visibilitychange', () => { if (document.hidden) scrubSecrets(); });
    $('credential-create').addEventListener('click', () => void createCredential().catch(error => toast(error.message)));
    $('reload-credentials').addEventListener('click', () => void loadCredentials());
  }

  return { load: loadCredentials, close, bind };
}
