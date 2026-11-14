const keyboardModifiers = new Set(['Alt', 'Control', 'Meta', 'Shift', 'AltGraph']);
const textInputTypes = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);

function isTextEditor(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const editor = target.closest('input, textarea, [contenteditable="true"]');
  if (!editor) return false;
  if (editor instanceof HTMLInputElement) return textInputTypes.has(editor.type);
  return editor instanceof HTMLTextAreaElement || (editor as HTMLElement).isContentEditable;
}

export function installFocusModality() {
  const root = document.documentElement;
  root.dataset.inputModality = 'pointer';

  document.addEventListener('pointerdown', () => {
    root.dataset.inputModality = 'pointer';
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Tab') { root.dataset.inputModality = 'keyboard'; return; }
    if (!keyboardModifiers.has(event.key) && !isTextEditor(event.target)) root.dataset.inputModality = 'keyboard';
  }, true);
}
