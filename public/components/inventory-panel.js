(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};
  const formatters = namespace.formatters;

  const ICON_DIR = 'assets/items';

  function getItemIconUrl(item) {
    if (!item || !item.name) return '';
    const name = String(item.name).replace(/^minecraft:/, '');
    if (!name) return '';
    return `${ICON_DIR}/${name}.png`;
  }

  const WINDOW_LABELS = {
    inventory: '背包',
    chest: '箱子',
    'large-chest': '大箱子',
    'crafting-table': '工作台',
    furnace: '熔炉'
  };

  // 已知窗口类型 → 原版 GUI 背景图（public/assets/gui/）
  const BACKGROUND_IMAGES = {
    inventory: 'inventory.png',
    chest: 'chest.png',
    'large-chest': 'generic_54.png',
    'crafting-table': 'crafting_table.png',
    furnace: 'furnace.png'
  };

  // unsupported 窗口的原始 type 尽力匹配背景图（去掉 minecraft: 前缀）
  const FALLBACK_BACKGROUND_IMAGES = {
    smoker: 'smoker.png',
    blast_furnace: 'blast_furnace.png',
    brewing_stand: 'brewing_stand.png',
    dispenser: 'dispenser.png',
    hopper: 'hopper.png',
    shulker_box: 'shulker_box.png'
  };

  // 精确对齐布局：槽位按背景图像素坐标定位（容器区 + 背包区 9x3 + 快捷栏 9）
  const SLOT_LAYOUTS = {
    chest: { image: 'chest.png', width: 176, height: 167, containerRows: 3, containerY: 17, inventoryY: 83, hotbarY: 145 },
    'large-chest': { image: 'generic_54.png', width: 176, height: 222, containerRows: 6, containerY: 17, inventoryY: 137, hotbarY: 199 },
    // 物品栏：槽位分布不规则，用显式坐标表（prismarine 槽位顺序，1.21.11 纹理实测中心坐标 -9 转左上角）
    // 0=合成结果 1-4=合成2x2 5-8=盔甲 9-35=背包 36-44=快捷栏 45=副手
    inventory: {
      image: 'inventory.png',
      width: 176,
      height: 166,
      sections: [
        { start: 0, end: 1, xs: [152.5], ys: [26.5] },
        { start: 1, end: 5, xs: [96.5, 114.5, 96.5, 114.5], ys: [16.5, 16.5, 34.5, 34.5] },
        { start: 5, end: 9, xs: [6.5, 6.5, 6.5, 6.5], ys: [6.5, 24.5, 42.5, 60.5] },
        { start: 9, end: 36, gridX: 6.5, gridY: 82.5, cols: 9, step: 18 },
        { start: 36, end: 45, gridX: 6.5, gridY: 140.5, cols: 9, step: 18 },
        { start: 45, end: 46, xs: [76.5], ys: [61.5] }
      ]
    }
  };

  function getSlotPixelPosition(slot, layout, inventory) {
    if (layout.sections) {
      const section = layout.sections.find((item) => slot >= item.start && slot < item.end);
      if (!section) return null;
      const index = slot - section.start;
      if (Array.isArray(section.xs)) {
        if (index >= section.xs.length) return null;
        return { x: section.xs[index], y: section.ys[index], w: 18, h: 18 };
      }
      const col = index % section.cols;
      const row = Math.floor(index / section.cols);
      return { x: section.gridX + col * section.step, y: section.gridY + row * section.step, w: 18, h: 18 };
    }
    if (slot < (inventory && inventory.inventoryStart)) {
      const row = Math.floor(slot / 9);
      const col = slot % 9;
      return { x: 7 + col * 18, y: layout.containerY + row * 18, w: 18, h: 18 };
    }
    const idx = slot - (inventory && inventory.inventoryStart || 0);
    const row = Math.floor(idx / 9);
    const col = idx % 9;
    if (row < 3) {
      return { x: 7 + col * 18, y: layout.inventoryY + row * 18, w: 18, h: 18 };
    }
    return { x: 7 + col * 18, y: layout.hotbarY + (row - 3) * 18, w: 18, h: 18 };
  }

  function getWindowLayout(inventory) {
    if (!inventory) return null;
    return SLOT_LAYOUTS[inventory.name] || null;
  }

  function getFallbackBackground(name) {
    const type = String(name || '').replace(/^minecraft:/, '');
    return FALLBACK_BACKGROUND_IMAGES[type] || null;
  }

  function getBackgroundImage(inventory) {
    if (!inventory) return null;
    if (inventory.supported !== false) {
      return BACKGROUND_IMAGES[inventory.name] || null;
    }
    return getFallbackBackground(inventory.name);
  }

  function toPercent(value, total) {
    return `${((value / total) * 100).toFixed(3)}%`;
  }

  function getWindowLabel(name, supported) {
    if (!name) return '窗口';
    if (supported === false) return `窗口 (${name})`;
    return WINDOW_LABELS[name] || name;
  }

  const MAX_SLOT_RENDER = 200;

  function getSlotItems(inventory, layout) {
    if (!inventory) return [];
    const start = Number.isInteger(inventory.inventoryStart) ? inventory.inventoryStart : 0;
    const end = Number.isInteger(inventory.inventoryEnd) ? inventory.inventoryEnd : 0;
    // 渲染范围覆盖布局表定义的最大槽位：即使后端 inventoryEnd 不含副手（如 45），
    // 布局表内的 45 号副手槽也要渲染，否则拖拽吸附不到它
    let total = Math.max(end, start);
    if (layout && Array.isArray(layout.sections)) {
      layout.sections.forEach((section) => {
        if (Number.isInteger(section.end) && section.end > total) {
          total = section.end;
        }
      });
    }
    // 上限保护：异常 window 数据不应生成海量空槽 DOM
    total = Math.min(total, MAX_SLOT_RENDER);
    const items = [];
    for (let slot = 0; slot < total; slot += 1) {
      items.push({
        slot,
        item: (inventory.slots && inventory.slots[String(slot)]) || null
      });
    }
    return items;
  }

  function getItemShortLabel(item) {
    if (!item) return '';
    const displayName = String(item.displayName || '').trim();
    if (displayName) {
      return Array.from(displayName)[0] || '?';
    }
    const name = String(item.name || '').replace(/^minecraft:/, '');
    return (Array.from(name)[0] || '?').toUpperCase();
  }

  function getDurabilityRatio(item) {
    if (!item) return null;
    if (
      !Number.isInteger(item.durabilityUsed) ||
      !Number.isInteger(item.maxDurability) ||
      item.maxDurability <= 0
    ) {
      return null;
    }
    return Math.max(0, Math.min(1, 1 - item.durabilityUsed / item.maxDurability));
  }

  function getItemTooltip(item) {
    if (!item) return '';
    const parts = [];
    const displayName = String(item.displayName || '').trim();
    parts.push(displayName || String(item.name || '').replace(/^minecraft:/, ''));
    if (Number.isInteger(item.count)) {
      parts.push(`×${item.count}`);
    }
    const ratio = getDurabilityRatio(item);
    if (ratio !== null) {
      parts.push(`耐久 ${item.durabilityUsed}/${item.maxDurability}`);
    }
    return parts.join(' ');
  }

  function renderSlotHtml(slot, positionStyle) {
    const index = slot.slot;
    const item = slot.item;
    const styleAttr = positionStyle ? ` style="${positionStyle}"` : '';
    if (!item) {
      return `<div class="inv-slot inv-slot-empty" data-slot="${index}"${styleAttr}></div>`;
    }

    const iconUrl = getItemIconUrl(item);
    const ratio = getDurabilityRatio(item);
    const durabilityHtml = ratio !== null
      ? `<span class="inv-slot-durability" style="--durability:${ratio.toFixed(3)}"></span>`
      : '';
    const countHtml = Number.isInteger(item.count) && item.count > 1
      ? `<span class="inv-slot-count">${item.count}</span>`
      : '';
    // 文字 label 垫底，img 图标覆盖其上；图标加载失败（404）时由 error 事件隐藏 img 露出文字
    const iconHtml = iconUrl
      ? `<img class="inv-item-icon" src="${formatters.escapeHtml(iconUrl)}" alt="" decoding="async" draggable="false">`
      : '';

    return `
      <div class="inv-slot" data-slot="${index}" title="${formatters.escapeHtml(getItemTooltip(item))}"${styleAttr}>
        <span class="inv-slot-label">${formatters.escapeHtml(getItemShortLabel(item))}</span>
        ${iconHtml}
        ${countHtml}
        ${durabilityHtml}
      </div>
    `;
  }

  // 光标（“手上拿着”）物品：绝对定位，跟随鼠标；数量/耐久/图标复用槽位那套渲染
  function renderCursorHtml(cursor) {
    if (!cursor) return '';
    const iconUrl = getItemIconUrl(cursor);
    const ratio = getDurabilityRatio(cursor);
    const countHtml = Number.isInteger(cursor.count) && cursor.count > 1
      ? `<span class="inv-slot-count">${cursor.count}</span>`
      : '';
    const durabilityHtml = ratio !== null
      ? `<span class="inv-slot-durability" style="--durability:${ratio.toFixed(3)}"></span>`
      : '';
    const iconHtml = iconUrl
      ? `<img class="inv-item-icon" src="${formatters.escapeHtml(iconUrl)}" alt="" decoding="async" draggable="false">`
      : '';

    return `
      <div class="inv-cursor-item" data-role="cursor-item" hidden title="${formatters.escapeHtml(getItemTooltip(cursor))}">
        <span class="inv-slot-label">${formatters.escapeHtml(getItemShortLabel(cursor))}</span>
        ${iconHtml}
        ${countHtml}
        ${durabilityHtml}
      </div>
    `;
  }

  function renderSlotsHtml(slots, layout, inventory) {
    if (!layout) {
      return slots.map((entry) => renderSlotHtml(entry)).join('');
    }
    return slots.map((entry) => {
      const pos = getSlotPixelPosition(entry.slot, layout, inventory);
      if (!pos) return ''; // 无位置的槽位（如物品栏副手 45）不渲染
      const style = [
        `left:${toPercent(pos.x, layout.width)}`,
        `top:${toPercent(pos.y, layout.height)}`,
        `width:${toPercent(pos.w, layout.width)}`,
        `height:${toPercent(pos.h, layout.height)}`
      ].join(';');
      return renderSlotHtml(entry, style);
    }).join('');
  }

  function renderInventoryHtml(inventory) {
    if (!inventory) {
      return `
        <div class="row space section-heading-copy">
          <div class="stack">
            <h3 class="title">背包 / 窗口</h3>
            <p class="subtitle">暂无数据</p>
          </div>
        </div>
        <div class="empty-state">Bot 未在线或尚未同步背包数据。</div>
      `;
    }

    const label = getWindowLabel(inventory.name, inventory.supported);
    const layout = getWindowLayout(inventory);
    const slots = getSlotItems(inventory, layout);
    const occupiedCount = slots.filter((entry) => entry.item).length;
    const unsupported = inventory.supported === false;
    const backgroundImage = getBackgroundImage(inventory);
    const hint = unsupported
      ? '<p class="helper">该窗口类型面板不认识，按格子列表显示；可点击“关闭窗口”退出。</p>'
      : '';

    let gridHtml;
    if (layout) {
      gridHtml = `
        <div class="inv-bg" data-role="inventory-grid" style="background-image:url('assets/gui/${layout.image}');aspect-ratio:${layout.width}/${layout.height}">
          ${renderSlotsHtml(slots, layout, inventory)}
          ${renderCursorHtml(inventory.cursor)}
        </div>
      `;
    } else {
      gridHtml = `
        <div class="inventory-grid${backgroundImage ? ' inv-grid-with-bg' : ''}" data-role="inventory-grid"${backgroundImage ? ` style="background-image:url('assets/gui/${backgroundImage}')"` : ''}>
          ${renderSlotsHtml(slots, null, inventory)}
          ${renderCursorHtml(inventory.cursor)}
        </div>
      `;
    }

    return `
      <div class="row space section-heading-copy">
        <div class="stack">
          <h3 class="title">${formatters.escapeHtml(label)}</h3>
          <p class="subtitle">${occupiedCount} 格物品${unsupported ? ' · 未识别窗口' : ''}${inventory.cursor ? ' · 手上有物品' : ''}</p>
        </div>
        <div class="row wrap inventory-actions">
          <button class="inv-drop-zone" data-role="drop-zone" type="button" title="把光标上的物品丢出去（点击窗口外）">丢出</button>
          <button class="button" data-action="close-window" type="button">关闭窗口</button>
        </div>
      </div>
      ${hint}
      ${gridHtml}
    `;
  }

  function getItemBySlot(inventory, slotText) {
    if (!inventory || !inventory.slots) return null;
    return inventory.slots[String(slotText)] || null;
  }

  const DOUBLE_CLICK_INTERVAL_MS = 300;
  const MOUSE_BUTTON_NAMES = { 0: 'left', 1: 'middle', 2: 'right' };

  function getMouseButtonName(button) {
    return MOUSE_BUTTON_NAMES[button] || null;
  }

  // 与游戏内一致：按下的一瞬间就决定语义动作；随后是否算拖拽，由“指针有没有进入别的格子”决定。
  function getPressAction(input = {}) {
    const button = Number(input.button);
    const shift = input.shiftKey === true;
    if (button === 1) return 'clone';
    if (button === 0) return shift ? 'shift' : 'left';
    if (button === 2) return shift ? 'shift-right' : 'right';
    return null;
  }

  function isDoubleClick(previous, current, intervalMs = DOUBLE_CLICK_INTERVAL_MS) {
    if (!previous || !current) return false;
    if (previous.slot !== current.slot || previous.button !== current.button) return false;
    const delta = Number(current.time) - Number(previous.time);
    return Number.isFinite(delta) && delta >= 0 && delta <= intervalMs;
  }

  function getKeyboardPayload(slot, input = {}) {
    if (!Number.isInteger(slot) || slot < 0) return null;
    const key = String(input.key || '').toLowerCase();
    if (key === 'q') {
      return { slot, action: input.ctrlKey === true ? 'dropstack' : 'drop' };
    }
    if (/^[1-9]$/.test(key)) {
      return { slot, action: 'swap', swapSlot: key };
    }
    if (key === 'f') {
      return { slot, action: 'swap', swapSlot: 'offhand' };
    }
    return null;
  }

  // 两条原版硬约束是“静默”的：返回非空字符串表示本地拦截并提示，不发请求。
  function getClientHint(payload, inventory) {
    if (!payload) return '';
    const cursor = inventory && inventory.cursor ? inventory.cursor : null;

    if (payload.action === 'drop' || payload.action === 'dropstack') {
      return cursor ? '光标上有物品时按 Q 无效（原版规则）：先放下再丢弃' : '';
    }

    if (payload.action === 'collect') {
      if (!cursor) return '双击收集需要手上先拿着同类物品：先左键拿起一格';
      const slotItem = payload.slot >= 0 ? getItemBySlot(inventory, payload.slot) : null;
      return slotItem ? '请对空格双击收集（先左键拿起，该格变空后再双击）' : '';
    }

    if (payload.slot === -999 && payload.action === 'left' && !cursor) {
      return '光标上没有物品，无需丢出';
    }

    return '';
  }

  // 拖拽状态机：按下只记录；指针首次进入别的格子才升级成拖拽序列。
  function createDragTracker() {
    let button = null;
    let originSlot = null;
    let started = false;
    const entered = new Set();

    function reset() {
      button = null;
      originSlot = null;
      started = false;
      entered.clear();
    }

    return {
      press(pressButton, slot) {
        if (button !== null) return false;
        button = Number(pressButton);
        originSlot = Number.isInteger(slot) ? slot : null;
        started = false;
        entered.clear();
        return true;
      },
      enter(slot) {
        if (button === null || !Number.isInteger(slot)) return null;
        if (entered.has(slot)) return null;
        if (!started && slot === originSlot) return null;
        entered.add(slot);
        const transition = { start: !started, add: slot, button };
        started = true;
        return transition;
      },
      release() {
        const result = { wasDrag: started, button };
        reset();
        return result;
      },
      isPressing() {
        return button !== null;
      }
    };
  }

  // 轻量乐观预测：只处理“左键把一整组拿到光标上”这一条，其余一律等 SSE 纠正。
  function createPickupOverlay(inventory, payload) {
    if (!inventory || !payload) return null;
    if (payload.action !== 'left' || !Number.isInteger(payload.slot) || payload.slot < 0) return null;
    if (inventory.cursor) return null;
    const item = getItemBySlot(inventory, payload.slot);
    if (!item) return null;
    return { cursor: item, clearedSlot: payload.slot };
  }

  function applyOptimisticOverlay(inventory, overlay) {
    if (!inventory || !overlay) return inventory;
    const slots = { ...(inventory.slots || {}) };
    if (Number.isInteger(overlay.clearedSlot)) {
      delete slots[String(overlay.clearedSlot)];
    }
    return {
      ...inventory,
      cursor: overlay.cursor === undefined ? inventory.cursor : overlay.cursor,
      slots
    };
  }

  // 光标物品坐标相对背包框架左上角；移出框架时钳在边界上（跨重渲染保留）。
  function clampCursorPoint(point, size) {
    const width = Number(size && size.width) || 0;
    const height = Number(size && size.height) || 0;
    return {
      x: Math.min(Math.max(Number(point && point.x) || 0, 0), width),
      y: Math.min(Math.max(Number(point && point.y) || 0, 0), height)
    };
  }

  function getContainerRelativePoint(container, clientX, clientY) {
    const rect = container.getBoundingClientRect();
    return {
      point: { x: clientX - rect.left, y: clientY - rect.top },
      size: { width: rect.width, height: rect.height }
    };
  }

  function applyCursorPosition(cursorEl, point) {
    if (!cursorEl || !point) return;
    cursorEl.hidden = false;
    cursorEl.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`;
  }

  function getHoveredSlot(container) {
    if (!container || !container.dataset) return null;
    const raw = container.dataset.hoverSlot;
    if (raw === undefined || raw === '') return null;
    const slot = Number(raw);
    return Number.isInteger(slot) && slot >= 0 ? slot : null;
  }

  // 跨重渲染保留的状态：组件每次重绘都会重建 DOM，这些不能放在渲染闭包里。
  let lastCursorPoint = null;
  let lastCursorSize = null;
  let lastPress = null;
  let activeInteraction = null;
  let documentReleaseBound = false;

  function bindDocumentRelease() {
    if (documentReleaseBound || typeof global.document === 'undefined') return;
    documentReleaseBound = true;
    // 指针在面板外松开也要收尾拖拽；只绑一次，避免每次重渲染叠加监听。
    global.document.addEventListener('pointerup', () => {
      if (activeInteraction) activeInteraction.releaseIfDragging();
    });
  }

  function bindSlotInteraction(container, props) {
    const panelRoot = container.querySelector('[data-role="inventory-panel"]') || container;
    const grid = container.querySelector('[data-role="inventory-grid"]');
    const cursorEl = container.querySelector('[data-role="cursor-item"]');
    const tracker = createDragTracker();

    function sendClick(payload) {
      const hint = getClientHint(payload, props.inventory);
      if (hint) {
        if (typeof props.onClientHint === 'function') props.onClientHint(hint);
        return;
      }
      if (typeof props.onWindowClick === 'function') props.onWindowClick(payload);
    }

    function sendDrag(payload) {
      if (typeof props.onWindowClick === 'function') props.onWindowClick(payload);
    }

    function closePendingDrag() {
      const pending = tracker.release();
      if (pending.wasDrag && pending.button !== null) {
        sendDrag({ slot: -999, action: 'drag-end', button: getMouseButtonName(pending.button) });
      }
    }

    function releaseIfDragging() {
      closePendingDrag();
    }

    activeInteraction = { releaseIfDragging };
    bindDocumentRelease();

    if (cursorEl && lastCursorPoint && lastCursorSize) {
      applyCursorPosition(cursorEl, lastCursorPoint);
    }

    if (grid) {
      grid.addEventListener('contextmenu', (event) => {
        event.preventDefault();
      });

      grid.addEventListener('mousedown', (event) => {
        const slotEl = event.target && event.target.closest ? event.target.closest('.inv-slot') : null;
        if (!slotEl) return;
        const slot = Number(slotEl.getAttribute('data-slot'));
        if (!Number.isInteger(slot)) return;
        const action = getPressAction({ button: event.button, shiftKey: event.shiftKey });
        if (!action) return;
        event.preventDefault();

        const now = Date.now();
        const doubleClick = action === 'left'
          && isDoubleClick(lastPress, { slot, button: event.button, time: now });

        if (doubleClick) {
          closePendingDrag();
          lastPress = null;
          sendClick({ slot, action: 'collect' });
          return;
        }

        if (action === 'shift' || action === 'shift-right') {
          // 原版 Shift+拖拽无效果：直接快速移动，不进入拖拽候选
          closePendingDrag();
          lastPress = null;
          sendClick({ slot, action });
          return;
        }

        closePendingDrag();
        lastPress = action === 'left' ? { slot, button: event.button, time: now } : null;
        tracker.press(event.button, slot);
        sendClick({ slot, action });
      });

      grid.addEventListener('pointerover', (event) => {
        const slotEl = event.target && event.target.closest ? event.target.closest('.inv-slot') : null;
        if (!slotEl) return;
        const slot = Number(slotEl.getAttribute('data-slot'));
        if (!Number.isInteger(slot)) return;
        panelRoot.dataset.hoverSlot = String(slot);

        const transition = tracker.enter(slot);
        if (!transition) return;
        const buttonName = getMouseButtonName(transition.button);
        if (!buttonName) return;
        if (transition.start) {
          sendDrag({ slot: -999, action: 'drag-start', button: buttonName });
        }
        sendDrag({ slot: transition.add, action: 'drag-add', button: buttonName });
      });

      grid.addEventListener('pointerout', (event) => {
        const slotEl = event.target && event.target.closest ? event.target.closest('.inv-slot') : null;
        if (!slotEl) return;
        const nextSlot = event.relatedTarget && event.relatedTarget.closest
          ? event.relatedTarget.closest('.inv-slot')
          : null;
        if (!nextSlot) {
          delete panelRoot.dataset.hoverSlot;
        }
      });

      grid.addEventListener('pointermove', (event) => {
        if (!cursorEl) return;
        const moved = getContainerRelativePoint(grid, event.clientX, event.clientY);
        lastCursorSize = moved.size;
        lastCursorPoint = clampCursorPoint(moved.point, moved.size);
        applyCursorPosition(cursorEl, lastCursorPoint);
      });

      grid.addEventListener('pointerleave', () => {
        // 移出框架后停在最后越界的那一点，鼠标移回来继续跟随
        if (cursorEl && lastCursorPoint) {
          applyCursorPosition(cursorEl, lastCursorPoint);
        }
      });

      grid.addEventListener('pointerup', () => {
        releaseIfDragging();
      });
    }

    const dropZone = container.querySelector('[data-role="drop-zone"]');
    if (dropZone) {
      dropZone.addEventListener('click', () => {
        sendClick({ slot: -999, action: 'left' });
      });
    }
  }

  function renderInventoryPanel(container, props) {
    container.innerHTML = `
      <section class="panel-section stack inventory-panel" data-role="inventory-panel">
        ${renderInventoryHtml(props.inventory || null)}
      </section>
    `;

    const closeButton = container.querySelector('[data-action="close-window"]');
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        if (typeof props.onCloseWindow === 'function') {
          props.onCloseWindow();
        }
      });
    }

    bindSlotInteraction(container, props);

    // 图标 404 时隐藏 img，露出垫底的文字 label
    container.querySelectorAll('.inv-item-icon').forEach((image) => {
      image.addEventListener('error', () => {
        image.hidden = true;
      }, { once: true });
      if (image.complete && image.naturalWidth === 0) {
        image.hidden = true;
      }
    });
  }

  const api = {
    WINDOW_LABELS,
    BACKGROUND_IMAGES,
    FALLBACK_BACKGROUND_IMAGES,
    SLOT_LAYOUTS,
    ICON_DIR,
    DOUBLE_CLICK_INTERVAL_MS,
    getWindowLabel,
    getSlotItems,
    getSlotPixelPosition,
    getWindowLayout,
    getFallbackBackground,
    getBackgroundImage,
    getItemShortLabel,
    getDurabilityRatio,
    getItemTooltip,
    getItemIconUrl,
    getItemBySlot,
    renderSlotHtml,
    renderCursorHtml,
    renderInventoryHtml,
    getMouseButtonName,
    getPressAction,
    isDoubleClick,
    getKeyboardPayload,
    getClientHint,
    createDragTracker,
    createPickupOverlay,
    applyOptimisticOverlay,
    clampCursorPoint,
    getHoveredSlot,
    renderInventoryPanel
  };

  namespace.components = namespace.components || {};
  namespace.components.inventoryPanel = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
