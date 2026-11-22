import { setText, setAttr, applyLanguage } from '../../renderer/i18n-dom';
import { msg, setLanguage } from '../../shared/i18n';
import { svg } from '../../renderer/icons';
import { installFocusModality } from '../../renderer/focus';
import { titlePalette } from '../../shared/appearance';
installFocusModality();
const api = (window as any).prototypeHost;
const $ = (id: string) => document.getElementById(id)!;
const bar = document.querySelector<HTMLElement>('.chrome')!;
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
let latest: any;
function appearance() {
  const prefs = latest?.preferences || {};
  document.documentElement.dataset.dark = String(prefs.theme === 'dark' || (prefs.theme !== 'light' && systemTheme.matches));
  const palette = prefs.titleBarColor ? titlePalette(prefs.titleBarColor) : null;
  for (const key of ['bg', 'fg', 'secondary', 'hover', 'selected', 'border']) {
    if (palette) bar.style.setProperty('--bar-' + key, palette[key as keyof typeof palette]);
    else bar.style.removeProperty('--bar-' + key);
  }
}
systemTheme.addEventListener('change', appearance);
$('refresh').innerHTML = svg('refresh');
$('settings').innerHTML = svg('settings');
$('new-tab').innerHTML = svg('plus');
$('new-tab').onclick = () => api.command('center');
$('notice').onclick=()=>api.command('notice-details');
$('speed').onclick = () => api.command('speed');
$('placeholder-recover').onclick=()=>api.command('refresh');
api.onFullscreen?.((value: boolean) => {document.documentElement.classList.toggle('fullscreen', value);const exit=document.getElementById('exit-fullscreen') as HTMLButtonElement|null;if(exit)exit.hidden=!value;});
(document.getElementById('exit-fullscreen') as HTMLButtonElement).onclick=()=>api.command('fullscreen-exit');
for (const type of ['center','settings','refresh','mute','save','dismiss','retry-exit']) $(type).onclick = () => api.command(type);
for(const type of ['complete','cancel-recovery']) $(type).onclick=()=>{if(latest?.recovery)void api.command(type,latest.recovery.candidateId);};
api.onState((state: any) => {
  latest = state; setLanguage(state.preferences?.language); applyLanguage(); appearance();
  const noticeText = state.recovery ? msg('ui.once_the_new_game_works_correctly_complete') : state.notice || '';
  setText($('notice'), noticeText);
  setAttr($('notice'), 'title', noticeText);
  setAttr($('notice'), 'aria-label', noticeText || msg('ui.view_notice_details'));
  $('notice').classList.toggle('is-error',state.noticeKind==='error');
  ($('notice') as HTMLButtonElement).disabled=!state.notice||!!state.recovery;
  const failed=state.failedPage;
  $('placeholder').hidden=!failed;
  setText($('placeholder-title'), failed?.state==='crashed'?msg('ui.game_display_stopped'):msg('ui.game_page_failed_to_load'));
  setText($('placeholder-detail'), failed?.region==='br'?msg('ui.re_enter_the_game_to_get_a'):msg('ui.refresh_the_page_and_try_again'));
  ($('placeholder-recover') as HTMLButtonElement).disabled=!state.refresh.enabled;
  setText($('placeholder-recover'), state.refresh.label);
  $('cancel-recovery').hidden = !state.recovery;
  setText($('cancel-recovery'), msg('ui.cancel_recovery'));
  $('complete').hidden = !state.recovery;
  $('retry-exit').hidden = state.exitState!=='save-failed';
  setText($('save'), state.savePrompt?.failed?msg('ui.retry_save'):msg('common.save'));
  $('save-prompt').hidden = !state.savePrompt;
  bar.classList.toggle('has-save', !!state.savePrompt);
  setAttr($('save-text'), 'title', state.savePrompt ? msg(state.savePrompt.update ? 'password.updatePrompt' : 'password.savePrompt', { username: state.savePrompt.username }) : '');
  setText($('save-text'), state.savePrompt ? msg(state.savePrompt.update ? 'password.updatePrompt' : 'password.savePrompt', { username: state.savePrompt.username }) : '');
  $('mute').innerHTML = svg(state.muted ? 'muted' : 'volume');
  $('mute').setAttribute('aria-pressed', String(!!state.muted));
  const speed = $('speed') as HTMLButtonElement;
  speed.hidden = !state.speed?.available;
  if (state.speed?.available) {
    setText(speed, `${state.speed.rate}×`);
    setAttr(speed, 'aria-label', msg('ui.speed_rate_toggle', { p0: String(state.speed.rate) }));
  }
  ($('refresh') as HTMLButtonElement).disabled = !state.refresh.enabled;
  setAttr($('refresh'), 'aria-label', state.refresh.label);
  const tabs = $('tabs');
  // Keep nodes stable during the host's periodic state updates so keyboard focus survives.
  const visibleTasks: any[] = state.tabs;
  const ids = new Set(visibleTasks.map((task: any) => task.id));
  for (const row of Array.from(tabs.children)) if (!ids.has((row as HTMLElement).dataset.tabId)) row.remove();
  const labels: Record<string,string> = {queued:msg('ui.queued'),'login-required':msg('ui.waiting_for_login_server_selection'),loading:msg('ui.loading_131'),ready:msg('ui.in_game'),failed:msg('ui.incomplete')};
  for (const task of visibleTasks) {
    let row = Array.from(tabs.children).find(el => (el as HTMLElement).dataset.tabId === task.id) as HTMLElement | undefined;
    if (!row) {
      row = document.createElement('div'); row.className = 'tab'; row.dataset.profileId = task.profileId; row.dataset.tabId=task.id;
      const select = document.createElement('button'); select.className = 'tab-select';
      const spinner = document.createElement('span'); spinner.className = 'tab-icon'; spinner.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span'); name.className = 'tab-name'; select.append(spinner, name);

      const retry = document.createElement('button'); retry.className = 'icon-button tab-retry'; setText(retry, '↻'); setAttr(retry, 'aria-label', msg('ui.retry'));
      const close = document.createElement('button'); close.className = 'tab-close'; close.innerHTML = svg('close');
      row.append(select, retry, close); tabs.append(row);
    }
    row.querySelector<HTMLButtonElement>('.tab-select')!.onclick = () => api.command('focus', task.id);
    row.querySelector<HTMLButtonElement>('.tab-retry')!.onclick = () => api.command('retry', task.id);
    row.querySelector<HTMLButtonElement>('.tab-close')!.onclick = () => api.command('cancel', task.id);
    const label = `${task.profile.name} · ${labels[task.status] || task.status}`;
    setAttr(row, 'title', label);
    row.setAttribute('aria-selected', String(!!task.active));
    setText(row.querySelector('.tab-name')!, `${task.profile.region === 'cn' ? msg('region.cn') : msg('region.br')} · ${task.profile.name}${task.suffix?' · '+task.suffix:''}`);
    setAttr(row.querySelector('.tab-select')!, 'aria-label', label);
    row.querySelector('.tab-select')!.setAttribute('aria-current', task.active ? 'page' : 'false');
    (row.querySelector('.tab-icon') as HTMLElement).hidden = !['queued','login-required','loading'].includes(task.status);
    (row.querySelector('.tab-retry') as HTMLElement).hidden = task.status !== 'failed';
    setAttr(row.querySelector('.tab-close')!, 'aria-label', msg('ui.close_cancel', { p0: task.profile.name }));
  }
  for(const button of document.querySelectorAll<HTMLButtonElement>('button'))if(state.stopping)button.disabled=button.id!=='retry-exit';else if(!['refresh','placeholder-recover','notice'].includes(button.id))button.disabled=false;
  document.documentElement.classList.remove('interface-pending');
});
