const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getPresetDefinitions,
  isPresetAppliedToDraft,
  applyPresetToDraft,
  removePresetFromDraft,
  togglePresetInDraft
} = require('../public/instance-presets.js');

test('instance presets expose expected built-in entries', () => {
  const presetIds = getPresetDefinitions().map((preset) => preset.id);

  assert.deepEqual(presetIds, [
    'auto_start',
    'whitelist_teleport',
    'resource_pack',
    'disable_entity_handling',
    'disable_terrain_handling',
    'auto_fish',
    'trader_monitor',
    'auto_attack',
    'recording'
  ]);
});

test('instance preset merges into bot config without clearing existing fields', () => {
  const nextDraft = applyPresetToDraft({
    serverJson: JSON.stringify({
      host: '127.0.0.1',
      port: 25565
    }, null, 2),
    botJson: JSON.stringify({
      username: 'bot@example.com',
      attack: {
        targetFilter: {
          excludePlayers: true
        }
      }
    }, null, 2)
  }, 'auto_attack');

  const serverObject = JSON.parse(nextDraft.serverJson);
  const botObject = JSON.parse(nextDraft.botJson);

  assert.deepEqual(serverObject, {
    host: '127.0.0.1',
    port: 25565
  });
  assert.equal(botObject.username, 'bot@example.com');
  assert.equal(botObject.attack.autoAttack, true);
  assert.equal(botObject.attack.attackRange, 3);
  assert.equal(botObject.attack.attackInterval, 2000);
  assert.equal(botObject.attack.targetFilter.excludePlayers, true);
  assert.equal(botObject.attack.targetFilter.excludeItems, true);
});

test('instance preset can be detected and toggled off cleanly', () => {
  const draft = applyPresetToDraft({
    serverJson: '{}',
    botJson: '{}'
  }, 'resource_pack');

  assert.equal(isPresetAppliedToDraft(draft, 'resource_pack'), true);

  const toggledOff = togglePresetInDraft(draft, 'resource_pack');
  const botObject = JSON.parse(toggledOff.botJson);

  assert.equal(isPresetAppliedToDraft(toggledOff, 'resource_pack'), false);
  assert.deepEqual(botObject, {});
});

test('removePresetFromDraft only removes matching template values', () => {
  const nextDraft = removePresetFromDraft({
    serverJson: '{}',
    botJson: JSON.stringify({
      behavior: {
        enableResourcePack: false,
        whitelistReloadMinutes: 30
      }
    }, null, 2)
  }, 'resource_pack');

  const botObject = JSON.parse(nextDraft.botJson);
  assert.deepEqual(botObject, {
    behavior: {
      enableResourcePack: false,
      whitelistReloadMinutes: 30
    }
  });
});

test('capability disable presets set false flags under bot.capabilities', () => {
  const entityDraft = applyPresetToDraft({
    serverJson: '{}',
    botJson: '{}'
  }, 'disable_entity_handling');
  const terrainDraft = applyPresetToDraft({
    serverJson: '{}',
    botJson: '{}'
  }, 'disable_terrain_handling');

  const entityBotObject = JSON.parse(entityDraft.botJson);
  const terrainBotObject = JSON.parse(terrainDraft.botJson);

  assert.equal(entityBotObject.capabilities.entityHandling, false);
  assert.equal(terrainBotObject.capabilities.terrainHandling, false);
});

test('instance preset reports invalid json before applying', () => {
  assert.throws(
    () => applyPresetToDraft({
      serverJson: '{}',
      botJson: '{'
    }, 'recording'),
    /JSON 解析失败/
  );
});

test('whitelist teleport preset points to parent directory whitelist file', () => {
  const nextDraft = applyPresetToDraft({
    serverJson: '{}',
    botJson: '{}'
  }, 'whitelist_teleport');

  const botObject = JSON.parse(nextDraft.botJson);
  assert.equal(botObject.teleport.mode, 'whitelist');
  assert.equal(botObject.teleport.whitelistFile, '../whitelist.txt');
});
