(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};

  // 仅 iOS Safari 且非独立窗口时显示；iOS 没有 beforeinstallprompt，只能给手动步骤。
  function renderInstallHint(container, props) {
    const visible = props && props.visible === true;

    if (!visible) {
      container.innerHTML = '';
      container.hidden = true;
      return;
    }

    container.hidden = false;
    container.innerHTML = `
      <div class="install-hint" role="region" aria-label="添加到主屏幕引导">
        <div class="install-hint-body">
          <strong>添加到主屏幕</strong>
          <ol class="install-hint-steps">
            <li>点 Safari 底部的 <span class="install-hint-key" aria-label="分享">分享</span> 按钮</li>
            <li>选择「添加到主屏幕」</li>
            <li>点右上角「添加」</li>
          </ol>
        </div>
        <button class="install-hint-close" type="button" data-action="dismiss-install-hint" aria-label="不再提示"><span aria-hidden="true">×</span></button>
      </div>
    `;

    container.querySelector('[data-action="dismiss-install-hint"]')?.addEventListener('click', () => {
      if (typeof props.onDismiss === 'function') {
        props.onDismiss();
      }
    });
  }

  const api = { renderInstallHint };

  namespace.components = namespace.components || {};
  namespace.components.installHint = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
