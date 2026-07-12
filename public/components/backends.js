(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};
  const formatters = namespace.formatters;

  function renderBackendEditor(editor) {
    if (!editor || !editor.open) {
      return '';
    }

    const draft = editor.draft || {};
    const tokenInputType = editor.showToken ? 'text' : 'password';

    return `
      <div class="panel-section stack">
        <div class="row space">
          <strong>${editor.mode === 'edit' ? '编辑后端' : '新增后端'}</strong>
          <button class="button ghost" data-action="cancel-editor">取消</button>
        </div>
        ${editor.error ? `<div class="message-banner">${formatters.escapeHtml(editor.error)}</div>` : ''}
        <label class="label">
          <span>名称</span>
          <input class="input" data-field="name" value="${formatters.escapeHtml(draft.name || '')}" placeholder="例如：本地服务">
        </label>
        <label class="label">
          <span>地址</span>
          <input class="input mono" data-field="baseUrl" value="${formatters.escapeHtml(draft.baseUrl || '')}" placeholder="http://127.0.0.1:18080">
        </label>
        <label class="label">
          <span>Token</span>
          <input class="input mono" type="${tokenInputType}" data-field="token" value="${formatters.escapeHtml(draft.token || '')}" placeholder="Bearer Token">
        </label>
        <label class="row helper">
          <input type="checkbox" data-action="toggle-token" ${editor.showToken ? 'checked' : ''}>
          显示 Token
        </label>
        <label class="row helper">
          <input type="checkbox" data-field="enabled" ${draft.enabled !== false ? 'checked' : ''}>
          启用后端并参与自动刷新
        </label>
        <div class="row wrap">
          <button class="button primary" data-action="save-editor">保存</button>
          <button class="button" data-action="test-backend">测试连接</button>
        </div>
      </div>
    `;
  }

  function renderBackendsPanel(container, props) {
    const backends = props.backends || [];

    container.innerHTML = `
      <div class="panel-section row space">
        <div class="stack">
          <h2 class="title">后端管理</h2>
          <p class="subtitle">管理多个 MULTIBOT 后端</p>
        </div>
        <div class="row wrap">
          <button class="button primary" data-action="add-backend">新增</button>
          <button class="button ghost" data-action="close-modal">关闭</button>
        </div>
      </div>
      ${renderBackendEditor(props.editor)}
      <div class="list">
        ${backends.length === 0
          ? '<div class="empty-state">还没有后端配置，点击“新增”开始。</div>'
          : backends.map((backend) => `
              <div class="list-card ${props.selectedBackendId === backend.id ? 'selected' : ''}" data-backend-id="${formatters.escapeHtml(backend.id)}">
                <div class="row space">
                  <div class="stack">
                    <strong>${formatters.escapeHtml(backend.name)}</strong>
                    <span class="subtitle mono">${formatters.escapeHtml(backend.baseUrl)}</span>
                  </div>
                  <span class="badge ${formatters.formatStateClass(backend.connectionState)}">${formatters.escapeHtml(formatters.formatStateText(backend.connectionState))}</span>
                </div>
                <div class="row wrap">
                  <span class="chip">Token：${backend.token ? '已设置' : '未设置'}</span>
                  <span class="chip">Bot：${backend.bots && backend.bots.allIds ? backend.bots.allIds.length : 0} 个</span>
                  <span class="chip">自动刷新：${backend.enabled !== false ? '开' : '关'}</span>
                </div>
                <div class="helper">${formatters.escapeHtml(formatters.summarizeError(backend.lastError))}</div>
                <div class="row wrap">
                  <button class="button ${backend.enabled !== false ? 'warn' : 'success'}" data-action="toggle-enabled" data-backend-id="${formatters.escapeHtml(backend.id)}">
                    ${backend.enabled !== false ? '禁用' : '启用'}
                  </button>
                  <button class="button" data-action="edit-backend" data-backend-id="${formatters.escapeHtml(backend.id)}">编辑</button>
                  <button class="button danger" data-action="delete-backend" data-backend-id="${formatters.escapeHtml(backend.id)}">删除</button>
                </div>
              </div>
            `).join('')}
      </div>
    `;

    container.querySelector('[data-action="add-backend"]')?.addEventListener('click', () => props.onAddBackend());
    container.querySelector('[data-action="close-modal"]')?.addEventListener('click', () => {
      if (typeof props.onCloseModal === 'function') {
        props.onCloseModal();
      }
    });
    container.querySelector('[data-action="cancel-editor"]')?.addEventListener('click', () => props.onCancelEditor());
    container.querySelector('[data-action="save-editor"]')?.addEventListener('click', () => props.onSaveEditor());
    container.querySelector('[data-action="test-backend"]')?.addEventListener('click', () => props.onTestBackend());
    container.querySelector('[data-action="toggle-token"]')?.addEventListener('change', (event) => props.onToggleShowToken(event.target.checked));

    container.querySelectorAll('[data-field="name"], [data-field="baseUrl"], [data-field="token"]').forEach((element) => {
      element.addEventListener('input', (event) => {
        props.onUpdateEditorField(event.target.getAttribute('data-field'), event.target.value);
      });
    });

    container.querySelector('[data-field="enabled"]')?.addEventListener('change', (event) => {
      props.onUpdateEditorField('enabled', event.target.checked);
    });

    container.querySelectorAll('[data-backend-id]').forEach((element) => {
      element.addEventListener('click', (event) => {
        const actionElement = event.target.closest('[data-action]');
        const backendId = element.getAttribute('data-backend-id');

        if (actionElement) {
          const action = actionElement.getAttribute('data-action');
          if (action === 'toggle-enabled') props.onToggleEnabled(backendId);
          if (action === 'edit-backend') props.onEditBackend(backendId);
          if (action === 'delete-backend') props.onDeleteBackend(backendId);
          event.stopPropagation();
          return;
        }

        props.onSelectBackend(backendId);
      });
    });
  }

  const api = {
    renderBackendsPanel
  };

  namespace.components = namespace.components || {};
  namespace.components.backends = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
