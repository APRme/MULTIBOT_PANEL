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
