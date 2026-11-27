import { msg } from '../../shared/i18n';
import type { Preferences, TabInfo } from '../../shared/model';
import type { Navigation } from '../../main/navigation';
import type { WebLogin } from '../../main/web-login';
import type { ExitState } from './exit-guard';
import type { Task } from './task-queue';

type LoginOperation = WebLogin['operation'];
type ToolbarTab = Pick<TabInfo, 'id' | 'profileId' | 'region' | 'state' | 'recoveryStage'>;
type LoginSelection = Pick<Navigation, 'isLoginForeground'>;
type ToolbarRow = Task & { id: string; active: boolean; suffix: string };

type RefreshInput = {
  stopping: boolean;
  active: ToolbarTab | undefined;
  operation: LoginOperation;
  navigation: LoginSelection;
  isRecoveryQueued: (id: string) => boolean;
  fixture: boolean;
};

export function toolbarRefreshState({ stopping, active, operation, navigation, isRecoveryQueued, fixture }: RefreshInput) {
  if (stopping) return { enabled: false, label: msg('ui.refresh_current_page') };
  if (operation?.stage === 'login' && navigation.isLoginForeground(operation.tabId, operation)) {
    return { enabled: true, label: msg('ui.refresh_login_server_selection_page') };
  }
  if (!active) return { enabled: false, label: msg('ui.refresh_current_page') };
  if (active.recoveryStage || operation?.originalId === active.id || isRecoveryQueued(active.id)) {
    return { enabled: false, label: msg('ui.re_entering') };
  }
  return { enabled: true, label: msg(active.region === 'br' && !fixture ? 'ui.re_enter_game' : 'ui.refresh_current_page') };
}

type TabsInput = {
  tasks: Iterable<Task>;
  tabs: readonly ToolbarTab[];
  activeId: string | null;
  operationForTab: (tabId: string | undefined) => LoginOperation;
  navigation: LoginSelection;
};

export function toolbarTabs({ tasks, tabs, activeId, operationForTab, navigation }: TabsInput) {
  const rows: ToolbarRow[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    if (['closed', 'cancelled'].includes(task.status) || seen.has(task.profileId)) continue;
    seen.add(task.profileId);
    const operation = operationForTab(task.tabId);
    const pages = tabs.filter(tab => tab.profileId === task.profileId);
    for (const tab of pages) {
      rows.push({
        ...task, id: tab.id, tabId: tab.id,
        status: ['failed', 'crashed'].includes(tab.state) ? 'failed' : tab.state === 'ready' ? 'ready' : 'loading',
        active: activeId === tab.id,
        suffix: operation?.originalId === tab.id ? msg('ui.original_game') : operation?.candidateId === tab.id ? msg('ui.new_game') : '',
      });
    }
    if (operation?.profileId === task.profileId && !pages.some(tab => tab.id === operation.tabId)) {
      rows.push({ ...task, id: operation.tabId, status: 'login-required',
        active: navigation.isLoginForeground(operation.tabId, operation), suffix: operation.recovering ? msg('ui.re_entering_150') : '' });
    } else if (!pages.length) {
      rows.push({ ...task, id: task.operationId, active: false, suffix: '' });
    }
  }
  return rows;
}

type ToolbarStateInput = {
  notice: string;
  noticeKind: 'info' | 'error';
  shutdown: { stopping: boolean; state: ExitState };
  muted: boolean;
  speed: { available: boolean; rate: number; allowRaise: boolean };
  preferences: Pick<Preferences, 'language' | 'theme' | 'titleBarColor'>;
  loginActive: boolean;
  visibleSave: { username: string; update: boolean; saveFailed?: boolean } | undefined;
  tabs: ToolbarRow[];
  active: ToolbarTab | undefined;
  activeId: string | null;
  loginVisible: boolean;
  operation: LoginOperation;
  refresh: ReturnType<typeof toolbarRefreshState>;
  tasks: Iterable<Task>;
};

export function buildToolbarState({
  notice, noticeKind, shutdown, muted, speed, preferences, loginActive, visibleSave,
  tabs, active, activeId, loginVisible, operation, refresh, tasks,
}: ToolbarStateInput) {
  return {
    notice, noticeKind, stopping: shutdown.stopping, exitState: shutdown.state, muted, speed,
    preferences: { language: preferences.language, theme: preferences.theme, titleBarColor: preferences.titleBarColor },
    loginActive,
    savePrompt: visibleSave ? { username: visibleSave.username, update: visibleSave.update, failed: !!visibleSave.saveFailed } : null,
    tabs,
    failedPage: active && ['failed', 'crashed'].includes(active.state) && !loginVisible ? { id: active.id, state: active.state, region: active.region } : null,
    refresh,
    recovery: operation?.stage === 'confirming' && activeId === operation.candidateId ? { candidateId: operation.candidateId } : null,
    tasks: Array.from(tasks).filter(task => !['cancelled', 'closed'].includes(task.status))
      .map(task => ({ ...task, active: loginVisible ? operation?.profileId === task.profileId : activeId === task.tabId })),
  };
}
