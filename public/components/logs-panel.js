(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};
  const formatters = namespace.formatters;
  const LOG_LEVEL_LABELS = {
    all: '全部',
    info: '信息',
    warn: '警告',
    error: '错误',
    debug: '调试'
  };

  function renderLogsPanel(container, props) {
    const logs = (props.logs || []).filter((log) => {
      if (!props.logLevelFilter || props.logLevelFilter === 'all') return true;
      return String(log.level || '').toLowerCase() === String(props.logLevelFilter || '').toLowerCase();
    });

    container.innerHTML = `
      <div class="panel-section stack">
        <div class="toolbar">
          <div class="toolbar-group">
            <button class="button success small" data-action="start-bot">启动</button>
            <button class="button warn small" data-action="stop-bot">停止</button>
            <button class="button danger small" data-action="restart-bot">重启</button>
            <button class="button small" data-action="refresh-bot">刷新</button>
          </div>
          <div class="toolbar-group">
            <label class="row helper">
              <input type="checkbox" data-action="toggle-autoscroll" ${props.autoScrollLogs ? 'checked' : ''}>
              自动滚动
            </label>
            <select class="select" data-action="filter-level">
              ${['all', 'info', 'warn', 'error', 'debug'].map((level) => `
                <option value="${level}" ${props.logLevelFilter === level ? 'selected' : ''}>${LOG_LEVEL_LABELS[level] || level}</option>
              `).join('')}
            </select>
            <button class="button ghost small" data-action="clear-logs">清空</button>
          </div>
        </div>
        <div class="helper">控制台日志</div>
        <div class="log-view console" data-role="log-view" data-scroll-id="bot-logs">${logs.length === 0
          ? '<div class="empty-state">暂无日志。</div>'
          : logs.map((log) => `<div class="log-line level-${formatters.escapeHtml(String(log.level || 'info').toLowerCase())}">${formatters.escapeHtml(formatters.formatConsoleLogEntry(log))}</div>`).join('')}</div>
      </div>
    `;

    container.querySelector('[data-action="start-bot"]')?.addEventListener('click', () => props.onStartBot());
    container.querySelector('[data-action="stop-bot"]')?.addEventListener('click', () => props.onStopBot());
    container.querySelector('[data-action="restart-bot"]')?.addEventListener('click', () => props.onRestartBot());
    container.querySelector('[data-action="refresh-bot"]')?.addEventListener('click', () => props.onRefreshBot());

    container.querySelector('[data-action="toggle-autoscroll"]')?.addEventListener('change', (event) => {
      props.onToggleAutoScroll(event.target.checked);
    });

    container.querySelector('[data-action="clear-logs"]')?.addEventListener('click', () => {
      props.onClearLogs();
    });

    container.querySelector('[data-action="filter-level"]')?.addEventListener('change', (event) => {
      props.onChangeLogLevel(event.target.value);
    });

    const logView = container.querySelector('[data-role="log-view"]');
    if (props.autoScrollLogs && logView) {
      logView.scrollTop = logView.scrollHeight;
    }
  }

  const api = {
    renderLogsPanel
  };

  namespace.components = namespace.components || {};
  namespace.components.logsPanel = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
