import { setText, setAttr } from './i18n-dom';
import { LobbyScene } from './lobby-scene';
import { msg } from '../shared/i18n';
import { AppState, Command, Preferences, Region, REGIONS } from '../shared/model';

export const LOBBY_PRESETS = [
  { name: msg('ui.paper_white'), color: '#fdfcfa' }, { name: msg('ui.rice_paper'), color: '#f3ede2' }, { name: msg('ui.mist_gray'), color: '#e8e8ea' },
  { name: msg('ui.cherry_pink'), color: '#f5e3df' }, { name: msg('ui.matcha'), color: '#e1e7d6' }, { name: msg('ui.sky_blue'), color: '#dde7ec' },
  { name: msg('ui.mustard'), color: '#e8bf55' }, { name: msg('ui.slate_blue'), color: '#6f8aa6' }, { name: msg('ui.ink_black'), color: '#161514' },
  { name: msg('ui.navy'), color: '#19202c' }, { name: msg('ui.pine_charcoal'), color: '#2b2d2a' }
] as const;

type CommandRunner = (input: Command) => Promise<void | boolean>;
type Profile = AppState['profiles'][number];
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const svgNS = 'http://www.w3.org/2000/svg';

function defaultBackground(theme: Preferences['theme']) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  return dark ? '#161514' : '#fdfcfa';
}
function avatarColors(name: string, dark: boolean) {
  let hue = 0;
  for (const character of name) hue = (hue * 31 + character.codePointAt(0)!) % 360;
  return dark ? [`hsl(${hue},28%,30%)`, `hsl(${hue},45%,88%)`] : [`hsl(${hue},32%,88%)`, `hsl(${hue},35%,28%)`];
}
function profileNotes(profile: Profile) {
  const notes: string[] = [];
  if (profile.identityNeedsConfirmation) notes.push(msg('ui.login_identity_needs_confirmation'));
  if (profile.serverNote) notes.push(msg('ui.usual_server', { p0: profile.serverNote }));
  return notes;
}

export class LobbyView {
  private state?: AppState;
  private visible = false;
  private deckOpen = false;
  private renderedRegion: Region | null = null;
  private renderedProfileId = '';
  private renderedProfileSignature = '';
  private renderedDeckSignature = '';
  private activeIndex = 0;
  private profileFrame = 0;
  private profileGeneration = 0;
  private requestedRegion: Region | null = null;
  private startPending = false;
  private launchError = '';
  private previewColor: string | null | undefined;
  private reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private root = $('lobby');
  private readonly scene = new LobbyScene(this.root);
  private deck = $('profile-deck');
  private current = $('lobby-current') as HTMLButtonElement;
  private regionButton = $('lobby-region') as HTMLButtonElement;
  private startButton = $('open-game') as HTMLButtonElement;

  constructor(private send: CommandRunner) {
    this.current.addEventListener('click', () => this.deckOpen ? this.closeDeck() : this.openDeck());
    this.regionButton.addEventListener('click', () => this.toggleRegion());
    this.startButton.addEventListener('click', () => void this.start());
    this.startButton.addEventListener('pointerenter', () => { if (this.root.dataset.motion !== 'off') this.root.classList.add('charge'); });
    this.startButton.addEventListener('pointerleave', () => this.root.classList.remove('charge'));
    this.startButton.addEventListener('pointermove', event => {
      const rect = this.startButton.getBoundingClientRect();
      this.startButton.style.setProperty('--mouse-x', `${event.clientX - rect.left}px`);
    });
    this.startButton.addEventListener('focus', () => {
      if (document.documentElement.dataset.inputModality === 'keyboard' && this.root.dataset.motion !== 'off') this.root.classList.add('charge');
    });
    this.startButton.addEventListener('blur', () => this.root.classList.remove('charge'));
    this.deck.addEventListener('keydown', event => this.onDeckKeydown(event));
    this.deck.addEventListener('click', event => {
      const option = (event.target as HTMLElement).closest<HTMLElement>('.lobby-option');
      const profile = option?.dataset.id ? this.state?.profiles.find(item => item.id === option.dataset.id) : undefined;
      if (profile && !profile.cleanupStatus) void this.chooseProfile(profile);
    });
    document.addEventListener('pointerdown', event => {
      if (this.deckOpen && !this.root.contains(event.target as Node)) this.closeDeck();
      else if (this.deckOpen && !(event.target as HTMLElement).closest('#profile-deck,#lobby-current')) this.closeDeck();
    });
    document.addEventListener('visibilitychange', () => { if (this.state) this.render(this.state); });
    this.reduceMotion.addEventListener('change', () => { if (this.state) this.applyMotion(this.state); });
  }

  render(state: AppState) {
    this.state = state;
    const shouldShow = !document.hidden && !state.activeId && !state.settingsOpen;
    if (!shouldShow) { this.hide(); this.renderedProfileSignature = ''; return; }
    const wasVisible = this.visible;
    this.visible = true;
    if (!wasVisible) this.root.classList.remove('leaving', 'charge');

    const region = state.preferences.region;
    if (this.requestedRegion === region) this.requestedRegion = null;
    if (this.renderedRegion !== region) {
      this.renderedRegion = region;
      this.closeDeck(false);
      setText($('lobby-region-label'), REGIONS[region].label);
      setAttr(this.regionButton, 'aria-label', msg('ui.current_region_click_to_switch', { p0: REGIONS[region].label }));
    }
    this.scene.show();
    this.applyBackground(this.previewColor !== undefined ? this.previewColor ?? defaultBackground(state.preferences.theme) : this.backgroundFor(state.preferences));
    this.applyMotion(state);
    this.renderProfiles(state);
    if (this.deckOpen) this.renderDeck(state);
  }

  refreshTheme() { if (this.state && this.visible) this.render(this.state); }

  backgroundFor(preferences: Pick<Preferences, 'theme' | 'lobbyBackground'>) {
    return preferences.lobbyBackground ?? defaultBackground(preferences.theme);
  }

  previewBackground(value: string | null) {
    this.previewColor = value;
    if (this.state && this.visible) this.applyBackground(value ?? defaultBackground(this.state.preferences.theme));
  }

  clearBackgroundPreview() {
    this.previewColor = undefined;
    if (this.state && this.visible) this.applyBackground(this.backgroundFor(this.state.preferences));
  }

  private hide() {
    if (!this.visible) return;
    this.visible = false;
    this.closeDeck(false);
    this.startPending = false;
    this.root.classList.remove('leaving', 'charge');
    if (this.profileFrame) cancelAnimationFrame(this.profileFrame);
    this.profileFrame = 0;
    this.scene.hide();
  }

  private applyMotion(state: AppState) {
    const enabled = state.preferences.lobbyMotion && !this.reduceMotion.matches;
    this.root.dataset.motion = enabled ? 'on' : 'off';
    if (!enabled) this.root.classList.remove('charge', 'leaving');
  }

  private applyBackground(hex: string) {
    if (this.scene.setBackground(hex) && this.state) this.paintCurrent(this.state, false);
  }

  private renderProfiles(state: AppState) {
    const regionProfiles = state.profiles.filter(profile => profile.region === state.preferences.region);
    const selectable = regionProfiles.filter(profile => !profile.cleanupStatus);
    const selected = selectable.find(profile => profile.id === state.selectedProfileId);
    const signature = JSON.stringify([state.profiles, state.profileDiscovery, state.profileError, state.canCreateProfile,
      state.preferences.region, state.selectedProfileId]);
    if (signature !== this.renderedProfileSignature) {
      const previousId = this.renderedProfileId;
      this.renderedProfileSignature = signature;
      this.renderedProfileId = selected?.id ?? '';
      this.paintCurrent(state, previousId !== '' && previousId !== this.renderedProfileId);
      if (this.deckOpen) this.renderedDeckSignature = '';
    }
    this.current.disabled = state.profileDiscovery !== 'ready' || !regionProfiles.length;
    this.current.setAttribute('aria-expanded', String(this.deckOpen));
    setAttr(this.current, 'aria-label', selected
      ? selected.serverNote ? msg('launch.selectedAccountWithServer',{name:selected.name,server:selected.serverNote}) : msg('launch.selectedAccount',{name:selected.name})
      : state.profileDiscovery === 'failed' ? msg('ui.failed_to_read_login_profiles') : !regionProfiles.length ? msg('ui.no_account_profiles') : msg('ui.account_profiles_are_being_cleaned_up'));
    this.startButton.disabled = state.profileDiscovery !== 'ready' || !selected || this.startPending;
    setAttr(this.startButton, 'aria-label', selected ? msg('launch.startAccount',{region:REGIONS[state.preferences.region].label,name:selected.name}) : msg('launch.startRegion',{region:REGIONS[state.preferences.region].label}));

    const status = $('profile-launch-status');
    setText(status, this.startPending ? msg('ui.starting_selected_accounts') : this.launchError || (state.profileDiscovery === 'loading' || state.profileDiscovery === 'idle' ? msg('ui.reading_local_login_profiles')
      : state.profileDiscovery === 'failed' ? state.profileError || msg('ui.read_failed_please_retry')
        : !regionProfiles.length ? msg('ui.no_login_profiles_in_the_current_region')
          : !selectable.length ? msg('ui.finish_pending_cleanup_or_create_a_new')
            : ''));
    status.hidden = !status.textContent;
    ($('lobby-create-profile') as HTMLButtonElement).hidden = !state.canCreateProfile || selectable.length > 0;
    ($('lobby-create-profile') as HTMLButtonElement).disabled = !state.canCreateProfile;
    ($('lobby-profile-retry') as HTMLButtonElement).hidden = state.profileDiscovery !== 'failed';
  }

  private paintCurrent(state: AppState, animate: boolean) {
    const selected = state.profiles.find(profile => profile.id === state.selectedProfileId && profile.region === state.preferences.region && !profile.cleanupStatus);
    const name = selected?.name ?? (state.profileDiscovery === 'failed' ? msg('ui.read_failed') : state.profileDiscovery === 'loading' || state.profileDiscovery === 'idle' ? msg('ui.reading_102') : msg('ui.no_account_profiles'));
    const dark = this.root.dataset.tone === 'dark';
    const [background, foreground] = avatarColors(name, dark);
    const avatar = $('lobby-avatar');
    setText(avatar, selected ? [...name][0] ?? '' : '·');
    avatar.style.setProperty('--avatar-bg', background);
    avatar.style.setProperty('--avatar-ink', foreground);
    setText($('lobby-account-name'), name);
    const note = selected ? profileNotes(selected).join(' · ') : '';
    setText($('profile-choice-note'), note);
    $('profile-choice-note').hidden = !note;
    setAttr($('lobby-current'), 'title', selected ? `${name}${note ? ` · ${note}` : ''}` : name);
    const stack = $('lobby-stack');
    stack.replaceChildren();
    for (let i = 0; i < Math.min(Math.max(0, state.profiles.filter(profile => profile.region === state.preferences.region).length - 1), 2); i++) {
      stack.append(document.createElement('i'));
    }
    if (animate && this.visible && this.root.dataset.motion !== 'off') {
      this.root.classList.add('account-changing');
      const generation = ++this.profileGeneration;
      if (this.profileFrame) cancelAnimationFrame(this.profileFrame);
      this.profileFrame = requestAnimationFrame(() => {
        this.profileFrame = 0;
        if (!this.visible || generation !== this.profileGeneration) return;
        this.profileFrame = requestAnimationFrame(() => {
          this.profileFrame = 0;
          if (generation === this.profileGeneration) this.root.classList.remove('account-changing');
        });
      });
    } else {
      this.profileGeneration++;
      if (this.profileFrame) cancelAnimationFrame(this.profileFrame);
      this.profileFrame = 0;
      this.root.classList.remove('account-changing');
    }
  }

  private renderDeck(state: AppState) {
    const profiles = state.profiles.filter(profile => profile.region === state.preferences.region);
    const signature = JSON.stringify([profiles, state.selectedProfileId]);
    if (signature === this.renderedDeckSignature) return;
    this.renderedDeckSignature = signature;
    this.deck.replaceChildren();
    if (!profiles.length) {
      const empty = document.createElement('div'); empty.className = 'lobby-empty';
      setText(empty, state.profileDiscovery === 'failed' ? state.profileError || msg('ui.read_failed_please_retry') : msg('ui.no_login_profiles_in_the_current_region'));
      this.deck.append(empty);
      this.deck.removeAttribute('aria-activedescendant');
      return;
    }
    const preferred = profiles.findIndex(profile => profile.id === state.selectedProfileId && !profile.cleanupStatus);
    this.activeIndex = preferred >= 0 ? preferred : profiles.findIndex(profile => !profile.cleanupStatus);
    if (this.activeIndex < 0) this.activeIndex = 0;
    profiles.forEach((profile, index) => {
      const option = document.createElement('div');
      option.className = 'lobby-option'; option.dataset.id = profile.id; option.id = `lobby-option-${profile.id}`;
      option.style.setProperty('--option-delay', `${(profiles.length - 1 - index) * 30}ms`);
      option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(profile.id === state.selectedProfileId));
      option.setAttribute('aria-disabled', String(!!profile.cleanupStatus)); setAttr(option, 'title', profile.name);
      if (profile.cleanupStatus) option.classList.add('is-disabled');
      const [background, foreground] = avatarColors(profile.name, this.root.dataset.tone === 'dark');
      const avatar = document.createElement('span'); avatar.className = 'lobby-avatar';
      setText(avatar, [...profile.name][0] ?? '');
      avatar.style.setProperty('--avatar-bg', background); avatar.style.setProperty('--avatar-ink', foreground);
      const name = document.createElement('b'); setText(name, profile.name);
      const detailText = profile.cleanupStatus ? msg('ui.cleanup_incomplete') : profileNotes(profile).join(' · ');
      const detail = document.createElement('small'); setText(detail, detailText);
      const grow = document.createElement('span'); grow.className = 'lobby-grow';
      const tick = document.createElementNS(svgNS, 'svg'); tick.setAttribute('class', 'lobby-tick'); tick.setAttribute('viewBox', '0 0 14 14');
      const path = document.createElementNS(svgNS, 'path'); path.setAttribute('d', 'M3 7.4 5.8 10 11 4.4'); tick.append(path);
      option.append(avatar, name);
      if (detailText) option.append(detail);
      option.append(grow, tick);
      if (index === this.activeIndex) option.classList.add('is-active');
      this.deck.append(option);
    });
    this.updateActiveOption();
  }

  private updateActiveOption() {
    const options = Array.from(this.deck.querySelectorAll<HTMLElement>('.lobby-option'));
    const active = options[this.activeIndex];
    for (let i = 0; i < options.length; i++) options[i].classList.toggle('is-active', i === this.activeIndex);
    if (active) {
      this.deck.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    } else this.deck.removeAttribute('aria-activedescendant');
  }

  private openDeck() {
    if (!this.state || this.current.disabled || !this.visible) return;
    this.deckOpen = true;
    this.renderedDeckSignature = '';
    this.renderDeck(this.state);
    this.deck.hidden = false;
    this.current.setAttribute('aria-expanded', 'true');
    this.deck.focus();
  }

  private closeDeck(restoreFocus = false) {
    if (!this.deckOpen && this.deck.hidden) return;
    this.deckOpen = false;
    this.deck.hidden = true;
    this.current.setAttribute('aria-expanded', 'false');
    this.deck.removeAttribute('aria-activedescendant');
    if (restoreFocus && this.visible && !this.current.hidden && !this.current.disabled) this.current.focus();
  }

  private onDeckKeydown(event: KeyboardEvent) {
    if (!this.deckOpen || !this.state) return;
    const options = Array.from(this.deck.querySelectorAll<HTMLElement>('.lobby-option'));
    const enabled = options.map((option, index) => option.getAttribute('aria-disabled') === 'true' ? -1 : index).filter(index => index >= 0);
    if (event.key === 'Escape') { event.preventDefault(); this.closeDeck(true); return; }
    if (event.key === 'Tab') { this.closeDeck(); return; }
    if (!enabled.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (event.key === 'Home') this.activeIndex = enabled[0];
      else if (event.key === 'End') this.activeIndex = enabled[enabled.length - 1];
      else {
        const at = enabled.indexOf(this.activeIndex), step = event.key === 'ArrowDown' ? 1 : -1;
        this.activeIndex = enabled[(at + step + enabled.length) % enabled.length];
      }
      this.updateActiveOption(); return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const id = options[this.activeIndex]?.dataset.id;
      const profile = id ? this.state.profiles.find(item => item.id === id) : undefined;
      if (profile && !profile.cleanupStatus) void this.chooseProfile(profile);
    }
  }

  private async chooseProfile(profile: Profile) {
    this.closeDeck(true);
    await this.send({ type: 'profile-select', id: profile.id });
  }

  private toggleRegion() {
    if (!this.state || !this.visible) return;
    const current = this.requestedRegion ?? this.state.preferences.region;
    const region: Region = current === 'br' ? 'cn' : 'br';
    this.requestedRegion = region;
    this.closeDeck();
    void this.send({ type: 'region', value: region }).then(() => {
      if (this.requestedRegion === region && this.state?.preferences.region === region) this.requestedRegion = null;
    }).catch(() => { if (this.requestedRegion === region) this.requestedRegion = null; });
  }

  private async start() {
    if (this.startPending || !this.state || this.startButton.disabled) return;
    this.startPending = true;
    this.launchError = '';
    this.startButton.disabled = true;
    if (this.state) this.render(this.state);
    try {
      const accepted = await this.send({ type: 'profile-start' });
      if (accepted !== true) {
        this.launchError = msg('ui.launch_request_had_no_effect_click_again');
        this.resetLaunch();
        if (this.state) this.render(this.state);
      }
    } catch (error) {
      this.launchError = error instanceof Error ? error.message : msg('ui.launch_request_incomplete_please_retry');
      this.resetLaunch();
      if (this.state) this.render(this.state);
    }
  }

  private resetLaunch() {
    this.startPending = false;
    this.root.classList.remove('leaving', 'charge');
    if (this.state) this.startButton.disabled = this.state.profileDiscovery !== 'ready' ||
      !this.state.profiles.some(profile => profile.id === this.state?.selectedProfileId && profile.region === this.state?.preferences.region && !profile.cleanupStatus);
  }
}
