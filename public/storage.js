(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};

  const STORAGE_KEYS = {
    backends: 'multibot_panel.backends.v1',
    ui: 'multibot_panel.ui.v1',
    commandHistory: 'multibot_panel.command_history.v1'
  };

  function safeParseJson(text, fallbackValue) {
    if (!text || typeof text !== 'string') {
      return fallbackValue;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      return fallbackValue;
    }
  }

  function createEmptyBackendProfile() {
    return {
      id: '',
      name: '',
      baseUrl: '',
      token: '',
      enabled: true
    };
  }

  function sanitizeProfile(profile) {
    const raw = profile && typeof profile === 'object' ? profile : {};
    return {
      id: String(raw.id || '').trim(),
      name: String(raw.name || '').trim(),
      baseUrl: String(raw.baseUrl || '').trim().replace(/\/+$/, ''),
      token: String(raw.token || '').trim(),
      enabled: raw.enabled !== false
    };
  }

  function loadBackendProfiles(storage) {
    const raw = safeParseJson(storage.getItem(STORAGE_KEYS.backends), []);
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .map(sanitizeProfile)
      .filter((profile) => profile.id && profile.name && profile.baseUrl);
  }

  function saveBackendProfiles(storage, profiles) {
    storage.setItem(STORAGE_KEYS.backends, JSON.stringify((profiles || []).map(sanitizeProfile)));
  }

  function loadUiPrefs(storage) {
    const raw = safeParseJson(storage.getItem(STORAGE_KEYS.ui), {});
    return {
      selectedBackendId: typeof raw.selectedBackendId === 'string' ? raw.selectedBackendId : null,
      autoScrollLogs: raw.autoScrollLogs !== false,
      botFilterText: typeof raw.botFilterText === 'string' ? raw.botFilterText : '',
      botFilterState: typeof raw.botFilterState === 'string' ? raw.botFilterState : 'all',
      botFilterServer: typeof raw.botFilterServer === 'string' ? raw.botFilterServer : '',
      logLevelFilter: typeof raw.logLevelFilter === 'string' ? raw.logLevelFilter : 'all'
    };
  }

  function saveUiPrefs(storage, prefs) {
    storage.setItem(STORAGE_KEYS.ui, JSON.stringify({
      selectedBackendId: prefs && prefs.selectedBackendId ? prefs.selectedBackendId : null,
      autoScrollLogs: prefs && prefs.autoScrollLogs !== false,
      botFilterText: prefs && typeof prefs.botFilterText === 'string' ? prefs.botFilterText : '',
      botFilterState: prefs && typeof prefs.botFilterState === 'string' ? prefs.botFilterState : 'all',
      botFilterServer: prefs && typeof prefs.botFilterServer === 'string' ? prefs.botFilterServer : '',
      logLevelFilter: prefs && typeof prefs.logLevelFilter === 'string' ? prefs.logLevelFilter : 'all'
    }));
  }

  function loadCommandHistory(storage) {
    const raw = safeParseJson(storage.getItem(STORAGE_KEYS.commandHistory), []);
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 20);
  }

  function saveCommandHistory(storage, history) {
    storage.setItem(STORAGE_KEYS.commandHistory, JSON.stringify((history || []).slice(0, 20)));
  }

  const api = {
    STORAGE_KEYS,
    safeParseJson,
    createEmptyBackendProfile,
    sanitizeProfile,
    loadBackendProfiles,
    saveBackendProfiles,
    loadUiPrefs,
    saveUiPrefs,
    loadCommandHistory,
    saveCommandHistory
  };

  namespace.storage = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
