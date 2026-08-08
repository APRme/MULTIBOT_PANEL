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

test('drop count resolution honors shift and alt modifiers', () => {
  const inventory = createChestInventory();
  assert.equal(inventoryPanel.resolveDropCount(inventory, 2, {}), null);
  assert.equal(inventoryPanel.resolveDropCount(inventory, 2, { shiftKey: true }), 32);
  assert.equal(inventoryPanel.resolveDropCount(inventory, 2, { altKey: true }), 1);
  assert.equal(inventoryPanel.resolveDropCount(inventory, 2, { ctrlKey: true }), 1);
  assert.equal(inventoryPanel.resolveDropCount(inventory, 0, { shiftKey: true }), null);
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
