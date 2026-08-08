const test = require('node:test');
const assert = require('node:assert/strict');
const { createInitialState, reduceState } = require('../public/state.js');

test('createInitialState restores backend selection and ui preferences', () => {
  const state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true },
      { id: 'backend-2', name: 'Two', baseUrl: 'http://b', token: 'b', enabled: false }
    ],
    ui: {
      selectedBackendId: 'backend-2',
      autoScrollLogs: false,
      botFilterText: 'nit',
      botFilterState: 'running',
      botFilterServer: 'server-b',
      logLevelFilter: 'warn'
    },
    commandHistory: ['health']
  });

  assert.equal(state.backends.selectedBackendId, 'backend-2');
  assert.equal(state.ui.autoScrollLogs, false);
  assert.equal(state.ui.botFilterText, 'nit');
  assert.equal(state.ui.botFilterServer, 'server-b');
  assert.deepEqual(state.ui.commandHistory, ['health']);
});

test('state reducer keeps bot selection and appends logs with unseen count', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });

  state = reduceState(state, {
    type: 'SET_BACKEND_BOTS',
    backendId: 'backend-1',
    bots: [
      { id: 'bot-1', username: 'Nitager', state: 'running' },
      { id: 'bot-2', username: 'APR_me', state: 'idle' }
    ],
    lastSyncAt: '2026-01-01T00:00:00.000Z'
  });

  assert.equal(state.backends.byId['backend-1'].selectedBotId, 'bot-1');

  state = reduceState(state, {
    type: 'APPEND_BOT_LOG',
    backendId: 'backend-1',
    botId: 'bot-2',
    log: { botId: 'bot-2', message: 'hello' }
  });

  assert.equal(state.backends.byId['backend-1'].bots.byId['bot-2'].logs.length, 1);
  assert.equal(state.backends.byId['backend-1'].bots.byId['bot-2'].unseenLogCount, 1);

  state = reduceState(state, {
    type: 'SET_SELECTED_BOT',
    backendId: 'backend-1',
    botId: 'bot-2'
  });

  assert.equal(state.backends.byId['backend-1'].bots.byId['bot-2'].unseenLogCount, 0);
});

test('state reducer de-duplicates command history and caps it to 20 items', () => {
  let state = createInitialState();

  for (let index = 0; index < 25; index += 1) {
    state = reduceState(state, {
      type: 'ADD_COMMAND_HISTORY',
      command: `cmd-${index}`
    });
  }

  state = reduceState(state, {
    type: 'ADD_COMMAND_HISTORY',
    command: 'cmd-10'
  });

  assert.equal(state.ui.commandHistory.length, 20);
  assert.equal(state.ui.commandHistory[0], 'cmd-10');
  assert.equal(state.ui.commandHistory.filter((item) => item === 'cmd-10').length, 1);
});

test('state reducer preserves SSE logs when stale bot details arrive later', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });

  state = reduceState(state, {
    type: 'SET_BACKEND_BOTS',
    backendId: 'backend-1',
    bots: [
      { id: 'bot-1', username: 'APR_m', state: 'waiting_restart' }
    ],
    lastSyncAt: '2026-01-01T00:00:00.000Z'
  });

  state = reduceState(state, {
    type: 'APPEND_BOT_LOG',
    backendId: 'backend-1',
    botId: 'bot-1',
    log: {
      botId: 'bot-1',
      timestamp: '2026-04-24T13:10:31.000Z',
      level: 'warn',
      message: '[BOT] scheduled restart reason=invalid_session_retry delayMs=1000 detail=error: ForbiddenOperationException'
    }
  });

  state = reduceState(state, {
    type: 'SET_BOT_DETAILS',
    backendId: 'backend-1',
    bot: {
      id: 'bot-1',
      username: 'APR_m',
      state: 'waiting_restart',
      logs: [
        {
          botId: 'bot-1',
          timestamp: '2026-04-24T13:10:30.000Z',
          level: 'warn',
          message: '[BOT] end'
        }
      ]
    },
    loadedAt: '2026-04-24T13:10:32.000Z'
  });

  const logs = state.backends.byId['backend-1'].bots.byId['bot-1'].logs;
  assert.equal(logs.length, 2);
  assert.equal(
    logs[1].message,
    '[BOT] scheduled restart reason=invalid_session_retry delayMs=1000 detail=error: ForbiddenOperationException'
  );
});

test('state reducer de-duplicates duplicate bot logs from details and SSE', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });

  const duplicatedLog = {
    botId: 'bot-1',
    timestamp: '2026-04-24T13:10:31.000Z',
    level: 'warn',
    message: '[BOT] scheduled restart reason=invalid_session_retry delayMs=1000 detail=error: ForbiddenOperationException'
  };

  state = reduceState(state, {
    type: 'SET_BOT_DETAILS',
    backendId: 'backend-1',
    bot: {
      id: 'bot-1',
      username: 'APR_m',
      state: 'waiting_restart',
      logs: [duplicatedLog]
    },
    loadedAt: '2026-04-24T13:10:32.000Z'
  });

  state = reduceState(state, {
    type: 'APPEND_BOT_LOG',
    backendId: 'backend-1',
    botId: 'bot-1',
    log: duplicatedLog
  });

  const logs = state.backends.byId['backend-1'].bots.byId['bot-1'].logs;
  assert.equal(logs.length, 1);
  assert.equal(logs[0].message, duplicatedLog.message);
});

test('state reducer appends historical bot logs without increasing unseen count', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });

  state = reduceState(state, {
    type: 'SET_BACKEND_BOTS',
    backendId: 'backend-1',
    bots: [
      { id: 'bot-1', username: 'APR_m', state: 'starting' },
      { id: 'bot-2', username: 'Nitager', state: 'online' }
    ],
    lastSyncAt: '2026-01-01T00:00:00.000Z'
  });

  state = reduceState(state, {
    type: 'APPEND_BOT_LOG',
    backendId: 'backend-1',
    botId: 'bot-2',
    log: {
      botId: 'bot-2',
      timestamp: '2026-04-24T13:10:31.000Z',
      level: 'error',
      message: '[BOT] startup timeout host=example.org port=25565 afterMs=30000'
    },
    historical: true
  });

  const bot = state.backends.byId['backend-1'].bots.byId['bot-2'];
  assert.equal(bot.logs.length, 1);
  assert.equal(bot.unseenLogCount, 0);
});

test('state reducer skips notifications when bot summaries are unchanged', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });

  const bots = [
    {
      id: 'bot-1',
      username: 'Alpha',
      state: 'online',
      host: 'a.example',
      port: 25565,
      lock: { locked: true, owner: 'owner-x' }
    }
  ];

  state = reduceState(state, {
    type: 'SET_BACKEND_BOTS',
    backendId: 'backend-1',
    bots
  });
  const before = state;

  const after = reduceState(state, {
    type: 'SET_BACKEND_BOTS',
    backendId: 'backend-1',
    bots: [{
      ...bots[0],
      lock: { owner: 'owner-x', locked: true }
    }],
    lastSyncAt: '2026-08-02T00:00:00.000Z'
  });

  assert.equal(after, before);
});

test('state reducer notifies when a bot summary field changes', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });

  state = reduceState(state, {
    type: 'SET_BACKEND_BOTS',
    backendId: 'backend-1',
    bots: [{ id: 'bot-1', state: 'online' }]
  });
  const before = state;

  const after = reduceState(state, {
    type: 'SET_BACKEND_BOTS',
    backendId: 'backend-1',
    bots: [{ id: 'bot-1', state: 'stopped' }]
  });

  assert.notEqual(after, before);
  assert.equal(after.backends.byId['backend-1'].bots.byId['bot-1'].state, 'stopped');
});

test('state reducer skips notifications when bot details are unchanged', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });

  const log = {
    botId: 'bot-1',
    timestamp: '2026-08-02T00:00:00.000Z',
    level: 'info',
    message: 'spawned'
  };

  state = reduceState(state, {
    type: 'SET_BOT_DETAILS',
    backendId: 'backend-1',
    bot: {
      id: 'bot-1',
      state: 'online',
      logs: [log]
    },
    loadedAt: '2026-08-02T00:00:01.000Z'
  });
  const before = state;

  const after = reduceState(state, {
    type: 'SET_BOT_DETAILS',
    backendId: 'backend-1',
    bot: {
      id: 'bot-1',
      state: 'online',
      logs: [log]
    },
    loadedAt: '2026-08-02T00:00:02.000Z'
  });

  assert.equal(after, before);
});

test('state reducer skips notifications for unchanged bot status events', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });

  state = reduceState(state, {
    type: 'UPSERT_BOT_SUMMARY',
    backendId: 'backend-1',
    bot: { id: 'bot-1', state: 'running' }
  });
  const before = state;

  const after = reduceState(state, {
    type: 'UPSERT_BOT_SUMMARY',
    backendId: 'backend-1',
    bot: { id: 'bot-1', state: 'running' }
  });

  assert.equal(after, before);
});

test('state reducer skips notifications for duplicate log events', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });

  const log = {
    botId: 'bot-1',
    timestamp: '2026-08-02T00:00:00.000Z',
    level: 'info',
    message: 'hello'
  };

  state = reduceState(state, {
    type: 'APPEND_BOT_LOG',
    backendId: 'backend-1',
    botId: 'bot-1',
    log
  });
  const before = state;

  const after = reduceState(state, {
    type: 'APPEND_BOT_LOG',
    backendId: 'backend-1',
    botId: 'bot-1',
    log
  });

  assert.equal(after, before);
});

test('state reducer skips notifications for identical connection state updates', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });

  state = reduceState(state, {
    type: 'SET_BACKEND_CONNECTION_STATE',
    backendId: 'backend-1',
    connectionState: 'online',
    sseConnected: false,
    lastError: null
  });
  const before = state;

  const after = reduceState(state, {
    type: 'SET_BACKEND_CONNECTION_STATE',
    backendId: 'backend-1',
    connectionState: 'online',
    sseConnected: false,
    lastError: null
  });

  assert.equal(after, before);
});

test('state reducer merges and sorts bot logs by timestamp', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });

  state = reduceState(state, {
    type: 'APPEND_BOT_LOG',
    backendId: 'backend-1',
    botId: 'bot-1',
    log: {
      botId: 'bot-1',
      timestamp: '2026-08-02T00:00:03.000Z',
      level: 'info',
      message: 'later'
    }
  });

  state = reduceState(state, {
    type: 'SET_BOT_DETAILS',
    backendId: 'backend-1',
    bot: {
      id: 'bot-1',
      state: 'online',
      logs: [
        {
          botId: 'bot-1',
          timestamp: '2026-08-02T00:00:01.000Z',
          level: 'info',
          message: 'first'
        },
        {
          botId: 'bot-1',
          timestamp: '2026-08-02T00:00:02.000Z',
          level: 'info',
          message: 'second'
        }
      ]
    },
    loadedAt: '2026-08-02T00:00:04.000Z'
  });

  const logs = state.backends.byId['backend-1'].bots.byId['bot-1'].logs;
  assert.deepEqual(logs.map((entry) => entry.message), ['first', 'second', 'later']);
});

test('state reducer sorts late-arriving log events by timestamp', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });

  state = reduceState(state, {
    type: 'APPEND_BOT_LOG',
    backendId: 'backend-1',
    botId: 'bot-1',
    log: {
      botId: 'bot-1',
      timestamp: '2026-08-02T00:00:03.000Z',
      level: 'info',
      message: 'newer'
    }
  });
  state = reduceState(state, {
    type: 'APPEND_BOT_LOG',
    backendId: 'backend-1',
    botId: 'bot-1',
    log: {
      botId: 'bot-1',
      timestamp: '2026-08-02T00:00:01.000Z',
      level: 'info',
      message: 'older'
    }
  });

  const logs = state.backends.byId['backend-1'].bots.byId['bot-1'].logs;
  assert.deepEqual(logs.map((entry) => entry.message), ['older', 'newer']);
});

test('state reducer merges bootstrap history in timestamp order without unseen count', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });

  state = reduceState(state, {
    type: 'APPEND_BOT_LOG',
    backendId: 'backend-1',
    botId: 'bot-1',
    log: {
      botId: 'bot-1',
      timestamp: '2026-08-02T00:00:03.000Z',
      level: 'info',
      message: 'new'
    }
  });
  const beforeUnseen = state.backends.byId['backend-1'].bots.byId['bot-1'].unseenLogCount;

  state = reduceState(state, {
    type: 'MERGE_BOT_LOGS',
    backendId: 'backend-1',
    botId: 'bot-1',
    logs: [
      {
        botId: 'bot-1',
        timestamp: '2026-08-02T00:00:01.000Z',
        level: 'info',
        message: 'old-a'
      },
      {
        botId: 'bot-1',
        timestamp: '2026-08-02T00:00:02.000Z',
        level: 'info',
        message: 'old-b'
      }
    ],
    historical: true
  });

  const bot = state.backends.byId['backend-1'].bots.byId['bot-1'];
  assert.deepEqual(bot.logs.map((entry) => entry.message), ['old-a', 'old-b', 'new']);
  assert.equal(bot.unseenLogCount, beforeUnseen);
});

test('state reducer skips notifications when merged logs are unchanged', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });

  const log = {
    botId: 'bot-1',
    timestamp: '2026-08-02T00:00:01.000Z',
    level: 'info',
    message: 'hello'
  };

  state = reduceState(state, {
    type: 'MERGE_BOT_LOGS',
    backendId: 'backend-1',
    botId: 'bot-1',
    logs: [log],
    historical: true
  });
  const before = state;

  const after = reduceState(state, {
    type: 'MERGE_BOT_LOGS',
    backendId: 'backend-1',
    botId: 'bot-1',
    logs: [log],
    historical: true
  });

  assert.equal(after, before);
});

test('state reducer keeps distinct same-key logs beyond existing occurrences', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });

  state = reduceState(state, {
    type: 'APPEND_BOT_LOG',
    backendId: 'backend-1',
    botId: 'bot-1',
    log: {
      botId: 'bot-1',
      timestamp: '2026-08-02T00:00:01.000Z',
      level: 'info',
      message: 'same'
    }
  });
  state = reduceState(state, {
    type: 'MERGE_BOT_LOGS',
    backendId: 'backend-1',
    botId: 'bot-1',
    logs: [
      {
        botId: 'bot-1',
        timestamp: '2026-08-02T00:00:01.000Z',
        level: 'info',
        message: 'same'
      },
      {
        botId: 'bot-1',
        timestamp: '2026-08-02T00:00:01.000Z',
        level: 'info',
        message: 'same'
      }
    ],
    historical: true
  });

  const logs = state.backends.byId['backend-1'].bots.byId['bot-1'].logs;
  assert.equal(logs.length, 2);
});

test('SET_BOT_INVENTORY stores window with slots indexed by slot number', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });
  state = reduceState(state, {
    type: 'SET_BACKEND_BOTS',
    backendId: 'backend-1',
    bots: [{ id: 'bot-1', username: 'Nitager', state: 'running' }]
  });

  state = reduceState(state, {
    type: 'SET_BOT_INVENTORY',
    backendId: 'backend-1',
    botId: 'bot-1',
    window: {
      id: 3,
      name: 'chest',
      supported: true,
      inventoryStart: 27,
      inventoryEnd: 54,
      slots: [
        { slot: 2, name: 'minecraft:oak_planks', displayName: '橡木木板', count: 64, metadata: 0, durabilityUsed: null, maxDurability: null },
        { slot: 10, name: 'minecraft:dirt', displayName: '泥土', count: 32, metadata: 0, durabilityUsed: null, maxDurability: null }
      ]
    }
  });

  const inventory = state.backends.byId['backend-1'].bots.byId['bot-1'].inventory;
  assert.equal(inventory.name, 'chest');
  assert.equal(inventory.supported, true);
  assert.equal(inventory.slots['2'].name, 'minecraft:oak_planks');
  assert.equal(inventory.slots['10'].count, 32);
  assert.equal(Object.keys(inventory.slots).length, 2);
});

test('SET_BOT_INVENTORY with null window clears inventory', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });
  state = reduceState(state, {
    type: 'SET_BACKEND_BOTS',
    backendId: 'backend-1',
    bots: [{ id: 'bot-1', username: 'Nitager', state: 'running' }]
  });
  state = reduceState(state, {
    type: 'SET_BOT_INVENTORY',
    backendId: 'backend-1',
    botId: 'bot-1',
    window: { id: 3, name: 'chest', supported: true, inventoryStart: 27, inventoryEnd: 54, slots: [{ slot: 0, name: 'minecraft:stone', displayName: '石头', count: 1, metadata: 0 }] }
  });
  assert.ok(state.backends.byId['backend-1'].bots.byId['bot-1'].inventory);

  state = reduceState(state, {
    type: 'SET_BOT_INVENTORY',
    backendId: 'backend-1',
    botId: 'bot-1',
    window: null
  });
  assert.equal(state.backends.byId['backend-1'].bots.byId['bot-1'].inventory, null);
});

test('PATCH_BOT_INVENTORY merges slot updates and clears emptied slots', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });
  state = reduceState(state, {
    type: 'SET_BACKEND_BOTS',
    backendId: 'backend-1',
    bots: [{ id: 'bot-1', username: 'Nitager', state: 'running' }]
  });
  state = reduceState(state, {
    type: 'SET_BOT_INVENTORY',
    backendId: 'backend-1',
    botId: 'bot-1',
    window: {
      id: 7,
      name: 'chest',
      supported: true,
      inventoryStart: 27,
      inventoryEnd: 54,
      slots: [
        { slot: 2, name: 'minecraft:oak_planks', displayName: '橡木木板', count: 64, metadata: 0 },
        { slot: 5, name: 'minecraft:dirt', displayName: '泥土', count: 10, metadata: 0 }
      ]
    }
  });

  state = reduceState(state, {
    type: 'PATCH_BOT_INVENTORY',
    backendId: 'backend-1',
    botId: 'bot-1',
    windowId: 7,
    slots: {
      2: { slot: 2, name: 'minecraft:oak_planks', displayName: '橡木木板', count: 63, metadata: 0 },
      5: null,
      9: { slot: 9, name: 'minecraft:cobblestone', displayName: '圆石', count: 1, metadata: 0 }
    }
  });

  const inventory = state.backends.byId['backend-1'].bots.byId['bot-1'].inventory;
  assert.equal(inventory.slots['2'].count, 63);
  assert.equal(inventory.slots['5'], undefined);
  assert.equal(inventory.slots['9'].name, 'minecraft:cobblestone');
  assert.equal(Object.keys(inventory.slots).length, 2);
});

test('PATCH_BOT_INVENTORY is ignored for stale window ids and missing snapshots', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });
  state = reduceState(state, {
    type: 'SET_BACKEND_BOTS',
    backendId: 'backend-1',
    bots: [{ id: 'bot-1', username: 'Nitager', state: 'running' }]
  });

  // 没有全量快照时，patch 直接忽略（等待 window 事件）
  const before = state;
  state = reduceState(state, {
    type: 'PATCH_BOT_INVENTORY',
    backendId: 'backend-1',
    botId: 'bot-1',
    windowId: 7,
    slots: { 2: { slot: 2, name: 'minecraft:stone', displayName: '石头', count: 1, metadata: 0 } }
  });
  assert.equal(state.backends.byId['backend-1'].bots.byId['bot-1'].inventory, undefined);

  state = reduceState(state, {
    type: 'SET_BOT_INVENTORY',
    backendId: 'backend-1',
    botId: 'bot-1',
    window: { id: 7, name: 'chest', supported: true, inventoryStart: 27, inventoryEnd: 54, slots: [] }
  });

  // 窗口 id 不匹配的 patch 忽略
  const snapshot = state.backends.byId['backend-1'].bots.byId['bot-1'].inventory;
  state = reduceState(state, {
    type: 'PATCH_BOT_INVENTORY',
    backendId: 'backend-1',
    botId: 'bot-1',
    windowId: 99,
    slots: { 2: { slot: 2, name: 'minecraft:stone', displayName: '石头', count: 1, metadata: 0 } }
  });
  assert.deepEqual(state.backends.byId['backend-1'].bots.byId['bot-1'].inventory, snapshot);
});

test('inventory survives backend bot list refreshes', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });
  state = reduceState(state, {
    type: 'SET_BACKEND_BOTS',
    backendId: 'backend-1',
    bots: [{ id: 'bot-1', username: 'Nitager', state: 'running' }]
  });
  state = reduceState(state, {
    type: 'SET_BOT_INVENTORY',
    backendId: 'backend-1',
    botId: 'bot-1',
    window: { id: 3, name: 'inventory', supported: true, inventoryStart: 36, inventoryEnd: 45, slots: [{ slot: 8, name: 'minecraft:diamond', displayName: '钻石', count: 1, metadata: 0 }] }
  });

  state = reduceState(state, {
    type: 'SET_BACKEND_BOTS',
    backendId: 'backend-1',
    bots: [{ id: 'bot-1', username: 'Nitager', state: 'running' }],
    lastSyncAt: '2026-01-02T00:00:00.000Z'
  });

  const inventory = state.backends.byId['backend-1'].bots.byId['bot-1'].inventory;
  assert.ok(inventory);
  assert.equal(inventory.slots['8'].name, 'minecraft:diamond');
});

test('stale snapshots do not overwrite newer patches', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });
  state = reduceState(state, {
    type: 'SET_BACKEND_BOTS',
    backendId: 'backend-1',
    bots: [{ id: 'bot-1', username: 'Nitager', state: 'running' }]
  });
  state = reduceState(state, {
    type: 'SET_BOT_INVENTORY',
    backendId: 'backend-1',
    botId: 'bot-1',
    updatedAt: 1000,
    window: { id: 7, name: 'chest', supported: true, inventoryStart: 27, inventoryEnd: 54, slots: [{ slot: 2, name: 'minecraft:oak_planks', displayName: '橡木木板', count: 64, metadata: 0 }] }
  });
  // patch 在快照请求发出后到达（updatedAt 更大）
  state = reduceState(state, {
    type: 'PATCH_BOT_INVENTORY',
    backendId: 'backend-1',
    botId: 'bot-1',
    updatedAt: 1200,
    windowId: 7,
    slots: { 2: { slot: 2, name: 'minecraft:oak_planks', displayName: '橡木木板', count: 63, metadata: 0 } }
  });
  assert.equal(state.backends.byId['backend-1'].bots.byId['bot-1'].inventory.slots['2'].count, 63);

  // 晚到的旧快照（发起于 1100，反映旧状态）不应覆盖本地更新的 count=63
  state = reduceState(state, {
    type: 'SET_BOT_INVENTORY',
    backendId: 'backend-1',
    botId: 'bot-1',
    updatedAt: 1100,
    window: { id: 7, name: 'chest', supported: true, inventoryStart: 27, inventoryEnd: 54, slots: [{ slot: 2, name: 'minecraft:oak_planks', displayName: '橡木木板', count: 64, metadata: 0 }] }
  });
  assert.equal(state.backends.byId['backend-1'].bots.byId['bot-1'].inventory.slots['2'].count, 63);

  // 更新的快照（反映最新状态）仍可覆盖
  state = reduceState(state, {
    type: 'SET_BOT_INVENTORY',
    backendId: 'backend-1',
    botId: 'bot-1',
    updatedAt: 1300,
    window: { id: 7, name: 'chest', supported: true, inventoryStart: 27, inventoryEnd: 54, slots: [{ slot: 2, name: 'minecraft:oak_planks', displayName: '橡木木板', count: 60, metadata: 0 }] }
  });
  assert.equal(state.backends.byId['backend-1'].bots.byId['bot-1'].inventory.slots['2'].count, 60);
});

test('patches apply when the window id is missing from the snapshot', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });
  state = reduceState(state, {
    type: 'SET_BACKEND_BOTS',
    backendId: 'backend-1',
    bots: [{ id: 'bot-1', username: 'Nitager', state: 'running' }]
  });
  state = reduceState(state, {
    type: 'SET_BOT_INVENTORY',
    backendId: 'backend-1',
    botId: 'bot-1',
    window: { id: null, name: 'inventory', supported: true, inventoryStart: 36, inventoryEnd: 45, slots: [{ slot: 8, name: 'minecraft:diamond', displayName: '钻石', count: 1, metadata: 0 }] }
  });

  state = reduceState(state, {
    type: 'PATCH_BOT_INVENTORY',
    backendId: 'backend-1',
    botId: 'bot-1',
    windowId: 3,
    slots: { 8: { slot: 8, name: 'minecraft:diamond', displayName: '钻石', count: 0, metadata: 0 }, 9: null }
  });

  const inventory = state.backends.byId['backend-1'].bots.byId['bot-1'].inventory;
  assert.equal(inventory.slots['8'].count, 0);
});

test('inventory events do not recreate bots that are not in the list', () => {
  let state = createInitialState({
    backends: [
      { id: 'backend-1', name: 'One', baseUrl: 'http://a', token: 'a', enabled: true }
    ]
  });
  state = reduceState(state, {
    type: 'SET_BOT_INVENTORY',
    backendId: 'backend-1',
    botId: 'ghost-bot',
    window: { id: 7, name: 'chest', supported: true, inventoryStart: 27, inventoryEnd: 54, slots: [] }
  });

  assert.equal(state.backends.byId['backend-1'].bots.byId['ghost-bot'], undefined);
  assert.deepEqual(state.backends.byId['backend-1'].bots.allIds, []);
});
