(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};

  const DEFAULT_UI_STATE = {
    backendEditorOpen: false,
    commandHistory: [],
    autoScrollLogs: true,
    botFilterText: '',
    botFilterState: 'all',
    botFilterServer: '',
    logLevelFilter: 'all',
    globalMessage: null
  };

  function createBackendRuntime(profile) {
    return {
      id: profile.id,
      name: profile.name,
      baseUrl: profile.baseUrl,
      token: profile.token,
      enabled: profile.enabled !== false,
      connectionState: 'idle',
      lastError: null,
      lastSyncAt: null,
      sseConnected: false,
      bots: {
        byId: {},
        allIds: []
      },
      selectedBotId: null
    };
  }

  function ensureArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function createInitialState(persisted = {}) {
    const profiles = ensureArray(persisted.backends);
    const byId = {};
    const allIds = [];

    profiles.forEach((profile) => {
      if (!profile || !profile.id) return;
      byId[profile.id] = createBackendRuntime(profile);
      allIds.push(profile.id);
    });

    return {
      backends: {
        byId,
        allIds,
        selectedBackendId: persisted.ui && persisted.ui.selectedBackendId && byId[persisted.ui.selectedBackendId]
          ? persisted.ui.selectedBackendId
          : allIds[0] || null
      },
      ui: {
        ...DEFAULT_UI_STATE,
        ...(persisted.ui || {}),
        commandHistory: ensureArray(persisted.commandHistory).slice(0, 20)
      }
    };
  }

  function cloneState(state) {
    return {
      backends: {
        byId: { ...state.backends.byId },
        allIds: state.backends.allIds.slice(),
        selectedBackendId: state.backends.selectedBackendId
      },
      ui: {
        ...state.ui
      }
    };
  }

  function mergeBotSummary(existingBot, incomingBot) {
    return {
      logs: ensureArray(existingBot && existingBot.logs).slice(0, 500),
      unseenLogCount: existingBot && existingBot.unseenLogCount ? existingBot.unseenLogCount : 0,
      lastCommandResult: existingBot ? existingBot.lastCommandResult || null : null,
      ...existingBot,
      ...incomingBot
    };
  }

  function getLogEntryKey(entry) {
    if (!entry || typeof entry !== 'object') {
      return `raw:${String(entry)}`;
    }

    const botId = String(entry.botId || '');
    const timestamp = String(entry.timestamp || '');
    const level = String(entry.level || '');
    const message = String(entry.message || '');
    return `${botId}\u0000${timestamp}\u0000${level}\u0000${message}`;
  }

  function appendUniqueLogs(baseLogs, extraLogs) {
    const output = ensureArray(baseLogs).slice();
    const seen = new Set(output.map(getLogEntryKey));

    ensureArray(extraLogs).forEach((entry) => {
      const key = getLogEntryKey(entry);
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      output.push(entry);
    });

    return output.slice(-500);
  }

  function ensureSelectedBot(backend) {
    if (!backend) return backend;
    if (backend.selectedBotId && backend.bots.byId[backend.selectedBotId]) {
      return backend;
    }
    backend.selectedBotId = backend.bots.allIds[0] || null;
    return backend;
  }

  function reduceState(state, action) {
    const nextState = cloneState(state);

    switch (action.type) {
      case 'UPSERT_BACKEND_PROFILE': {
        const profile = action.profile;
        const existing = nextState.backends.byId[profile.id];
        const runtime = existing ? {
          ...existing,
          name: profile.name,
          baseUrl: profile.baseUrl,
          token: profile.token,
          enabled: profile.enabled !== false
        } : createBackendRuntime(profile);

        nextState.backends.byId[profile.id] = runtime;
        if (!nextState.backends.allIds.includes(profile.id)) {
          nextState.backends.allIds.push(profile.id);
        }
        if (!nextState.backends.selectedBackendId) {
          nextState.backends.selectedBackendId = profile.id;
        }
        return nextState;
      }

      case 'REMOVE_BACKEND_PROFILE': {
        delete nextState.backends.byId[action.backendId];
        nextState.backends.allIds = nextState.backends.allIds.filter((id) => id !== action.backendId);
        if (nextState.backends.selectedBackendId === action.backendId) {
          nextState.backends.selectedBackendId = nextState.backends.allIds[0] || null;
        }
        return nextState;
      }

      case 'SET_SELECTED_BACKEND': {
        nextState.backends.selectedBackendId = action.backendId || null;
        return nextState;
      }

      case 'SET_SELECTED_BOT': {
        const backend = nextState.backends.byId[action.backendId];
        if (!backend) return state;
        backend.selectedBotId = action.botId || null;
        const bot = backend.selectedBotId ? backend.bots.byId[backend.selectedBotId] : null;
        if (bot) {
          bot.unseenLogCount = 0;
        }
        return nextState;
      }

      case 'SET_BACKEND_CONNECTION_STATE': {
        const backend = nextState.backends.byId[action.backendId];
        if (!backend) return state;
        backend.connectionState = action.connectionState || backend.connectionState;
        backend.lastError = action.lastError === undefined ? backend.lastError : action.lastError;
        backend.sseConnected = action.sseConnected === undefined ? backend.sseConnected : action.sseConnected;
        backend.lastSyncAt = action.lastSyncAt === undefined ? backend.lastSyncAt : action.lastSyncAt;
        return nextState;
      }

      case 'SET_BACKEND_BOTS': {
        const backend = nextState.backends.byId[action.backendId];
        if (!backend) return state;

        const byId = {};
        const allIds = [];
        ensureArray(action.bots).forEach((bot) => {
          if (!bot || !bot.id) return;
          const existing = backend.bots.byId[bot.id] || null;
          byId[bot.id] = mergeBotSummary(existing, bot);
          allIds.push(bot.id);
        });

        backend.bots = { byId, allIds };
        backend.lastSyncAt = action.lastSyncAt || backend.lastSyncAt;
        ensureSelectedBot(backend);
        return nextState;
      }

      case 'UPSERT_BOT_SUMMARY': {
        const backend = nextState.backends.byId[action.backendId];
        if (!backend) return state;
        const bot = action.bot;
        if (!bot || !bot.id) return state;
        const existing = backend.bots.byId[bot.id] || null;
        backend.bots.byId[bot.id] = mergeBotSummary(existing, bot);
        if (!backend.bots.allIds.includes(bot.id)) {
          backend.bots.allIds.push(bot.id);
        }
        ensureSelectedBot(backend);
        return nextState;
      }

      case 'SET_BOT_DETAILS': {
        const backend = nextState.backends.byId[action.backendId];
        if (!backend) return state;
        const bot = action.bot;
        if (!bot || !bot.id) return state;
        const existing = backend.bots.byId[bot.id] || null;
        const mergedLogs = appendUniqueLogs(ensureArray(bot.logs), existing && existing.logs);
        backend.bots.byId[bot.id] = {
          ...mergeBotSummary(existing, bot),
          recorderStatus: bot.recorderStatus,
          logs: mergedLogs,
          detailsLoadedAt: action.loadedAt || new Date().toISOString()
        };
        if (!backend.bots.allIds.includes(bot.id)) {
          backend.bots.allIds.push(bot.id);
        }
        ensureSelectedBot(backend);
        return nextState;
      }

      case 'APPEND_BOT_LOG': {
        const backend = nextState.backends.byId[action.backendId];
        if (!backend) return state;
        const botId = action.botId;
        if (!botId) return state;
        const existingBot = backend.bots.byId[botId] || mergeBotSummary(null, { id: botId });
        const existingLogs = ensureArray(existingBot.logs);
        const existingLogKeys = new Set(existingLogs.map(getLogEntryKey));
        const didAppend = !existingLogKeys.has(getLogEntryKey(action.log));
        const logs = appendUniqueLogs(existingLogs, [action.log]);
        const isSelected = backend.selectedBotId === botId && nextState.backends.selectedBackendId === action.backendId;
        backend.bots.byId[botId] = {
          ...existingBot,
          logs,
          unseenLogCount: isSelected || action.historical === true
            ? (isSelected ? 0 : existingBot.unseenLogCount || 0)
            : (existingBot.unseenLogCount || 0) + (didAppend ? 1 : 0)
        };
        if (!backend.bots.allIds.includes(botId)) {
          backend.bots.allIds.push(botId);
        }
        return nextState;
      }

      case 'CLEAR_BOT_LOGS': {
        const backend = nextState.backends.byId[action.backendId];
        if (!backend) return state;
        const existingBot = backend.bots.byId[action.botId];
        if (!existingBot) return state;
        backend.bots.byId[action.botId] = {
          ...existingBot,
          logs: [],
          unseenLogCount: 0
        };
        return nextState;
      }

      case 'SET_LAST_COMMAND_RESULT': {
        const backend = nextState.backends.byId[action.backendId];
        if (!backend) return state;
        const existingBot = backend.bots.byId[action.botId] || mergeBotSummary(null, { id: action.botId });
        backend.bots.byId[action.botId] = {
          ...existingBot,
          lastCommandResult: action.result
        };
        if (!backend.bots.allIds.includes(action.botId)) {
          backend.bots.allIds.push(action.botId);
        }
        return nextState;
      }

      case 'ADD_COMMAND_HISTORY': {
        const command = String(action.command || '').trim();
        if (!command) return state;
        nextState.ui.commandHistory = [command]
          .concat(nextState.ui.commandHistory.filter((item) => item !== command))
          .slice(0, 20);
        return nextState;
      }

      case 'SET_UI_PREF': {
        nextState.ui[action.key] = action.value;
        return nextState;
      }

      case 'SET_GLOBAL_MESSAGE': {
        nextState.ui.globalMessage = action.message || null;
        return nextState;
      }

      default:
        return state;
    }
  }

  function createStore(initialState) {
    let state = initialState;
    const listeners = new Set();

    return {
      getState() {
        return state;
      },
      dispatch(action) {
        const nextState = reduceState(state, action);
        if (nextState !== state) {
          state = nextState;
          listeners.forEach((listener) => listener(state, action));
        }
        return state;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    };
  }

  const api = {
    DEFAULT_UI_STATE,
    createInitialState,
    reduceState,
    createStore,
    mergeBotSummary
  };

  namespace.state = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
