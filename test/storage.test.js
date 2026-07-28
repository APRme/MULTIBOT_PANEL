const test = require('node:test');
const assert = require('node:assert/strict');
const storageApi = require('../public/storage.js');

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    }
  };
}

test('storage profile helpers sanitize and reload saved backends', () => {
  const storage = createMemoryStorage();

  storageApi.saveBackendProfiles(storage, [
    {
      id: 'backend-1',
      name: ' Local ',
      baseUrl: 'http://127.0.0.1:18080/',
      token: ' token-1 ',
      enabled: true
    },
    {
      id: '',
      name: 'invalid',
      baseUrl: 'http://example.com',
      token: 'token'
    }
  ]);

  assert.deepEqual(storageApi.loadBackendProfiles(storage), [
    {
      id: 'backend-1',
      name: 'Local',
      baseUrl: 'http://127.0.0.1:18080',
      token: 'token-1',
      enabled: true
    }
  ]);
});

test('storage helpers fall back safely on malformed JSON and clamp history', () => {
  const storage = createMemoryStorage();

  storage.setItem(storageApi.STORAGE_KEYS.backends, '{bad json');
  storage.setItem(storageApi.STORAGE_KEYS.ui, '{bad json');
  storage.setItem(storageApi.STORAGE_KEYS.commandHistory, JSON.stringify(Array.from({ length: 25 }, (_, index) => `cmd-${index}`)));

  assert.deepEqual(storageApi.loadBackendProfiles(storage), []);
  assert.deepEqual(storageApi.loadUiPrefs(storage), {
    selectedBackendId: null,
    autoScrollLogs: true,
    botFilterText: '',
    botFilterState: 'all',
    botFilterServer: '',
    logLevelFilter: 'all'
  });
  assert.equal(storageApi.loadCommandHistory(storage).length, 20);
  assert.equal(storageApi.loadCommandHistory(storage)[0], 'cmd-0');
  assert.equal(storageApi.loadCommandHistory(storage)[19], 'cmd-19');
});
