'use strict';
// Shared by the launcher and its isolated prototype. No credentials in argv/logs.
const { spawn } = require('child_process');
const { URL } = require('url');
const gameHost = /^(?:s\d+-naruto(?:pt|br)?|naruto-(?:pt|br)(?:-s?\d+)?)\.oasgames\.com$/;
const authHosts = ['oasgames.com', 'narutowebgame.com', 'naruto.narutowebgame.com', 'naruto.oasgames.com', 'passport.oasgames.com', 'passport.narutowebgame.com'];
const allowedDomain = value => typeof value === 'string' && (authHosts.includes(value.replace(/^\./, '')) || gameHost.test(value.replace(/^\./, '')));

function validateHandoff(event, fixture) {
  if (!event || event.type !== 'handoff' || typeof event.url !== 'string' || event.url.length > 16384) throw new Error('invalid-handoff');
  const url = new URL(event.url);
  const local = fixture && new URL(fixture);
  const targetOK = local ? url.origin === local.origin && url.pathname === '/game'
    : url.protocol === 'https:' && !url.port && gameHost.test(url.hostname);
  if (!targetOK || url.username || url.password || !Array.isArray(event.cookies) || event.cookies.length > 256) throw new Error('invalid-target');
  const cookies = cookieDetails(event.cookies, fixture, url.hostname);
  return { url: url.href, cookies };
}

function cookieDetails(records, fixture, targetHost) {
  const local = fixture && new URL(fixture);
  if (!Array.isArray(records) || records.length > 256) throw new Error('invalid-cookie-list');
  return records.map(record => {
    if (!record || typeof record.domain !== 'string' || typeof record.name !== 'string' || typeof record.value !== 'string' ||
      !record.name || record.name.length > 256 || record.value.length > 8192 || typeof record.path !== 'string' ||
      !record.path.startsWith('/') || record.path.length > 2048 || /[\x00-\x20\x7f;]/.test(record.name) || /[\r\n\0]/.test(record.value)) throw new Error('invalid-cookie');
    const domain = record.domain.replace(/^\./, '');
    const allowed = local ? domain === '127.0.0.1' : targetHost ? authHosts.includes(domain) || domain === targetHost : allowedDomain(record.domain);
    if (!allowed || !['secure', 'httpOnly', 'hostOnly', 'session'].every(key => typeof record[key] === 'boolean') ||
      record.hostOnly !== !record.domain.startsWith('.')) throw new Error('invalid-cookie-domain');
    const cookie = { url: `${record.secure ? 'https' : 'http'}://${domain}${local ? ':' + local.port : ''}${record.path}`,
      name: record.name, value: record.value, path: record.path, secure: record.secure, httpOnly: record.httpOnly };
    if (!record.hostOnly) cookie.domain = record.domain;
    if (!record.session) {
      if (!Number.isFinite(record.expirationDate)) throw new Error('invalid-cookie-expiry');
      cookie.expirationDate = record.expirationDate;
    } else if (record.expirationDate !== undefined) throw new Error('invalid-cookie-expiry');
    if (record.sameSite !== undefined) {
      if (!['lax', 'strict', 'none'].includes(record.sameSite)) throw new Error('invalid-cookie-samesite');
      cookie.sameSite = record.sameSite === 'none' ? 'no_restriction' : record.sameSite;
    }
    return cookie;
  });
}

function startLogin(binary, { fixture, visible = true, production = false, initialCookies, onSnapshot = async () => {}, onReady = () => {}, onBlocked = () => {}, timeout = 900000 } = {}) {
  const sessionMode = initialCookies !== undefined;
  const args = ['--bridge'];
  if (visible) args.push('--visible');
  if (fixture) args.push('--fixture-url', fixture);
  if (production) args.push('--production');
  if (sessionMode) args.push('--session');
  const child = spawn(binary, args, { stdio: [sessionMode ? 'pipe' : 'ignore', 'pipe', 'ignore'] });
  child.stdout.setEncoding('utf8');
  child.stdin?.on('error', () => {});
  const send = value => { if (child.stdin?.writable) child.stdin.write(JSON.stringify(value) + '\n'); };
  const stopChild = () => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    const force = setTimeout(() => child.kill('SIGKILL'), 1500);
    child.once('close', () => { clearTimeout(force); resolve(); });
    child.stdin?.end(); child.kill('SIGTERM');
  });
  if (sessionMode) send({ type: 'seed', cookies: initialCookies });
  let stop, settled = false, buffer = '', cancellation = false, cancelTimer;
  const result = new Promise((resolve, reject) => {
    const finish = (error, value, records) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(cancelTimer);
      child.stdout.removeAllListeners('data');
      let details;
      try { if (records !== undefined) details = cookieDetails(records, fixture); }
      catch { void stopChild().then(() => reject(new Error('invalid-snapshot'))); return; }
      Promise.resolve().then(() => details === undefined ? undefined : onSnapshot(details)).then(() => {
        return stopChild().then(() => { if (error) reject(error); else resolve(value); });
      }, () => stopChild().then(() => reject(new Error('snapshot-failed'))));
    };
    stop = () => {
      if (settled || cancellation) return;
      cancellation = true;
      if (!sessionMode) { finish(new Error('cancelled')); return; }
      send({ type: 'close' });
      cancelTimer = setTimeout(() => finish(new Error('cancelled')), 4000);
    };
    const timer = setTimeout(() => finish(new Error('timeout')), timeout);
    child.on('error', () => finish(new Error('native-launch-failed')));
    child.on('close', () => finish(new Error('native-closed')));
    child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (Buffer.byteLength(buffer) > 1048576) { finish(new Error('native-response-too-large')); return; }
      let index;
      while (!settled && (index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let event;
        try { event = JSON.parse(line); } catch { finish(new Error('native-invalid-response')); return; }
        if (event.type === 'result') {
          if (event.result?.ok) onReady(); else finish(new Error('login-page-unavailable'));
        } else if (event.type === 'handoff') {
          try {
            const value = validateHandoff(event, fixture);
            if (sessionMode && !Array.isArray(event.sessionCookies)) throw new Error('missing-snapshot');
            finish(cancellation ? new Error('cancelled') : null, value, sessionMode ? event.sessionCookies : undefined);
          }
          catch { finish(new Error('invalid-handoff')); }
        } else if (event.type === 'blocked' && event.code === 'game-source') onBlocked();
        else if (event.type === 'cancelled') finish(new Error('cancelled'), undefined, sessionMode ? event.cookies : undefined);
        else if (event.type === 'error') finish(new Error('native-failed'));
      }
    });
  });
  return { result, cancel: () => stop(), focus: () => send({ type: 'focus' }), child };
}
module.exports = { validateHandoff, cookieDetails, allowedDomain, startLogin };
