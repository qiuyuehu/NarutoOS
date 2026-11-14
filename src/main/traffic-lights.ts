import { BrowserWindow, nativeTheme } from 'electron';
import path from 'path';
interface NativeControls { apply(handle: Buffer): boolean; measure(handle: Buffer): string }
export interface NativeButton { x: number; y: number; width: number; height: number; circle: number; action: string; nativeHit: boolean; visible: boolean; enabled: boolean }
const controls: NativeControls = require(path.join(__dirname, '../native/traffic-lights.node'));
export function measureTrafficLights(window: BrowserWindow): NativeButton[] { return JSON.parse(controls.measure(window.getNativeWindowHandle())); }
export function attachTrafficLights(window: BrowserWindow) {
  let immediate: NodeJS.Immediate | null = null;
  let transition: ReturnType<typeof setTimeout> | null = null;
  const apply = () => {
    immediate = null;
    if (!window.isDestroyed() && !window.isFullScreen()) controls.apply(window.getNativeWindowHandle());
  };
  const schedule = () => {
    if (immediate) clearImmediate(immediate);
    // Start after Electron layout; the native keeper also tracks later AppKit layout.
    immediate = setImmediate(apply);
  };
  const settled = () => {
    schedule(); if (transition) clearTimeout(transition);
    transition = setTimeout(schedule, 100);
  };
  window.on('resize', schedule); window.on('show', schedule);
  window.on('focus', schedule); window.on('restore', schedule);
  window.on('leave-full-screen', settled); nativeTheme.on('updated', settled);
  window.once('closed', () => {
    if (immediate) clearImmediate(immediate); if (transition) clearTimeout(transition);
    nativeTheme.removeListener('updated', settled);
  });
  schedule();
}
