const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPanelServer, loadPanelConfig, resolvePublicFile, DEFAULT_CONFIG } = require('../index');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

test('loadPanelConfig falls back to defaults and merges config file', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multibot-panel-config-'));
  const configPath = path.join(tempDir, 'panel.config.json');

  assert.deepEqual(loadPanelConfig(path.join(tempDir, 'missing.json')), DEFAULT_CONFIG);

  fs.writeFileSync(configPath, JSON.stringify({
    port: 19090,
    title: 'Custom Panel'
  }), 'utf8');

  assert.deepEqual(loadPanelConfig(configPath), {
    host: DEFAULT_CONFIG.host,
    port: 19090,
    title: 'Custom Panel'
  });
});

test('createPanelServer serves static files, healthz and 404', async () => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multibot-panel-public-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>ok</title>', 'utf8');
  fs.writeFileSync(path.join(publicDir, 'app.js'), 'console.log("ok")', 'utf8');

  const server = createPanelServer({
    publicDir,
    title: 'Panel Test'
  });

  const baseUrl = await listen(server);

  try {
    const healthResponse = await fetch(`${baseUrl}/healthz`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), { ok: true, title: 'Panel Test' });

    const indexResponse = await fetch(`${baseUrl}/`);
    assert.equal(indexResponse.status, 200);
    assert.match(indexResponse.headers.get('content-type') || '', /text\/html/);
    assert.equal(indexResponse.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(indexResponse.headers.get('x-frame-options'), 'DENY');
    assert.match(indexResponse.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
    assert.match(await indexResponse.text(), /<title>ok<\/title>/);

    const scriptHead = await fetch(`${baseUrl}/app.js`, { method: 'HEAD' });
    assert.equal(scriptHead.status, 200);
    assert.match(scriptHead.headers.get('content-type') || '', /application\/javascript/);
    assert.equal(await scriptHead.text(), '');

    const missingResponse = await fetch(`${baseUrl}/missing.txt`);
    assert.equal(missingResponse.status, 404);
    assert.equal(await missingResponse.text(), 'Not Found');

    const malformedResponse = await fetch(`${baseUrl}/%E0%A4%A`);
    assert.equal(malformedResponse.status, 400);
  } finally {
    await close(server);
  }
});

test('resolvePublicFile rejects traversal into similarly named sibling directories', () => {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multibot-panel-path-'));
  const publicDir = path.join(parentDir, 'public');
  fs.mkdirSync(publicDir, { recursive: true });

  assert.equal(resolvePublicFile(publicDir, '/../public-evil/secret.txt'), null);
  assert.throws(() => resolvePublicFile(publicDir, '/%E0%A4%A'), /invalid url encoding/);
});
