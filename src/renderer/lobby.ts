import { AppState, Command, Region, REGIONS } from '../shared/model';

export const LOBBY_PRESETS = [
  { name: '纸白', color: '#fdfcfa' }, { name: '宣纸', color: '#f3ede2' }, { name: '雾灰', color: '#e8e8ea' },
  { name: '樱粉', color: '#f5e3df' }, { name: '抹茶', color: '#e1e7d6' }, { name: '天青', color: '#dde7ec' },
  { name: '芥黄', color: '#e8bf55' }, { name: '灰蓝', color: '#6f8aa6' }, { name: '夜墨', color: '#161514' },
  { name: '藏青', color: '#19202c' }, { name: '松烟', color: '#2b2d2a' }
] as const;

type CommandRunner = (input: Command) => Promise<void | boolean>;
type Profile = AppState['profiles'][number];
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const svgNS = 'http://www.w3.org/2000/svg';

function darkTheme(state: AppState) {
  return state.preferences.theme === 'dark' || (state.preferences.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}
function defaultBackground(state: AppState) { return darkTheme(state) ? '#161514' : '#fdfcfa'; }
function hexToHsl(hex: string) {
  const value = parseInt(hex.slice(1), 16), r = ((value >> 16) & 255) / 255, g = ((value >> 8) & 255) / 255, b = (value & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const h = d ? ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360 : 0;
  const linear = (channel: number) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  return { h, s: s * 100, l: l * 100, y: .2126 * linear(r) + .7152 * linear(g) + .0722 * linear(b) };
}
function avatarColors(name: string, dark: boolean) {
  let hue = 0;
  for (const character of name) hue = (hue * 31 + character.codePointAt(0)!) % 360;
  return dark ? [`hsl(${hue},28%,30%)`, `hsl(${hue},45%,88%)`] : [`hsl(${hue},32%,88%)`, `hsl(${hue},35%,28%)`];
}
function profileNotes(profile: Profile) {
  const notes: string[] = [];
  if (profile.identityNeedsConfirmation) notes.push('登录身份待自行确认');
  if (profile.serverNote) notes.push(`常用区服：${profile.serverNote}`);
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
  private renderedBackground = '';
  private activeIndex = 0;
  private artGeneration = 0;
  private artFrame = 0;
  private profileFrame = 0;
  private profileGeneration = 0;
  private resizeFrame = 0;
  private requestedRegion: Region | null = null;
  private startPending = false;
  private launchError = '';
  private previewColor: string | null | undefined;
  private ink = { color: '#302a24', alpha: .28 };
  private reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private root = $('lobby');
  private art = $('lobby-character') as HTMLImageElement;
  private deck = $('profile-deck');
  private current = $('lobby-current') as HTMLButtonElement;
  private regionButton = $('lobby-region') as HTMLButtonElement;
  private startButton = $('open-game') as HTMLButtonElement;
  private dots = $('lobby-dots') as HTMLCanvasElement;
  private lines = $('lobby-lines') as HTMLCanvasElement;
  private focusPoint = { x: .68, y: .24 };
  private lineSeed = 7;
  private artImage: HTMLImageElement | null = null;
  private pendingArtwork: HTMLImageElement | null = null;

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
    window.addEventListener('resize', () => {
      if (!this.visible || this.resizeFrame) return;
      this.resizeFrame = requestAnimationFrame(() => { this.resizeFrame = 0; this.drawScene(); });
    });
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
      $('lobby-region-label').textContent = REGIONS[region].label;
      this.regionButton.setAttribute('aria-label', `当前${REGIONS[region].label}，点击切换地区`);
    }
    if (!this.artImage && !this.pendingArtwork) this.loadArtwork();
    this.applyBackground(this.previewColor !== undefined ? this.previewColor ?? defaultBackground(state) : state.preferences.lobbyBackground ?? defaultBackground(state));
    this.applyMotion(state);
    this.renderProfiles(state);
    if (this.deckOpen) this.renderDeck(state);
    if (!wasVisible) this.scheduleDraw();
  }

  refreshTheme() { if (this.state && this.visible) this.render(this.state); }

  backgroundFor(state: AppState) { return state.preferences.lobbyBackground ?? defaultBackground(state); }

  previewBackground(value: string | null) {
    this.previewColor = value;
    if (this.state && this.visible) this.applyBackground(value ?? defaultBackground(this.state));
  }

  clearBackgroundPreview() {
    this.previewColor = undefined;
    if (this.state && this.visible) this.applyBackground(this.backgroundFor(this.state));
  }

  private hide() {
    if (!this.visible) return;
    this.visible = false;
    this.closeDeck(false);
    this.startPending = false;
    this.root.classList.remove('leaving', 'charge');
    this.artGeneration++;
    if (this.artFrame) cancelAnimationFrame(this.artFrame);
    if (this.profileFrame) cancelAnimationFrame(this.profileFrame);
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.artFrame = this.profileFrame = this.resizeFrame = 0;
    this.cancelArtwork();
    this.artImage = null;
    this.art.removeAttribute('src');
    this.art.classList.remove('is-swapping');
    this.dots.width = this.dots.height = 1;
    this.lines.width = this.lines.height = 1;
  }

  private cancelArtwork() {
    if (!this.pendingArtwork) return;
    this.pendingArtwork.onload = this.pendingArtwork.onerror = null;
    this.pendingArtwork.removeAttribute('src');
    this.pendingArtwork = null;
  }

  private applyMotion(state: AppState) {
    const enabled = state.preferences.lobbyMotion && !this.reduceMotion.matches;
    this.root.dataset.motion = enabled ? 'on' : 'off';
    if (!enabled) this.root.classList.remove('charge', 'leaving');
  }

  private applyBackground(hex: string) {
    if (this.renderedBackground === hex) return;
    this.renderedBackground = hex;
    const { h, s, l, y } = hexToHsl(hex), isDark = y < .28;
    this.root.dataset.tone = isDark ? 'dark' : 'light';
    this.root.style.setProperty('--bg-top', `hsl(${h},${s}%,${Math.min(l + (isDark ? 2.5 : 1.2), 99.5)}%)`);
    this.root.style.setProperty('--bg-bottom', `hsl(${h},${s}%,${Math.max(l - (isDark ? 1.5 : 2.5), 0)}%)`);
    this.ink = isDark
      ? { color: `hsl(${h},${Math.min(s, 25)}%,88%)`, alpha: .14 + y * 1.2 }
      : { color: `hsl(${h},${Math.min(s * .7, 50)}%,${Math.max(l * .22, 6)}%)`, alpha: .20 + (1 - y) * .32 };
    this.scheduleDraw();
    if (this.state) this.paintCurrent(this.state, false);
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
    this.current.setAttribute('aria-label', selected
      ? `当前账号${selected.name}${selected.serverNote ? `，常用区服：${selected.serverNote}` : ''}，点击切换账号`
      : state.profileDiscovery === 'failed' ? '登录档案读取失败' : !regionProfiles.length ? '暂无账号档案' : '账号档案正在清理');
    this.startButton.disabled = state.profileDiscovery !== 'ready' || !selected || this.startPending;
    this.startButton.setAttribute('aria-label', `开始游戏：${REGIONS[state.preferences.region].label}${selected ? `，${selected.name}` : ''}`);

    const status = $('profile-launch-status');
    status.textContent = this.startPending ? '正在启动所选账号…' : this.launchError || (state.profileDiscovery === 'loading' || state.profileDiscovery === 'idle' ? '正在读取本地登录档案…'
      : state.profileDiscovery === 'failed' ? state.profileError || '读取失败，请重试'
        : !regionProfiles.length ? '当前地区还没有登录档案'
          : !selectable.length ? '请先完成待清理档案，或新建一个档案'
            : '');
    status.hidden = !status.textContent;
    ($('lobby-create-profile') as HTMLButtonElement).hidden = !state.canCreateProfile || selectable.length > 0;
    ($('lobby-create-profile') as HTMLButtonElement).disabled = !state.canCreateProfile;
    ($('lobby-profile-retry') as HTMLButtonElement).hidden = state.profileDiscovery !== 'failed';
  }

  private paintCurrent(state: AppState, animate: boolean) {
    const selected = state.profiles.find(profile => profile.id === state.selectedProfileId && profile.region === state.preferences.region && !profile.cleanupStatus);
    const name = selected?.name ?? (state.profileDiscovery === 'failed' ? '读取失败' : state.profileDiscovery === 'loading' || state.profileDiscovery === 'idle' ? '正在读取…' : '暂无账号档案');
    const dark = this.root.dataset.tone === 'dark';
    const [background, foreground] = avatarColors(name, dark);
    const avatar = $('lobby-avatar');
    avatar.textContent = selected ? [...name][0] ?? '' : '·';
    avatar.style.setProperty('--avatar-bg', background);
    avatar.style.setProperty('--avatar-ink', foreground);
    $('lobby-account-name').textContent = name;
    const note = selected ? profileNotes(selected).join(' · ') : '';
    $('profile-choice-note').textContent = note;
    $('profile-choice-note').hidden = !note;
    $('lobby-current').title = selected ? `${name}${note ? ` · ${note}` : ''}` : name;
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
      empty.textContent = state.profileDiscovery === 'failed' ? state.profileError || '读取失败，请重试' : '当前地区还没有登录档案';
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
      option.setAttribute('aria-disabled', String(!!profile.cleanupStatus)); option.title = profile.name;
      if (profile.cleanupStatus) option.classList.add('is-disabled');
      const [background, foreground] = avatarColors(profile.name, this.root.dataset.tone === 'dark');
      const avatar = document.createElement('span'); avatar.className = 'lobby-avatar';
      avatar.textContent = [...profile.name][0] ?? '';
      avatar.style.setProperty('--avatar-bg', background); avatar.style.setProperty('--avatar-ink', foreground);
      const name = document.createElement('b'); name.textContent = profile.name;
      const detailText = profile.cleanupStatus ? '清理未完成' : profileNotes(profile).join(' · ');
      const detail = document.createElement('small'); detail.textContent = detailText;
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
    if (this.root.dataset.motion !== 'off') this.root.classList.add('leaving', 'charge');
    try {
      const accepted = await this.send({ type: 'profile-start' });
      if (accepted !== true) this.resetLaunch();
    } catch (error) {
      this.launchError = error instanceof Error ? error.message : '启动请求未完成，请重试';
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

  private loadArtwork() {
    this.cancelArtwork();
    const generation = ++this.artGeneration;
    if (this.artFrame) cancelAnimationFrame(this.artFrame);
    this.artFrame = 0;
    const artwork = new Image();
    this.pendingArtwork = artwork;
    const source = 'lobby-art-br.png';
    artwork.onload = () => { if (generation === this.artGeneration) this.installArtwork(artwork, source, generation); };
    artwork.onerror = () => {
      if (generation !== this.artGeneration) return;
      const fallback = new Image();
      this.pendingArtwork = fallback;
      fallback.onload = () => { if (generation === this.artGeneration) this.installArtwork(fallback, 'zhiyan-br.png', generation); };
      fallback.onerror = () => { if (generation === this.artGeneration) this.root.dataset.artworkFailed = 'true'; };
      fallback.src = 'zhiyan-br.png';
    };
    artwork.src = source;
  }

  private installArtwork(image: HTMLImageElement, src: string, generation: number) {
    if (generation !== this.artGeneration || !this.visible) return;
    this.pendingArtwork = null;
    this.root.removeAttribute('data-artwork-failed');
    this.art.src = src;
    this.artImage = image;
    try { this.measureFocus(image); }
    catch { this.focusPoint = { x: .68, y: .24 }; }
    this.root.removeAttribute('data-canvas-error');
    this.scheduleDraw();
    if (this.artFrame) cancelAnimationFrame(this.artFrame);
    this.artFrame = requestAnimationFrame(() => {
      this.artFrame = 0;
      if (generation === this.artGeneration && this.visible) this.art.classList.remove('is-swapping');
    });
  }

  private measureFocus(image: HTMLImageElement) {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 144;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(image, 0, 0, 96, 144);
    const data = context.getImageData(0, 0, 96, 144).data;
    let top = 144, bottom = 0;
    for (let y = 0; y < 144; y++) for (let x = 0; x < 96; x++) if (data[(y * 96 + x) * 4 + 3] > 128) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
    if (top === 144) throw new Error('Artwork has no visible pixels');
    const limit = top + (bottom - top) * .25; let sx = 0, sy = 0, count = 0;
    for (let y = top; y < limit; y++) for (let x = 0; x < 96; x++) if (data[(y * 96 + x) * 4 + 3] > 128) { sx += x; sy += y; count++; }
    if (count) this.focusPoint = { x: sx / count / 96, y: (sy / count / 144 + limit / 144) / 2 };
  }

  private scheduleDraw() {
    if (!this.visible || this.resizeFrame) return;
    this.resizeFrame = requestAnimationFrame(() => { this.resizeFrame = 0; this.drawScene(); });
  }

  private drawScene() {
    if (!this.visible || !this.artImage || this.root.hidden || this.root.dataset.canvasError === 'true') return;
    try {
      const width = this.root.clientWidth, height = this.root.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 1);
      if (!width || !height) return;
      const rootRect = this.root.getBoundingClientRect(), artRect = this.art.getBoundingClientRect();
      const art = { x: artRect.left - rootRect.left, y: artRect.top - rootRect.top, w: artRect.width, h: artRect.height };
      const fx = art.x + this.focusPoint.x * art.w, fy = art.y + this.focusPoint.y * art.h;
      this.root.style.setProperty('--focus-x', `${fx}px`); this.root.style.setProperty('--focus-y', `${fy}px`);
      const prepare = (canvas: HTMLCanvasElement) => {
        const pixelWidth = Math.max(1, Math.round(width * dpr)), pixelHeight = Math.max(1, Math.round(height * dpr));
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
        const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
        context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height); return context;
      };
      const dots = prepare(this.dots), cell = 6.5, k = cell / Math.SQRT2;
      const right = art.x + art.w / 2 > width / 2, cx = right ? width * 1.02 : -width * .02, cy = height * 1.04;
      const reach = Math.hypot(width, height) * .62;
      dots.fillStyle = this.ink.color; dots.globalAlpha = Math.min(this.ink.alpha, .5); dots.beginPath();
      const count = Math.ceil((width + height) / k) + 2;
      for (let i = -count; i <= count; i++) for (let j = 0; j <= count * 2; j++) {
        const x = (i + j) * k - height, y = (j - i) * k;
        if (x < -4 || x > width + 4 || y < -4 || y > height + 4) continue;
        const amount = 1 - Math.hypot(x - cx, y - cy) / reach; if (amount <= 0) continue;
        const radius = cell * .46 * Math.pow(amount, 1.35); if (radius < .32) continue;
        dots.moveTo(x + radius, y); dots.arc(x, y, radius, 0, Math.PI * 2);
      }
      dots.fill(); dots.globalAlpha = 1;
      const lines = prepare(this.lines); this.lineSeed = 7; lines.fillStyle = this.ink.color;
      const lineFactor = this.ink.alpha / .22, far = Math.hypot(width, height) * 1.1, base = Math.min(width, height);
      const random = () => (this.lineSeed = (this.lineSeed * 16807) % 2147483647) / 2147483647;
      for (let angle = 0; angle < Math.PI * 2;) {
        angle += (.6 + random() * 2.6) * Math.PI / 180;
        if (random() < .18) angle += random() * 5 * Math.PI / 180;
        const start = base * (.34 + random() * .3), lineWidth = .5 + random() * 1.6, alpha = .03 + random() * .045;
        const cos = Math.cos(angle), sin = Math.sin(angle), px = -sin, py = cos, halfEnd = lineWidth * 1.7;
        lines.globalAlpha = Math.min(alpha * lineFactor, .2); lines.beginPath();
        lines.moveTo(fx + cos * start, fy + sin * start);
        lines.lineTo(fx + cos * far + px * halfEnd, fy + sin * far + py * halfEnd);
        lines.lineTo(fx + cos * far - px * halfEnd, fy + sin * far - py * halfEnd);
        lines.closePath(); lines.fill();
      }
      lines.globalAlpha = 1;
      for (const [context, blur] of [[dots, 9], [lines, 14]] as const) {
        context.save(); context.globalCompositeOperation = 'destination-out'; context.filter = `blur(${blur}px)`;
        for (let i = 0; i < 3; i++) context.drawImage(this.artImage, art.x, art.y, art.w, art.h);
        context.restore();
      }
    } catch {
      this.root.dataset.canvasError = 'true';
      this.dots.getContext('2d')?.clearRect(0, 0, this.dots.width, this.dots.height);
      this.lines.getContext('2d')?.clearRect(0, 0, this.lines.width, this.lines.height);
    }
  }
}
