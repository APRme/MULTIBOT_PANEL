(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};
  const formatters = namespace.formatters;

  const KINDS = ['neutral', 'success', 'error'];

  function normalizeKind(kind) {
    const value = String(kind || '').trim().toLowerCase();
    return KINDS.includes(value) ? value : 'neutral';
  }

  function renderToast(container, props) {
    const message = props && props.message ? String(props.message) : '';
    const kind = normalizeKind(props && props.kind);

    if (!message) {
      container.innerHTML = '';
      container.hidden = true;
      return;
    }

    container.hidden = false;
    const role = kind === 'error' ? 'alert' : 'status';
    container.innerHTML = `
      <div class="toast toast-${kind}" role="${role}">
        <span class="toast-text">${formatters.escapeHtml(message)}</span>
        <button class="toast-close" type="button" data-action="dismiss-toast" aria-label="关闭提示"><span aria-hidden="true">×</span></button>
      </div>
    `;

    container.querySelector('[data-action="dismiss-toast"]')?.addEventListener('click', () => {
      if (typeof props.onDismiss === 'function') {
        props.onDismiss();
      }
    });
  }

  const api = {
    renderToast,
    normalizeKind
  };

  namespace.components = namespace.components || {};
  namespace.components.toast = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
