import catalog from './messages.json';

export const LANGUAGES = ['zh-CN', 'en', 'pt-BR'] as const;
export type Language = typeof LANGUAGES[number];
export const validLanguage = (value: unknown): value is Language => LANGUAGES.includes(value as Language);
export const normalizeLanguage = (value: unknown): Language => validLanguage(value) ? value : 'zh-CN';
type Params = Record<string, string | number>;
type Catalog = Record<string, Partial<Record<Language, string>>>;
let language: Language = 'zh-CN';
const listeners = new Set<() => void>();
export const currentLanguage = () => language;
export function setLanguage(value: unknown) {
  const next = normalizeLanguage(value);
  if (next === language) return false;
  language = next;
  for (const fn of listeners) fn();
  return true;
}
export function onLanguageChange(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }

// Messages remain language-neutral across IPC and in retained notices. No user
// data is interpreted as HTML; the DOM adapter writes text and attributes only.
export function msg(key: string, params: Params = {}): string {
  return '\uE000' + key + (Object.keys(params).length ? ':' + encodeURIComponent(JSON.stringify(params)) : '') + '\uE001';
}
export function pluralMessage(key: string, count: number, params: Params = {}) {
  return msg(key + (count === 1 ? '.one' : '.other'), { ...params, count });
}
export function translate(key: string, params: Params = {}, locale: Language = language, source: Catalog = catalog): string {
  const entry = source[key];
  const template = entry?.[locale] || entry?.['zh-CN'];
  if (!template) { console.warn('[i18n] Missing key:', key); return `[${key}]`; }
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name: string) => params[name] === undefined ? `{${name}}` : String(params[name]));
}
export function messageCode(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? '');
  return /^\uE000([^:\uE001]+)/.exec(text)?.[1] || text;
}
export function resolveText(value: unknown, locale: Language = language, depth = 0): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (depth > 8) return text;
  return text.replace(/\uE000([^:\uE001]+)(?::([^\uE001]*))?\uE001/g, (_, key: string, encoded?: string) => {
    let params: Params = {};
    try { params = encoded ? JSON.parse(decodeURIComponent(encoded)) : {}; } catch { return `[${key}]`; }
    for (const name of Object.keys(params)) if (typeof params[name] === 'string') params[name] = resolveText(params[name], locale, depth + 1);
    return translate(key, params, locale);
  });
}

export function interfaceStrings() {
  return Object.fromEntries(Object.keys(catalog).map(key => [key, translate(key)]));
}
