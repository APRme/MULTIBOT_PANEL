const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidUsername,
  parseAvatarCache,
  isCacheFresh,
  isDebounced,
  createAvatarClient,
  DEFAULT_TTL_MS,
  FAILURE_TTL_MS
} = require('../public/skin.js');

function createMemoryStorage(initialText) {
  const map = new Map();
  if (initialText != null) map.set('multibot_panel.avatars.v1', String(initialText));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    dump() {
      return map.get('multibot_panel.avatars.v1');
    }
  };
}

function createFetchStub(status, body) {
  const calls = [];
  return {
    calls,
    fetchFn: async () => {
      calls.push(1);
      return new Response(body || new Uint8Array([1, 2, 3]), { status });
    }
  };
}

test('username validation matches Minecraft name rules only', () => {
  assert.equal(isValidUsername('APR_m'), true);
  assert.equal(isValidUsername('Steve'), true);
  assert.equal(isValidUsername('player@example.com'), false);
  assert.equal(isValidUsername(''), false);
  assert.equal(isValidUsername('with space'), false);
});

test('parseAvatarCache keeps only valid entries', () => {
  const text = JSON.stringify({
    APR_m: { dataUrl: 'data:image/png;base64,AAAA', fetchedAt: 1000 },
    'bad@mail.com': { dataUrl: 'data:image/png;base64,BBBB', fetchedAt: 1000 },
    Ghost: { failedAt: 500 },
    empty: {},
    notUrl: { dataUrl: 'https://example.com/x.png', fetchedAt: 1000 },
    array: [{ dataUrl: 'data:image/png;base64,CCCC' }]
  });
  const cache = parseAvatarCache(text);
  assert.deepEqual(Object.keys(cache).sort(), ['APR_m', 'Ghost']);
  assert.equal(cache.APR_m.dataUrl, 'data:image/png;base64,AAAA');
  assert.equal(cache.Ghost.failedAt, 500);

  assert.deepEqual(parseAvatarCache('not json'), {});
  assert.deepEqual(parseAvatarCache('[]'), {});
  assert.deepEqual(parseAvatarCache(null), {});
  assert.deepEqual(parseAvatarCache(''), {});
});

test('cache freshness and debounce respect time windows', () => {
  const fresh = { dataUrl: 'data:image/png;base64,A', fetchedAt: 1000 };
  assert.equal(isCacheFresh(fresh, 1000 + DEFAULT_TTL_MS - 1, DEFAULT_TTL_MS), true);
  assert.equal(isCacheFresh(fresh, 1000 + DEFAULT_TTL_MS, DEFAULT_TTL_MS), false);
  assert.equal(isCacheFresh({ failedAt: 1000 }, 2000, DEFAULT_TTL_MS), false);

  const debounced = { failedAt: 1000 };
  assert.equal(isDebounced(debounced, 1000 + FAILURE_TTL_MS - 1, FAILURE_TTL_MS), true);
  assert.equal(isDebounced(debounced, 1000 + FAILURE_TTL_MS, FAILURE_TTL_MS), false);
  assert.equal(isDebounced({ dataUrl: 'data:image/png;base64,A', fetchedAt: 1000 }, 2000, FAILURE_TTL_MS), false);
});

test('client serves cached data urls without fetching', async () => {
  const storage = createMemoryStorage(JSON.stringify({
    Steve: { dataUrl: 'data:image/png;base64,CACHED', fetchedAt: 1000 }
  }));
  const stub = createFetchStub(200);
  const client = createAvatarClient({
    storage,
    now: () => 1000 + DEFAULT_TTL_MS - 1,
    fetchFn: stub.fetchFn,
    cropFn: async () => 'data:image/png;base64,CROPPED'
  });

  assert.equal(await client.getAvatar('Steve'), 'data:image/png;base64,CACHED');
  assert.equal(stub.calls.length, 0);
});

test('client fetches and caches a cropped data url on miss', async () => {
  const storage = createMemoryStorage();
  const stub = createFetchStub(200);
  const client = createAvatarClient({
    storage,
    now: () => 5000,
    fetchFn: stub.fetchFn,
    cropFn: async () => 'data:image/png;base64,CROPPED'
  });

  assert.equal(await client.getAvatar('Steve'), 'data:image/png;base64,CROPPED');
  assert.equal(stub.calls.length, 1);

  const dumped = parseAvatarCache(storage.dump());
  assert.equal(dumped.Steve.dataUrl, 'data:image/png;base64,CROPPED');
  assert.equal(dumped.Steve.fetchedAt, 5000);
  assert.equal(dumped.Steve.failedAt, 0);

  assert.equal(await client.getAvatar('Steve'), 'data:image/png;base64,CROPPED');
  assert.equal(stub.calls.length, 1);
});

test('client debounces upstream failures', async () => {
  const storage = createMemoryStorage();
  const stub = createFetchStub(404);
  const client = createAvatarClient({
    storage,
    now: () => 5000,
    fetchFn: stub.fetchFn,
    cropFn: async () => 'data:image/png;base64,CROPPED'
  });

  assert.equal(await client.getAvatar('Ghost'), null);
  assert.equal(stub.calls.length, 1);

  assert.equal(await client.getAvatar('Ghost'), null);
  assert.equal(stub.calls.length, 1, 'second call must be suppressed by failure debounce');

  const dumped = parseAvatarCache(storage.dump());
  assert.equal(dumped.Ghost.failedAt, 5000);
});

test('client returns null on network error without throwing', async () => {
  const storage = createMemoryStorage();
  const client = createAvatarClient({
    storage,
    now: () => 5000,
    fetchFn: async () => { throw new Error('network down'); },
    cropFn: async () => 'data:image/png;base64,CROPPED'
  });

  assert.equal(await client.getAvatar('Steve'), null);
  assert.equal(parseAvatarCache(storage.dump()).Steve.failedAt, 5000);
});

test('client rejects invalid usernames without fetching', async () => {
  const stub = createFetchStub(200);
  const client = createAvatarClient({ storage: createMemoryStorage(), fetchFn: stub.fetchFn });
  assert.equal(await client.getAvatar('player@example.com'), null);
  assert.equal(stub.calls.length, 0);
});

test('client works without storage', async () => {
  const stub = createFetchStub(200);
  const client = createAvatarClient({
    storage: null,
    now: () => 5000,
    fetchFn: stub.fetchFn,
    cropFn: async () => 'data:image/png;base64,CROPPED'
  });

  assert.equal(await client.getAvatar('Steve'), 'data:image/png;base64,CROPPED');
  assert.equal(stub.calls.length, 1);
});
