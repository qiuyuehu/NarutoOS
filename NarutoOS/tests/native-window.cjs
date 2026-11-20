// Real AppKit widgets in an empty Electron window. No websites or credentials.
const { app, BrowserWindow, nativeTheme, nativeImage } = require('electron');
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const { attachTrafficLights, measureTrafficLights } = require('../dist/main/traffic-lights.test.cjs');
const testNative = require('../.test-artifacts/native-window/test.node');
const root = path.resolve(__dirname, '..'); const directory = path.join(root, '.test-artifacts/native-window');
app.setPath('userData', process.env.NARUTO_NATIVE_DATA_DIR);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
const check = (name, condition) => { assert(condition, name); results.push(name); console.log('PASS', name); };
async function until(condition) { for (let i = 0; i < 80; i++) { if (condition()) return; await pause(100); } throw Error('Native window transition timeout'); }
function matches(rows) {
 return rows.length === 3 && rows.every((b, i) => Math.abs(b.circle - 14) < .01 && Math.abs(b.x + b.width / 2 - (21 + i * 22)) < .01 && Math.abs(b.y + b.height / 2 - 21) < .01 && b.nativeHit);
}
function ink(handle, filename) {
 const png = testNative.snapshot(handle); fs.writeFileSync(path.join(directory, filename), png);
 const image = nativeImage.createFromBuffer(png); const {width, height} = image.getSize(); const bitmap = image.toBitmap({scaleFactor:1}); const runs = [];
 for (let x = 0; x < width; x++) {
  let opaque = false; for (let y = 0; y < height; y++) if (bitmap[(y * width + x) * 4 + 3] > 128) { opaque = true; break; }
  if (opaque) { let run = runs[runs.length - 1]; if (!run || x !== run.right + 1) { run = {left:x,right:x}; runs.push(run); } else run.right=x; }
 }
 return runs.map(run => ({...run, width:run.right-run.left+1}));
}
app.whenReady().then(async () => {
 let win;
 try {
  win = new BrowserWindow({ width: 800, height: 560, title: 'Naruto OS · 原生控件回归验证', titleBarStyle:'hidden', trafficLightPosition:{x:14,y:15}, backgroundColor:'#f2f2f2', webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true} });
  await win.loadURL('data:text/html,<body style="background:%23f2f2f2;font:16px sans-serif"><p style="margin:80px">Naruto OS · 原生控件回归验证</p>');
  const handle = win.getNativeWindowHandle(); app.focus({steal:true}); win.focus();
  await until(() => win.isFocused()); await pause(200);
  const before = measureTrafficLights(win); const beforeInk = ink(handle, 'before.png');
  check('reproduces original 12pt colored circles', before.every(b => Math.abs(b.circle - 12) < .01));
  attachTrafficLights(win); await pause(200);
  const after = measureTrafficLights(win); const afterInk = ink(handle, 'after.png');
  console.log('NATIVE_INK', JSON.stringify({before:beforeInk,after:afterInk}));
  check('native frames draw 14pt circles at scheme C centers', matches(after));
  check('actual native drawing grows to 14px with 8px gaps', afterInk.length === 3 && afterInk.every((run,i) => run.width === 14 && (i === 0 || run.left - afterInk[i-1].right - 1 === 8)));
  check('native actions preserved', after.every((b,i) => b.action === before[i].action && b.enabled));
  for (let i = 0; i < 8; i++) { win.setSize(i % 2 ? 800 : 1100, i % 2 ? 560 : 700); await pause(50); }
  check('repeated resize does not shrink or compound scale', matches(measureTrafficLights(win)));
  nativeTheme.themeSource = 'dark'; await pause(250); check('dark theme retains native geometry', matches(measureTrafficLights(win)));
  nativeTheme.themeSource = 'light'; await pause(250); check('light theme retains native geometry', matches(measureTrafficLights(win)));
  win.blur(); await pause(200); win.focus(); await until(() => win.isFocused()); await pause(350);
  check('activation retains scheme C centers and native hit areas after AppKit relayout', matches(measureTrafficLights(win)));
  testNative.relayout(handle); await pause(150);
  check('late AppKit frame changes restore geometry and native hit areas', matches(measureTrafficLights(win)));
  const idleStart=Date.now(), idleCpu=process.cpuUsage(); await pause(500);
  const cpu=process.cpuUsage(idleCpu);
  check('layout notifications settle without a main-thread spin loop', (cpu.user+cpu.system)/1000 < (Date.now()-idleStart)*.5);
  win.setFullScreen(true); await until(() => win.isFullScreen()); await pause(700);
  win.setFullScreen(false); await until(() => !win.isFullScreen()); await pause(700);
  check('fullscreen return restores scheme C controls', matches(measureTrafficLights(win)));
  testNative.click(handle, 1); await until(() => win.isMinimized()); check('native yellow button minimizes', win.isMinimized());
  win.restore(); await until(() => !win.isMinimized()); await pause(200); check('restore retains native geometry', matches(measureTrafficLights(win)));
  const original = win.getBounds(); testNative.click(handle, 2);
  await until(() => win.isFullScreen() || win.isMaximized() || win.getBounds().width !== original.width);
  check('native green button invokes system zoom or fullscreen', win.isFullScreen() || win.isMaximized() || win.getBounds().width !== original.width);
  if (win.isFullScreen()) { win.setFullScreen(false); await until(() => !win.isFullScreen()); await pause(700); }
  else if(win.isMaximized()) { win.unmaximize(); await pause(200); }
  fs.writeFileSync(path.join(directory, 'native-results.json'), JSON.stringify({ok:true,results,before,after,beforeInk,afterInk},null,2));
  let closed=false; win.once('closed',()=>{closed=true;}); testNative.click(handle,0);
  check('native red button closes its own window', closed || win.isDestroyed());
  fs.writeFileSync(path.join(directory, 'native-results.json'), JSON.stringify({ok:true,results,before,after,beforeInk,afterInk},null,2));
  console.log('NATIVE_COMPLETE',results.length); app.quit();
 } catch(error) {
  console.error('NATIVE_ERROR',error.message);
  fs.writeFileSync(path.join(directory,'native-results.json'),JSON.stringify({ok:false,results,error:error.message},null,2));
  process.exitCode=1; if(win && !win.isDestroyed()) win.close(); app.quit();
 }
});
