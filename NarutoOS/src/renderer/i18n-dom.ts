import { currentLanguage, msg, onLanguageChange, resolveText } from '../shared/i18n';

const texts = new Map<Node, string>();
const attributes = new Map<Element, Map<string, string>>();
export function setText(node: Node, value: unknown) {
  const raw = value == null ? '' : String(value);
  if (node instanceof Element) node.removeAttribute('data-i18n');
  if (raw.includes('\uE000')) texts.set(node, raw); else texts.delete(node);
  const translated = resolveText(raw);
  if (node.textContent !== translated) node.textContent = translated;
  return raw;
}
export function setAttr(node: Element, name: string, value: string) {
  node.removeAttribute('data-i18n-' + name);
  let bindings = attributes.get(node);
  if (!bindings) attributes.set(node, bindings = new Map());
  if (value.includes('\uE000')) bindings.set(name, value); else bindings.delete(name);
  const translated = resolveText(value);
  if (node.getAttribute(name) !== translated) node.setAttribute(name, translated);
}
export function applyLanguage() {
  document.documentElement.lang = currentLanguage();
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) node.textContent = resolveText(msg(node.dataset.i18n!));
  for (const name of ['title', 'aria-label', 'placeholder']) {
    for (const node of document.querySelectorAll<HTMLElement>(`[data-i18n-${name}]`)) node.setAttribute(name, resolveText(msg(node.getAttribute('data-i18n-' + name)!)));
  }
  for (const [node, value] of texts) { if (!node.isConnected) texts.delete(node); else { const text=resolveText(value); if(node.textContent!==text)node.textContent=text; } }
  for (const [node, bindings] of attributes) { if (!node.isConnected) attributes.delete(node); else for (const [name, value] of bindings) node.setAttribute(name, resolveText(value)); }
}
onLanguageChange(applyLanguage);
