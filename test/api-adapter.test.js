const test = require('node:test');
const assert = require('node:assert/strict');
const { createApiClient, normalizeBaseUrl } = require('../public/api.js');

function createJsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type'
          ? 'application/json; charset=utf-8'
          : null;
      }
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

test('normalizeBaseUrl trims whitespace and trailing slashes', () => {
  assert.equal(normalizeBaseUrl(' http://127.0.0.1:18080/// '), 'http://127.0.0.1:18080');
});

test('api client sends auth headers and instance/command payloads', async () => {
  const calls = [];
  const apiClient = createApiClient({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/api/instances')) {
        return createJsonResponse(200, { instances: [{ id: 'server__bot' }] });
      }
      if (url.endsWith('/api/instances/server-a/bot-a')) {
        if ((init.method || 'GET') === 'PATCH') {
          return createJsonResponse(200, {
            instance: { id: 'server-a__bot-a', serverDir: 'server-a', botDir: 'bot-a' },
            affectedBotIds: ['server-a__bot-a']
          });
        }
        return createJsonResponse(200, {
          instance: { id: 'server-a__bot-a', serverDir: 'server-a', botDir: 'bot-a' }
        });
      }
      if (url.endsWith('/command')) {
        return createJsonResponse(200, {
          handled: true,
          messages: [{ mode: 'tell', message: 'ok' }]
        });
      }
      return createJsonResponse(200, { bots: [{ id: 'bot-1' }] });
    }
  });

  const profile = {
    baseUrl: 'http://127.0.0.1:18080/',
    token: 'secret-token'
  };

  const botsResponse = await apiClient.getBots(profile);
  assert.deepEqual(botsResponse, { bots: [{ id: 'bot-1' }] });

  const instancesResponse = await apiClient.getInstances(profile);
  assert.deepEqual(instancesResponse, { instances: [{ id: 'server__bot' }] });

  const instanceDetail = await apiClient.getInstance(profile, 'server-a', 'bot-a');
  assert.equal(instanceDetail.instance.id, 'server-a__bot-a');

  const instanceUpdate = await apiClient.updateInstance(profile, 'server-a', 'bot-a', {
    start: true
  });
  assert.deepEqual(instanceUpdate.affectedBotIds, ['server-a__bot-a']);

  const commandResponse = await apiClient.sendCommand(profile, 'bot-1', 'health');
  assert.equal(commandResponse.handled, true);
  const consoleInputResponse = await apiClient.sendConsoleInput(profile, 'bot-1', '/health');
  assert.equal(consoleInputResponse.handled, true);

  assert.equal(calls.length, 6);
  assert.equal(calls[0].url, 'http://127.0.0.1:18080/api/bots');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-token');
  assert.equal(calls[1].url, 'http://127.0.0.1:18080/api/instances');
  assert.equal(calls[2].url, 'http://127.0.0.1:18080/api/instances/server-a/bot-a');
  assert.equal(calls[3].url, 'http://127.0.0.1:18080/api/instances/server-a/bot-a');
  assert.equal(calls[3].init.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    start: true
  });
  assert.equal(calls[4].url, 'http://127.0.0.1:18080/api/bots/bot-1/command');
  assert.equal(calls[4].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[4].init.body), {
    command: 'health',
    source: 'http',
    sender: 'panel'
  });
  assert.equal(calls[5].url, 'http://127.0.0.1:18080/api/bots/bot-1/command');
  assert.equal(calls[5].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[5].init.body), {
    input: '/health',
    source: 'console',
    sender: 'panel'
  });
});

test('api client posts window clicks with the raw payload', async () => {
  const calls = [];
  const apiClient = createApiClient({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return createJsonResponse(200, {
        ok: true,
        click: { windowId: 0, slot: 9, action: 'left', skipped: false }
      });
    }
  });

  const profile = { baseUrl: 'http://127.0.0.1:18080', token: 'secret-token' };

  const leftClick = await apiClient.clickWindow(profile, 'bot-1', { slot: 9, action: 'left' });
  assert.equal(leftClick.click.action, 'left');
  assert.equal(calls[0].url, 'http://127.0.0.1:18080/api/bots/bot-1/window-click');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-token');
  assert.deepEqual(JSON.parse(calls[0].init.body), { slot: 9, action: 'left' });

  await apiClient.clickWindow(profile, 'bot 2', { slot: -999, action: 'left' });
  assert.equal(calls[1].url, 'http://127.0.0.1:18080/api/bots/bot%202/window-click');
  assert.deepEqual(JSON.parse(calls[1].init.body), { slot: -999, action: 'left' });

  await apiClient.clickWindow(profile, 'bot-1', {
    slot: 12,
    action: 'drag-add',
    button: 'right'
  });
  assert.deepEqual(JSON.parse(calls[2].init.body), { slot: 12, action: 'drag-add', button: 'right' });
});

test('api client normalizes auth and network errors', async () => {
  const authClient = createApiClient({
    fetchImpl: async () => createJsonResponse(401, { error: 'unauthorized' })
  });

  await assert.rejects(
    authClient.getBots({
      baseUrl: 'http://127.0.0.1:18080',
      token: 'bad-token'
    }),
    (error) => error.kind === 'auth_error' && error.status === 401
  );

  const networkClient = createApiClient({
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED');
    }
  });

  await assert.rejects(
    networkClient.getBots({
      baseUrl: 'http://127.0.0.1:18080',
      token: 'token'
    }),
    (error) => error.kind === 'network_error' && /ECONNREFUSED/.test(error.message)
  );
});
