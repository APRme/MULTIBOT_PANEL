(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};

  const STORAGE_KEY = 'multibot_panel.avatars.v1';
  const FACE_X = 8;
  const FACE_Y = 8;
  const FACE_SIZE = 8;
  const OVERLAY_X = 40;
  const OVERLAY_Y = 8;
  const OVERLAY_MIN_HEIGHT = 64;
  const OUTPUT_SIZE = 40;
  const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const FAILURE_TTL_MS = 5 * 60 * 1000;
  const MINECRAFT_USERNAME_PATTERN = /^[A-Za-z0-9_]{1,16}$/;

  function isValidUsername(username) {
    return MINECRAFT_USERNAME_PATTERN.test(String(username || '').trim());
  }

  function parseAvatarCache(text) {
    let raw;
    try {
      raw = JSON.parse(text || '');
    } catch (error) {
      return {};
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }

    const result = {};
    Object.keys(raw).forEach((username) => {
      if (!isValidUsername(username)) return;
      const entry = raw[username];
      if (!entry || typeof entry !== 'object') return;
      const dataUrl = typeof entry.dataUrl === 'string' && entry.dataUrl.startsWith('data:image/')
        ? entry.dataUrl
        : '';
      const fetchedAt = Number(entry.fetchedAt) || 0;
      const failedAt = Number(entry.failedAt) || 0;
      if (dataUrl || failedAt) {
        result[username] = { dataUrl, fetchedAt, failedAt };
      }
    });
    return result;
  }

  function isCacheFresh(entry, now, ttlMs) {
    return !!entry &&
      typeof entry.dataUrl === 'string' &&
      entry.dataUrl.length > 0 &&
      entry.fetchedAt > 0 &&
      now - entry.fetchedAt < ttlMs;
  }

  function isDebounced(entry, now, failureTtlMs) {
    return !!entry &&
      entry.failedAt > 0 &&
      now - entry.failedAt < failureTtlMs;
  }

  function shouldDrawOverlay(bitmapHeight) {
    return Number(bitmapHeight) >= OVERLAY_MIN_HEIGHT;
  }

  async function cropFaceToDataUrl(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const context = canvas.getContext('2d');
      if (!context) return '';
      // 像素画保持硬边：整数倍放大时禁用平滑插值，避免出现半透明过渡色
      context.imageSmoothingEnabled = false;
      context.drawImage(bitmap, FACE_X, FACE_Y, FACE_SIZE, FACE_SIZE, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      // 64×64 双层皮肤：头部外层（帽子/头饰）位于 (40,8)，叠加后由透明像素透出本体
      if (shouldDrawOverlay(bitmap.height)) {
        context.drawImage(bitmap, OVERLAY_X, OVERLAY_Y, FACE_SIZE, FACE_SIZE, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      }
      return canvas.toDataURL('image/png');
    } finally {
      if (typeof bitmap.close === 'function') bitmap.close();
    }
  }

  function createAvatarClient(options = {}) {
    const storage = options.storage !== undefined
      ? options.storage
      : (typeof localStorage !== 'undefined' ? localStorage : null);
    const now = options.now || (() => Date.now());
    const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
    const failureTtlMs = options.failureTtlMs || FAILURE_TTL_MS;
    const fetchFn = options.fetchFn || ((username) => {
      const origin = typeof location !== 'undefined' ? location.origin : '';
      // no-store：头像新鲜度由 localStorage 缓存与面板进程缓存共同管理，绕过浏览器 HTTP 缓存，
      // 否则清除缓存后的热重载可能命中旧 PNG
      return fetch(`${origin}/avatar/${encodeURIComponent(username)}`, { cache: 'no-store' });
    });
    const cropFn = options.cropFn || cropFaceToDataUrl;

    function readCache() {
      return storage ? parseAvatarCache(storage.getItem(STORAGE_KEY)) : {};
    }

    function writeEntry(username, entry) {
      if (!storage) return;
      const cache = readCache();
      cache[username] = { ...cache[username], ...entry };
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(cache));
      } catch (error) {
        // localStorage 配额满或不可用时静默降级为不缓存
      }
    }

    async function getAvatar(username) {
      if (!isValidUsername(username)) return null;

      const timestamp = now();
      const entry = readCache()[username];
      if (isCacheFresh(entry, timestamp, ttlMs)) return entry.dataUrl;
      if (isDebounced(entry, timestamp, failureTtlMs)) return null;

      let response;
      try {
        response = await fetchFn(username);
      } catch (error) {
        writeEntry(username, { failedAt: timestamp });
        return null;
      }

      if (!response.ok) {
        writeEntry(username, { failedAt: timestamp });
        return null;
      }

      let dataUrl;
      try {
        const blob = await response.blob();
        dataUrl = await cropFn(blob);
      } catch (error) {
        return null;
      }
      if (!dataUrl) return null;

      writeEntry(username, { dataUrl, fetchedAt: timestamp, failedAt: 0 });
      return dataUrl;
    }

    function readCacheMap() {
      return readCache();
    }

    function clearCache() {
      if (!storage) return;
      try {
        storage.removeItem(STORAGE_KEY);
      } catch (error) {
        // localStorage 不可用时静默降级
      }
    }

    return {
      getAvatar,
      readCacheMap,
      clearCache
    };
  }

  const api = {
    STORAGE_KEY,
    FACE_X,
    FACE_Y,
    FACE_SIZE,
    OVERLAY_X,
    OVERLAY_Y,
    OVERLAY_MIN_HEIGHT,
    OUTPUT_SIZE,
    DEFAULT_TTL_MS,
    FAILURE_TTL_MS,
    isValidUsername,
    parseAvatarCache,
    isCacheFresh,
    isDebounced,
    shouldDrawOverlay,
    cropFaceToDataUrl,
    createAvatarClient
  };

  namespace.skin = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
