import { Theme } from './model';

export function validTheme(value: unknown): value is Theme { return value === 'system' || value === 'light' || value === 'dark'; }
export function validTitleColor(value: unknown): value is string { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value); }
// Prefer the foreground with the higher WCAG contrast on any chosen title color.
export function titlePalette(color: string) {
  if (!validTitleColor(color)) throw new Error('标题栏颜色无效');
  const linear = [1, 3, 5].map(i => {
    const v = parseInt(color.slice(i, i + 2), 16) / 255;
    return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  });
  const light = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722 < .179;
  return { bg: color, fg: light ? '#ffffff' : '#000000', secondary: light ? '#ffffff' : '#000000',
    hover: light ? '#ffffff14' : '#00000009', selected: light ? '#ffffff25' : '#00000011', border: light ? '#ffffff28' : '#00000018' };
}
