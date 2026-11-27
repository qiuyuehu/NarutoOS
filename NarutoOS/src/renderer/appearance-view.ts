import { titlePalette } from '../shared/appearance';
import type { Command, Preferences, Theme } from '../shared/model';
import { LOBBY_PRESETS, type LobbyView } from './lobby';

type AppearancePreferences = Pick<Preferences, 'theme' | 'titleBarColor' | 'lobbyBackground' | 'lobbyMotion'>;
type AppearanceCommand = Extract<Command, { type: 'theme' | 'title-color' | 'lobby-background' | 'lobby-motion' }>;
type LobbyAppearance = Pick<LobbyView, 'backgroundFor' | 'previewBackground' | 'clearBackgroundPreview' | 'refreshTheme'>;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const isLobbyPreset = (color: string) => LOBBY_PRESETS.some(preset => preset.color === color);

export function createAppearanceView(
  command: (input: AppearanceCommand) => Promise<void | boolean>,
  lobby: LobbyAppearance,
  fitSettingSelect: (select: HTMLSelectElement) => void,
) {
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const bar = document.querySelector<HTMLElement>('.chrome')!;
  const theme = $<HTMLSelectElement>('theme-select');
  const titleMode = $<HTMLSelectElement>('title-mode');
  const titleColor = $<HTMLInputElement>('title-color');
  const settingsPanel = $<HTMLElement>('settings-panel');
  const lobbyBackgroundMode = $<HTMLSelectElement>('lobby-bg-mode');
  const lobbyCustomBackground = $<HTMLInputElement>('lobby-bg-custom');
  const lobbyMotion = $<HTMLButtonElement>('lobby-motion');

  let latestPreferences: AppearancePreferences | undefined;
  let customLobbyColorMode = false;
  let lobbyBackgroundTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingLobbyBackground: { value: string | null } | undefined;
  let savingLobbyBackground = false;

  function paintTitle(color: string | null) {
    const palette = color ? titlePalette(color) : null;
    for (const key of ['bg', 'fg', 'secondary', 'hover', 'selected', 'border'] as const) {
      if (palette) bar.style.setProperty('--bar-' + key, palette[key]);
      else bar.style.removeProperty('--bar-' + key);
    }
  }

  function applyAppearance(preferences: AppearancePreferences) {
    document.documentElement.dataset.dark = String(preferences.theme === 'dark' || (preferences.theme === 'system' && systemTheme.matches));
    theme.value = preferences.theme;
    titleMode.value = preferences.titleBarColor ? 'custom' : 'default';
    titleColor.hidden = !preferences.titleBarColor;
    if (preferences.titleBarColor) titleColor.value = preferences.titleBarColor;
    fitSettingSelect(theme);
    fitSettingSelect(titleMode);
    paintTitle(preferences.titleBarColor);
  }

  function selectedBackground(preferences: AppearancePreferences) {
    return pendingLobbyBackground ? pendingLobbyBackground.value : preferences.lobbyBackground;
  }

  function renderLobbyPreferences(preferences: AppearancePreferences) {
    latestPreferences = preferences;
    const selected = selectedBackground(preferences);
    let mode = 'custom';
    if (!customLobbyColorMode) {
      if (selected === null) mode = 'theme';
      else if (isLobbyPreset(selected)) mode = selected;
    }
    lobbyBackgroundMode.value = mode;
    fitSettingSelect(lobbyBackgroundMode);
    lobbyCustomBackground.hidden = mode !== 'custom';
    lobbyCustomBackground.value = mode === 'custom' && selected !== null ? selected : lobby.backgroundFor(preferences);
    lobbyMotion.setAttribute('aria-checked', String(preferences.lobbyMotion));
  }

  function queueLobbyBackground(value: string | null, delay = 180) {
    if (!pendingLobbyBackground && latestPreferences?.lobbyBackground === value) {
      renderLobbyPreferences(latestPreferences);
      return;
    }
    pendingLobbyBackground = { value };
    settingsPanel.toggleAttribute('data-lobby-background-pending', true);
    lobby.previewBackground(value);
    clearTimeout(lobbyBackgroundTimer);
    lobbyBackgroundTimer = setTimeout(() => { void flushLobbyBackground(); }, delay);
  }

  async function flushLobbyBackground() {
    clearTimeout(lobbyBackgroundTimer);
    lobbyBackgroundTimer = undefined;
    if (savingLobbyBackground || !pendingLobbyBackground) return;

    const choice = pendingLobbyBackground;
    // Wait for the command's state refresh before sending another write with its new revision.
    savingLobbyBackground = true;
    const saved = (await command({ type: 'lobby-background', value: choice.value })) !== false;
    savingLobbyBackground = false;

    if (pendingLobbyBackground === choice || (saved && pendingLobbyBackground?.value === choice.value)) {
      clearTimeout(lobbyBackgroundTimer);
      lobbyBackgroundTimer = undefined;
      pendingLobbyBackground = undefined;
      settingsPanel.removeAttribute('data-lobby-background-pending');
      lobby.clearBackgroundPreview();
      if (latestPreferences) renderLobbyPreferences(latestPreferences);
    } else if (lobbyBackgroundTimer === undefined) {
      // The debounce elapsed, or closing Settings already requested an immediate save.
      void flushLobbyBackground();
    }
  }

  systemTheme.addEventListener('change', () => {
    if (!latestPreferences) return;
    applyAppearance(latestPreferences);
    lobby.refreshTheme();
    renderLobbyPreferences(latestPreferences);
  });
  theme.addEventListener('change', () => {
    void command({ type: 'theme', value: theme.value as Theme });
    fitSettingSelect(theme);
  });
  titleMode.addEventListener('change', () => {
    fitSettingSelect(titleMode);
    void command({ type: 'title-color', value: titleMode.value === 'custom' ? titleColor.value : null });
  });
  titleColor.addEventListener('input', () => paintTitle(titleColor.value));
  titleColor.addEventListener('change', () => void command({ type: 'title-color', value: titleColor.value }));

  lobbyBackgroundMode.addEventListener('change', () => {
    fitSettingSelect(lobbyBackgroundMode);
    const mode = lobbyBackgroundMode.value;
    if (mode === 'custom') {
      customLobbyColorMode = true;
      if (latestPreferences) renderLobbyPreferences(latestPreferences);
    } else if (mode === 'theme' || isLobbyPreset(mode)) {
      customLobbyColorMode = false;
      queueLobbyBackground(mode === 'theme' ? null : mode, 0);
    }
  });
  lobbyCustomBackground.addEventListener('input', () => queueLobbyBackground(lobbyCustomBackground.value));
  lobbyCustomBackground.addEventListener('change', () => {
    customLobbyColorMode = false;
    queueLobbyBackground(lobbyCustomBackground.value, 0);
    void flushLobbyBackground();
  });
  lobbyMotion.addEventListener('click', () => {
    if (latestPreferences) void command({ type: 'lobby-motion', value: !latestPreferences.lobbyMotion });
  });

  return { applyAppearance, renderLobbyPreferences, flushLobbyBackground };
}
