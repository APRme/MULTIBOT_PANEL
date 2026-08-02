(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};
  const STATE_TEXTS = {
    idle: '待机',
    unknown: '未知',
    online: '在线',
    starting: '启动中',
    stopped: '已停止',
    waiting_restart: '等待重启',
    stopping: '停止中',
    running: '运行中',
    offline: '离线',
    connected: '已连接',
    connecting: '连接中',
    disconnected: '已断开',
    error: '错误',
    locked: '已锁定'
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stableStringify(value) {
    if (typeof value === 'function') {
      return '[function]';
    }

    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map(stableStringify).join(',')}]`;
    }

    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  function shortenText(value, maxLength) {
    const text = String(value == null ? '' : value);
    const limit = Number.isFinite(maxLength) ? maxLength : 80;
    if (text.length <= limit) {
      return text;
    }
    return `${text.slice(0, limit - 1)}…`;
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('zh-CN');
  }

  function formatRelativeTime(value, now = Date.now()) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';

    const diffMs = Math.max(0, now - date.getTime());
    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) return `${days}天前`;
    if (hours > 0) return `${hours}小时前`;
    if (minutes > 0) return `${minutes}分钟前`;
    return `${seconds}秒前`;
  }

  function formatStateClass(value) {
    const state = String(value || 'idle').toLowerCase();
    return `state-${state.replace(/[^a-z0-9_]+/g, '_')}`;
  }

  function formatStateText(value) {
    const state = String(value || 'idle');
    return STATE_TEXTS[state.toLowerCase()] || state;
  }

  function summarizeError(value, maxLength) {
    if (!value) return '—';
    return shortenText(value, Number.isFinite(maxLength) ? maxLength : 90);
  }

  function formatLockSummary(lock) {
    if (!lock || lock.locked !== true) {
      return '未锁定';
    }

    return `已锁定 · ${lock.owner || '未知'} · ${lock.remainingText || '剩余时间未知'}`;
  }

  function formatLockDetails(lock) {
    if (!lock || lock.locked !== true) {
      return '未锁定';
    }

    return `持有者：${lock.owner || '未知'} | 原因：${lock.reason || '未说明'} | 剩余：${lock.remainingText || '未知'}`;
  }

  function formatConsoleLogEntry(log) {
    const timestamp = formatDateTime(log && log.timestamp);
    const level = String(log && log.level || 'info');
    const message = String(log && log.message || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return `${timestamp} [${level}] ${message}`.trim();
  }

  const api = {
    escapeHtml,
    stableStringify,
    shortenText,
    formatDateTime,
    formatRelativeTime,
    formatStateClass,
    formatStateText,
    summarizeError,
    formatLockSummary,
    formatLockDetails,
    formatConsoleLogEntry
  };

  namespace.formatters = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
