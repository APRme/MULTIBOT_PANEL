(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};
  const formatters = namespace.formatters;

  function renderBotDetail(container, props) {
    const backend = props.backend;
    const bot = props.bot;
    const desiredRunningText = typeof bot?.desiredRunning === 'boolean'
      ? (bot.desiredRunning ? '是' : '否')
      : String(bot?.desiredRunning ?? '-');

    if (!backend || !bot) {
      container.innerHTML = '<div class="empty-state empty-state-composed detail-empty"><strong>选择一个 Bot</strong><span>查看实时日志、运行状态并发送控制台输入。</span></div>';
      return {
        logsContainer: null,
        commandContainer: null
      };
    }

    container.innerHTML = `
      <div class="detail-main">
        <div class="panel-section">
          <div class="detail-header">
            <div class="stack detail-identity">
              <h2 class="title mono">${formatters.escapeHtml(bot.id)}</h2>
              <p class="subtitle">${formatters.escapeHtml(bot.username || '-')}</p>
            </div>
            <div class="row wrap">
              <span class="badge ${formatters.formatStateClass(bot.state)}">${formatters.escapeHtml(formatters.formatStateText(bot.state))}</span>
              ${bot.lock && bot.lock.locked ? '<span class="badge state-locked">已锁定</span>' : ''}
            </div>
          </div>
        </div>
        <div data-slot="logs-panel"></div>
        <div data-slot="inventory-panel"></div>
        <div class="detail-bottom">
          <div class="panel-section stack detail-overview">
            <div class="section-heading-copy">
              <strong>运行概览</strong>
              <span class="helper">当前实例的连接与生命周期摘要</span>
            </div>
            <div class="meta-grid">
              <div class="meta-item"><strong>${formatters.escapeHtml(desiredRunningText)}</strong><span class="helper">期望运行</span></div>
              <div class="meta-item"><strong>${formatters.escapeHtml(String(bot.spawnCount || 0))}</strong><span class="helper">启动次数</span></div>
              <div class="meta-item"><strong>${formatters.escapeHtml(formatters.formatDateTime(bot.lastSpawnAt))}</strong><span class="helper">最近启动</span></div>
              <div class="meta-item"><strong>${formatters.escapeHtml(formatters.formatDateTime(bot.lastEndAt))}</strong><span class="helper">最近断开</span></div>
            </div>
            <div class="detail-info-list">
              <div class="detail-info-item">
                <div class="helper">地址</div>
                <div class="mono">${formatters.escapeHtml(`${bot.host || '-'}:${bot.port || '-'}`)}</div>
              </div>
              <div class="detail-info-item">
                <div class="helper">锁定</div>
                <div>${formatters.escapeHtml(formatters.formatLockDetails(bot.lock))}</div>
              </div>
              <div class="detail-info-item">
                <div class="helper">录制</div>
                <div class="mono">${formatters.escapeHtml(bot.recorderStatus || '-')}</div>
              </div>
              <div class="detail-info-item">
                <div class="helper">最近错误</div>
                <div class="mono">${formatters.escapeHtml(formatters.summarizeError(bot.lastFailure || bot.lastError || bot.lastKick, 240))}</div>
              </div>
            </div>
          </div>
          <div data-slot="command-panel"></div>
        </div>
      </div>
    `;

    return {
      logsContainer: container.querySelector('[data-slot="logs-panel"]'),
      inventoryContainer: container.querySelector('[data-slot="inventory-panel"]'),
      commandContainer: container.querySelector('[data-slot="command-panel"]')
    };
  }

  const api = {
    renderBotDetail
  };

  namespace.components = namespace.components || {};
  namespace.components.botDetail = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
