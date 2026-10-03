(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};

  function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || '').trim().replace(/\/+$/, '');
  }

  function createApiError(message, extra = {}) {
    return Object.assign(new Error(message), extra);
  }

  async function parseResponseBody(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }

    const text = await response.text();
    return text ? { message: text } : {};
  }

  function createApiClient(options = {}) {
    const fetchImpl = options.fetchImpl || global.fetch.bind(global);

    async function requestJson(profile, pathname, init = {}) {
      const baseUrl = normalizeBaseUrl(profile && profile.baseUrl);
      const token = String(profile && profile.token || '').trim();

      if (!baseUrl) {
        throw createApiError('必须填写后端地址', { kind: 'validation_error' });
      }

      if (!token) {
        throw createApiError('必须填写 Token', { kind: 'validation_error' });
      }

      const controller = new AbortController();
      const timeoutMs = Number.isFinite(init.timeoutMs) ? init.timeoutMs : 10000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(`${baseUrl}${pathname}`, {
          method: init.method || 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...(init.headers || {})
          },
          body: init.body ? JSON.stringify(init.body) : undefined,
          signal: controller.signal
        });

        const payload = await parseResponseBody(response);

        if (!response.ok) {
          throw createApiError(
            payload && payload.error ? String(payload.error) : `HTTP ${response.status}`,
            {
              kind: response.status === 401 ? 'auth_error' : 'http_error',
              status: response.status,
              payload
            }
          );
        }

        return payload;
      } catch (error) {
        if (error.name === 'AbortError') {
          throw createApiError('请求超时', { kind: 'timeout_error' });
        }

        if (error.kind) {
          throw error;
        }

        throw createApiError(error.message || '网络错误', { kind: 'network_error' });
      } finally {
        clearTimeout(timeoutId);
      }
    }

    return {
      normalizeBaseUrl,
      async testBackend(profile) {
        return requestJson(profile, '/api/bots');
      },
      async getBots(profile) {
        return requestJson(profile, '/api/bots');
      },
      async getBotDetails(profile, botId) {
        return requestJson(profile, `/api/bots/${encodeURIComponent(botId)}`);
      },
      async getInventory(profile, botId) {
        return requestJson(profile, `/api/bots/${encodeURIComponent(botId)}/inventory`);
      },
      async closeWindow(profile, botId) {
        return requestJson(profile, `/api/bots/${encodeURIComponent(botId)}/close-window`, {
          method: 'POST'
        });
      },
      async clickWindow(profile, botId, payload) {
        return requestJson(profile, `/api/bots/${encodeURIComponent(botId)}/window-click`, {
          method: 'POST',
          body: payload
        });
      },
      async getInstances(profile) {
        return requestJson(profile, '/api/instances');
      },
      async getInstance(profile, serverDir, botDir) {
        return requestJson(
          profile,
          `/api/instances/${encodeURIComponent(serverDir)}/${encodeURIComponent(botDir)}`
        );
      },
      async createInstance(profile, payload) {
        return requestJson(profile, '/api/instances', {
          method: 'POST',
          body: payload
        });
      },
      async updateInstance(profile, serverDir, botDir, payload) {
        return requestJson(
          profile,
          `/api/instances/${encodeURIComponent(serverDir)}/${encodeURIComponent(botDir)}`,
          {
            method: 'PATCH',
            body: payload
          }
        );
      },
      async deleteInstance(profile, serverDir, botDir) {
        return requestJson(
          profile,
          `/api/instances/${encodeURIComponent(serverDir)}/${encodeURIComponent(botDir)}`,
          {
            method: 'DELETE'
          }
        );
      },
      async startBot(profile, botId) {
        return requestJson(profile, `/api/bots/${encodeURIComponent(botId)}/start`, { method: 'POST' });
      },
      async stopBot(profile, botId) {
        return requestJson(profile, `/api/bots/${encodeURIComponent(botId)}/stop`, { method: 'POST' });
      },
      async restartBot(profile, botId) {
        return requestJson(profile, `/api/bots/${encodeURIComponent(botId)}/restart`, { method: 'POST' });
      },
      async sendCommand(profile, botId, command) {
        return requestJson(profile, `/api/bots/${encodeURIComponent(botId)}/command`, {
          method: 'POST',
          body: {
            command,
            source: 'http',
            sender: 'panel'
          }
        });
      },
      async sendConsoleInput(profile, botId, input) {
        return requestJson(profile, `/api/bots/${encodeURIComponent(botId)}/command`, {
          method: 'POST',
          body: {
            input,
            source: 'console',
            sender: 'panel'
          }
        });
      }
    };
  }

  const api = {
    normalizeBaseUrl,
    createApiClient,
    createApiError
  };

  namespace.api = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
