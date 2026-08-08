(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};
  const storageApi = namespace.storage;
  const formatters = namespace.formatters;
  const stableStringify = formatters.stableStringify;
  const apiModule = namespace.api;
  const stateModule = namespace.state;
  const sseModule = namespace.sse;
  const statusBar = namespace.components.statusBar;
  const backendsComponent = namespace.components.backends;
  const botListComponent = namespace.components.botList;
  const instancesComponent = namespace.components.instances;
  const botDetailComponent = namespace.components.botDetail;
  const commandPanelComponent = namespace.components.commandPanel;
  const logsPanelComponent = namespace.components.logsPanel;
  const inventoryPanelComponent = namespace.components.inventoryPanel;
  const instancePresetsModule = namespace.instancePresets;
  const avatarClient = namespace.skin.createAvatarClient();
  const BOT_LIST_WIDTH_STORAGE_KEY = 'multibot_panel.bot_list_width.v1';
  const DEFAULT_BOT_LIST_WIDTH = 360;
  const MIN_BOT_LIST_WIDTH = 240;
  const MAX_BOT_LIST_WIDTH_FALLBACK_MARGIN = 320;

  function generateLocalId() {
    return `backend_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  }

  function getPersistedBackendProfiles(state) {
    return state.backends.allIds
      .map((backendId) => state.backends.byId[backendId])
      .filter(Boolean)
      .map((backend) => ({
        id: backend.id,
        name: backend.name,
        baseUrl: backend.baseUrl,
        token: backend.token,
        enabled: backend.enabled !== false
      }));
  }

  function getSelectedBackend(state) {
    return state.backends.selectedBackendId
      ? state.backends.byId[state.backends.selectedBackendId] || null
      : null;
  }

  function getSelectedBot(state) {
    const backend = getSelectedBackend(state);
    if (!backend || !backend.selectedBotId) return null;
    return backend.bots.byId[backend.selectedBotId] || null;
  }

  function selectFirstBotIfNeeded(store, backendId) {
    const state = store.getState();
    const backend = state.backends.byId[backendId];
    if (!backend || backend.selectedBotId || !backend.bots.allIds.length) return;
    store.dispatch({
      type: 'SET_SELECTED_BOT',
      backendId,
      botId: backend.bots.allIds[0]
    });
  }

  function loadPersistedBotListWidth(storage) {
    const raw = storage ? storage.getItem(BOT_LIST_WIDTH_STORAGE_KEY) : null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : DEFAULT_BOT_LIST_WIDTH;
  }

  function getInstanceKey(serverDir, botDir) {
    return `${String(serverDir || '').trim()}/${String(botDir || '').trim()}`;
  }

  function parseInstanceKey(key) {
    const text = String(key || '');
    const slashIndex = text.indexOf('/');
    if (slashIndex < 0) {
      return {
        serverDir: text,
        botDir: ''
      };
    }

    return {
      serverDir: text.slice(0, slashIndex),
      botDir: text.slice(slashIndex + 1)
    };
  }

  function stringifyJson(value) {
    try {
      return JSON.stringify(value == null ? {} : value, null, 2);
    } catch (error) {
      return '{}';
    }
  }

  function createEmptyInstanceDraft(serverDir, defaultBotConfig) {
    return {
      serverDir: String(serverDir || '').trim(),
      botDir: '',
      start: false,
      serverJson: '{}',
      defaultBotJson: stringifyJson(defaultBotConfig || {}),
      botJson: JSON.stringify({
        enabled: true,
        autoStart: false,
        email: '',
        username: ''
      }, null, 2)
    };
  }

  function parseJsonObject(text, label) {
    const source = String(text || '').trim();
    if (!source) {
      return {};
    }

    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      throw new Error(`${label} JSON 解析失败: ${error.message}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} JSON 必须是对象`);
    }

    return parsed;
  }

  function validatePathSegment(value, label) {
    const text = String(value || '').trim();
    if (!text) {
      return `${label} 不能为空`;
    }

    if (text.includes('/') || text.includes('\\') || text === '.' || text === '..') {
      return `${label} 非法`;
    }

    return '';
  }

  function init() {
    const persistedBackends = storageApi.loadBackendProfiles(global.localStorage);
    const persistedUi = storageApi.loadUiPrefs(global.localStorage);
    const persistedCommandHistory = storageApi.loadCommandHistory(global.localStorage);
    const store = stateModule.createStore(stateModule.createInitialState({
      backends: persistedBackends,
      ui: persistedUi,
      commandHistory: persistedCommandHistory
    }));
    const apiClient = apiModule.createApiClient();

    const dom = {
      layout: document.getElementById('layout'),
      layoutResizer: document.getElementById('layout-resizer'),
      statusBar: document.getElementById('status-bar'),
      backendsModal: document.getElementById('backends-modal'),
      backendsPanel: document.getElementById('backends-panel'),
      instancesModal: document.getElementById('instances-modal'),
      instancesPanel: document.getElementById('instances-panel'),
      botsPanel: document.getElementById('bots-panel'),
      detailPanel: document.getElementById('detail-panel')
    };

    const editorState = {
      open: false,
      mode: 'create',
      draft: storageApi.createEmptyBackendProfile(),
      error: '',
      showToken: false
    };
    const modalState = {
      backendsOpen: persistedBackends.length === 0,
      instancesOpen: false
    };
    const splitState = {
      width: loadPersistedBotListWidth(global.localStorage),
      dragging: false
    };
    let botFilterTextDraft = persistedUi.botFilterText || '';
    let botFilterStateDraft = persistedUi.botFilterState || 'all';
    let botFilterServerDraft = persistedUi.botFilterServer || '';
    let botFilterSyncTimer = null;
    let instanceFilterTextDraft = '';
    let instanceFilterSyncTimer = null;
    const instanceModalState = {
      backendId: null,
      loadingList: false,
      loadingDetail: false,
      error: '',
      instances: [],
      selectedKey: null,
      detail: null,
      filterServer: '',
      filterText: '',
      editor: {
        open: false,
        mode: 'create',
        error: '',
        saving: false,
        originalServerJson: '{}',
        originalDefaultBotJson: '{}',
        originalDefaultBotServerDir: '',
        originalBotJson: '{}',
        draft: createEmptyInstanceDraft('')
      }
    };

    const SSE_DEGRADED_FAILURE_THRESHOLD = 3;
    const SSE_DEGRADED_DOWN_MS = 30000;
    let sseFailureStreak = 0;
    let sseDownSince = null;

    function resetSseFailureTracking() {
      sseFailureStreak = 0;
      sseDownSince = null;
    }

    function shouldMarkSseDegraded() {
      return sseFailureStreak >= SSE_DEGRADED_FAILURE_THRESHOLD ||
        (sseDownSince !== null && Date.now() - sseDownSince >= SSE_DEGRADED_DOWN_MS);
    }

    function handleSseError(backendId, error) {
      const backend = store.getState().backends.byId[backendId];
      if (!backend) return;

      const errorMessage = error && error.message ? error.message : String(error);
      if (error && error.kind === 'auth_error') {
        store.dispatch({
          type: 'SET_BACKEND_CONNECTION_STATE',
          backendId,
          connectionState: 'auth_error',
          sseConnected: false,
          lastError: errorMessage
        });
        return;
      }

      sseFailureStreak += 1;
      if (sseDownSince === null) {
        sseDownSince = Date.now();
      }

      store.dispatch({
        type: 'SET_BACKEND_CONNECTION_STATE',
        backendId,
        connectionState: !backend.lastSyncAt
          ? 'offline'
          : shouldMarkSseDegraded()
            ? 'degraded'
            : backend.connectionState,
        sseConnected: false,
        lastError: errorMessage
      });
    }

    const sseManager = sseModule.createSseManager({
      onEvent(backendId, event) {
        handleSseEvent(backendId, event);
      },
      onStateChange(backendId, info) {
        handleSseState(backendId, info);
      },
      onError(backendId, error) {
        handleSseError(backendId, error);
      }
    });

    let refreshIntervalId = null;
    let renderSequence = 0;
    let renderFrameHandle = null;
    let pendingRenderSnapshot = null;
    let renderQueuedWhileTyping = false;
    const commandDrafts = new Map();

    function getCommandDraftKey(backendId, botId) {
      return `${String(backendId || '').trim()}/${String(botId || '').trim()}`;
    }

    function setCommandDraft(backendId, botId, value) {
      const key = getCommandDraftKey(backendId, botId);
      const text = String(value || '');
      if (!backendId || !botId) return;

      if (text) {
        commandDrafts.set(key, text);
      } else {
        commandDrafts.delete(key);
      }
    }

    function getCommandDraft(backendId, botId) {
      return commandDrafts.get(getCommandDraftKey(backendId, botId)) || '';
    }

    function escapeAttributeValue(value) {
      return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function captureRenderSnapshot() {
      const activeElement = global.document.activeElement;
      const scrollPositions = Array.from(global.document.querySelectorAll('[data-scroll-id]'))
        .map((element) => ({
          id: element.getAttribute('data-scroll-id'),
          top: element.scrollTop,
          left: element.scrollLeft
        }));

      let focusState = null;
      if (activeElement && activeElement !== global.document.body && typeof activeElement.getAttribute === 'function') {
        const selectionStart = typeof activeElement.selectionStart === 'number' ? activeElement.selectionStart : null;
        const selectionEnd = typeof activeElement.selectionEnd === 'number' ? activeElement.selectionEnd : null;
        const selectionDirection = typeof activeElement.selectionDirection === 'string' ? activeElement.selectionDirection : 'none';
        if (activeElement.hasAttribute('data-json-field') && activeElement.hasAttribute('data-json-path')) {
          focusState = {
            selector: `[data-json-field="${escapeAttributeValue(activeElement.getAttribute('data-json-field'))}"][data-json-path="${escapeAttributeValue(activeElement.getAttribute('data-json-path'))}"]`,
            selectionStart,
            selectionEnd,
            selectionDirection
          };
        } else {
          const focusAttributes = ['data-editor-field', 'data-field', 'data-filter', 'name', 'data-instance-preset'];
          for (const attributeName of focusAttributes) {
            if (!activeElement.hasAttribute(attributeName)) continue;
            focusState = {
              selector: `[${attributeName}="${escapeAttributeValue(activeElement.getAttribute(attributeName))}"]`,
              selectionStart,
              selectionEnd,
              selectionDirection
            };
            break;
          }
        }
      }

      return {
        scrollX: global.scrollX || 0,
        scrollY: global.scrollY || 0,
        scrollPositions,
        focusState
      };
    }

    function isTypingFieldFocused() {
      const activeElement = global.document.activeElement;
      if (!activeElement || activeElement === global.document.body) {
        return false;
      }

      if (activeElement.isContentEditable) {
        return true;
      }

      const tagName = String(activeElement.tagName || '').toLowerCase();
      if (tagName === 'textarea') {
        return true;
      }

      if (tagName !== 'input') {
        return false;
      }

      const inputType = String(activeElement.type || 'text').toLowerCase();
      return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'hidden'].includes(inputType);
    }

    function cancelScheduledRender() {
      if (renderFrameHandle !== null) {
        if (typeof global.cancelAnimationFrame === 'function' && typeof renderFrameHandle === 'number') {
          global.cancelAnimationFrame(renderFrameHandle);
        } else {
          global.clearTimeout(renderFrameHandle);
        }
        renderFrameHandle = null;
      }
    }

    const sectionCache = new WeakMap();

    function renderSection(sectionKey, container, dataProps, renderFn) {
      const serialized = stableStringify(dataProps);
      const cached = sectionCache.get(container);
      if (cached && cached.sectionKey === sectionKey && cached.serialized === serialized) {
        return cached.extra || null;
      }

      const extra = renderFn(container, dataProps);
      sectionCache.set(container, {
        sectionKey,
        serialized,
        extra: extra || null
      });
      return extra || null;
    }

    function flushScheduledRender() {
      cancelScheduledRender();
      const snapshot = pendingRenderSnapshot;
      pendingRenderSnapshot = null;
      persistState();
      syncBackendsModal();
      syncInstancesModal();
      render(snapshot, ++renderSequence);
    }

    function flushQueuedRenderAfterTyping() {
      if (!renderQueuedWhileTyping || isTypingFieldFocused()) {
        return;
      }

      renderQueuedWhileTyping = false;
      requestRender();
    }

    function restoreRenderSnapshot(snapshot, renderId) {
      const apply = () => {
        if (renderId !== renderSequence || !snapshot) {
          return;
        }

        if (typeof global.scrollTo === 'function') {
          global.scrollTo(snapshot.scrollX || 0, snapshot.scrollY || 0);
        }

        (snapshot.scrollPositions || []).forEach((item) => {
          if (!item || !item.id) return;
          const selector = `[data-scroll-id="${escapeAttributeValue(item.id)}"]`;
          const element = dom.layout
            ? dom.layout.querySelector(selector) || global.document.querySelector(selector)
            : global.document.querySelector(selector);
          if (!element) return;
          if (element.hasAttribute('data-scroll-managed')) return;
          element.scrollTop = item.top || 0;
          element.scrollLeft = item.left || 0;
        });

        if (!snapshot.focusState) {
          return;
        }

        const focusSelector = snapshot.focusState.selector;
        const focusElement = focusSelector ? global.document.querySelector(focusSelector) : null;
        if (!focusElement || typeof focusElement.focus !== 'function') {
          return;
        }

        try {
          focusElement.focus({ preventScroll: true });
        } catch (error) {
          focusElement.focus();
        }

        if (
          typeof focusElement.setSelectionRange === 'function' &&
          typeof snapshot.focusState.selectionStart === 'number' &&
          typeof snapshot.focusState.selectionEnd === 'number'
        ) {
          try {
            focusElement.setSelectionRange(
              snapshot.focusState.selectionStart,
              snapshot.focusState.selectionEnd,
              snapshot.focusState.selectionDirection || 'none'
            );
          } catch (error) {
          }
        }
      };

      if (typeof global.requestAnimationFrame === 'function') {
        global.requestAnimationFrame(apply);
      } else {
        global.setTimeout(apply, 0);
      }
    }

    function requestRender() {
      pendingRenderSnapshot = captureRenderSnapshot();

      if (isTypingFieldFocused()) {
        renderQueuedWhileTyping = true;
        cancelScheduledRender();
        return;
      }

      if (renderQueuedWhileTyping) {
        renderQueuedWhileTyping = false;
      }

      if (renderFrameHandle !== null) {
        return;
      }

      renderFrameHandle = typeof global.requestAnimationFrame === 'function'
        ? global.requestAnimationFrame(() => {
            renderFrameHandle = null;
            flushScheduledRender();
          })
        : global.setTimeout(() => {
            renderFrameHandle = null;
            flushScheduledRender();
          }, 0);
    }

    function clampBotListWidth(width) {
      if (!dom.layout) return DEFAULT_BOT_LIST_WIDTH;
      const layoutRect = dom.layout.getBoundingClientRect();
      const maxWidth = Math.max(MIN_BOT_LIST_WIDTH, layoutRect.width - MAX_BOT_LIST_WIDTH_FALLBACK_MARGIN);
      return Math.min(Math.max(Number(width) || DEFAULT_BOT_LIST_WIDTH, MIN_BOT_LIST_WIDTH), maxWidth);
    }

    function applyBotListWidth(width, shouldPersist = false) {
      if (!dom.layout) return;
      splitState.width = clampBotListWidth(width);
      dom.layout.style.setProperty('--bots-panel-width', `${splitState.width}px`);
      if (shouldPersist && global.localStorage) {
        global.localStorage.setItem(BOT_LIST_WIDTH_STORAGE_KEY, String(splitState.width));
      }
    }

    function startLayoutResize(initialEvent) {
      if (!dom.layout || !dom.layoutResizer || global.innerWidth <= 1100) {
        return;
      }

      initialEvent.preventDefault();
      splitState.dragging = true;
      global.document.body.style.userSelect = 'none';

      const onMouseMove = (event) => {
        const layoutRect = dom.layout.getBoundingClientRect();
        applyBotListWidth(event.clientX - layoutRect.left, false);
      };

      const onMouseUp = () => {
        splitState.dragging = false;
        global.document.body.style.userSelect = '';
        global.removeEventListener('mousemove', onMouseMove);
        global.removeEventListener('mouseup', onMouseUp);
        applyBotListWidth(splitState.width, true);
      };

      global.addEventListener('mousemove', onMouseMove);
      global.addEventListener('mouseup', onMouseUp);
    }

    function syncBackendsModal() {
      if (!dom.backendsModal) return;
      dom.backendsModal.hidden = !modalState.backendsOpen;
      global.document.body.classList.toggle('modal-open', modalState.backendsOpen || modalState.instancesOpen);
    }

    function openBackendsModal() {
      closeInstancesModal({ renderAfterClose: false });
      modalState.backendsOpen = true;
      syncBackendsModal();
      requestRender();
    }

    function closeBackendsModal() {
      modalState.backendsOpen = false;
      syncBackendsModal();
    }

    function syncInstancesModal() {
      if (!dom.instancesModal) return;
      dom.instancesModal.hidden = !modalState.instancesOpen;
      global.document.body.classList.toggle('modal-open', modalState.backendsOpen || modalState.instancesOpen);
    }

    function closeInstanceEditor() {
      instanceModalState.editor.open = false;
      instanceModalState.editor.error = '';
      instanceModalState.editor.saving = false;
      instanceModalState.editor.originalServerJson = '{}';
      instanceModalState.editor.originalDefaultBotJson = '{}';
      instanceModalState.editor.originalDefaultBotServerDir = '';
      instanceModalState.editor.originalBotJson = '{}';
      instanceModalState.editor.draft = createEmptyInstanceDraft('');
    }

    function openInstancesModal() {
      const backend = getSelectedBackend(store.getState());
      if (!backend) {
        store.dispatch({
          type: 'SET_GLOBAL_MESSAGE',
          message: '请先选择一个后端，再管理实例。'
        });
        return;
      }

      closeBackendsModal();
      modalState.instancesOpen = true;
      instanceModalState.backendId = backend.id;
      syncInstancesModal();
      requestRender();
      void refreshInstances(backend.id, {
        selectFirst: true
      });
    }

    function closeInstancesModal(options = {}) {
      modalState.instancesOpen = false;
      if (options.resetState !== false) {
        instanceModalState.backendId = null;
        instanceModalState.loadingList = false;
        instanceModalState.loadingDetail = false;
        instanceModalState.error = '';
        instanceModalState.instances = [];
        instanceModalState.selectedKey = null;
        instanceModalState.detail = null;
        instanceModalState.filterServer = '';
        instanceModalState.filterText = '';
        instanceFilterTextDraft = '';
        if (instanceFilterSyncTimer) {
          global.clearTimeout(instanceFilterSyncTimer);
          instanceFilterSyncTimer = null;
        }
        closeInstanceEditor();
      }
      syncInstancesModal();
      if (options.renderAfterClose !== false) {
        render();
      }
    }

    function commitBotFilterText(value) {
      botFilterTextDraft = String(value || '');

      if (botFilterSyncTimer) {
        global.clearTimeout(botFilterSyncTimer);
      }

      botFilterSyncTimer = global.setTimeout(() => {
        botFilterSyncTimer = null;
        persistState();
      }, 180);
    }

    function flushBotFilterText() {
      if (botFilterSyncTimer) {
        global.clearTimeout(botFilterSyncTimer);
        botFilterSyncTimer = null;
      }
      persistState();
    }

    function commitInstanceFilterText(value) {
      instanceFilterTextDraft = String(value || '');
      if (instanceFilterSyncTimer) {
        global.clearTimeout(instanceFilterSyncTimer);
      }
      instanceFilterSyncTimer = global.setTimeout(() => {
        instanceFilterSyncTimer = null;
        instanceModalState.filterText = instanceFilterTextDraft;
        requestRender();
      }, 250);
    }

    function commitInstanceFilterServer(value) {
      instanceModalState.filterServer = String(value || '');
      requestRender();
    }

    async function clearAvatarCacheAndReload() {
      const origin = typeof location !== 'undefined' ? location.origin : '';
      try {
        await fetch(`${origin}/avatar/clear-cache`, { method: 'POST' });
      } catch (error) {
        // 面板进程缓存清除失败不阻塞浏览器侧清除与重载
      }
      avatarClient.clearCache();
      const backend = getSelectedBackend(store.getState());
      if (backend) {
        botListComponent.resetAvatarSlots(dom.botsPanel, backend);
        botListComponent.scheduleAvatarLoads(dom.botsPanel, backend, avatarClient);
      }
    }

    function persistState() {
      const state = store.getState();
      storageApi.saveBackendProfiles(global.localStorage, getPersistedBackendProfiles(state));
      storageApi.saveUiPrefs(global.localStorage, {
        selectedBackendId: state.backends.selectedBackendId,
        autoScrollLogs: state.ui.autoScrollLogs,
        botFilterText: botFilterTextDraft,
        botFilterState: botFilterStateDraft,
        botFilterServer: botFilterServerDraft,
        logLevelFilter: state.ui.logLevelFilter
      });
      storageApi.saveCommandHistory(global.localStorage, state.ui.commandHistory);
    }

    async function refreshBackend(backendId, options) {
      const state = store.getState();
      const backend = state.backends.byId[backendId];
      if (!backend || backend.enabled === false) return;
      const silent = options && options.silent === true;

      if (!silent) {
        store.dispatch({
          type: 'SET_BACKEND_CONNECTION_STATE',
          backendId,
          connectionState: 'connecting',
          lastError: null
        });
      }

      try {
        const response = await apiClient.getBots(backend);
        const rawBots = Array.isArray(response.bots) ? response.bots : [];
        const bots = await enrichBotServerDirectories(backend, rawBots);
        store.dispatch({
          type: 'SET_BACKEND_BOTS',
          backendId,
          bots,
          lastSyncAt: silent ? undefined : new Date().toISOString()
        });
        if (!silent) {
          store.dispatch({
            type: 'SET_BACKEND_CONNECTION_STATE',
            backendId,
            connectionState: 'online',
            sseConnected: sseManager.getActiveBackendId() === backendId,
            lastError: null,
            lastSyncAt: new Date().toISOString()
          });
        }
        synchronizeServerSelection(backendId);
        selectFirstBotIfNeeded(store, backendId);

        const latestState = store.getState();
        const refreshedBackend = latestState.backends.byId[backendId];
        if (refreshedBackend && refreshedBackend.selectedBotId && options && options.loadSelectedBot !== false) {
          await loadBotDetails(backendId, refreshedBackend.selectedBotId, { silent: true });
        }
        if (modalState.instancesOpen && instanceModalState.backendId === backendId) {
          await refreshInstances(backendId, {
            selectKey: instanceModalState.selectedKey,
            silent: true
          });
        }
      } catch (error) {
        store.dispatch({
          type: 'SET_BACKEND_CONNECTION_STATE',
          backendId,
          connectionState: error && error.kind === 'auth_error' ? 'auth_error' : 'offline',
          sseConnected: false,
          lastError: error && error.message ? error.message : String(error)
        });
      }
    }

    async function enrichBotServerDirectories(backend, bots) {
      if (!botListComponent.hasMissingServerDirectories(bots)) {
        return bots;
      }

      try {
        const response = await apiClient.getInstances(backend);
        const instances = Array.isArray(response.instances) ? response.instances : [];
        return botListComponent.applyInstanceDirectories(bots, instances);
      } catch (error) {
        return bots;
      }
    }

    async function refreshAllBackends(options) {
      const state = store.getState();
      const silent = options && options.silent === true;
      for (const backendId of state.backends.allIds) {
        const backend = state.backends.byId[backendId];
        if (backend && backend.enabled !== false) {
          await refreshBackend(backendId, {
            loadSelectedBot: backendId === state.backends.selectedBackendId,
            silent
          });
        }
      }
    }

    function instanceModalSignature() {
      return stableStringify({
        instances: instanceModalState.instances,
        selectedKey: instanceModalState.selectedKey,
        detail: instanceModalState.detail,
        error: instanceModalState.error
      });
    }

    async function refreshInstances(backendId, options = {}) {
      const backend = store.getState().backends.byId[backendId];
      if (!backend) return;

      const silent = options.silent === true;
      instanceModalState.backendId = backendId;
      if (!silent) {
        instanceModalState.loadingList = true;
      }
      instanceModalState.error = '';
      const beforeSignature = instanceModalSignature();
      if (!silent) {
        requestRender();
      }

      try {
        const response = await apiClient.getInstances(backend);
        const instances = Array.isArray(response.instances) ? response.instances : [];
        instanceModalState.instances = instances;

        const requestedKey = options.selectKey || instanceModalState.selectedKey;
        const nextKey = instances.some((item) => getInstanceKey(item.serverDir, item.botDir) === requestedKey)
          ? requestedKey
          : options.selectFirst === false
            ? null
            : instances[0]
              ? getInstanceKey(instances[0].serverDir, instances[0].botDir)
              : null;

        instanceModalState.selectedKey = nextKey;
        if (!nextKey) {
          instanceModalState.detail = null;
          return;
        }

        const selectedDetailKey = instanceModalState.detail
          ? getInstanceKey(instanceModalState.detail.serverDir, instanceModalState.detail.botDir)
          : null;

        if (selectedDetailKey !== nextKey || options.reloadDetail === true) {
          const { serverDir, botDir } = parseInstanceKey(nextKey);
          await loadInstanceDetails(backendId, serverDir, botDir, {
            silent: true
          });
        }
      } catch (error) {
        instanceModalState.error = `加载实例列表失败: ${error.message}`;
      } finally {
        instanceModalState.loadingList = false;
        if (!silent || instanceModalSignature() !== beforeSignature) {
          requestRender();
        }
      }
    }

    async function loadInstanceDetails(backendId, serverDir, botDir, options = {}) {
      const backend = store.getState().backends.byId[backendId];
      if (!backend || !serverDir || !botDir) return;

      const silent = options.silent === true;
      instanceModalState.selectedKey = getInstanceKey(serverDir, botDir);
      instanceModalState.loadingDetail = !silent;
      if (!silent) {
        requestRender();
      }

      try {
        const response = await apiClient.getInstance(backend, serverDir, botDir);
        instanceModalState.detail = response && response.instance ? response.instance : null;
        instanceModalState.error = '';
      } catch (error) {
        instanceModalState.error = `加载实例详情失败: ${error.message}`;
      } finally {
        instanceModalState.loadingDetail = false;
        if (!silent) {
          requestRender();
        }
      }
    }

    async function loadBotDetails(backendId, botId, options) {
      const state = store.getState();
      const backend = state.backends.byId[backendId];
      if (!backend || !botId) return;

      try {
        const response = await apiClient.getBotDetails(backend, botId);
        if (response && response.bot) {
          store.dispatch({
            type: 'SET_BOT_DETAILS',
            backendId,
            bot: response.bot,
            loadedAt: new Date().toISOString()
          });
          if (!(options && options.silent)) {
            store.dispatch({
              type: 'SET_BACKEND_CONNECTION_STATE',
              backendId,
              connectionState: backend.sseConnected ? 'online' : backend.connectionState === 'idle' ? 'online' : backend.connectionState,
              lastError: null
            });
          }
        }
      } catch (error) {
        if (!(options && options.silent)) {
          store.dispatch({
            type: 'SET_GLOBAL_MESSAGE',
            message: `加载 Bot 详情失败: ${error.message}`
          });
        }
      }
    }

    async function refreshBotInventory(backendId, botId) {
      const state = store.getState();
      const backend = state.backends.byId[backendId];
      if (!backend || !botId) return;

      const startedAt = Date.now();
      try {
        const response = await apiClient.getInventory(backend, botId);
        store.dispatch({
          type: 'SET_BOT_INVENTORY',
          backendId,
          botId,
          updatedAt: startedAt,
          window: (response && response.window) || null
        });
      } catch (error) {
        // 快照拉取失败时静默：SSE inventory 事件仍会覆盖数据
      }
    }

    async function sendChestCommand(backendId, botId, command) {
      const backend = store.getState().backends.byId[backendId];
      if (!backend) return;

      try {
        const result = await apiClient.sendCommand(backend, botId, command);
        store.dispatch({
          type: 'SET_LAST_COMMAND_RESULT',
          backendId,
          botId,
          result
        });
      } catch (error) {
        store.dispatch({
          type: 'SET_GLOBAL_MESSAGE',
          message: `物品操作失败: ${error.message}`
        });
      }
    }

    async function closeBotWindow(backendId, botId) {
      const backend = store.getState().backends.byId[backendId];
      if (!backend) return;

      try {
        await apiClient.closeWindow(backend, botId);
      } catch (error) {
        store.dispatch({
          type: 'SET_GLOBAL_MESSAGE',
          message: `关闭窗口失败: ${error.message}`
        });
      }
    }

    function connectSelectedBackendStream() {
      const state = store.getState();
      const backend = getSelectedBackend(state);

      if (!backend || backend.enabled === false || !backend.baseUrl || !backend.token) {
        sseManager.disconnect();
        return;
      }

      resetSseFailureTracking();
      sseManager.connect(backend);
    }

    function handleSseEvent(backendId, event) {
      if (!event || !event.event) return;

      if (event.event === 'bootstrap' && event.data) {
        const bots = Array.isArray(event.data.bots) ? event.data.bots : [];
        if (bots.length > 0) {
          store.dispatch({
            type: 'SET_BACKEND_BOTS',
            backendId,
            bots,
            lastSyncAt: new Date().toISOString()
          });
        }

        const logsByBotId = event.data.logsByBotId && typeof event.data.logsByBotId === 'object'
          ? event.data.logsByBotId
          : {};
        Object.keys(logsByBotId).forEach((botId) => {
          const logs = Array.isArray(logsByBotId[botId]) ? logsByBotId[botId] : [];
          store.dispatch({
            type: 'MERGE_BOT_LOGS',
            backendId,
            botId,
            logs: logs.map((log) => ({
              ...log,
              botId: log && log.botId ? log.botId : botId
            })),
            historical: true
          });
        });

        store.dispatch({
          type: 'SET_BACKEND_CONNECTION_STATE',
          backendId,
          connectionState: 'online',
          sseConnected: true,
          lastError: null,
          lastSyncAt: new Date().toISOString()
        });
        resetSseFailureTracking();
        selectFirstBotIfNeeded(store, backendId);
        const selectedBotId = store.getState().backends.byId[backendId].selectedBotId;
        if (selectedBotId) {
          void refreshBotInventory(backendId, selectedBotId);
        }
        return;
      }

      if (event.event === 'botStatus' && event.data && event.data.id) {
        store.dispatch({
          type: 'UPSERT_BOT_SUMMARY',
          backendId,
          bot: event.data
        });
        store.dispatch({
          type: 'SET_BACKEND_CONNECTION_STATE',
          backendId,
          connectionState: 'online',
          sseConnected: true,
          lastError: null
        });
        return;
      }

      if (event.event === 'log' && event.data && event.data.botId) {
        store.dispatch({
          type: 'APPEND_BOT_LOG',
          backendId,
          botId: event.data.botId,
          log: event.data
        });
        return;
      }

      if (event.event === 'inventory' && event.data && event.data.botId) {
        const data = event.data;
        if (data.type === 'window') {
          store.dispatch({
            type: 'SET_BOT_INVENTORY',
            backendId,
            botId: data.botId,
            updatedAt: Number.isFinite(data.timestamp) ? data.timestamp : Date.now(),
            window: data.window
          });
        } else if (data.type === 'patch') {
          store.dispatch({
            type: 'PATCH_BOT_INVENTORY',
            backendId,
            botId: data.botId,
            updatedAt: Number.isFinite(data.timestamp) ? data.timestamp : Date.now(),
            windowId: data.windowId,
            slots: data.slots
          });
        }
      }
    }

    function handleSseState(backendId, info) {
      const state = store.getState();
      const backend = state.backends.byId[backendId];
      if (!backend) return;

      if (info.phase === 'open') {
        resetSseFailureTracking();
        store.dispatch({
          type: 'SET_BACKEND_CONNECTION_STATE',
          backendId,
          connectionState: 'online',
          sseConnected: true,
          lastError: null
        });
        return;
      }

      if (info.phase === 'connecting') {
        store.dispatch({
          type: 'SET_BACKEND_CONNECTION_STATE',
          backendId,
          connectionState: backend.lastSyncAt ? backend.connectionState : 'connecting',
          sseConnected: false
        });
        return;
      }

      if (info.phase === 'closed') {
        if (sseDownSince === null) {
          sseDownSince = Date.now();
        }
        store.dispatch({
          type: 'SET_BACKEND_CONNECTION_STATE',
          backendId,
          connectionState: backend.lastSyncAt ? backend.connectionState : 'offline',
          sseConnected: false
        });
        return;
      }

      if (info.phase === 'error') {
        sseFailureStreak += 1;
        if (sseDownSince === null) {
          sseDownSince = Date.now();
        }
        store.dispatch({
          type: 'SET_BACKEND_CONNECTION_STATE',
          backendId,
          connectionState: !backend.lastSyncAt
            ? 'offline'
            : shouldMarkSseDegraded()
              ? 'degraded'
              : backend.connectionState,
          sseConnected: false,
          lastError: info.error && info.error.message ? info.error.message : backend.lastError
        });
      }
    }

    async function runBotAction(action, backendId, botId) {
      const backend = store.getState().backends.byId[backendId];
      if (!backend) return;

      try {
        if (action === 'start') await apiClient.startBot(backend, botId);
        if (action === 'stop') await apiClient.stopBot(backend, botId);
        if (action === 'restart') await apiClient.restartBot(backend, botId);
        await refreshBackend(backendId, { loadSelectedBot: true });
      } catch (error) {
        store.dispatch({
          type: 'SET_GLOBAL_MESSAGE',
          message: `${action} 失败: ${error.message}`
        });
      }
    }

    async function sendBotCommand(backendId, botId, command) {
      const rawInput = String(command || '');
      if (!rawInput.trim()) return false;

      const backend = store.getState().backends.byId[backendId];
      if (!backend) return false;

      try {
        const result = await apiClient.sendConsoleInput(backend, botId, rawInput);
        store.dispatch({
          type: 'SET_LAST_COMMAND_RESULT',
          backendId,
          botId,
          result
        });
        store.dispatch({
          type: 'ADD_COMMAND_HISTORY',
          command: rawInput
        });
        return true;
      } catch (error) {
        store.dispatch({
          type: 'SET_GLOBAL_MESSAGE',
          message: `发送命令失败: ${error.message}`
        });
      }
    }

    function selectBackend(backendId) {
      store.dispatch({
        type: 'SET_SELECTED_BACKEND',
        backendId
      });
      closeBackendsModal();
      const backend = store.getState().backends.byId[backendId];
      if (backend && backend.enabled !== false) {
        void refreshBackend(backendId, { loadSelectedBot: true });
      }
      connectSelectedBackendStream();
    }

    function selectBot(botId) {
      const backend = getSelectedBackend(store.getState());
      if (!backend) return;
      store.dispatch({
        type: 'SET_SELECTED_BOT',
        backendId: backend.id,
        botId
      });
      void loadBotDetails(backend.id, botId, { silent: true });
      void refreshBotInventory(backend.id, botId);
    }

    function selectServer(serverDir) {
      botFilterServerDraft = String(serverDir || '').trim();
      const backend = getSelectedBackend(store.getState());
      if (!backend) {
        persistState();
        return;
      }

      const matchingBotId = backend.bots.allIds.find((botId) => {
        return botListComponent.getBotServerDir(backend.bots.byId[botId]) === botFilterServerDraft;
      });
      const selectedBot = backend.selectedBotId ? backend.bots.byId[backend.selectedBotId] : null;
      const selectedServerDir = botListComponent.getBotServerDir(selectedBot);

      persistState();
      if (matchingBotId && selectedServerDir !== botFilterServerDraft) {
        selectBot(matchingBotId);
      } else {
        requestRender();
      }
    }

    function synchronizeServerSelection(backendId) {
      const state = store.getState();
      if (state.backends.selectedBackendId !== backendId) return;

      const backend = state.backends.byId[backendId];
      if (!backend) return;

      const bots = backend.bots.allIds.map((botId) => backend.bots.byId[botId]).filter(Boolean);
      const resolvedServerDir = botListComponent.resolveServerFilter(bots, botFilterServerDraft);
      const selectedBot = backend.selectedBotId ? backend.bots.byId[backend.selectedBotId] : null;
      const selectedServerDir = botListComponent.getBotServerDir(selectedBot);
      const matchingBot = bots.find((bot) => botListComponent.getBotServerDir(bot) === resolvedServerDir);
      const filterChanged = resolvedServerDir !== botFilterServerDraft;

      botFilterServerDraft = resolvedServerDir;
      if (matchingBot && selectedServerDir !== resolvedServerDir) {
        store.dispatch({
          type: 'SET_SELECTED_BOT',
          backendId,
          botId: matchingBot.id
        });
      }
      if (filterChanged) persistState();
    }

    async function focusInstanceBot(instanceId) {
      const backendId = instanceModalState.backendId || store.getState().backends.selectedBackendId;
      if (!backendId || !instanceId) return;

      const backend = store.getState().backends.byId[backendId];
      if (!backend) return;

      if (!backend.bots.byId[instanceId]) {
        await refreshBackend(backendId, { loadSelectedBot: false });
      }

      selectBot(instanceId);
      closeInstancesModal();
    }

    function openEditor(mode, backendId) {
      openBackendsModal();
      editorState.open = true;
      editorState.mode = mode;
      editorState.error = '';
      editorState.showToken = false;

      if (mode === 'edit' && backendId) {
        const backend = store.getState().backends.byId[backendId];
        editorState.draft = {
          id: backend.id,
          name: backend.name,
          baseUrl: backend.baseUrl,
          token: backend.token,
          enabled: backend.enabled !== false
        };
      } else {
        editorState.draft = {
          id: '',
          name: '',
          baseUrl: '',
          token: '',
          enabled: true
        };
      }

      render();
    }

    async function openInstanceEditor(mode) {
      const backendId = instanceModalState.backendId || store.getState().backends.selectedBackendId;
      if (!backendId) {
        store.dispatch({
          type: 'SET_GLOBAL_MESSAGE',
          message: '请先选择一个后端。'
        });
        return;
      }

      instanceModalState.editor.mode = mode;
      instanceModalState.editor.error = '';
      instanceModalState.editor.saving = false;

      if (mode === 'edit') {
        const detail = instanceModalState.detail;
        if (!detail) {
          instanceModalState.editor.error = '请先选择一个实例。';
          requestRender();
          return;
        }

        const serverJson = stringifyJson(detail.serverConfig || {});
        const defaultBotJson = stringifyJson(detail.defaultBotConfig || {});
        const botJson = stringifyJson(detail.botConfig || {});
        instanceModalState.editor.originalServerJson = serverJson;
        instanceModalState.editor.originalDefaultBotJson = defaultBotJson;
        instanceModalState.editor.originalDefaultBotServerDir = detail.serverDir || '';
        instanceModalState.editor.originalBotJson = botJson;
        instanceModalState.editor.draft = {
          serverDir: detail.serverDir || '',
          botDir: detail.botDir || '',
          start: false,
          serverJson,
          defaultBotJson,
          botJson
        };
      } else {
        const selectedInstance = instanceModalState.detail || null;
        instanceModalState.editor.originalServerJson = '{}';
        instanceModalState.editor.originalDefaultBotJson = stringifyJson(selectedInstance && selectedInstance.defaultBotConfig || {});
        instanceModalState.editor.originalDefaultBotServerDir = selectedInstance && selectedInstance.serverDir || '';
        instanceModalState.editor.originalBotJson = '{}';
        instanceModalState.editor.draft = createEmptyInstanceDraft(
          selectedInstance ? selectedInstance.serverDir : '',
          selectedInstance && selectedInstance.defaultBotConfig
        );
      }

      instanceModalState.editor.open = true;
      requestRender();
    }

    function cancelInstanceEditor() {
      closeInstanceEditor();
      requestRender();
    }

    async function saveInstanceEditor() {
      const backendId = instanceModalState.backendId || store.getState().backends.selectedBackendId;
      const backend = backendId ? store.getState().backends.byId[backendId] : null;
      if (!backend) {
        instanceModalState.editor.error = '未找到后端。';
        requestRender();
        return;
      }

      const draft = instanceModalState.editor.draft || {};
      const serverDirError = validatePathSegment(draft.serverDir, 'serverDir');
      if (serverDirError) {
        instanceModalState.editor.error = serverDirError;
        requestRender();
        return;
      }

      const botDirError = validatePathSegment(draft.botDir, 'botDir');
      if (botDirError) {
        instanceModalState.editor.error = botDirError;
        requestRender();
        return;
      }

      let serverObject;
      let defaultBotObject;
      let botObject;
      try {
        serverObject = parseJsonObject(draft.serverJson, 'server');
        defaultBotObject = parseJsonObject(draft.defaultBotJson, 'default bot');
        botObject = parseJsonObject(draft.botJson, 'bot');
      } catch (error) {
        instanceModalState.editor.error = error.message;
        requestRender();
        return;
      }

      if (
        instanceModalState.editor.mode === 'create' &&
        !String(botObject.username || botObject.email || '').trim()
      ) {
        instanceModalState.editor.error = 'bot JSON 需要至少提供 username 或 email。';
        requestRender();
        return;
      }

      instanceModalState.editor.error = '';
      instanceModalState.editor.saving = true;
      requestRender();

      try {
        let response;
        const originalDefaultBotObject = parseJsonObject(instanceModalState.editor.originalDefaultBotJson, 'original default bot');
        const defaultBotChanged = JSON.stringify(defaultBotObject) !== JSON.stringify(originalDefaultBotObject);
        const currentServerDir = String(draft.serverDir || '').trim();
        const defaultBotSourceServerDir = String(instanceModalState.editor.originalDefaultBotServerDir || '').trim();
        const shouldSendDefaultBotConfig = defaultBotChanged || (
          currentServerDir !== defaultBotSourceServerDir &&
          JSON.stringify(defaultBotObject) !== '{}'
        );

        if (instanceModalState.editor.mode === 'create') {
          const payload = {
            serverDir: String(draft.serverDir).trim(),
            botDir: String(draft.botDir).trim(),
            server: serverObject,
            bot: botObject,
            start: draft.start === true
          };

          if (shouldSendDefaultBotConfig) {
            payload.defaultBotConfig = defaultBotObject;
          }

          response = await apiClient.createInstance(backend, payload);
        } else {
          const originalServerObject = parseJsonObject(instanceModalState.editor.originalServerJson, 'original server');
          const originalBotObject = parseJsonObject(instanceModalState.editor.originalBotJson, 'original bot');
          const payload = {};

          if (JSON.stringify(serverObject) !== JSON.stringify(originalServerObject)) {
            payload.server = serverObject;
          }
          if (JSON.stringify(defaultBotObject) !== JSON.stringify(originalDefaultBotObject)) {
            payload.defaultBotConfig = defaultBotObject;
          }
          if (JSON.stringify(botObject) !== JSON.stringify(originalBotObject)) {
            payload.bot = botObject;
          }
          if (draft.start === true) {
            payload.start = true;
          }

          if (!payload.server && !payload.defaultBotConfig && !payload.bot && payload.start !== true) {
            instanceModalState.editor.error = '没有可保存的变更。';
            return;
          }

          if (payload.server || payload.defaultBotConfig || payload.bot) {
            payload.replace = true;
          }

          response = await apiClient.updateInstance(
            backend,
            String(draft.serverDir).trim(),
            String(draft.botDir).trim(),
            payload
          );
        }

        const isCreateMode = instanceModalState.editor.mode === 'create';
        closeInstanceEditor();
        store.dispatch({
          type: 'SET_GLOBAL_MESSAGE',
          message: isCreateMode ? '实例创建成功' : '实例更新成功'
        });

        await refreshBackend(backend.id, { loadSelectedBot: true });

        const responseInstance = response && response.instance ? response.instance : null;
        const nextKey = responseInstance
          ? getInstanceKey(responseInstance.serverDir, responseInstance.botDir)
          : getInstanceKey(draft.serverDir, draft.botDir);

        await refreshInstances(backend.id, {
          selectKey: nextKey,
          reloadDetail: true
        });
      } catch (error) {
        instanceModalState.editor.error = error.message || String(error);
      } finally {
        instanceModalState.editor.saving = false;
        requestRender();
      }
    }

    async function startInstance(serverDir, botDir) {
      const backendId = instanceModalState.backendId || store.getState().backends.selectedBackendId;
      const backend = backendId ? store.getState().backends.byId[backendId] : null;
      if (!backend) return;

      try {
        await apiClient.updateInstance(backend, serverDir, botDir, {
          start: true
        });
        store.dispatch({
          type: 'SET_GLOBAL_MESSAGE',
          message: '实例启动请求已发送'
        });
        await refreshBackend(backend.id, { loadSelectedBot: true });
        await refreshInstances(backend.id, {
          selectKey: getInstanceKey(serverDir, botDir),
          reloadDetail: true
        });
      } catch (error) {
        instanceModalState.error = `启动实例失败: ${error.message}`;
        requestRender();
      }
    }

    async function deleteInstance(serverDir, botDir) {
      const backendId = instanceModalState.backendId || store.getState().backends.selectedBackendId;
      const backend = backendId ? store.getState().backends.byId[backendId] : null;
      if (!backend) return;

      const confirmed = global.confirm(
        `确定删除实例 ${serverDir}/${botDir} 吗？\n\n只会删除该 Bot 目录；服务器共享配置、名单和聚合日志会保留。`
      );
      if (!confirmed) return;

      try {
        await apiClient.deleteInstance(backend, serverDir, botDir);
        store.dispatch({
          type: 'SET_GLOBAL_MESSAGE',
          message: '实例已删除'
        });
        await refreshBackend(backend.id, { loadSelectedBot: true });
        await refreshInstances(backend.id, {
          selectFirst: true,
          reloadDetail: true
        });
      } catch (error) {
        instanceModalState.error = `删除实例失败: ${error.message}`;
        requestRender();
      }
    }

    function closeEditor() {
      editorState.open = false;
      editorState.error = '';
      requestRender();
    }

    function validateEditorDraft() {
      const draft = editorState.draft;
      if (!draft.name.trim()) return '名称不能为空';
      if (!draft.baseUrl.trim()) return '地址不能为空';
      if (!draft.token.trim()) return 'Token 不能为空';
      if (!/^https?:\/\//i.test(draft.baseUrl.trim())) return '地址必须以 http:// 或 https:// 开头';
      return '';
    }

    async function saveEditor() {
      const validationError = validateEditorDraft();
      if (validationError) {
        editorState.error = validationError;
        requestRender();
        return;
      }

      const profile = {
        id: editorState.mode === 'edit' && editorState.draft.id ? editorState.draft.id : generateLocalId(),
        name: editorState.draft.name.trim(),
        baseUrl: apiModule.normalizeBaseUrl(editorState.draft.baseUrl),
        token: editorState.draft.token.trim(),
        enabled: editorState.draft.enabled !== false
      };

      store.dispatch({
        type: 'UPSERT_BACKEND_PROFILE',
        profile
      });

      closeEditor();
      selectBackend(profile.id);
      closeBackendsModal();
    }

    async function testEditorBackend() {
      const validationError = validateEditorDraft();
      if (validationError) {
        editorState.error = validationError;
        requestRender();
        return;
      }

      try {
        await apiClient.testBackend({
          baseUrl: apiModule.normalizeBaseUrl(editorState.draft.baseUrl),
          token: editorState.draft.token.trim()
        });
        editorState.error = '';
        store.dispatch({
          type: 'SET_GLOBAL_MESSAGE',
          message: '测试连接成功'
        });
      } catch (error) {
        editorState.error = `测试连接失败: ${error.message}`;
      }

      requestRender();
    }

    function deleteBackend(backendId) {
      const backend = store.getState().backends.byId[backendId];
      if (!backend) return;

      const confirmed = global.confirm(`确定删除后端 ${backend.name} 吗？`);
      if (!confirmed) return;

      if (sseManager.getActiveBackendId() === backendId) {
        sseManager.disconnect();
      }

      if (instanceModalState.backendId === backendId) {
        closeInstancesModal({ renderAfterClose: false });
      }

      store.dispatch({
        type: 'REMOVE_BACKEND_PROFILE',
        backendId
      });

      if (store.getState().backends.allIds.length === 0) {
        openBackendsModal();
      } else {
        closeBackendsModal();
      }
      connectSelectedBackendStream();
    }

    function toggleBackendEnabled(backendId) {
      const backend = store.getState().backends.byId[backendId];
      if (!backend) return;

      const profile = {
        id: backend.id,
        name: backend.name,
        baseUrl: backend.baseUrl,
        token: backend.token,
        enabled: backend.enabled === false
      };

      store.dispatch({
        type: 'UPSERT_BACKEND_PROFILE',
        profile
      });

      if (profile.enabled) {
        selectBackend(backendId);
      } else {
        if (instanceModalState.backendId === backendId) {
          closeInstancesModal({ renderAfterClose: false });
        }
        if (sseManager.getActiveBackendId() === backendId) {
          sseManager.disconnect();
        }
        store.dispatch({
          type: 'SET_BACKEND_CONNECTION_STATE',
          backendId,
          connectionState: 'idle',
          sseConnected: false
        });
      }
    }

    function render(snapshotFromCaller, renderIdFromCaller) {
      if (!snapshotFromCaller && renderFrameHandle !== null) {
        if (typeof global.cancelAnimationFrame === 'function' && typeof renderFrameHandle === 'number') {
          global.cancelAnimationFrame(renderFrameHandle);
        } else {
          global.clearTimeout(renderFrameHandle);
        }
        renderFrameHandle = null;
        pendingRenderSnapshot = null;
      }
      const snapshot = snapshotFromCaller || captureRenderSnapshot();
      const renderId = renderIdFromCaller || (++renderSequence);
      const state = store.getState();
      const selectedBackend = getSelectedBackend(state);
      const selectedBot = getSelectedBot(state);

      renderSection('status-bar', dom.statusBar, {
        title: 'MULTIBOT 控制面板',
        backendCount: state.backends.allIds.length,
        backendName: selectedBackend ? selectedBackend.name : null,
        backendBaseUrl: selectedBackend ? selectedBackend.baseUrl : null,
        backendConnectionState: selectedBackend ? selectedBackend.connectionState : null,
        selectedBotId: selectedBot ? selectedBot.id : null,
        globalMessage: state.ui.globalMessage
      }, (container) => {
        statusBar.renderStatusBar(container, {
          title: 'MULTIBOT 控制面板',
          backendCount: state.backends.allIds.length,
          selectedBackend,
          selectedBot,
          globalMessage: state.ui.globalMessage,
          onOpenBackends() {
            openBackendsModal();
          },
          onOpenInstances() {
            openInstancesModal();
          },
          onRefresh() {
            if (selectedBackend) {
              void refreshBackend(selectedBackend.id, { loadSelectedBot: true });
            } else {
              void refreshAllBackends();
            }
          },
          onDismissMessage() {
            store.dispatch({
              type: 'SET_GLOBAL_MESSAGE',
              message: null
            });
          }
        });
      });

      if (modalState.backendsOpen) {
        renderSection('backends-panel', dom.backendsPanel, {
          backends: state.backends.allIds.map((backendId) => {
            const backend = state.backends.byId[backendId];
            return {
              id: backend.id,
              name: backend.name,
              baseUrl: backend.baseUrl,
              tokenSet: Boolean(backend.token),
              enabled: backend.enabled !== false,
              connectionState: backend.connectionState,
              botCount: backend.bots.allIds.length,
              lastError: backend.lastError
            };
          }),
          selectedBackendId: state.backends.selectedBackendId,
          editor: editorState
        }, (container) => {
          backendsComponent.renderBackendsPanel(container, {
            backends: state.backends.allIds.map((backendId) => state.backends.byId[backendId]).filter(Boolean),
            selectedBackendId: state.backends.selectedBackendId,
            editor: editorState,
            onCloseModal() {
              closeBackendsModal();
            },
            onAddBackend() {
              openEditor('create');
            },
            onEditBackend(backendId) {
              openEditor('edit', backendId);
            },
            onDeleteBackend(backendId) {
              deleteBackend(backendId);
            },
            onToggleEnabled(backendId) {
              toggleBackendEnabled(backendId);
            },
            onSelectBackend(backendId) {
              selectBackend(backendId);
            },
            onCancelEditor() {
              closeEditor();
            },
            onSaveEditor() {
              void saveEditor();
            },
            onTestBackend() {
              void testEditorBackend();
            },
            onUpdateEditorField(field, value) {
              editorState.draft[field] = value;
            },
            onToggleShowToken(value) {
              editorState.showToken = value === true;
              requestRender();
            }
          });
        });
      }

      if (modalState.instancesOpen && dom.instancesPanel) {
        const modalBackend = instanceModalState.backendId
          ? state.backends.byId[instanceModalState.backendId] || null
          : selectedBackend;
        const selectedSummary = instanceModalState.selectedKey
          ? instanceModalState.instances.find((item) => getInstanceKey(item.serverDir, item.botDir) === instanceModalState.selectedKey) || null
          : null;
        const selectedDetailKey = instanceModalState.detail
          ? getInstanceKey(instanceModalState.detail.serverDir, instanceModalState.detail.botDir)
          : null;
        const selectedInstance = selectedDetailKey === instanceModalState.selectedKey
          ? instanceModalState.detail
          : selectedSummary;

        renderSection('instances-panel', dom.instancesPanel, {
          backendId: modalBackend ? modalBackend.id : null,
          backendName: modalBackend ? modalBackend.name : null,
          backendBaseUrl: modalBackend ? modalBackend.baseUrl : null,
          loadingList: instanceModalState.loadingList,
          loadingDetail: instanceModalState.loadingDetail,
          error: instanceModalState.error,
          instances: instanceModalState.instances,
          selectedKey: instanceModalState.selectedKey,
          filterText: instanceModalState.filterText,
          filterServer: instanceModalState.filterServer,
          selectedInstance,
          editor: instanceModalState.editor,
          presets: instancePresetsModule && typeof instancePresetsModule.getPresetDefinitions === 'function'
            ? instancePresetsModule.getPresetDefinitions()
            : []
        }, (container) => {
          instancesComponent.renderInstancesPanel(container, {
            backend: modalBackend,
            loadingList: instanceModalState.loadingList,
            loadingDetail: instanceModalState.loadingDetail,
            error: instanceModalState.error,
            instances: instanceModalState.instances,
            selectedKey: instanceModalState.selectedKey,
            filterText: instanceModalState.filterText,
            filterServer: instanceModalState.filterServer,
            selectedInstance,
            editor: {
              ...instanceModalState.editor,
              presets: (instancePresetsModule && typeof instancePresetsModule.getPresetDefinitions === 'function'
                ? instancePresetsModule.getPresetDefinitions()
                : []
              ).map((preset) => ({
                ...preset,
                active: typeof instancePresetsModule.isPresetAppliedToDraft === 'function'
                  ? instancePresetsModule.isPresetAppliedToDraft(instanceModalState.editor.draft, preset.id)
                  : false
              }))
            },
            onClose() {
              closeInstancesModal();
            },
            onRefreshInstances() {
              if (modalBackend) {
                void refreshInstances(modalBackend.id, {
                  selectKey: instanceModalState.selectedKey,
                  reloadDetail: true,
                  silent: instanceModalState.editor.open === true
                });
              }
            },
            onClearAvatarCache() {
              void clearAvatarCacheAndReload();
            },
            onChangeFilterText(value) {
              commitInstanceFilterText(value);
            },
            onChangeFilterServer(value) {
              commitInstanceFilterServer(value);
            },
            onSelectInstance(serverDir, botDir) {
              if (modalBackend) {
                closeInstanceEditor();
                void loadInstanceDetails(modalBackend.id, serverDir, botDir);
              }
            },
            onRefreshInstance(serverDir, botDir) {
              if (modalBackend) {
                void loadInstanceDetails(modalBackend.id, serverDir, botDir, {
                  silent: instanceModalState.editor.open === true
                });
              }
            },
            onCreateInstance() {
              void openInstanceEditor('create');
            },
            onEditInstance() {
              void openInstanceEditor('edit');
            },
            onCancelEditor() {
              cancelInstanceEditor();
            },
            onSaveEditor() {
              void saveInstanceEditor();
            },
            onApplyPreset(presetId) {
              if (!instancePresetsModule || typeof instancePresetsModule.togglePresetInDraft !== 'function') {
                instanceModalState.editor.error = '预设模块未加载。';
                requestRender();
                return;
              }

              try {
                instanceModalState.editor.draft = instancePresetsModule.togglePresetInDraft(
                  instanceModalState.editor.draft,
                  presetId
                );
                instanceModalState.editor.error = '';
              } catch (error) {
                instanceModalState.editor.error = error.message || String(error);
              }
              requestRender();
            },
            onUpdateEditorField(field, value) {
              instanceModalState.editor.draft[field] = value;
            },
            onStartInstance(serverDir, botDir) {
              void startInstance(serverDir, botDir);
            },
            onDeleteInstance(serverDir, botDir) {
              void deleteInstance(serverDir, botDir);
            },
            onFocusBot(instanceId) {
              void focusInstanceBot(instanceId);
            }
          });
        });
      }

      renderSection('bot-list', dom.botsPanel, {
        backendName: selectedBackend ? selectedBackend.name : null,
        selectedBotId: selectedBackend ? selectedBackend.selectedBotId : null,
        botFilterText: botFilterTextDraft,
        botFilterState: botFilterStateDraft,
        botFilterServer: botFilterServerDraft,
        bots: selectedBackend
          ? selectedBackend.bots.allIds.map((botId) => {
              const bot = selectedBackend.bots.byId[botId];
              return {
                id: bot.id,
                username: bot.username,
                host: bot.host,
                port: bot.port,
                state: bot.state,
                lock: bot.lock,
                serverDir: bot.serverDir,
                botDir: bot.botDir,
                lastFailure: bot.lastFailure,
                lastError: bot.lastError,
                lastKick: bot.lastKick
              };
            })
          : []
      }, (container) => {
        botListComponent.renderBotList(container, {
          avatarClient,
          backend: selectedBackend,
          botFilterText: botFilterTextDraft,
          botFilterState: botFilterStateDraft,
          botFilterServer: botFilterServerDraft,
          onRefreshBackend() {
            if (selectedBackend) {
              void refreshBackend(selectedBackend.id, { loadSelectedBot: true });
            }
          },
          onChangeFilterText(value) {
            commitBotFilterText(value);
          },
          onChangeFilterState(value) {
            botFilterStateDraft = String(value || 'all');
            persistState();
          },
          onChangeFilterServer(value) {
            selectServer(value);
          },
          onSelectBot(botId) {
            selectBot(botId);
          },
          onStartBot(botId) {
            if (selectedBackend) void runBotAction('start', selectedBackend.id, botId);
          },
          onStopBot(botId) {
            if (selectedBackend) void runBotAction('stop', selectedBackend.id, botId);
          },
          onRestartBot(botId) {
            if (selectedBackend) void runBotAction('restart', selectedBackend.id, botId);
          }
        });
      });

      const detailSlots = renderSection('bot-detail', dom.detailPanel, selectedBot ? {
        id: selectedBot.id,
        username: selectedBot.username,
        state: selectedBot.state,
        lock: selectedBot.lock,
        desiredRunning: selectedBot.desiredRunning,
        spawnCount: selectedBot.spawnCount,
        lastSpawnAt: selectedBot.lastSpawnAt,
        lastEndAt: selectedBot.lastEndAt,
        host: selectedBot.host,
        port: selectedBot.port,
        recorderStatus: selectedBot.recorderStatus,
        lastFailure: selectedBot.lastFailure,
        lastError: selectedBot.lastError,
        lastKick: selectedBot.lastKick
      } : {
        empty: true
      }, (container) => {
        return botDetailComponent.renderBotDetail(container, {
          backend: selectedBackend,
          bot: selectedBot
        });
      });

      if (detailSlots && detailSlots.inventoryContainer && selectedBackend && selectedBot) {
        renderSection('inventory-panel', detailSlots.inventoryContainer, {
          inventory: selectedBot.inventory || null
        }, (container) => {
          inventoryPanelComponent.renderInventoryPanel(container, {
            inventory: selectedBot.inventory || null,
            onMoveItem(fromSlot, toSlot, count) {
              const command = count == null
                ? `chest move ${fromSlot} ${toSlot}`
                : `chest move ${fromSlot} ${toSlot} ${count}`;
              void sendChestCommand(selectedBackend.id, selectedBot.id, command);
            },
            onCloseWindow() {
              void closeBotWindow(selectedBackend.id, selectedBot.id);
            }
          });
        });
      }

      if (detailSlots && detailSlots.commandContainer && selectedBackend && selectedBot) {
        renderSection('command-panel', detailSlots.commandContainer, {
          botId: selectedBot.id,
          canSend: selectedBackend.connectionState !== 'offline' && selectedBackend.connectionState !== 'auth_error',
          commandHistory: state.ui.commandHistory,
          commandDraft: getCommandDraft(selectedBackend.id, selectedBot.id),
          lastCommandResult: selectedBot.lastCommandResult || null
        }, (container) => {
          commandPanelComponent.renderCommandPanel(container, {
            bot: selectedBot,
            commandHistory: state.ui.commandHistory,
            commandDraft: getCommandDraft(selectedBackend.id, selectedBot.id),
            canSend: selectedBackend.connectionState !== 'offline' && selectedBackend.connectionState !== 'auth_error',
            onSendCommand(command) {
              return sendBotCommand(selectedBackend.id, selectedBot.id, command);
            },
            onUpdateCommandDraft(value) {
              setCommandDraft(selectedBackend.id, selectedBot.id, value);
            },
            onUseHistory() {
            }
          });
        });
      }

      if (detailSlots && detailSlots.logsContainer && selectedBackend && selectedBot) {
        logsPanelComponent.renderLogsPanel(detailSlots.logsContainer, {
          botKey: `${selectedBackend.id}/${selectedBot.id}`,
          logs: selectedBot.logs || [],
          autoScrollLogs: state.ui.autoScrollLogs,
          logLevelFilter: state.ui.logLevelFilter,
          onStartBot() {
            void runBotAction('start', selectedBackend.id, selectedBot.id);
          },
          onStopBot() {
            void runBotAction('stop', selectedBackend.id, selectedBot.id);
          },
          onRestartBot() {
            void runBotAction('restart', selectedBackend.id, selectedBot.id);
          },
          onRefreshBot() {
            void loadBotDetails(selectedBackend.id, selectedBot.id);
          },
          onToggleAutoScroll(value) {
            store.dispatch({ type: 'SET_UI_PREF', key: 'autoScrollLogs', value });
          },
          onClearLogs() {
            store.dispatch({ type: 'CLEAR_BOT_LOGS', backendId: selectedBackend.id, botId: selectedBot.id });
          },
          onChangeLogLevel(value) {
            store.dispatch({ type: 'SET_UI_PREF', key: 'logLevelFilter', value });
          }
        });
      }

      restoreRenderSnapshot(snapshot, renderId);
    }

    store.subscribe(() => {
      requestRender();
    });

    dom.backendsModal?.querySelector('[data-action="close-backends-modal"]')?.addEventListener('click', () => {
      closeBackendsModal();
    });
    dom.instancesModal?.querySelector('[data-action="close-instances-modal"]')?.addEventListener('click', () => {
      closeInstancesModal();
    });

    dom.layoutResizer?.addEventListener('mousedown', startLayoutResize);

    global.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (modalState.instancesOpen) {
          closeInstancesModal();
          return;
        }
        if (modalState.backendsOpen) {
          closeBackendsModal();
        }
      }
    });

    global.addEventListener('resize', () => {
      applyBotListWidth(splitState.width, false);
    });

    global.addEventListener('focusout', () => {
      global.setTimeout(() => {
        flushQueuedRenderAfterTyping();
      }, 0);
    }, true);

    syncBackendsModal();
    syncInstancesModal();
    applyBotListWidth(splitState.width, false);
    render();

    if (store.getState().backends.selectedBackendId) {
      const backend = getSelectedBackend(store.getState());
      if (backend && backend.enabled !== false) {
        void refreshBackend(backend.id, { loadSelectedBot: true });
        connectSelectedBackendStream();
      }
    }

    refreshIntervalId = global.setInterval(() => {
      void refreshAllBackends({ silent: true });
    }, 30000);

    global.addEventListener('beforeunload', () => {
      flushBotFilterText();
      if (refreshIntervalId) {
        global.clearInterval(refreshIntervalId);
      }
      sseManager.disconnect();
    });
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', init);
  }

  namespace.app = {
    init,
    generateLocalId,
    getPersistedBackendProfiles
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = namespace.app;
  }
})(typeof window !== 'undefined' ? window : globalThis);
