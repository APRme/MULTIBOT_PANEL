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
