(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};

  function createSseError(message, extra = {}) {
    return Object.assign(new Error(message), extra);
  }

  function consumeEventStreamBuffer(buffer, emitEvent) {
    let working = buffer;

    while (true) {
      const separatorIndex = working.search(/\r?\n\r?\n/);
      if (separatorIndex === -1) {
        break;
      }

      const rawBlock = working.slice(0, separatorIndex);
      const separatorText = working.slice(separatorIndex).match(/^\r?\n\r?\n/)[0];
      working = working.slice(separatorIndex + separatorText.length);

      if (!rawBlock.trim()) {
        continue;
      }

      let eventName = 'message';
      const dataLines = [];

      rawBlock.split(/\r?\n/).forEach((line) => {
        if (line.startsWith(':')) return;
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim() || 'message';
          return;
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      });

      const dataText = dataLines.join('\n');
      let parsedData = dataText;
      if (dataText) {
        try {
          parsedData = JSON.parse(dataText);
        } catch (error) {
        }
      }

      emitEvent({
        event: eventName,
        data: parsedData
      });
    }

    return working;
  }

  function createSseManager(options = {}) {
    const fetchImpl = options.fetchImpl || global.fetch.bind(global);
    const setTimeoutFn = options.setTimeoutFn || global.setTimeout.bind(global);
    const clearTimeoutFn = options.clearTimeoutFn || global.clearTimeout.bind(global);
    const onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};
    const onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : () => {};
    const onError = typeof options.onError === 'function' ? options.onError : () => {};

    let activeProfile = null;
    let activeAbortController = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;

    function isSameProfile(left, right) {
      if (!left || !right) return false;
      return left.id === right.id &&
        left.baseUrl === right.baseUrl &&
        left.token === right.token;
    }

    function cleanupTimer() {
      if (reconnectTimer) {
        clearTimeoutFn(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function disconnect() {
      cleanupTimer();
      reconnectAttempts = 0;
      if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
      }
      activeProfile = null;
    }

    function scheduleReconnect(profile) {
      cleanupTimer();
      if (!activeProfile || activeProfile.id !== profile.id) {
        return;
      }

      const delayMs = Math.min(10000, 1500 + (reconnectAttempts * 750));
      reconnectAttempts += 1;
      reconnectTimer = setTimeoutFn(() => {
        reconnectTimer = null;
        void open(profile);
      }, delayMs);
    }

    async function open(profile) {
      if (!profile || !profile.id) {
        throw createSseError('profile is required', { kind: 'validation_error' });
      }

      if (!profile.baseUrl || !profile.token) {
        throw createSseError('profile baseUrl and token are required', { kind: 'validation_error' });
      }

      if (!activeProfile || activeProfile.id !== profile.id) {
        activeProfile = profile;
      }

      if (activeAbortController) {
        activeAbortController.abort();
      }

      activeAbortController = new AbortController();
      onStateChange(profile.id, { phase: 'connecting', sseConnected: false });

      try {
        const response = await fetchImpl(`${String(profile.baseUrl).replace(/\/+$/, '')}/api/events`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${profile.token}`,
            Accept: 'text/event-stream'
          },
          signal: activeAbortController.signal
        });

        if (!response.ok) {
          throw createSseError(`SSE HTTP ${response.status}`, {
            kind: response.status === 401 ? 'auth_error' : 'http_error',
            status: response.status
          });
        }

        if (!response.body || typeof response.body.getReader !== 'function') {
          throw createSseError('ReadableStream is not available', { kind: 'unsupported_error' });
        }

        reconnectAttempts = 0;
        onStateChange(profile.id, { phase: 'open', sseConnected: true });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }

          buffer += decoder.decode(chunk.value, { stream: true });
          buffer = consumeEventStreamBuffer(buffer, (event) => {
            onEvent(profile.id, event);
          });
        }

        if (buffer) {
          consumeEventStreamBuffer(`${buffer}\n\n`, (event) => {
            onEvent(profile.id, event);
          });
        }

        if (activeProfile && activeProfile.id === profile.id) {
          onStateChange(profile.id, { phase: 'closed', sseConnected: false });
          scheduleReconnect(profile);
        }
      } catch (error) {
        if (activeAbortController && activeAbortController.signal.aborted) {
          return;
        }

        onError(profile.id, error);
        onStateChange(profile.id, { phase: 'error', sseConnected: false, error });

        if (activeProfile && activeProfile.id === profile.id) {
          scheduleReconnect(profile);
        }
      }
    }

    function connect(profile) {
      if (isSameProfile(activeProfile, profile)) {
        return;
      }

      disconnect();
      activeProfile = profile;
      void open(profile);
    }

    return {
      connect,
      disconnect,
      getActiveBackendId() {
        return activeProfile ? activeProfile.id : null;
      }
    };
  }

  const api = {
    createSseManager,
    consumeEventStreamBuffer,
    createSseError
  };

  namespace.sse = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
