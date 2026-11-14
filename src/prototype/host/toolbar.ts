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
$('placeholder-recover').onclick=()=>api.command('refresh');
api.onFullscreen?.((value: boolean) => document.documentElement.classList.toggle('fullscreen', value));
for (const type of ['center','settings','refresh','mute','save','dismiss','retry-exit']) $(type).onclick = () => api.command(type);
for(const type of ['complete','cancel-recovery']) $(type).onclick=()=>{if(latest?.recovery)void api.command(type,latest.recovery.candidateId);};
api.onState((state: any) => {
  latest = state; appearance();
  $('notice').textContent = state.recovery ? '确认新游戏可以正常操作后，完成切换。' : state.notice || '';
  $('notice').classList.toggle('is-error',state.noticeKind==='error');
  ($('notice') as HTMLButtonElement).disabled=!state.notice||!!state.recovery;
  const failed=state.failedPage;
  $('placeholder').hidden=!failed;
  $('placeholder-title').textContent=failed?.state==='crashed'?'游戏画面已停止':'游戏页面加载失败';
  $('placeholder-detail').textContent=failed?.region==='br'?'可以重新进入游戏获取新的登录入口。':'请刷新页面重试。';
  ($('placeholder-recover') as HTMLButtonElement).disabled=!state.refresh.enabled;
  $('placeholder-recover').textContent=state.refresh.label;
  $('cancel-recovery').hidden = !state.recovery;
  $('cancel-recovery').textContent = '取消恢复';
  $('complete').hidden = !state.recovery;
  $('retry-exit').hidden = state.exitState!=='save-failed';
  $('save').textContent=state.savePrompt?.failed?'重试保存':'保存';
  $('save-prompt').hidden = !state.savePrompt;
  bar.classList.toggle('has-save', !!state.savePrompt);
  $('save-text').textContent = state.savePrompt ? `${state.savePrompt.update ? '更新' : '保存'} ${state.savePrompt.username} 的密码？` : '';
  $('mute').innerHTML = svg(state.muted ? 'muted' : 'volume');
  $('mute').setAttribute('aria-pressed', String(!!state.muted));
  ($('refresh') as HTMLButtonElement).disabled = !state.refresh.enabled;
  $('refresh').setAttribute('aria-label',state.refresh.label);
  const tabs = $('tabs');
  // Keep nodes stable during the host's periodic state updates so keyboard focus survives.
  const visibleTasks: any[] = state.tabs;
  const ids = new Set(visibleTasks.map((task: any) => task.id));
  for (const row of Array.from(tabs.children)) if (!ids.has((row as HTMLElement).dataset.tabId)) row.remove();
  const labels: Record<string,string> = {queued:'等待启动','login-required':'等待登录／选服',loading:'加载中',ready:'游戏中',failed:'未完成'};
  for (const task of visibleTasks) {
    let row = Array.from(tabs.children).find(el => (el as HTMLElement).dataset.tabId === task.id) as HTMLElement | undefined;
    if (!row) {
      row = document.createElement('div'); row.className = 'tab'; row.dataset.profileId = task.profileId; row.dataset.tabId=task.id;
      const select = document.createElement('button'); select.className = 'tab-select';
      const spinner = document.createElement('span'); spinner.className = 'tab-icon'; spinner.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span'); name.className = 'tab-name'; select.append(spinner, name);

      const retry = document.createElement('button'); retry.className = 'icon-button tab-retry'; retry.textContent = '↻'; retry.setAttribute('aria-label', '重试');
      const close = document.createElement('button'); close.className = 'tab-close'; close.innerHTML = svg('close');
      row.append(select, retry, close); tabs.append(row);
    }
    row.querySelector<HTMLButtonElement>('.tab-select')!.onclick = () => api.command('focus', task.id);
    row.querySelector<HTMLButtonElement>('.tab-retry')!.onclick = () => api.command('retry', task.id);
    row.querySelector<HTMLButtonElement>('.tab-close')!.onclick = () => api.command('cancel', task.id);
    const label = `${task.profile.name} · ${labels[task.status] || task.status}`;
    row.setAttribute('aria-selected', String(!!task.active));
    row.querySelector('.tab-name')!.textContent = `${task.profile.region === 'cn' ? '国服' : '巴西服'} · ${task.profile.name}${task.suffix?' · '+task.suffix:''}`;
    row.querySelector('.tab-select')!.setAttribute('aria-label', label);
    row.querySelector('.tab-select')!.setAttribute('aria-current', task.active ? 'page' : 'false');
    (row.querySelector('.tab-icon') as HTMLElement).hidden = !['queued','login-required','loading'].includes(task.status);
    (row.querySelector('.tab-retry') as HTMLElement).hidden = task.status !== 'failed';
    row.querySelector('.tab-close')!.setAttribute('aria-label', `关闭／取消 ${task.profile.name}`);
  }
  for(const button of document.querySelectorAll<HTMLButtonElement>('button'))if(state.stopping)button.disabled=button.id!=='retry-exit';else if(!['refresh','placeholder-recover','notice'].includes(button.id))button.disabled=false;
});
