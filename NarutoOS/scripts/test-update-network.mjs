// Local-only network checks for the update download path. A synthetic release
// response, a same-origin redirect and a rejected redirect are served from
// 127.0.0.1; the production source is never contacted.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
const project = path.resolve(import.meta.dirname, '..');
const artifacts = path.join(project, '.test-artifacts/update-network');
fs.rmSync(artifacts, { recursive: true, force: true });
fs.mkdirSync(artifacts, { recursive: true });
const moduleCache = path.join(project, 'dist/swift-module-cache');
fs.mkdirSync(moduleCache, { recursive: true });
const target = (process.arch === 'arm64' ? 'arm64' : 'x86_64') + '-apple-macos15.0';
const binary = path.join(artifacts, 'update-tests');
execFileSync('/usr/bin/xcrun', ['swiftc', '-target', target, '-O', '-module-cache-path', moduleCache,
  'src/prototype/native/Transport.swift', 'src/prototype/native/I18n.swift', 'src/prototype/native/Update.swift', 'tests/update-tests.swift',
  '-o', binary], { stdio: 'inherit', cwd: project });
// A real ZIP so extraction metadata (size, digest) is exercised for real.
const source = path.join(artifacts, 'source');
fs.mkdirSync(source, { recursive: true });
fs.writeFileSync(path.join(source, 'payload.txt'), 'synthetic update payload\n'.repeat(2000));
const zip = path.join(artifacts, 'package.zip');
execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', source, zip]);
const zipBytes = fs.readFileSync(zip);
const zipSize = zipBytes.length;
const zipDigest = crypto.createHash('sha256').update(zipBytes).digest('hex');
const assetName = 'NarutoOS-9.9.9-macOS-AppleSilicon.zip';
const release = (overrides = {}) => JSON.stringify({
  id: 1, tag_name: 'v9.9.9', draft: false, prerelease: false, body: 'synthetic notes',
  assets: [{
    id: 2, name: assetName, size: zipSize, state: 'uploaded', digest: 'sha256:' + zipDigest,
    browser_download_url: 'http://127.0.0.1:PORT/download/' + assetName
  }],
  ...overrides
});
const results = [];
function check(name, ok, detail = '') {
  if (!ok) throw new Error(name + (detail ? ': ' + detail : ''));
  results.push(name);
  console.log('PASS ' + name);
}
let port = 0;
const server = http.createServer((request, response) => {
  const url = request.url || '';
  fs.appendFileSync(path.join(artifacts, 'requests.log'), url + '\n');
  const send = (status, body, headers = {}) => { response.writeHead(status, { 'content-type': 'application/json', ...headers }); response.end(body); };
  if (url === '/latest') { const body = release().split('127.0.0.1:PORT').join('127.0.0.1:' + port); if (process.env.DEBUG_UPDATE_NET) console.log('BODY ' + body.slice(0, 300)); return send(200, body); }
  if (url === '/latest-bad-digest') return send(200, release({ assets: [{ id: 2, name: assetName, size: zipSize, state: 'uploaded', digest: 'sha256:' + 'a'.repeat(64), browser_download_url: 'http://127.0.0.1:PORT/download/' + assetName }] }).split('127.0.0.1:PORT').join('127.0.0.1:' + port));
  if (url === '/latest-bad-size') return send(200, release({ assets: [{ id: 2, name: assetName, size: zipSize + 1, state: 'uploaded', digest: 'sha256:' + zipDigest, browser_download_url: 'http://127.0.0.1:PORT/download/' + assetName }] }).split('127.0.0.1:PORT').join('127.0.0.1:' + port));
  if (url === '/latest-no-digest') return send(200, release({ assets: [{ id: 2, name: assetName, size: zipSize, state: 'uploaded', browser_download_url: 'http://127.0.0.1:PORT/download/' + assetName }] }).split('127.0.0.1:PORT').join('127.0.0.1:' + port));
  if (url === '/latest-no-asset') return send(200, release({ assets: [{ id: 2, name: 'NarutoOS-9.9.9-macOS.zip', size: zipSize, state: 'uploaded', digest: 'sha256:' + zipDigest, browser_download_url: 'http://127.0.0.1:PORT/download/NarutoOS-9.9.9-macOS.zip' }] }).split('127.0.0.1:PORT').join('127.0.0.1:' + port));
  if (url === '/latest-evil-redirect') return send(200, release({ assets: [{ id: 2, name: assetName, size: zipSize, state: 'uploaded', digest: 'sha256:' + zipDigest, browser_download_url: 'http://127.0.0.1:PORT/download-evil/' + assetName }] }).split('127.0.0.1:PORT').join('127.0.0.1:' + port));
  if (url === '/latest-hop') { response.writeHead(302, { location: 'http://127.0.0.1:' + port + '/latest' }); return response.end(); }
  if (url === '/latest-meta-redirect') { response.writeHead(302, { location: 'http://127.0.0.2:' + port + '/latest' }); return response.end(); }
  if (url.startsWith('/download/')) {
    response.writeHead(302, { location: 'http://127.0.0.1:' + port + '/objects/pkg' });
    return response.end();
  }
  if (url.startsWith('/download-evil/')) {
    response.writeHead(302, { location: 'http://127.0.0.2:' + port + '/objects/pkg' });
    return response.end();
  }
  if (url === '/objects/pkg') { response.writeHead(200, { 'content-type': 'application/zip', 'content-length': String(zipSize) }); return response.end(zipBytes); }
  send(404, '{}');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
port = server.address().port;
function runCheck(name, endpoint, expect) {
  return new Promise((resolve, reject) => {
    const directory = path.join(artifacts, name);
    fs.mkdirSync(directory, { recursive: true });
    const child = spawn(binary, ['--check', 'http://127.0.0.1:' + port + endpoint, directory], { env: { ...process.env, NARUTO_C_MESSAGES: path.join(project, 'src/shared/messages.json') } });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('close', () => {
      try {
        const line = output.trim().split('\n').filter(row => row.startsWith('{')).pop() || '{}';
        const result = JSON.parse(line);
        check(name + ' -> ' + (result.ok ? 'ok' : result.error), result.ok === expect.ok && (!expect.ok || (result.version === '9.9.9' && result.bytes === zipSize && result.digest === zipDigest)) && (!expect.error || result.error === expect.error), JSON.stringify(result));
        resolve();
      } catch (error) { reject(error); }
    });
  });
}
try {
  await runCheck('valid-release-downloads-and-verifies', '/latest', { ok: true });
  await runCheck('digest-mismatch-is-rejected', '/latest-bad-digest', { ok: false, error: 'update.asset_digest_mismatch' });
  await runCheck('size-mismatch-is-rejected', '/latest-bad-size', { ok: false, error: 'update.asset_size_mismatch' });
  await runCheck('missing-digest-is-rejected', '/latest-no-digest', { ok: false, error: 'update.asset_digest_missing' });
  await runCheck('missing-asset-is-rejected', '/latest-no-asset', { ok: false, error: 'update.asset_missing' });
  await runCheck('cross-host-redirect-is-rejected', '/latest-evil-redirect', { ok: false, error: 'update.redirect_rejected' });
  await runCheck('same-host-metadata-redirect-is-followed', '/latest-hop', { ok: true });
  await runCheck('cross-host-metadata-redirect-is-rejected', '/latest-meta-redirect', { ok: false, error: 'update.redirect_rejected' });
  fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({ ok: true, results, zipSize, zipDigest }, null, 2));
  console.log('更新下载链路检查通过：' + results.length + ' 项');
} finally {
  server.close();
}