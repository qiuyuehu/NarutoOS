import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// One-shot, read-only OS measurements. No application GC, reload or config changes.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
const [command, ...args] = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const get = name => args.includes(name) ? option(name) : undefined;
const directory = path.resolve(root, get('--out') || '.test-artifacts/battle-memory-followup-2026-11-03');
if (!directory.startsWith(path.join(root, '.test-artifacts') + path.sep)) throw new Error('--out must be inside this project .test-artifacts/');
const mib = value => (value / 1048576).toFixed(1);
const role = name => name.includes('(Plugin)') ? 'PPAPI' : name.includes('(GPU)') ? 'GPU'
  : name.includes('(Renderer)') ? 'renderer' : name === 'Electron' ? 'main' : 'utility';
const problem = data => Object.keys(data.errors || {}).length || Object.keys(data.warnings || {}).length
  ? 'footprint errors/warnings; inspect raw JSON'
  : data.unit !== 'byte' || !Number.isFinite(data['total footprint']) || !Array.isArray(data.processes)
    || !data.processes.length ? 'invalid footprint schema' : undefined;

if (command === 'capture') {
  const pid = Number(get('--pid')), label = get('--label'), scene = get('--scene');
  const battles = Number(get('--battles'));
  if (!Number.isSafeInteger(pid) || pid < 1 || !/^[a-z0-9-]+$/.test(label || '') || !scene
    || !Number.isSafeInteger(battles) || battles < 0) {
    throw new Error('capture --pid MAIN_PID --label unique-label --battles N --scene "NPC menu / result" [--experience "reported observation"] [--out .test-artifacts/...]');
  }
  const { stdout } = await run('/bin/ps', ['-axo', 'pid=,ppid=,rss=,pcpu=,comm=']);
  const rows = stdout.trim().split('\n').map(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/);
    if (!m) throw new Error('Unrecognized ps row');
    return { pid: +m[1], ppid: +m[2], rssKiB: +m[3], cpuPercent: +m[4], executable: m[5] };
  });
  const main = rows.find(row => row.pid === pid);
  const expected = fs.realpathSync(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'));
  if (!main || fs.realpathSync(main.executable) !== expected) throw new Error('PID must be this project development Electron main process');
  const pids = new Set([pid]);
  let previous;
  do {
    previous = pids.size;
    for (const row of rows) if (pids.has(row.ppid)) pids.add(row.pid);
  } while (previous !== pids.size);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const prefix = path.join(directory, label);
  const metaPath = prefix + '.meta.json';
  // Never overwrite an earlier measurement, even if a previous capture failed.
  const meta = { label, startedAt: new Date().toISOString(), mainPid: pid, battles, scene,
    experience: get('--experience') || 'not reported', pids: [...pids], status: 'capturing' };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(prefix + '.processes.json', JSON.stringify(rows.filter(row => pids.has(row.pid)), null, 2), { mode: 0o600 });
  const started = performance.now();
  const results = await Promise.allSettled([
    run('/usr/bin/footprint', ['-j', prefix + '.footprint.json', '--swapped', '--wired', ...[...pids].map(String)], { maxBuffer: 16 * 1024 * 1024, timeout: 60000 }),
    run('/usr/bin/memory_pressure', ['-Q'], { timeout: 10000 }),
    run('/usr/sbin/sysctl', ['vm.swapusage'], { timeout: 10000 })
  ]);
  for (const [index, suffix] of ['footprint', 'memory-pressure', 'swap'].entries()) {
    const result = results[index];
    fs.writeFileSync(prefix + '.' + suffix + '.txt', result.status === 'fulfilled'
      ? result.value.stdout + result.value.stderr : String(result.reason), { mode: 0o600 });
  }
  meta.finishedAt = new Date().toISOString();
  meta.durationSeconds = (performance.now() - started) / 1000;
  let data;
  try {
    if (results.some(result => result.status === 'rejected')) throw new Error('OS measurement command failed');
    data = JSON.parse(fs.readFileSync(prefix + '.footprint.json', 'utf8'));
    const issue = problem(data);
    if (issue) throw new Error(issue);
    if ([...pids].some(pid => !data.processes.some(process => process.pid === pid))) throw new Error('PID exited or missing during capture');
    meta.status = 'captured';
  } catch (error) {
    meta.status = 'failed';
    meta.problem = String(error);
  }
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
  if (meta.status === 'failed') throw new Error('Capture incomplete; inspect saved outputs');
  console.log(`${label}: total footprint ${mib(data['total footprint'])} MiB; capture ${meta.durationSeconds.toFixed(2)}s`);
  for (const process of data.processes) console.log(`  ${role(process.name)} ${process.pid}: ${mib(process.footprint)} MiB`);
  console.log('Per-process footprints are diagnostic; do not sum them. System Swap is not app Swap.');
} else if (command === 'summarize') {
  const samples = fs.readdirSync(directory).filter(name => name.endsWith('.footprint.json')).map(name => {
    const label = name.replace('.footprint.json', '');
    try {
      const data = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
      const metaPath = path.join(directory, label + '.meta.json');
      const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : undefined;
      return { label, data, issue: problem(data) || (meta && meta.status !== 'captured' ? `capture status: ${meta.status}` : undefined) };
    } catch (error) { return { label, issue: String(error) }; }
  }).sort((a, b) => (a.data?.start_time?.wall_time_s || 0) - (b.data?.start_time?.wall_time_s || 0));
  console.log('sample | time | total MiB | PPAPI MiB | PPAPI Tag1 dirty MiB | PPAPI Malloc Small dirty MiB');
  for (const { label, data, issue } of samples) {
    if (issue) { console.log(`${label} | EXCLUDED: ${issue}`); continue; }
    const plugin = data.processes.filter(process => role(process.name) === 'PPAPI');
    const p = plugin.length === 1 ? plugin[0] : undefined;
    const category = name => p ? mib(p.categories[name]?.dirty || 0) : '-';
    console.log([label, data.start_time.date, mib(data['total footprint']), p ? mib(p.footprint) : `(${plugin.length} plugins)`,
      category('App-Specific Tag 1'), category('Malloc Small')].join(' | '));
  }
} else {
  console.log('node scripts/battle-memory.mjs capture --pid MAIN_PID --label unique-label --battles N --scene "scene" [--experience "observation"] [--out .test-artifacts/...]');
  console.log('node scripts/battle-memory.mjs summarize [--out .test-artifacts/...]');
}
