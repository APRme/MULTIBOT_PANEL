'use strict';

const LOOKUP_API_URL = 'https://api.minecraftservices.com/minecraft/profile/lookup/name/';
const PROFILE_API_URL = 'https://sessionserver.mojang.com/session/minecraft/profile/';
const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,16}$/;

const ERROR_CODES = {
  INVALID_USERNAME: 'invalid_username',
  NOT_FOUND: 'not_found',
  RATE_LIMITED: 'rate_limited',
  UPSTREAM_ERROR: 'upstream_error'
};

const DEFAULT_OPTIONS = {
  lookupTtlMs: 24 * 60 * 60 * 1000,
  skinTtlMs: 24 * 60 * 60 * 1000,
  failureTtlMs: 5 * 60 * 1000,
  fetchTimeoutMs: 15000
};

class AvatarServiceError extends Error {
  constructor(code, detail) {
    super(code);
    this.name = 'AvatarServiceError';
    this.code = code;
    this.detail = detail;
  }
}

function isValidUsername(username) {
  return USERNAME_PATTERN.test(String(username || '').trim());
}

function normalizeSkinUrl(url) {
  const text = String(url || '').trim();
  if (!text) return '';
  if (text.startsWith('http://')) return `https://${text.slice('http://'.length)}`;
  return text;
}

function decodeSkinTextures(base64Value) {
  if (!base64Value || typeof base64Value !== 'string') return '';
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(base64Value, 'base64').toString('utf8'));
  } catch (error) {
    return '';
  }
  const url = parsed && parsed.textures && parsed.textures.SKIN && parsed.textures.SKIN.url;
  return normalizeSkinUrl(url);
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('fetch timeout')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createAvatarService(options = {}) {
  const fetcher = options.fetcher || globalThis.fetch;
  const now = options.now || (() => Date.now());
  const lookupTtlMs = options.lookupTtlMs || DEFAULT_OPTIONS.lookupTtlMs;
  const skinTtlMs = options.skinTtlMs || DEFAULT_OPTIONS.skinTtlMs;
  const failureTtlMs = options.failureTtlMs || DEFAULT_OPTIONS.failureTtlMs;
  const fetchTimeoutMs = options.fetchTimeoutMs || DEFAULT_OPTIONS.fetchTimeoutMs;

  const skinUrlCache = new Map();
  const skinBytesCache = new Map();
  const failureCache = new Map();
  const inflight = new Map();

  function markFailure(name, timestamp) {
    failureCache.set(name, { expiresAt: timestamp + failureTtlMs });
  }

  async function fetchJson(url, timestamp) {
    let response;
    try {
      response = await withTimeout(
        fetcher(url, { headers: { accept: 'application/json' } }),
        fetchTimeoutMs
      );
    } catch (error) {
      throw new AvatarServiceError(ERROR_CODES.UPSTREAM_ERROR, error);
    }
    if (response.status === 429) throw new AvatarServiceError(ERROR_CODES.RATE_LIMITED);
    if (response.status === 404) throw new AvatarServiceError(ERROR_CODES.NOT_FOUND);
    if (!response.ok) throw new AvatarServiceError(ERROR_CODES.UPSTREAM_ERROR, response.status);

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new AvatarServiceError(ERROR_CODES.UPSTREAM_ERROR, error);
    }
    return data;
  }

  async function fetchSkinUrl(name, timestamp) {
    try {
      const lookup = await fetchJson(`${LOOKUP_API_URL}${encodeURIComponent(name)}`, timestamp);
      const uuid = lookup && lookup.id;
      if (!uuid) throw new AvatarServiceError(ERROR_CODES.NOT_FOUND);

      const profile = await fetchJson(`${PROFILE_API_URL}${uuid}`, timestamp);
      const properties = profile && Array.isArray(profile.properties) ? profile.properties : [];
      const skinUrl = decodeSkinTextures(properties[0] && properties[0].value);
      if (!skinUrl) throw new AvatarServiceError(ERROR_CODES.NOT_FOUND);

      skinUrlCache.set(name, { skinUrl, expiresAt: timestamp + lookupTtlMs });
      return skinUrl;
    } catch (error) {
      markFailure(name, timestamp);
      throw error;
    }
  }

  async function fetchSkinBytes(skinUrl) {
    let response;
    try {
      response = await withTimeout(fetcher(skinUrl), fetchTimeoutMs);
    } catch (error) {
      throw new AvatarServiceError(ERROR_CODES.UPSTREAM_ERROR, error);
    }
    if (!response.ok) throw new AvatarServiceError(ERROR_CODES.UPSTREAM_ERROR, response.status);

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) throw new AvatarServiceError(ERROR_CODES.UPSTREAM_ERROR);
    return buffer;
  }

  async function resolveSkin(name, timestamp) {
    const cachedUrl = skinUrlCache.get(name);
    const skinUrl = cachedUrl && cachedUrl.expiresAt > timestamp
      ? cachedUrl.skinUrl
      : await fetchSkinUrl(name, timestamp);

    const cachedBytes = skinBytesCache.get(skinUrl);
    if (cachedBytes && cachedBytes.expiresAt > timestamp) {
      return { bytes: cachedBytes.bytes, contentType: cachedBytes.contentType };
    }

    const bytes = await fetchSkinBytes(skinUrl);
    skinBytesCache.set(skinUrl, {
      bytes,
      contentType: 'image/png',
      expiresAt: timestamp + skinTtlMs
    });
    return { bytes, contentType: 'image/png' };
  }

  async function getSkinPng(username) {
    const name = String(username || '').trim();
    if (!isValidUsername(name)) throw new AvatarServiceError(ERROR_CODES.INVALID_USERNAME);

    const timestamp = now();
    const failed = failureCache.get(name);
    if (failed && failed.expiresAt > timestamp) {
      throw new AvatarServiceError(ERROR_CODES.NOT_FOUND);
    }

    if (inflight.has(name)) return inflight.get(name);

    const pending = resolveSkin(name, timestamp).finally(() => inflight.delete(name));
    inflight.set(name, pending);
    return pending;
  }

  function getStats() {
    return {
      skinUrlEntries: skinUrlCache.size,
      skinBytesEntries: skinBytesCache.size,
      failureEntries: failureCache.size,
      inflight: inflight.size
    };
  }

  function clearCache() {
    skinUrlCache.clear();
    skinBytesCache.clear();
    failureCache.clear();
  }

  return {
    getSkinPng,
    getStats,
    clearCache
  };
}

module.exports = {
  LOOKUP_API_URL,
  PROFILE_API_URL,
  ERROR_CODES,
  DEFAULT_OPTIONS,
  AvatarServiceError,
  isValidUsername,
  normalizeSkinUrl,
  decodeSkinTextures,
  createAvatarService
};
