const test = require('node:test');
const assert = require('node:assert/strict');

global.MultibotPanel = {
  formatters: {
    escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  }
};

const inventoryPanel = require('../public/components/inventory-panel.js');

function createChestInventory() {
  return {
    id: 3,
    name: 'chest',
    supported: true,
    inventoryStart: 27,
    inventoryEnd: 54,
    slots: {
      '2': { slot: 2, name: 'minecraft:oak_planks', displayName: '橡木木板', count: 64, metadata: 0, durabilityUsed: null, maxDurability: null },
      '30': { slot: 30, name: 'minecraft:iron_pickaxe', displayName: '铁镐', count: 1, metadata: 0, durabilityUsed: 100, maxDurability: 250 }
    }
  };
}

test('window labels map known types to Chinese and degrade unknown windows', () => {
  assert.equal(inventoryPanel.getWindowLabel('inventory', true), '背包');
  assert.equal(inventoryPanel.getWindowLabel('chest', true), '箱子');
  assert.equal(inventoryPanel.getWindowLabel('large-chest', true), '大箱子');
  assert.equal(inventoryPanel.getWindowLabel('crafting-table', true), '工作台');
  assert.equal(inventoryPanel.getWindowLabel('furnace', true), '熔炉');
  assert.equal(inventoryPanel.getWindowLabel('minecraft:some_menu', false), '窗口 (minecraft:some_menu)');
  assert.equal(inventoryPanel.getWindowLabel('', true), '窗口');
});

test('slot items are expanded into a full slot range', () => {
  const items = inventoryPanel.getSlotItems(createChestInventory());
  assert.equal(items.length, 54);
  assert.equal(items[0].item, null);
  assert.equal(items[2].item.name, 'minecraft:oak_planks');
  assert.equal(items[30].item.count, 1);
  assert.equal(inventoryPanel.getSlotItems(null).length, 0);
});

test('item short labels prefer display name initials', () => {
  assert.equal(inventoryPanel.getItemShortLabel({ displayName: '橡木木板' }), '橡');
  assert.equal(inventoryPanel.getItemShortLabel({ name: 'minecraft:oak_planks', displayName: '' }), 'O');
  assert.equal(inventoryPanel.getItemShortLabel(null), '');
});

test('durability ratio clamps between zero and one', () => {
  assert.equal(inventoryPanel.getDurabilityRatio({ durabilityUsed: 100, maxDurability: 250 }), 0.6);
  assert.equal(inventoryPanel.getDurabilityRatio({ durabilityUsed: 0, maxDurability: 250 }), 1);
  assert.equal(inventoryPanel.getDurabilityRatio({ durabilityUsed: 250, maxDurability: 250 }), 0);
  assert.equal(inventoryPanel.getDurabilityRatio({ durabilityUsed: 100, maxDurability: 0 }), null);
  assert.equal(inventoryPanel.getDurabilityRatio({}), null);
});

test('item tooltip includes count and durability', () => {
  assert.equal(inventoryPanel.getItemTooltip({ displayName: '橡木木板', count: 64 }), '橡木木板 ×64');
  assert.equal(
    inventoryPanel.getItemTooltip({ displayName: '铁镐', count: 1, durabilityUsed: 100, maxDurability: 250 }),
    '铁镐 ×1 耐久 100/250'
  );
  assert.equal(inventoryPanel.getItemTooltip(null), '');
});

test('slot html renders empty slots, counts and durability bars', () => {
  const empty = inventoryPanel.renderSlotHtml({ slot: 5, item: null });
  assert.match(empty, /inv-slot-empty/);
  assert.match(empty, /data-slot="5"/);

  const occupied = inventoryPanel.renderSlotHtml({
    slot: 2,
    item: { slot: 2, displayName: '橡木木板', count: 64, durabilityUsed: null, maxDurability: null }
  });
  assert.match(occupied, /橡/);
  assert.match(occupied, /64/);
  assert.doesNotMatch(occupied, /inv-slot-durability/);

  const worn = inventoryPanel.renderSlotHtml({
    slot: 2,
    item: { slot: 2, displayName: '铁镐', count: 1, durabilityUsed: 100, maxDurability: 250 }
  });
  assert.match(worn, /inv-slot-durability/);
  assert.match(worn, /--durability:0.600/);
});

test('inventory html shows empty state for missing data', () => {
  const html = inventoryPanel.renderInventoryHtml(null);
  assert.match(html, /暂无数据/);
  assert.doesNotMatch(html, /data-action="close-window"/);
});

test('inventory html renders grid, close button and unsupported hint', () => {
  const html = inventoryPanel.renderInventoryHtml(createChestInventory());
  assert.match(html, /箱子/);
  assert.match(html, /2 格物品/);
  assert.match(html, /data-action="close-window"/);
  assert.match(html, /data-role="inventory-grid"/);
  assert.doesNotMatch(html, /未识别窗口/);

  const unsupported = inventoryPanel.renderInventoryHtml({
    id: 9,
    name: 'minecraft:custom_menu',
    supported: false,
    inventoryStart: 27,
    inventoryEnd: 54,
    slots: {}
  });
  assert.match(unsupported, /窗口 \(minecraft:custom_menu\)/);
  assert.match(unsupported, /未识别窗口/);
  assert.match(unsupported, /关闭窗口/);
});

test('slot items cover layout sections even when inventoryEnd excludes offhand', () => {
  const inventory = {
    id: 0,
    name: 'inventory',
    supported: true,
    inventoryStart: 9,
    inventoryEnd: 45,
    slots: {}
  };
  const layout = inventoryPanel.getWindowLayout(inventory);
  const items = inventoryPanel.getSlotItems(inventory, layout);
  assert.ok(items.some((entry) => entry.slot === 45), '副手槽应在渲染范围内');

  const html = inventoryPanel.renderInventoryHtml(inventory);
  assert.match(html, /data-slot="45"/);
  assert.match(html, /data-slot="0"/);
});

test('press actions follow the in-game mapping (act on press)', () => {
  assert.equal(inventoryPanel.getPressAction({ button: 0 }), 'left');
  assert.equal(inventoryPanel.getPressAction({ button: 0, shiftKey: true }), 'shift');
  assert.equal(inventoryPanel.getPressAction({ button: 2 }), 'right');
  assert.equal(inventoryPanel.getPressAction({ button: 2, shiftKey: true }), 'shift-right');
  assert.equal(inventoryPanel.getPressAction({ button: 1 }), 'clone');
  assert.equal(inventoryPanel.getPressAction({ button: 3 }), null);
  assert.equal(inventoryPanel.getMouseButtonName(0), 'left');
  assert.equal(inventoryPanel.getMouseButtonName(1), 'middle');
  assert.equal(inventoryPanel.getMouseButtonName(2), 'right');
  assert.equal(inventoryPanel.getMouseButtonName(5), null);
});

test('double click detection needs the same slot, the same button and a short interval', () => {
  const first = { slot: 9, button: 0, time: 1000 };
  assert.equal(inventoryPanel.isDoubleClick(first, { slot: 9, button: 0, time: 1200 }), true);
  assert.equal(inventoryPanel.isDoubleClick(first, { slot: 9, button: 0, time: 1400 }), false);
  assert.equal(inventoryPanel.isDoubleClick(first, { slot: 10, button: 0, time: 1100 }), false);
  assert.equal(inventoryPanel.isDoubleClick(first, { slot: 9, button: 2, time: 1100 }), false);
  assert.equal(inventoryPanel.isDoubleClick(null, { slot: 9, button: 0, time: 1100 }), false);
});

test('keyboard payloads cover hotbar swap, offhand and drop', () => {
  assert.deepEqual(inventoryPanel.getKeyboardPayload(9, { key: '3' }), { slot: 9, action: 'swap', swapSlot: '3' });
  assert.deepEqual(inventoryPanel.getKeyboardPayload(9, { key: 'F' }), { slot: 9, action: 'swap', swapSlot: 'offhand' });
  assert.deepEqual(inventoryPanel.getKeyboardPayload(9, { key: 'q' }), { slot: 9, action: 'drop' });
  assert.deepEqual(inventoryPanel.getKeyboardPayload(9, { key: 'Q', ctrlKey: true }), { slot: 9, action: 'dropstack' });
  assert.equal(inventoryPanel.getKeyboardPayload(9, { key: '0' }), null);
  assert.equal(inventoryPanel.getKeyboardPayload(9, { key: 'a' }), null);
  assert.equal(inventoryPanel.getKeyboardPayload(null, { key: '1' }), null);
});

test('client hints guard the two silent vanilla rules', () => {
  const cursorItem = { slot: -1, name: 'minecraft:stone', displayName: '石头', count: 5 };
  const inventory = {
    cursor: null,
    slots: { '9': { slot: 9, name: 'minecraft:dirt', displayName: '泥土', count: 3 } }
  };
  const withCursor = { ...inventory, cursor: cursorItem };

  // drop 只在光标为空时有效
  assert.match(inventoryPanel.getClientHint({ slot: 9, action: 'drop' }, withCursor), /光标上有物品/);
  assert.equal(inventoryPanel.getClientHint({ slot: 9, action: 'drop' }, inventory), '');
  assert.match(inventoryPanel.getClientHint({ slot: 9, action: 'dropstack' }, withCursor), /光标上有物品/);

  // collect 需要对空格双击，且手上要拿着东西
  assert.match(inventoryPanel.getClientHint({ slot: 9, action: 'collect' }, inventory), /先左键拿起/);
  assert.match(
    inventoryPanel.getClientHint({ slot: 9, action: 'collect' }, { ...withCursor, slots: { '9': inventory.slots['9'] } }),
    /请对空格双击收集/
  );
  assert.equal(inventoryPanel.getClientHint({ slot: 10, action: 'collect' }, withCursor), '');

  // 点窗口外丢出需要光标上有物品
  assert.match(inventoryPanel.getClientHint({ slot: -999, action: 'left' }, inventory), /无需丢出/);
  assert.equal(inventoryPanel.getClientHint({ slot: -999, action: 'left' }, withCursor), '');

  // 普通点击与拖拽不受约束
  assert.equal(inventoryPanel.getClientHint({ slot: 9, action: 'left' }, inventory), '');
  assert.equal(inventoryPanel.getClientHint({ slot: -999, action: 'drag-start', button: 'left' }, inventory), '');
});

test('drag tracker only upgrades to a drag after entering another slot', () => {
  const tracker = inventoryPanel.createDragTracker();

  assert.equal(tracker.press(0, 9), true);
  assert.equal(tracker.press(0, 10), false, 'second press while holding is ignored');
  assert.equal(tracker.enter(9), null, 'still on the origin slot: no drag yet');
  assert.deepEqual(tracker.enter(10), { start: true, add: 10, button: 0 });
  assert.equal(tracker.enter(10), null, 'duplicate slot entry is ignored');
  assert.deepEqual(tracker.enter(11), { start: false, add: 11, button: 0 });
  assert.deepEqual(tracker.enter(9), { start: false, add: 9, button: 0 });
  assert.deepEqual(tracker.release(), { wasDrag: true, button: 0 });
  assert.equal(tracker.isPressing(), false);
});

test('drag tracker reports a plain click when no other slot was entered', () => {
  const tracker = inventoryPanel.createDragTracker();
  tracker.press(2, 5);
  assert.equal(tracker.enter(5), null);
  assert.deepEqual(tracker.release(), { wasDrag: false, button: 2 });
});

test('optimistic pickup only predicts the left-click pickup case', () => {
  const inventory = {
    cursor: null,
    slots: { '9': { slot: 9, name: 'minecraft:stone', displayName: '石头', count: 64 } }
  };

  const overlay = inventoryPanel.createPickupOverlay(inventory, { slot: 9, action: 'left' });
  assert.equal(overlay.clearedSlot, 9);
  assert.equal(overlay.cursor.count, 64);

  const view = inventoryPanel.applyOptimisticOverlay(inventory, overlay);
  assert.equal(view.slots['9'], undefined);
  assert.equal(view.cursor.count, 64);
  assert.equal(inventory.slots['9'].count, 64, 'original inventory is not mutated');

  assert.equal(inventoryPanel.createPickupOverlay(inventory, { slot: 9, action: 'right' }), null);
  assert.equal(inventoryPanel.createPickupOverlay(inventory, { slot: 8, action: 'left' }), null);
  assert.equal(inventoryPanel.createPickupOverlay({ ...inventory, cursor: { name: 'x' } }, { slot: 9, action: 'left' }), null);
  assert.equal(inventoryPanel.applyOptimisticOverlay(inventory, null), inventory);
});

test('cursor follow point is clamped to the frame and hover slots are read back', () => {
  assert.deepEqual(inventoryPanel.clampCursorPoint({ x: -20, y: 30 }, { width: 176, height: 166 }), { x: 0, y: 30 });
  assert.deepEqual(inventoryPanel.clampCursorPoint({ x: 300, y: 300 }, { width: 176, height: 166 }), { x: 176, y: 166 });

  assert.equal(inventoryPanel.getHoveredSlot({ dataset: { hoverSlot: '45' } }), 45);
  assert.equal(inventoryPanel.getHoveredSlot({ dataset: {} }), null);
  assert.equal(inventoryPanel.getHoveredSlot({ dataset: { hoverSlot: '' } }), null);
  assert.equal(inventoryPanel.getHoveredSlot(null), null);
});

test('cursor item html renders only when an item is held', () => {
  assert.equal(inventoryPanel.renderCursorHtml(null), '');
  const html = inventoryPanel.renderCursorHtml({
    name: 'minecraft:stone',
    displayName: '石头',
    count: 12
  });
  assert.match(html, /data-role="cursor-item"/);
  assert.match(html, /inv-slot-count">12</);
  assert.match(html, /assets\/items\/stone\.png/);
});

test('slot interaction sends a click on press and a drag sequence after entering another slot', () => {
  const handlers = new Map();
  const grid = {
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 176, height: 166 };
    }
  };
  const panelRoot = { dataset: {} };
  const container = {
    querySelector(selector) {
      if (selector === '[data-role="inventory-panel"]') return panelRoot;
      if (selector === '[data-role="inventory-grid"]') return grid;
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };

  const sent = [];
  const hints = [];
  const inventory = {
    id: 0,
    name: 'inventory',
    supported: true,
    inventoryStart: 9,
    inventoryEnd: 45,
    cursor: null,
    slots: { '9': { slot: 9, name: 'minecraft:stone', displayName: '石头', count: 64 } }
  };

  inventoryPanel.renderInventoryPanel(container, {
    inventory,
    onWindowClick(payload) {
      sent.push(payload);
    },
    onClientHint(message) {
      hints.push(message);
    }
  });

  function slotElement(slot) {
    return {
      getAttribute(name) {
        return name === 'data-slot' ? String(slot) : null;
      },
      closest(selector) {
        return selector === '.inv-slot' ? this : null;
      }
    };
  }

  const mousedown = (payload) => handlers.get('mousedown')(payload);
  const pointerover = (payload) => handlers.get('pointerover')(payload);
  const pointerup = (payload) => handlers.get('pointerup')(payload);
  assert.equal(typeof handlers.get('mousedown'), 'function');
  assert.equal(typeof handlers.get('pointerover'), 'function');
  assert.equal(typeof handlers.get('pointerup'), 'function');

  // 单击：按下即发语义动作（不依赖松开）
  mousedown({ target: slotElement(9), button: 0, shiftKey: false, preventDefault() {} });
  assert.deepEqual(sent, [{ slot: 9, action: 'left' }]);

  // app 层随即做乐观预测并重渲染：光标拿到物品、该格清空（真实链路就是这样）
  const overlay = inventoryPanel.createPickupOverlay(inventory, sent[0]);
  assert.ok(overlay, 'pickup should be predicted optimistically');
  const optimisticView = inventoryPanel.applyOptimisticOverlay(inventory, overlay);
  inventoryPanel.renderInventoryPanel(container, {
    inventory: optimisticView,
    onWindowClick(payload) {
      sent.push(payload);
    },
    onClientHint(message) {
      hints.push(message);
    }
  });

  // 双击判定必须跨重渲染存活，第二次按下才会变成 collect
  mousedown({ target: slotElement(9), button: 0, shiftKey: false, preventDefault() {} });
  assert.deepEqual(sent[1], { slot: 9, action: 'collect' });

  // Shift+点击直接快速移动，不进入拖拽
  mousedown({ target: slotElement(9), button: 0, shiftKey: true, preventDefault() {} });
  assert.deepEqual(sent[2], { slot: 9, action: 'shift' });

  // 拖拽：按下 → 进入另一格才补 drag-start 与 drag-add → 松开 drag-end
  mousedown({ target: slotElement(10), button: 0, shiftKey: false, preventDefault() {} });
  assert.deepEqual(sent[3], { slot: 10, action: 'left' });
  pointerover({ target: slotElement(11), relatedTarget: slotElement(10) });
  assert.deepEqual(sent[4], { slot: -999, action: 'drag-start', button: 'left' });
  assert.deepEqual(sent[5], { slot: 11, action: 'drag-add', button: 'left' });
  pointerover({ target: slotElement(12), relatedTarget: slotElement(11) });
  assert.deepEqual(sent[6], { slot: 12, action: 'drag-add', button: 'left' });
  pointerup({});
  assert.deepEqual(sent[7], { slot: -999, action: 'drag-end', button: 'left' });
  assert.equal(sent.length, 8);
  assert.equal(hints.length, 0);
  assert.equal(panelRoot.dataset.hoverSlot, '12');
});


test('slot pixel positions follow the standard 9-column gui layout', () => {
  const chestLayout = inventoryPanel.SLOT_LAYOUTS.chest;
  const chest = { inventoryStart: 27, inventoryEnd: 63 };
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(0, chestLayout, chest), { x: 7, y: 17, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(8, chestLayout, chest), { x: 151, y: 17, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(26, chestLayout, chest), { x: 151, y: 53, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(27, chestLayout, chest), { x: 7, y: 83, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(53, chestLayout, chest), { x: 151, y: 119, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(54, chestLayout, chest), { x: 7, y: 145, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(62, chestLayout, chest), { x: 151, y: 145, w: 18, h: 18 });

  const largeLayout = inventoryPanel.SLOT_LAYOUTS['large-chest'];
  const large = { inventoryStart: 54, inventoryEnd: 90 };
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(27, largeLayout, large), { x: 7, y: 71, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(53, largeLayout, large), { x: 151, y: 107, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(54, largeLayout, large), { x: 7, y: 137, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(89, largeLayout, large), { x: 151, y: 199, w: 18, h: 18 });
});

test('window layout and background image resolution', () => {
  assert.equal(inventoryPanel.getWindowLayout({ name: 'chest' }), inventoryPanel.SLOT_LAYOUTS.chest);
  assert.equal(inventoryPanel.getWindowLayout({ name: 'furnace' }), null);
  assert.equal(inventoryPanel.getWindowLayout(null), null);

  assert.equal(inventoryPanel.getBackgroundImage({ name: 'chest', supported: true }), 'chest.png');
  assert.equal(inventoryPanel.getBackgroundImage({ name: 'large-chest', supported: true }), 'generic_54.png');
  assert.equal(inventoryPanel.getBackgroundImage({ name: 'crafting-table', supported: true }), 'crafting_table.png');
  assert.equal(inventoryPanel.getBackgroundImage({ name: 'furnace', supported: true }), 'furnace.png');
  assert.equal(inventoryPanel.getBackgroundImage({ name: 'minecraft:smoker', supported: false }), 'smoker.png');
  assert.equal(inventoryPanel.getBackgroundImage({ name: 'minecraft:custom_menu', supported: false }), null);
});

test('chest windows render a background container with positioned slots', () => {
  const html = inventoryPanel.renderInventoryHtml(createChestInventory());
  assert.match(html, /inv-bg/);
  assert.match(html, /background-image:url\('assets\/gui\/chest\.png'\)/);
  assert.match(html, /aspect-ratio:176\/167/);
  assert.match(html, /left:3\.977%/);   // 7/176
  assert.match(html, /top:10\.180%/);   // 17/167
  assert.doesNotMatch(html, /class="inventory-grid"/);
});

test('unknown windows with matching assets fall back to decorated grid', () => {
  const html = inventoryPanel.renderInventoryHtml({
    id: 9,
    name: 'minecraft:smoker',
    supported: false,
    inventoryStart: 3,
    inventoryEnd: 39,
    slots: {}
  });
  assert.match(html, /inv-grid-with-bg/);
  assert.match(html, /background-image:url\('assets\/gui\/smoker\.png'\)/);
  assert.match(html, /未识别窗口/);
});

test('inventory slots follow the prismarine slot order table', () => {
  const layout = inventoryPanel.SLOT_LAYOUTS.inventory;
  const inv = { inventoryStart: 9, inventoryEnd: 46 };
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(0, layout, inv), { x: 152.5, y: 26.5, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(1, layout, inv), { x: 96.5, y: 16.5, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(4, layout, inv), { x: 114.5, y: 34.5, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(5, layout, inv), { x: 6.5, y: 6.5, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(8, layout, inv), { x: 6.5, y: 60.5, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(9, layout, inv), { x: 6.5, y: 82.5, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(17, layout, inv), { x: 150.5, y: 82.5, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(35, layout, inv), { x: 150.5, y: 118.5, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(36, layout, inv), { x: 6.5, y: 140.5, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(44, layout, inv), { x: 150.5, y: 140.5, w: 18, h: 18 });
  assert.deepEqual(inventoryPanel.getSlotPixelPosition(45, layout, inv), { x: 76.5, y: 61.5, w: 18, h: 18 });
});

test('inventory window renders the exact-aligned background container', () => {
  const html = inventoryPanel.renderInventoryHtml({
    id: 0,
    name: 'inventory',
    supported: true,
    inventoryStart: 9,
    inventoryEnd: 46,
    slots: { '0': { slot: 0, name: 'minecraft:diamond', displayName: '钻石', count: 1, metadata: 0 } }
  });
  assert.match(html, /inv-bg/);
  assert.match(html, /background-image:url\('assets\/gui\/inventory\.png'\)/);
  assert.match(html, /aspect-ratio:176\/166/);
  assert.match(html, /data-slot="0"/);
  assert.match(html, /data-slot="45"/);
});

test('item icon url maps any item name to a texture path', () => {
  assert.equal(inventoryPanel.getItemIconUrl({ name: 'minecraft:oak_planks' }), 'assets/items/oak_planks.png');
  assert.equal(inventoryPanel.getItemIconUrl({ name: 'cod' }), 'assets/items/cod.png');
  assert.equal(inventoryPanel.getItemIconUrl({ name: '' }), '');
  assert.equal(inventoryPanel.getItemIconUrl(null), '');
});

test('slots render label underneath and icon on top', () => {
  const html = inventoryPanel.renderSlotHtml({
    slot: 9,
    item: { slot: 9, name: 'minecraft:cod', displayName: '生鳕鱼', count: 3, metadata: 0 }
  });
  assert.match(html, /inv-slot-label/);
  assert.match(html, /inv-item-icon/);
  assert.match(html, /src="assets\/items\/cod\.png"/);
  assert.match(html, /3/);
});
