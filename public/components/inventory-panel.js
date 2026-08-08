(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};
  const formatters = namespace.formatters;

  const WINDOW_LABELS = {
    inventory: '背包',
    chest: '箱子',
    'large-chest': '大箱子',
    'crafting-table': '工作台',
    furnace: '熔炉'
  };

  function getWindowLabel(name, supported) {
    if (!name) return '窗口';
    if (supported === false) return `窗口 (${name})`;
    return WINDOW_LABELS[name] || name;
  }

  const MAX_SLOT_RENDER = 200;

  function getSlotItems(inventory) {
    if (!inventory) return [];
    const start = Number.isInteger(inventory.inventoryStart) ? inventory.inventoryStart : 0;
    const end = Number.isInteger(inventory.inventoryEnd) ? inventory.inventoryEnd : 0;
    // 上限保护：异常 window 数据不应生成海量空槽 DOM
    const total = Math.min(Math.max(end, start), MAX_SLOT_RENDER);
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

  function renderSlotHtml(slot) {
    const index = slot.slot;
    const item = slot.item;
    if (!item) {
      return `<div class="inv-slot inv-slot-empty" data-slot="${index}"></div>`;
    }

    const ratio = getDurabilityRatio(item);
    const durabilityHtml = ratio !== null
      ? `<span class="inv-slot-durability" style="--durability:${ratio.toFixed(3)}"></span>`
      : '';
    const countHtml = Number.isInteger(item.count) && item.count > 1
      ? `<span class="inv-slot-count">${item.count}</span>`
      : '';

    return `
      <div class="inv-slot" data-slot="${index}" draggable="true" title="${formatters.escapeHtml(getItemTooltip(item))}">
        <span class="inv-slot-label">${formatters.escapeHtml(getItemShortLabel(item))}</span>
        ${countHtml}
        ${durabilityHtml}
      </div>
    `;
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
    const slots = getSlotItems(inventory);
    const occupiedCount = slots.filter((entry) => entry.item).length;
    const unsupported = Boolean(inventory) && inventory.supported === false;
    const hint = unsupported
      ? '<p class="helper">该窗口类型面板不认识，按格子列表显示；可点击“关闭窗口”退出。</p>'
      : '';

    return `
      <div class="row space section-heading-copy">
        <div class="stack">
          <h3 class="title">${formatters.escapeHtml(label)}</h3>
          <p class="subtitle">${occupiedCount} 格物品${unsupported ? ' · 未识别窗口' : ''}</p>
        </div>
        <button class="button" data-action="close-window" type="button">关闭窗口</button>
      </div>
      ${hint}
      <div class="inventory-grid" data-role="inventory-grid">
        ${slots.map(renderSlotHtml).join('')}
      </div>
    `;
  }

  function getItemBySlot(inventory, slotText) {
    if (!inventory || !inventory.slots) return null;
    return inventory.slots[String(slotText)] || null;
  }

  function resolveDropCount(inventory, fromSlot, event) {
    const item = getItemBySlot(inventory, fromSlot);
    if (!item || !Number.isInteger(item.count)) return null;
    if (event && event.shiftKey) return Math.max(1, Math.floor(item.count / 2));
    if (event && (event.altKey || event.ctrlKey)) return 1;
    return null;
  }

  function bindSlotDragAndDrop(container, props) {
    const grid = container.querySelector('[data-role="inventory-grid"]');
    if (!grid) return;

    let dragFrom = null;

    grid.addEventListener('dragstart', (event) => {
      const slotEl = event.target && event.target.closest
        ? event.target.closest('[data-slot]')
        : null;
      if (!slotEl) {
        event.preventDefault();
        return;
      }
      const fromSlot = Number(slotEl.getAttribute('data-slot'));
      if (!getItemBySlot(props.inventory, fromSlot)) {
        event.preventDefault();
        return;
      }
      dragFrom = fromSlot;
      event.dataTransfer.setData('text/plain', String(fromSlot));
      event.dataTransfer.effectAllowed = 'move';
    });

    grid.addEventListener('dragover', (event) => {
      const slotEl = event.target && event.target.closest
        ? event.target.closest('[data-slot]')
        : null;
      if (!slotEl) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });

    grid.addEventListener('drop', (event) => {
      const slotEl = event.target && event.target.closest
        ? event.target.closest('[data-slot]')
        : null;
      if (!slotEl) return;
      event.preventDefault();
      if (dragFrom === null || typeof props.onMoveItem !== 'function') return;
      const toSlot = Number(slotEl.getAttribute('data-slot'));
      if (toSlot === dragFrom) {
        dragFrom = null;
        return;
      }
      const count = resolveDropCount(props.inventory, dragFrom, event);
      props.onMoveItem(dragFrom, toSlot, count);
      dragFrom = null;
    });

    grid.addEventListener('dragend', () => {
      dragFrom = null;
    });
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

    bindSlotDragAndDrop(container, props);
  }

  const api = {
    WINDOW_LABELS,
    getWindowLabel,
    getSlotItems,
    getItemShortLabel,
    getDurabilityRatio,
    getItemTooltip,
    renderSlotHtml,
    renderInventoryHtml,
    resolveDropCount,
    renderInventoryPanel
  };

  namespace.components = namespace.components || {};
  namespace.components.inventoryPanel = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
