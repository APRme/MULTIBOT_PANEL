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

  function deepEqual(left, right) {
    if (left === right) return true;
    if (typeof left !== typeof right) return false;
    if (left === null || right === null) return left === right;
    if (typeof left !== 'object') return left === right;
    if (Array.isArray(left) !== Array.isArray(right)) return false;

    if (Array.isArray(left)) {
      if (left.length !== right.length) return false;
      return left.every((item, index) => deepEqual(item, right[index]));
    }

    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key, index) => (
      key === rightKeys[index] && deepEqual(left[key], right[key])
    ));
  }

  const BOT_SUMMARY_FIELDS = [
    'id',
    'username',
    'host',
    'port',
    'state',
    'desiredRunning',
    'spawnCount',
    'lastSpawnAt',
    'lastEndAt',
    'lock',
    'serverDir',
    'botDir',
    'lastFailure',
    'lastError',
    'lastKick'
  ];

  function sameBotSummary(left, right) {
    if (!left || !right) return false;
    return BOT_SUMMARY_FIELDS.every((field) => deepEqual(left[field], right[field]));
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

  function normalizeInventoryWindow(window) {
    if (!window || typeof window !== 'object') {
      return null;
    }

    const slots = {};
    if (Array.isArray(window.slots)) {
      window.slots.forEach((item) => {
        if (item && Number.isInteger(item.slot)) {
          slots[String(item.slot)] = item;
        }
      });
    }

    return {
      id: Number.isInteger(window.id) ? window.id : null,
      name: typeof window.name === 'string' ? window.name : 'unknown',
      supported: window.supported !== false,
      title: typeof window.title === 'string' && window.title ? window.title : null,
      inventoryStart: Number.isInteger(window.inventoryStart) ? window.inventoryStart : 0,
      inventoryEnd: Number.isInteger(window.inventoryEnd) ? window.inventoryEnd : 0,
      cursor: window.cursor && typeof window.cursor === 'object' && !Array.isArray(window.cursor)
        ? window.cursor
        : null,
      slots
    };
  }

  function applyInventoryPatch(inventory, patch) {
    if (!inventory || !patch || !patch.slots || typeof patch.slots !== 'object') {
      return inventory;
    }
    // 两侧都有明确 id 时才校验窗口一致性；id 为空（如背包快照缺失 id）时不做匹配，避免误丢全部 patch
    if (inventory.id != null && patch.windowId != null && Number(inventory.id) !== Number(patch.windowId)) {
      return inventory;
    }

    const nextSlots = { ...inventory.slots };
    Object.keys(patch.slots).forEach((slotKey) => {
      const item = patch.slots[slotKey];
      if (item === null || item === undefined) {
        delete nextSlots[slotKey];
        return;
      }
      const slot = Number.isInteger(item.slot) ? item.slot : Number(slotKey);
      if (!Number.isInteger(slot) || slot < 0) return;
      nextSlots[String(slot)] = item;
    });

    return {
      ...inventory,
      slots: nextSlots
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

  function compareLogEntries(left, right) {
    const leftTimestamp = String(left && left.timestamp || '');
    const rightTimestamp = String(right && right.timestamp || '');
    if (leftTimestamp < rightTimestamp) return -1;
    if (leftTimestamp > rightTimestamp) return 1;
    return 0;
  }

  function appendUniqueLogs(baseLogs, extraLogs) {
    const output = ensureArray(baseLogs).slice();
    const seenCounts = new Map();
    output.forEach((entry) => {
      const key = getLogEntryKey(entry);
      seenCounts.set(key, (seenCounts.get(key) || 0) + 1);
    });

    ensureArray(extraLogs).forEach((entry) => {
      const key = getLogEntryKey(entry);
      const count = seenCounts.get(key) || 0;
      if (count > 0) {
        seenCounts.set(key, count - 1);
        return;
      }

      output.push(entry);
    });

    return output.sort(compareLogEntries).slice(-500);
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
        const nextConnectionState = action.connectionState || backend.connectionState;
        const nextLastError = action.lastError === undefined ? backend.lastError : action.lastError;
        const nextSseConnected = action.sseConnected === undefined ? backend.sseConnected : action.sseConnected;
        const nextLastSyncAt = action.lastSyncAt === undefined ? backend.lastSyncAt : action.lastSyncAt;
        if (
          backend.connectionState === nextConnectionState &&
          backend.lastError === nextLastError &&
          backend.sseConnected === nextSseConnected &&
          backend.lastSyncAt === nextLastSyncAt
        ) {
          return state;
        }
        backend.connectionState = nextConnectionState;
        backend.lastError = nextLastError;
        backend.sseConnected = nextSseConnected;
        backend.lastSyncAt = nextLastSyncAt;
        return nextState;
      }

      case 'SET_BACKEND_BOTS': {
        const backend = nextState.backends.byId[action.backendId];
        if (!backend) return state;

        const incomingBots = ensureArray(action.bots).filter((bot) => bot && bot.id);
        const existingBots = backend.bots.allIds
          .map((botId) => backend.bots.byId[botId])
          .filter(Boolean);
        const summaryUnchanged = incomingBots.length === existingBots.length &&
          incomingBots.every((bot, index) => (
            existingBots[index] &&
            existingBots[index].id === bot.id &&
            sameBotSummary(existingBots[index], bot)
          ));
        if (summaryUnchanged) {
          return state;
        }

        const byId = {};
        const allIds = [];
        incomingBots.forEach((bot) => {
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
        if (existing && sameBotSummary(existing, bot)) {
          return state;
        }
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
        if (
          existing &&
          sameBotSummary(existing, bot) &&
          existing.recorderStatus === bot.recorderStatus &&
          deepEqual(existing.logs, mergedLogs)
        ) {
          return state;
        }
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

      case 'PATCH_BOT_INVENTORY': {
        const backend = nextState.backends.byId[action.backendId];
        if (!backend) return state;
        const botId = action.botId;
        if (!botId) return state;
        const existingBot = backend.bots.byId[botId];
        if (!existingBot || !existingBot.inventory) {
          return state;
        }
        const patched = applyInventoryPatch(existingBot.inventory, {
          windowId: action.windowId,
          slots: action.slots
        });
        if (patched === existingBot.inventory || deepEqual(patched, existingBot.inventory)) {
          return state;
        }
        const nextUpdatedAt = Math.max(
          existingBot.inventory.updatedAt || 0,
          Number.isFinite(action.updatedAt) ? action.updatedAt : 0
        );
        backend.bots.byId[botId] = {
          ...existingBot,
          inventory: {
            ...patched,
            updatedAt: nextUpdatedAt
          }
        };
        return nextState;
      }

      case 'SET_BOT_INVENTORY': {
        const backend = nextState.backends.byId[action.backendId];
        if (!backend) return state;
        const botId = action.botId;
        if (!botId) return state;
        const existingBot = backend.bots.byId[botId];
        // 事件只作用于已存在的 bot：避免迟到的 inventory 事件凭空把已删除/未加载的 bot 加回列表
        if (!existingBot) return state;
        // 快照竞态保护：本地已有更新（patch/新窗口）晚于该快照时，跳过过期快照的整体覆盖
        if (
          existingBot.inventory &&
          Number.isFinite(existingBot.inventory.updatedAt) &&
          Number.isFinite(action.updatedAt) &&
          existingBot.inventory.updatedAt > action.updatedAt
        ) {
          return state;
        }
        const inventory = normalizeInventoryWindow(action.window);
        if (inventory) {
          inventory.updatedAt = Number.isFinite(action.updatedAt) ? action.updatedAt : null;
        }
        if (deepEqual(existingBot.inventory || null, inventory)) {
          return state;
        }
        backend.bots.byId[botId] = {
          ...existingBot,
          inventory
        };
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
        const nextUnseenLogCount = isSelected || action.historical === true
          ? (isSelected ? 0 : existingBot.unseenLogCount || 0)
          : (existingBot.unseenLogCount || 0) + (didAppend ? 1 : 0);
        if (!didAppend && nextUnseenLogCount === (existingBot.unseenLogCount || 0)) {
          return state;
        }
        backend.bots.byId[botId] = {
          ...existingBot,
          logs,
          unseenLogCount: nextUnseenLogCount
        };
        if (!backend.bots.allIds.includes(botId)) {
          backend.bots.allIds.push(botId);
        }
        return nextState;
      }

      case 'MERGE_BOT_LOGS': {
        const backend = nextState.backends.byId[action.backendId];
        if (!backend) return state;
        const botId = action.botId;
        if (!botId) return state;
        const existingBot = backend.bots.byId[botId] || mergeBotSummary(null, { id: botId });
        const existingLogs = ensureArray(existingBot.logs);
        const mergedLogs = appendUniqueLogs(existingLogs, ensureArray(action.logs));
        if (
          mergedLogs.length === existingLogs.length &&
          mergedLogs.every((entry, index) => getLogEntryKey(entry) === getLogEntryKey(existingLogs[index]))
        ) {
          return state;
        }

        const addedCount = Math.max(0, mergedLogs.length - existingLogs.length);
        const isSelected = backend.selectedBotId === botId && nextState.backends.selectedBackendId === action.backendId;
        backend.bots.byId[botId] = {
          ...existingBot,
          logs: mergedLogs,
          unseenLogCount: isSelected || action.historical === true
            ? (isSelected ? 0 : existingBot.unseenLogCount || 0)
            : (existingBot.unseenLogCount || 0) + addedCount
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
    mergeBotSummary,
    normalizeInventoryWindow,
    applyInventoryPatch
  };

  namespace.state = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
