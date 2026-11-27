import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import electron from 'electron';

const project = path.resolve(import.meta.dirname, '..');
const artifacts = path.join(project, '.test-artifacts');

async function waitFor(description, predicate, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readMessage(socket) {
  return new Promise((resolve, reject) => {
    let input = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      input += chunk;
      const end = input.indexOf('\n');
      if (end === -1) return;
      try { resolve(JSON.parse(input.slice(0, end))); } catch (error) { reject(error); }
    });
    socket.once('error', reject);
    socket.once('close', () => reject(new Error('IPC connection closed before a complete message')));
    socket.setTimeout(3500, () => socket.destroy(new Error('IPC timed out')));
  });
}

async function exercise(label, beforeRegistration) {
  const root = fs.mkdtempSync(path.join(artifacts, 'native-core-host-handoff-'));
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 16);
  const socket = `/tmp/naruto-c-${process.getuid()}-${hash}.sock`;
  const backend = `/tmp/naruto-handoff-${hash}.sock`;
  const env = {
    ...process.env, NARUTO_C_ROOT: root, NARUTO_C_PROJECT: project, NARUTO_C_ELECTRON: electron,
    NARUTO_C_FIXTURE: '1', NARUTO_C_PACKAGED: '0', NARUTO_C_UI_CHECKS: '0',
  };
  delete env.NARUTO_C_LOGIN_FIXTURE;

  const connections = new Set();
  const handoffStates = [];
  const firstPoll = Promise.withResolvers();
  const retryPoll = Promise.withResolvers();
  const closed = Promise.withResolvers();
  let polls = 0, successfulPolls = 0, hostPID, tokens, coreError, proxyError;
  let firstPollReply, closeRequested = false, closeReply, closing = false;

  async function forward(message) {
    const connection = net.createConnection(backend);
    const reply = readMessage(connection);
    connection.write(JSON.stringify(message) + '\n');
    try { return await reply; } finally { connection.destroy(); }
  }

  async function command(command, payload = {}) {
    const reply = await forward({ v: 1, role: 'center', token: tokens.center, command, payload });
    assert.equal(reply.ok, true, `${command}: ${reply.message}`);
    return reply.value;
  }

  function wait(description, predicate) {
    return waitFor(description, () => {
      if (coreError) throw coreError;
      if (proxyError) throw proxyError;
      return predicate();
    });
  }

  // Park host messages before forwarding them so Core remains free to process
  // update commands and send SIGUSR2 to the real host PID.
  const proxy = net.createServer(async front => {
    connections.add(front);
    front.once('close', () => connections.delete(front));
    try {
      const message = await readMessage(front);
      let expectNotReady = false;
      if (message.command === 'host.poll') {
        polls++;
        if (beforeRegistration && polls === 1) {
          await firstPoll.promise;
          message.payload.windowShown = false;
          expectNotReady = true;
        } else if (beforeRegistration && polls === 2) {
          await retryPoll.promise;
        }
      }
      if (message.command === 'host.updateHandoff') handoffStates.push(message.payload.state);
      if (message.command === 'host.closed') {
        assert.equal(closeRequested, false, 'host must only request one close acknowledgement');
        closeRequested = true;
        await closed.promise;
      }
      if (closing) return;
      const reply = await forward(message);
      if (expectNotReady) firstPollReply = reply;
      if (message.command === 'host.poll' && reply.ok) successfulPolls++;
      if (message.command === 'host.closed') closeReply = reply;
      front.end(JSON.stringify(reply) + '\n');
    } catch (error) {
      if (!closing) proxyError = error;
      front.destroy();
    }
  });

  const core = spawn(path.join(project, 'dist/prototype/native/core'), [], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  const coreStopped = new Promise(resolve => {
    core.once('exit', (code, signal) => {
      if (!closing) coreError = new Error(`Core exited during handoff test (${signal ?? code})`);
      resolve();
    });
    core.once('error', error => { coreError = error; resolve(); });
  });
  core.stderr.on('data', chunk => fs.appendFileSync(path.join(root, 'core-stderr.log'), chunk));

  try {
    await wait('Core socket', () => fs.existsSync(path.join(root, 'core-runtime.json')));
    fs.renameSync(socket, backend);
    proxy.listen(socket);
    await once(proxy, 'listening');
    tokens = JSON.parse(fs.readFileSync(path.join(root, 'capabilities.json'), 'utf8'));
    await command('batch.start', { requestId: randomUUID(), profileIds: ['br-1'] });
    ({ hostPID } = await command('snapshot'));
    assert.ok(hostPID > 0, 'Core must spawn an Electron host');

    if (beforeRegistration) {
      await wait('first poll before registration', () => polls === 1);
      assert.equal((await command('snapshot')).hostInstance, '');
    } else {
      await wait('registered host polling', () => successfulPolls >= 2);
      assert.ok((await command('snapshot')).hostInstance);
    }

    assert.equal((await command('update.prepare')).update.handoff.state, 'prepared');
    const requested = await command('update.quitHost');
    assert.equal(requested.update.handoff.state, 'quitting-host');
    assert.equal(requested.hostPID, hostPID);

    if (beforeRegistration) {
      firstPoll.resolve();
      await wait('retry or premature handoff after rejected poll', () => polls >= 2 || handoffStates.length || closeRequested);
      assert.equal(firstPollReply?.ok, false);
      assert.equal(firstPollReply.messageRef, 'host-window-not-ready');
      assert.deepEqual(handoffStates, [], 'handoff must wait through a rejected poll');
      assert.equal(closeRequested, false, 'host must stay open through a rejected poll');
      assert.equal((await command('snapshot')).hostInstance, '');
      retryPoll.resolve();
    }

    await wait('host.closed request', () => closeRequested);
    assert.ok(successfulPolls > 0, 'host must register before requesting close');
    // Repeat the real signal while shutdown is still waiting for its Core ACK.
    await command('update.quitHost');
    await delay(100);
    closed.resolve();
    await wait('host exit', () => !alive(hostPID));
    const snapshot = await command('snapshot');
    assert.equal(closeReply?.ok, true, closeReply?.message || 'Core must accept host.closed');
    assert.deepEqual(handoffStates.filter(state => state !== 'closed'), ['confirming', 'saving']);
    assert.equal(snapshot.update.handoff.state, 'host-exited');
    assert.equal(snapshot.update.handoff.host, 'closed');
    assert.equal(snapshot.hostPID, 0);
    console.log(`PASS ${label}`);
  } catch (error) {
    console.error(`Handoff fixture logs: ${root}`);
    throw error;
  } finally {
    closing = true;
    for (const connection of connections) connection.destroy();
    proxy.close();
    firstPoll.resolve();
    retryPoll.resolve();
    closed.resolve();
    core.kill('SIGTERM');
    await coreStopped;
    if (hostPID && alive(hostPID)) {
      try { process.kill(hostPID, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    for (const file of [socket, backend]) fs.rmSync(file, { force: true });
  }
}

fs.mkdirSync(artifacts, { recursive: true });
await exercise('SIGUSR2 before the first successful host.poll', true);
await exercise('SIGUSR2 after host registration', false);
