// Core-side update handoff wiring: preparing an update blocks new game
// requests, the host reports cancellation through the core, and cancelling
// restores normal operation. Uses an isolated fixture root only.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const project = path.resolve(import.meta.dirname, '..');
const root = fs.mkdtempSync(path.join(project, '.test-artifacts/native-core-update-handoff-'));
const env = { ...process.env, NARUTO_C_ROOT: root, NARUTO_C_PROJECT: project, NARUTO_C_ELECTRON: '/usr/bin/true', NARUTO_C_FIXTURE: '1' };
const socket = '/tmp/naruto-c-' + process.getuid() + '-' + crypto.createHash('sha256').update(root).digest('hex').slice(0, 16) + '.sock';
const results = [];
let core;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(name, value) { assert(value, name); results.push(name); console.log('PASS ' + name); }
async function until(fn) { for (let i = 0; i < 200; i += 1) { try { const value = await fn(); if (value) return value; } catch {} await pause(100); } throw new Error('timeout'); }
function request(role, command, payload = {}) {
  return new Promise((resolve, reject) => {
    const token = JSON.parse(fs.readFileSync(path.join(root, 'capabilities.json')))[role];
    let data = '';
    const client = net.createConnection(socket);
    const timer = setTimeout(() => { client.destroy(); reject(new Error('IPC timeout')); }, 3000);
    client.on('error', error => { clearTimeout(timer); reject(error); });
    client.on('connect', () => client.write(JSON.stringify({ v: 1, role, token, command, payload }) + '\n'));
    client.on('data', bytes => {
      data += bytes;
      if (!data.includes('\n')) return;
      clearTimeout(timer); client.end();
      const reply = JSON.parse(data.split('\n')[0]);
      if (reply.ok) resolve(reply.value); else { const error = new Error(reply.message); error.code = reply.code; reject(error); }
    });
  });
}
try {
  core = spawn(path.join(project, 'dist/prototype/native/core'), [], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  core.stderr.on('data', chunk => process.stderr.write(chunk));
  await until(() => request('center', 'snapshot'));
  check('update mode starts idle', (await request('center', 'snapshot')).update.mode === false);
  const prepared = await request('center', 'update.prepare');
  check('prepare enters update mode', prepared.update.mode === true && prepared.update.handoff.state === 'prepared');
  let rejected = '';
  try { await request('center', 'batch.start', { requestId: crypto.randomUUID(), profileIds: ['br-1'] }); } catch (error) { rejected = error.code || error.message; }
  check('new game requests are rejected during an update', rejected === 'update.in_progress');
  await request('host', 'host.updateHandoff', { instance: '', state: 'cancelled' });
  check('host cancellation reaches the centre', (await request('center', 'snapshot')).update.handoff.state === 'cancelled');
  const ensured = await request('host', 'center.ensure', {});
  check('centre is not respawned during an update', ensured.centerPID === 0);
  await request('center', 'update.quitHost', {});
  check('quit request records host exit', (await request('center', 'snapshot')).update.handoff.state === 'host-exited');
  const cancelled = await request('center', 'update.cancel');
  check('cancel clears update mode', cancelled.update.mode === false);
  const batch = await request('center', 'batch.start', { requestId: crypto.randomUUID(), profileIds: ['br-1'] });
  check('normal game requests resume after cancel', batch.profileIds[0] === 'br-1');
  let doublePrepare = '';
  await request('center', 'update.prepare');
  try { await request('center', 'update.prepare'); } catch (error) { doublePrepare = error.code || error.message; }
  check('a second update cannot start', doublePrepare === 'update.in_progress');
  await request('center', 'update.cancel');
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ ok: true, results }, null, 2));
  console.log('更新交接接线检查通过：' + results.length + ' 项');
} catch (error) {
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ ok: false, results, error: String(error) }, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally {
  if (core && core.exitCode === null) { core.kill('SIGTERM'); await new Promise(resolve => core.once('exit', resolve)); }
  console.log('交接检查目录：' + root);
}
