const fs = require('fs');
const http = require('http');
const path = require('path');
const { createAvatarService, AvatarServiceError, ERROR_CODES } = require('./lib/avatar-service');

const DEFAULT_CONFIG = {
  host: '127.0.0.1',
  port: 18081,
  title: 'MULTIBOT Panel'
};

// 版本号规则见 AGENTS.md：V<年份两位>.<自然季度>.<小版本>，小版本每提交一次加 1、跨年归零。
const PANEL_VERSION = 'V26.4.44';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function loadPanelConfig(configPath) {
  if (!configPath || !fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  const raw = fs.readFileSync(configPath, 'utf8').trim();
  if (!raw) {
    return { ...DEFAULT_CONFIG };
  }

  const parsed = JSON.parse(raw);
  return {
    ...DEFAULT_CONFIG,
    ...(parsed && typeof parsed === 'object' ? parsed : {})
  };
}

function sendJson(res, statusCode, payload) {
  setSecurityHeaders(res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  setSecurityHeaders(res);
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' http: https:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'");
  res.setHeader('X-Frame-Options', 'DENY');
}

function resolvePublicFile(publicDir, requestPath) {
  const normalizedRequestPath = requestPath === '/' ? '/index.html' : requestPath;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(normalizedRequestPath);
  } catch (error) {
    const parseError = new Error('invalid url encoding');
    parseError.statusCode = 400;
    throw parseError;
  }
  const sanitizedPath = decodedPath.replace(/^\/+/, '');
  const publicRoot = path.resolve(publicDir);
  const fullPath = path.resolve(publicRoot, sanitizedPath);
  const relativePath = path.relative(publicRoot, fullPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  return fullPath;
}

const AVATAR_ERROR_STATUS = {
  [ERROR_CODES.INVALID_USERNAME]: 400,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.RATE_LIMITED]: 429,
  [ERROR_CODES.UPSTREAM_ERROR]: 502
};

async function handleAvatarRequest(req, res, pathname, avatarService) {
  let username;
  try {
    username = decodeURIComponent(pathname.slice('/avatar/'.length));
  } catch (error) {
    sendJson(res, 400, { error: ERROR_CODES.INVALID_USERNAME });
    return;
  }

  try {
    const { bytes, contentType } = await avatarService.getSkinPng(username);
    setSecurityHeaders(res);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      'Content-Length': bytes.length
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(bytes);
  } catch (error) {
    const statusCode = error instanceof AvatarServiceError
      ? AVATAR_ERROR_STATUS[error.code] || 502
      : 502;
    sendJson(res, statusCode, { error: error instanceof AvatarServiceError ? error.code : ERROR_CODES.UPSTREAM_ERROR });
  }
}

function createPanelServer(options = {}) {
  const publicDir = options.publicDir || path.join(__dirname, 'public');
  const title = options.title || DEFAULT_CONFIG.title;
  const version = options.version || PANEL_VERSION;
  const avatarService = createAvatarService({ fetcher: options.fetcher });

  return http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = url.pathname;

      if (req.method === 'GET' && pathname === '/healthz') {
        sendJson(res, 200, { ok: true, title, version });
        return;
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/avatar/') && pathname !== '/avatar/clear-cache') {
        handleAvatarRequest(req, res, pathname, avatarService);
        return;
      }

      if (req.method === 'POST' && pathname === '/avatar/clear-cache') {
        avatarService.clearCache();
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method_not_allowed' });
        return;
      }

      const filePath = resolvePublicFile(publicDir, pathname);
      if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        sendText(res, 404, 'Not Found');
        return;
      }

      const extension = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[extension] || 'application/octet-stream';

      setSecurityHeaders(res);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(filePath);
      stream.on('error', () => {
        if (!res.headersSent) sendText(res, 500, 'Internal Server Error');
        else res.destroy();
      });
      stream.pipe(res);
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      if (!res.headersSent) {
        sendText(res, statusCode, statusCode === 400 ? error.message : 'Internal Server Error');
      } else {
        res.destroy();
      }
    }
  });
}

async function startPanelServer(options = {}) {
  const configPath = options.configPath || path.join(__dirname, 'panel.config.json');
  const config = loadPanelConfig(configPath);
  const server = createPanelServer({
    publicDir: path.join(__dirname, 'public'),
    title: config.title
  });

  await new Promise((resolve) => {
    server.listen(config.port, config.host, resolve);
  });

  return {
    config,
    server
  };
}

async function main() {
  const configPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.join(__dirname, 'panel.config.json');

  const { config, server } = await startPanelServer({ configPath });
  console.log(`[MULTIBOT_PANEL] ${PANEL_VERSION} listening on http://${config.host}:${config.port}`);

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[MULTIBOT_PANEL] fatal error:', error && error.stack ? error.stack : error);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_CONFIG,
  PANEL_VERSION,
  loadPanelConfig,
  resolvePublicFile,
  createPanelServer,
  startPanelServer
};
