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
  const AUTO_SCROLL_MARGIN_PX = 40;
  const panelStates = new WeakMap();

  function getLogKey(log) {
    return [
      String(log && log.botId || ''),
      String(log && log.timestamp || ''),
      String(log && log.level || ''),
      String(log && log.message || '')
    ].join('\u0000');
  }

  function sanitizeLevelClass(level) {
    return String(level || 'info').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  }

  function appendLogLines(logView, logs, startIndex) {
    const fragment = document.createDocumentFragment();
    for (let index = startIndex; index < logs.length; index += 1) {
      const log = logs[index];
      const line = document.createElement('div');
      line.className = `log-line level-${sanitizeLevelClass(log && log.level)}`;
      line.textContent = formatters.formatConsoleLogEntry(log);
      fragment.appendChild(line);
    }
    logView.appendChild(fragment);
  }

  function isNearBottom(logView) {
    return logView.scrollTop + logView.clientHeight >= logView.scrollHeight - AUTO_SCROLL_MARGIN_PX;
  }

  function renderLogsPanel(container, props) {
    const logs = (props.logs || []).filter((log) => {
      if (!props.logLevelFilter || props.logLevelFilter === 'all') return true;
      return String(log.level || '').toLowerCase() === String(props.logLevelFilter || '').toLowerCase();
    });
    const botKey = String(props.botKey || '');
    const filterKey = String(props.logLevelFilter || 'all');
    const firstKey = logs.length > 0 ? getLogKey(logs[0]) : null;
    const lastKey = logs.length > 0 ? getLogKey(logs[logs.length - 1]) : null;
    let state = panelStates.get(container);
    const tailGrewWithSameTail = Boolean(state && state.renderedCount > 0 &&
      logs.length > state.renderedCount &&
      state.lastRenderedKey === lastKey);
    const frontChanged = Boolean(state && state.renderedCount > 0 &&
      state.firstRenderedKey !== firstKey);
    const needsRebuild = !state ||
      state.botKey !== botKey ||
      state.filterKey !== filterKey ||
      logs.length < (state.renderedCount || 0) ||
      tailGrewWithSameTail ||
      frontChanged;

    let preserveScrollTop = null;
    let previousWasNearBottom = true;
    if (needsRebuild) {
      const previousLogView = container.querySelector('[data-role="log-view"]');
      if (
        previousLogView &&
        state &&
        state.botKey === botKey &&
        state.filterKey === filterKey &&
        state.renderedCount > 0
      ) {
        preserveScrollTop = previousLogView.scrollTop;
        previousWasNearBottom = isNearBottom(previousLogView);
      }

      container.innerHTML = `
        <div class="panel-section stack logs-surface">
          <div class="toolbar">
            <div class="toolbar-group bot-actions">
              <button class="button success small" type="button" data-action="start-bot"><span class="button-icon" aria-hidden="true">▶</span>启动</button>
              <button class="button warn small" type="button" data-action="stop-bot"><span class="button-icon" aria-hidden="true">■</span>停止</button>
              <button class="button danger small" type="button" data-action="restart-bot"><span class="button-icon" aria-hidden="true">↻</span>重启</button>
              <button class="button icon-button small" type="button" data-action="refresh-bot" aria-label="刷新当前 Bot" title="刷新当前 Bot"><span class="button-icon" aria-hidden="true">↻</span></button>
            </div>
            <div class="toolbar-group log-tools">
              <label class="switch-control compact">
                <span class="switch-copy">自动滚动</span>
                <input type="checkbox" data-action="toggle-autoscroll" ${props.autoScrollLogs ? 'checked' : ''}>
                <span class="switch-track" aria-hidden="true"></span>
              </label>
              <select class="select" data-action="filter-level" aria-label="日志级别">
                ${['all', 'info', 'warn', 'error', 'debug'].map((level) => `
                  <option value="${level}" ${props.logLevelFilter === level ? 'selected' : ''}>${LOG_LEVEL_LABELS[level] || level}</option>
                `).join('')}
              </select>
              <button class="button icon-button ghost small" type="button" data-action="clear-logs" aria-label="清空日志" title="清空日志"><span class="button-icon" aria-hidden="true">×</span></button>
            </div>
          </div>
          <div class="logs-heading row space"><strong>实时控制台</strong><span class="helper">${logs.length} 条</span></div>
          <div class="log-view console" data-role="log-view" data-scroll-id="bot-logs" data-scroll-managed>${logs.length === 0
            ? '<div class="empty-state">暂无日志。</div>'
            : ''}</div>
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

      state = {
        botKey,
        filterKey,
        renderedCount: 0,
        wasNearBottom: previousWasNearBottom,
        firstRenderedKey: null,
        lastRenderedKey: null
      };
      panelStates.set(container, state);
    }

    const logView = container.querySelector('[data-role="log-view"]');
    if (!logView) {
      return;
    }

    if (logs.length > state.renderedCount) {
      if (state.renderedCount === 0) {
        const emptyState = logView.querySelector('.empty-state');
        if (emptyState) {
          emptyState.remove();
        }
      }
      appendLogLines(logView, logs, state.renderedCount);
      state.renderedCount = logs.length;
      state.firstRenderedKey = firstKey;
      state.lastRenderedKey = lastKey;
      if (preserveScrollTop !== null) {
        logView.scrollTop = preserveScrollTop;
      }
    }

    const nearBottom = isNearBottom(logView);
    if (props.autoScrollLogs && (state.wasNearBottom || nearBottom)) {
      logView.scrollTop = logView.scrollHeight;
    }
    state.wasNearBottom = isNearBottom(logView);
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
