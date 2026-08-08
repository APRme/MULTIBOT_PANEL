const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPanelServer, loadPanelConfig, resolvePublicFile, DEFAULT_CONFIG } = require('../index');
const { isValidUsername, normalizeSkinUrl, decodeSkinTextures, createAvatarService, ERROR_CODES } = require('../lib/avatar-service');

const FAKE_UUID = '069a79f444e94726a5befca90e38aaf5';
const FAKE_SKIN_URL = 'https://textures.minecraft.net/texture/fake123';
const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

function createStubFetcher(overrides = {}) {
  const lookupStatus = overrides.lookupStatus == null ? 200 : overrides.lookupStatus;
  const profileStatus = overrides.profileStatus == null ? 200 : overrides.profileStatus;
  const textureStatus = overrides.textureStatus == null ? 200 : overrides.textureStatus;
  const calls = [];

  const texturePayload = Buffer.from(JSON.stringify({
    textures: { SKIN: { url: 'http://textures.minecraft.net/texture/fake123' } }
  })).toString('base64');

  return {
    calls,
    async fetcher(url) {
      calls.push(url);
      if (url.startsWith('https://api.minecraftservices.com/minecraft/profile/lookup/name/')) {
        if (lookupStatus === 404) return new Response('{}', { status: 404 });
        if (lookupStatus !== 200) return new Response('{}', { status: lookupStatus });
        return new Response(JSON.stringify({ id: FAKE_UUID, name: 'Steve' }), { status: 200 });
      }
      if (url.startsWith('https://sessionserver.mojang.com/session/minecraft/profile/')) {
        if (profileStatus !== 200) return new Response('{}', { status: profileStatus });
        return new Response(JSON.stringify({
          id: FAKE_UUID,
          name: 'Steve',
          properties: [{ name: 'textures', value: texturePayload }]
        }), { status: 200 });
      }
      if (url.startsWith('https://textures.minecraft.net/')) {
        if (textureStatus !== 200) return new Response('oops', { status: textureStatus });
        return new Response(FAKE_PNG, { status: 200, headers: { 'content-type': 'image/png' } });
      }
      return new Response('{}', { status: 404 });
    }
  };
}

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

test('avatar service resolves username to skin png via minecraftservices and caches', async () => {
  const stub = createStubFetcher();
  const service = createAvatarService({ fetcher: stub.fetcher });

  const first = await service.getSkinPng('Steve');
  assert.equal(Buffer.compare(first.bytes, FAKE_PNG), 0);
  assert.equal(first.contentType, 'image/png');
  assert.equal(stub.calls.length, 3);

  const second = await service.getSkinPng('Steve');
  assert.equal(Buffer.compare(second.bytes, FAKE_PNG), 0);
  assert.equal(stub.calls.length, 3, 'second call must hit the in-memory cache');

  const stats = service.getStats();
  assert.equal(stats.skinUrlEntries, 1);
  assert.equal(stats.skinBytesEntries, 1);
});

test('avatar service maps upstream errors and applies failure debounce', async () => {
  const missingStub = createStubFetcher({ lookupStatus: 404 });
  const missingService = createAvatarService({ fetcher: missingStub.fetcher });
  await assert.rejects(missingService.getSkinPng('Ghost'), (error) => error.code === ERROR_CODES.NOT_FOUND);
  await assert.rejects(missingService.getSkinPng('Ghost'), (error) => error.code === ERROR_CODES.NOT_FOUND);
  assert.equal(missingStub.calls.length, 1, 'failed lookups must not hit upstream again during debounce');

  const limitedStub = createStubFetcher({ lookupStatus: 429 });
  const limitedService = createAvatarService({ fetcher: limitedStub.fetcher });
  await assert.rejects(limitedService.getSkinPng('Steve'), (error) => error.code === ERROR_CODES.RATE_LIMITED);

  const brokenStub = createStubFetcher({ textureStatus: 502 });
  const brokenService = createAvatarService({ fetcher: brokenStub.fetcher });
  await assert.rejects(brokenService.getSkinPng('Steve'), (error) => error.code === ERROR_CODES.UPSTREAM_ERROR);
});

test('avatar service rejects invalid usernames', async () => {
  const service = createAvatarService({ fetcher: async () => new Response('{}', { status: 404 }) });
  await assert.rejects(service.getSkinPng('player@example.com'), (error) => error.code === ERROR_CODES.INVALID_USERNAME);
  await assert.rejects(service.getSkinPng(''), (error) => error.code === ERROR_CODES.INVALID_USERNAME);
});

test('avatar endpoint serves proxied skin png bytes with caching headers', async () => {
  const stub = createStubFetcher();
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multibot-panel-avatar-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>ok</title>', 'utf8');

  const server = createPanelServer({ publicDir, title: 'Panel Test', fetcher: stub.fetcher });
  const baseUrl = await listen(server);

  try {
    const first = await fetch(`${baseUrl}/avatar/Steve`);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('content-type'), 'image/png');
    assert.equal(first.headers.get('cache-control'), 'public, max-age=86400');
    assert.deepEqual(Buffer.from(await first.arrayBuffer()), FAKE_PNG);
    assert.equal(stub.calls.length, 3);

    const second = await fetch(`${baseUrl}/avatar/Steve`);
    assert.equal(second.status, 200);
    assert.equal(stub.calls.length, 3, 'avatar endpoint must reuse the in-process cache');

    const head = await fetch(`${baseUrl}/avatar/Steve`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  } finally {
    await close(server);
  }
});

test('avatar endpoint maps errors to http status codes', async () => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multibot-panel-avatar-errors-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>ok</title>', 'utf8');

  const cases = [
    { stub: createStubFetcher({ lookupStatus: 404 }), path: '/avatar/Ghost', expected: 404 },
    { stub: createStubFetcher({ lookupStatus: 429 }), path: '/avatar/Steve', expected: 429 },
    { stub: createStubFetcher({ textureStatus: 500 }), path: '/avatar/Steve', expected: 502 }
  ];

  for (const item of cases) {
    const server = createPanelServer({ publicDir, title: 'Panel Test', fetcher: item.stub.fetcher });
    const baseUrl = await listen(server);
    try {
      const response = await fetch(`${baseUrl}${item.path}`);
      assert.equal(response.status, item.expected);
      const body = await response.json();
      assert.equal(typeof body.error, 'string');
    } finally {
      await close(server);
    }
  }

  const server = createPanelServer({ publicDir, title: 'Panel Test', fetcher: async () => new Response('{}', { status: 404 }) });
  const baseUrl = await listen(server);
  try {
    const invalid = await fetch(`${baseUrl}/avatar/player%40example.com`);
    assert.equal(invalid.status, 400);
  } finally {
    await close(server);
  }
});

test('avatar clear-cache endpoint resets the in-process cache', async () => {
  const stub = createStubFetcher();
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multibot-panel-avatar-clear-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>ok</title>', 'utf8');

  const server = createPanelServer({ publicDir, title: 'Panel Test', fetcher: stub.fetcher });
  const baseUrl = await listen(server);

  try {
    await fetch(`${baseUrl}/avatar/Steve`);
    assert.equal(stub.calls.length, 3);
    await fetch(`${baseUrl}/avatar/Steve`);
    assert.equal(stub.calls.length, 3, 'second fetch must hit the in-process cache');

    const clearResponse = await fetch(`${baseUrl}/avatar/clear-cache`, { method: 'POST' });
    assert.equal(clearResponse.status, 200);
    assert.deepEqual(await clearResponse.json(), { ok: true });

    await fetch(`${baseUrl}/avatar/Steve`);
    assert.equal(stub.calls.length, 6, 'after clearing, the next fetch must hit upstream again');
  } finally {
    await close(server);
  }
});

test('avatar helper functions parse textures and normalize urls', () => {
  assert.equal(isValidUsername('APR_m'), true);
  assert.equal(isValidUsername('player@example.com'), false);
  assert.equal(isValidUsername(''), false);
  assert.equal(normalizeSkinUrl('http://textures.minecraft.net/texture/abc'), 'https://textures.minecraft.net/texture/abc');
  assert.equal(normalizeSkinUrl('https://textures.minecraft.net/texture/abc'), 'https://textures.minecraft.net/texture/abc');
  assert.equal(normalizeSkinUrl(''), '');

  const payload = Buffer.from(JSON.stringify({
    textures: { SKIN: { url: 'http://textures.minecraft.net/texture/abc' } }
  })).toString('base64');
  assert.equal(decodeSkinTextures(payload), 'https://textures.minecraft.net/texture/abc');
  assert.equal(decodeSkinTextures('not-json'), '');
  assert.equal(decodeSkinTextures(''), '');
  assert.equal(decodeSkinTextures('e30='), '');
  assert.equal(decodeSkinTextures(null), '');
});

test('content security policy allows data and blob images for avatars', async () => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multibot-panel-csp-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>ok</title>', 'utf8');

  const server = createPanelServer({ publicDir, title: 'Panel Test' });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/`);
    const csp = response.headers.get('content-security-policy') || '';
    assert.match(csp, /img-src 'self' data: blob:/);
    assert.match(csp, /style-src 'self' 'unsafe-inline'/);
    assert.match(csp, /default-src 'self'/);
  } finally {
    await close(server);
  }
});
