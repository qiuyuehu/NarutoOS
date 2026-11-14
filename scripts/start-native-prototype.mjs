import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import electron from 'electron';
const project = path.resolve(import.meta.dirname, '..');
const live = process.argv.includes('--live');
const direct = process.argv.includes('--direct');
const useInstalledData = process.argv.includes('--installed-data');
if (direct && !live) throw new Error('直连模式只允许与 --live 一起使用');
if (useInstalledData && (!live || !direct)) throw new Error('复用安装资料需要真实官网直连模式');
const defaultRoot = path.join(project, '.test-artifacts', direct ? 'native-core-direct-live' : live ? 'native-core-dev' : 'native-core-preview');
let installedRoot;
if (useInstalledData) {
  const location = path.join(process.env.HOME, 'Library/Application Support/Naruto OS C/data-location.json');
  installedRoot = JSON.parse(fs.readFileSync(location, 'utf8')).root;
  if (typeof installedRoot !== 'string' || !path.isAbsolute(installedRoot) || fs.realpathSync(installedRoot) !== installedRoot || !fs.existsSync(path.join(installedRoot, 'management.json'))) throw new Error('安装版账号资料目录无效；原资料未改动');
}
const root = path.resolve(useInstalledData ? installedRoot : process.env.NARUTO_C_ROOT || defaultRoot);
if (!useInstalledData && root === path.join(project, '.test-artifacts', 'native-core-live')) throw new Error('开发版不能读取安装版资料目录；原资料未改动');
if (direct && !useInstalledData && root !== defaultRoot) throw new Error('直连模式必须使用专属隔离资料目录');
if (!useInstalledData && !direct && path.basename(root) === 'native-core-direct-live') throw new Error('普通模式不能复用直连专属资料目录');
if (!useInstalledData && !root.startsWith(project + '/.test-artifacts/native-core-')) throw new Error('仅允许隔离原型目录');
if (useInstalledData && fs.statSync(root).uid !== process.getuid()) throw new Error('账号资料目录不属于当前用户；原资料未改动');
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const env = { ...process.env, NARUTO_C_ROOT: root, NARUTO_C_PROJECT: project, NARUTO_C_ELECTRON: electron, NARUTO_C_FIXTURE: live ? '0' : '1' };
if (direct) env.NARUTO_C_DIRECT = '1'; else delete env.NARUTO_C_DIRECT;
if (useInstalledData) env.NARUTO_C_DEV_REAL = '1'; else delete env.NARUTO_C_DEV_REAL;
delete env.ELECTRON_RUN_AS_NODE;
const socket = `/tmp/naruto-c-${process.getuid()}-${crypto.createHash('sha256').update(root).digest('hex').slice(0, 16)}.sock`;
function request(command) {
  return new Promise((resolve, reject) => {
    const tokens = JSON.parse(fs.readFileSync(path.join(root, 'capabilities.json')));
    const c = net.createConnection(socket); const timer = setTimeout(() => { c.destroy(); reject(new Error('核心连接超时')); }, 3000); let text = '';
    c.on('connect', () => c.write(JSON.stringify({ v: 1, role: 'center', token: tokens.center, command, payload: {} }) + '\n'));
    c.on('error', error => { clearTimeout(timer); reject(error); });
    c.on('data', data => { text += data; if (text.includes('\n')) { clearTimeout(timer); c.end(); const result = JSON.parse(text.split('\n')[0]); result.ok ? resolve(result.value) : reject(new Error('请求失败')); } });
  });
}
let existing;
try {existing=await request('snapshot');} catch {}
if (existing && existing.fixture !== (env.NARUTO_C_FIXTURE === '1')) throw new Error('该资料正在运行另一种模式，请先正常退出当前启动器和游戏后重开');
if (!existing) {
  spawn(path.join(project, 'dist/prototype/native/core'), [], { env, detached: true, stdio: 'ignore' }).unref();
  let ready = false;
  for (let i = 0; i < 40; i++) { try { await request('snapshot'); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  if (!ready) throw new Error('原生核心未启动，请先构建原型');
}
await request('center.ensure');
console.log('已打开C架构开发版；资料目录：' + root);
console.log(live ? `真实官网模式${direct ? '，游戏会话直连' : '，游戏会话跟随系统代理'}${useInstalledData ? '，沿用安装版账号资料。' : '，使用本地测试资料。'}` : '离线模式：两个合成账号，真实 Flash 样本，无官网访问。');
