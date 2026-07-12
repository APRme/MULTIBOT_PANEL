(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};
  const formatters = namespace.formatters;

  function renderStatusBar(container, props) {
    const selectedBackend = props.selectedBackend;
    const selectedBot = props.selectedBot;
    const globalMessage = props.globalMessage;
    const backendCount = Number.isFinite(props.backendCount) ? props.backendCount : 0;

    const backendStateClass = selectedBackend
      ? formatters.formatStateClass(selectedBackend.connectionState)
      : formatters.formatStateClass('idle');

    container.innerHTML = `
      <div class="row space wrap">
        <div class="stack">
          <h1 class="title">${formatters.escapeHtml(props.title || 'MULTIBOT 控制面板')}</h1>
          <p class="subtitle">
            ${selectedBackend
              ? `${formatters.escapeHtml(selectedBackend.name)} · ${formatters.escapeHtml(selectedBackend.baseUrl)}`
              : '未选择后端'}
          </p>
        </div>
        <div class="row wrap">
          ${selectedBackend
            ? `<span class="badge ${backendStateClass}">${formatters.escapeHtml(formatters.formatStateText(selectedBackend.connectionState))}</span>`
            : ''}
          ${selectedBot
            ? `<span class="chip">当前 Bot：<span class="mono">${formatters.escapeHtml(selectedBot.id)}</span></span>`
            : ''}
          <button class="button" data-action="open-backends">后端（${backendCount}）</button>
          <button class="button" data-action="open-instances" ${selectedBackend ? '' : 'disabled'}>实例</button>
          <button class="button primary" data-action="refresh">刷新</button>
        </div>
      </div>
      ${globalMessage
        ? `<div class="panel-section">
            <div class="message-banner row space">
              <span>${formatters.escapeHtml(globalMessage)}</span>
              <button class="button ghost" data-action="dismiss-message">关闭</button>
            </div>
          </div>`
        : ''}
    `;

    container.querySelector('[data-action="open-backends"]')?.addEventListener('click', () => {
      if (typeof props.onOpenBackends === 'function') {
        props.onOpenBackends();
      }
    });

    container.querySelector('[data-action="open-instances"]')?.addEventListener('click', () => {
      if (typeof props.onOpenInstances === 'function') {
        props.onOpenInstances();
      }
    });

    container.querySelector('[data-action="refresh"]')?.addEventListener('click', () => {
      props.onRefresh();
    });

    container.querySelector('[data-action="dismiss-message"]')?.addEventListener('click', () => {
      props.onDismissMessage();
    });
  }

  const api = {
    renderStatusBar
  };

  namespace.components = namespace.components || {};
  namespace.components.statusBar = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
