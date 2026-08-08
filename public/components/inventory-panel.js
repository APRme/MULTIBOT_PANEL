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

  function renderSlotHtml(slot, positionStyle) {
    const index = slot.slot;
    const item = slot.item;
    const styleAttr = positionStyle ? ` style="${positionStyle}"` : '';
    if (!item) {
      return `<div class="inv-slot inv-slot-empty" data-slot="${index}"${styleAttr}></div>`;
    }

    const ratio = getDurabilityRatio(item);
    const durabilityHtml = ratio !== null
      ? `<span class="inv-slot-durability" style="--durability:${ratio.toFixed(3)}"></span>`
      : '';
    const countHtml = Number.isInteger(item.count) && item.count > 1
      ? `<span class="inv-slot-count">${item.count}</span>`
      : '';

    return `
      <div class="inv-slot" data-slot="${index}" draggable="true" title="${formatters.escapeHtml(getItemTooltip(item))}"${styleAttr}>
        <span class="inv-slot-label">${formatters.escapeHtml(getItemShortLabel(item))}</span>
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
    const slots = getSlotItems(inventory);
    const occupiedCount = slots.filter((entry) => entry.item).length;
    const unsupported = inventory.supported === false;
    const layout = getWindowLayout(inventory);
    const backgroundImage = getBackgroundImage(inventory);
    const hint = unsupported
      ? '<p class="helper">该窗口类型面板不认识，按格子列表显示；可点击“关闭窗口”退出。</p>'
      : '';

    let gridHtml;
    if (layout) {
      gridHtml = `
        <div class="inv-bg" data-role="inventory-grid" style="background-image:url('assets/gui/${layout.image}');aspect-ratio:${layout.width}/${layout.height}">
          ${renderSlotsHtml(slots, layout, inventory)}
        </div>
      `;
    } else {
      gridHtml = `
        <div class="inventory-grid${backgroundImage ? ' inv-grid-with-bg' : ''}" data-role="inventory-grid"${backgroundImage ? ` style="background-image:url('assets/gui/${backgroundImage}')"` : ''}>
          ${renderSlotsHtml(slots, null, inventory)}
        </div>
      `;
    }

    return `
      <div class="row space section-heading-copy">
        <div class="stack">
          <h3 class="title">${formatters.escapeHtml(label)}</h3>
          <p class="subtitle">${occupiedCount} 格物品${unsupported ? ' · 未识别窗口' : ''}</p>
        </div>
        <button class="button" data-action="close-window" type="button">关闭窗口</button>
      </div>
      ${hint}
      ${gridHtml}
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
    BACKGROUND_IMAGES,
    FALLBACK_BACKGROUND_IMAGES,
    SLOT_LAYOUTS,
    getWindowLabel,
    getSlotItems,
    getSlotPixelPosition,
    getWindowLayout,
    getFallbackBackground,
    getBackgroundImage,
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
