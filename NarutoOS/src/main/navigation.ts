export type NavigationOperation = {
  tabId: string;
  stage: string;
  recovering: boolean;
  originalId?: string;
  candidateId?: string;
};

export interface LoginNavigation {
  readonly selectionVersion: number;
  isLoginForeground(id: string, operation?: NavigationOperation): boolean;
  selectLogin(id: string): void;
  selectGameForTask(id: string | null): void;
  handoffGame(taskId: string, gameId: string): boolean;
  completeRecovery(originalId: string, candidateId: string): boolean;
  prepareCandidateClose(candidateId: string, originalId?: string): void;
  restoreOriginal(id: string, version: number, wasForeground: boolean): boolean;
}

export interface NavigationGameSessions {
  activeId: string | null;
  hidden: boolean;
  tabs: Array<{ id: string }>;
  select(id: string | null): void;
}

export type NavigationTarget = { kind: 'home' } | { kind: 'login'; id: string } | { kind: 'game'; id: string };
export interface NavigationSnapshot { version: number; target: NavigationTarget; obscured: boolean }

export class Navigation {
  private foregroundLoginId: string | null = null;
  private version = 0;
  private obscured = false;

  constructor(private readonly games: NavigationGameSessions) {}

  get selectionVersion() { return this.version; }
  get isObscured() { return this.obscured; }

  snapshot(operationTabId?: string | null): NavigationSnapshot {
    const target: NavigationTarget = this.games.activeId
      ? { kind: 'game', id: this.games.activeId }
      : this.foregroundLoginId && this.foregroundLoginId === operationTabId
        ? { kind: 'login', id: this.foregroundLoginId }
        : { kind: 'home' };
    return { version: this.version, target, obscured: this.obscured };
  }

  isLoginForeground(id: string, operation?: NavigationOperation) {
    if (!operation || operation.tabId !== id || this.obscured) return false;
    if (operation.candidateId && this.games.activeId === operation.candidateId) return true;
    if (operation.recovering && operation.originalId === this.games.activeId && this.foregroundLoginId === id) return true;
    return this.games.activeId === null && this.foregroundLoginId === id;
  }

  syncOverlay(settingsOpen: boolean, modalOpen: boolean) {
    const obscured = settingsOpen || modalOpen;
    if (obscured !== this.obscured) this.version++;
    this.obscured = obscured;
    this.games.hidden = obscured;
  }

  syncOperation(operationTabId?: string | null) {
    if (this.foregroundLoginId && this.foregroundLoginId !== operationTabId) this.foregroundLoginId = null;
  }

  selectHome() {
    this.version++; this.foregroundLoginId = null; this.obscured = false; this.games.hidden = false; this.games.select(null);
  }

  selectGame(id: string) {
    this.version++; this.foregroundLoginId = null; this.obscured = false; this.games.hidden = false; this.games.select(id);
  }

  selectLogin(id: string) {
    this.version++; this.obscured = false; this.games.hidden = false; this.games.select(null); this.foregroundLoginId = id;
  }

  clearLoginTask(id: string) {
    if (this.foregroundLoginId === id) this.foregroundLoginId = null;
  }

  selectGameForTask(id: string | null) {
    this.foregroundLoginId = null;
    this.games.select(id);
  }

  handoffGame(taskId: string, gameId: string) {
    if (this.obscured || this.foregroundLoginId !== taskId || this.games.activeId !== null) return false;
    this.selectGameForTask(gameId);
    return true;
  }

  closeGame(id: string) {
    if (this.games.activeId !== id) return;
    this.version++; this.foregroundLoginId = null;
  }

  completeRecovery(originalId: string, candidateId: string) {
    if (this.games.activeId !== originalId) return false;
    this.selectGame(candidateId);
    return true;
  }

  prepareCandidateClose(candidateId: string, originalId?: string) {
    if (this.games.activeId !== candidateId) return;
    const fallback = originalId && this.games.tabs.some(tab => tab.id === originalId)
      ? originalId
      : this.games.tabs.find(tab => tab.id !== candidateId)?.id ?? null;
    this.selectGameForTask(fallback);
  }

  restoreOriginal(id: string, version: number, wasForeground: boolean) {
    if (!wasForeground || version !== this.version || !this.games.tabs.some(tab => tab.id === id)) return false;
    if (this.games.activeId !== id) this.selectGameForTask(id);
    else this.foregroundLoginId = null;
    return true;
  }
}
