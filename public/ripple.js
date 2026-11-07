(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};

  // 尺寸取"覆盖最远角的直径"，
  // 进入 550ms 后停在 0.3，松开再 550ms 淡出。
  // 区别：ripple 挂在全局图层而非宿主元素内——本面板会频繁重渲染替换节点，
  // 挂在宿主内部会导致松开后的淡出被直接销毁。
  const RIPPLE_SELECTOR = 'button:not(.toast-close):not(.drawer-backdrop), [role="tab"], .list-card';
  const RIPPLE_DURATION = 550;
  const RIPPLE_DELAY_TOUCH = 80;
  const LAYER_ID = 'ripple-layer';

  let bound = false;
  const keyboardRipples = new WeakMap();

  function rippleHost(target) {
    if (!target || typeof target.closest !== 'function') return null;
    const host = target.closest(RIPPLE_SELECTOR);
    if (!host) return null;
    if (host.disabled || host.getAttribute('aria-disabled') === 'true') return null;
    if (host.closest('input, textarea, select')) return null;
    return host;
  }

  function ensureLayer(document) {
    let layer = document.getElementById(LAYER_ID);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = LAYER_ID;
      layer.className = 'ripple-layer';
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);
    }
    return layer;
  }

  // 指针位置 + 覆盖最远角的直径
  function computeRipple(width, height, offsetX, offsetY, center) {
    let x;
    let y;
    if (center || offsetX == null || offsetY == null) {
      x = Math.round(width / 2);
      y = Math.round(height / 2);
    } else {
      x = Math.round(offsetX);
      y = Math.round(offsetY);
    }

    let size;
    if (center) {
      size = Math.sqrt((2 * width ** 2 + height ** 2) / 3);
      if (size % 2 === 0) size += 1;
    } else {
      const sizeX = Math.max(Math.abs(width - x), x) * 2 + 2;
      const sizeY = Math.max(Math.abs(height - y), y) * 2 + 2;
      size = Math.sqrt(sizeX ** 2 + sizeY ** 2);
    }
    return { x, y, size };
  }

  function createRipple(host, options = {}) {
    const document = host.ownerDocument || global.document;
    const rect = host.getBoundingClientRect();
    const width = host.clientWidth || rect.width;
    const height = host.clientHeight || rect.height;
    const center = options.center === true;

    const offsetX = center || options.clientX == null ? null : options.clientX - rect.left;
    const offsetY = center || options.clientY == null ? null : options.clientY - rect.top;
    const { x, y, size } = computeRipple(width, height, offsetX, offsetY, center);

    const style = global.getComputedStyle(host);
    const clip = document.createElement('div');
    clip.className = 'ripple-clip';
    clip.style.left = `${rect.left}px`;
    clip.style.top = `${rect.top}px`;
    clip.style.width = `${rect.width}px`;
    clip.style.height = `${rect.height}px`;
    clip.style.borderRadius = style.borderRadius;
    // 让 currentColor 跟随宿主文字色（ripple 挂在全局图层上，无法自然继承）
    clip.style.color = style.color;

    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    if (options.pulsate === true) ripple.classList.add('is-pulsate');
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${x - size / 2}px`;
    ripple.style.top = `${y - size / 2}px`;

    const child = document.createElement('span');
    child.className = 'ripple-child';
    ripple.appendChild(child);
    clip.appendChild(ripple);
    ensureLayer(document).appendChild(clip);

    global.requestAnimationFrame(() => ripple.classList.add('is-visible'));
    return { clip, ripple };
  }

  function fadeRipple(created) {
    const { clip, ripple } = created;
    if (!ripple || ripple.dataset.leaving === '1') return;
    ripple.dataset.leaving = '1';
    ripple.classList.add('is-leaving');
    global.setTimeout(() => {
      if (clip && clip.parentNode) clip.parentNode.removeChild(clip);
    }, RIPPLE_DURATION + 50);
  }

  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const host = rippleHost(event.target);
    if (!host) return;

    const end = (created) => {
      const stop = () => {
        fadeRipple(created);
        global.document.removeEventListener('pointerup', stop);
        global.document.removeEventListener('pointercancel', stop);
      };
      global.document.addEventListener('pointerup', stop, { once: true });
      global.document.addEventListener('pointercancel', stop, { once: true });
    };

    if (event.pointerType === 'touch') {
      const timer = global.setTimeout(() => {
        const created = createRipple(host, { clientX: event.clientX, clientY: event.clientY });
        if (created) end(created);
      }, RIPPLE_DELAY_TOUCH);
      const cancel = () => {
        global.clearTimeout(timer);
        global.document.removeEventListener('pointerup', cancel);
        global.document.removeEventListener('pointercancel', cancel);
      };
      global.document.addEventListener('pointerup', cancel, { once: true });
      global.document.addEventListener('pointercancel', cancel, { once: true });
      return;
    }

    const created = createRipple(host, { clientX: event.clientX, clientY: event.clientY });
    if (created) end(created);
  }

  function onFocusIn(event) {
    const host = rippleHost(event.target);
    if (!host || !host.matches(':focus-visible')) return;
    if (keyboardRipples.has(host)) return;
    const created = createRipple(host, { center: true, pulsate: true });
    if (created) keyboardRipples.set(host, created);
  }

  function onFocusOut(event) {
    const host = rippleHost(event.target);
    if (!host) return;
    const created = keyboardRipples.get(host);
    if (!created) return;
    keyboardRipples.delete(host);
    fadeRipple(created);
  }

  function init(options = {}) {
    if (bound) return;
    const document = options.document || global.document;
    if (!document) return;
    bound = true;
    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
  }

  const api = { init };

  namespace.ripple = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
