const test = require('node:test');
const assert = require('node:assert/strict');

global.MultibotPanel = {
  formatters: {
    formatStateText(value) { return value; }
  }
};

const botList = require('../public/components/bot-list.js');

const bots = [
  { id: 'server-b__bot-2', serverDir: 'server-b', botDir: 'bot-2', username: 'Beta', host: 'b.example', state: 'stopped' },
  { id: 'server-a__bot-1', serverDir: 'server-a', botDir: 'bot-1', username: 'Alpha', host: 'a.example', state: 'online' },
  { id: 'server-a__bot-3', serverDir: 'server-a', botDir: 'bot-3', username: 'Gamma', host: 'a.example', state: 'stopped' }
];

test('server options are sorted, de-duplicated, and default to the first server', () => {
  assert.deepEqual(botList.getServerOptions(bots), ['server-a', 'server-b']);
  assert.equal(botList.resolveServerFilter(bots, ''), 'server-a');
  assert.equal(botList.resolveServerFilter(bots, 'missing'), 'server-a');
  assert.equal(botList.resolveServerFilter(bots, 'server-b'), 'server-b');
});

test('server filtering composes with text and state filters', () => {
  assert.deepEqual(
    botList.applyFilters(bots, '', 'all', 'server-a').map((bot) => bot.id),
    ['server-a__bot-1', 'server-a__bot-3']
  );
  assert.deepEqual(
    botList.applyFilters(bots, 'gamma', 'stopped', 'server-a').map((bot) => bot.id),
    ['server-a__bot-3']
  );
  assert.deepEqual(botList.applyFilters(bots, '', 'online', 'server-b'), []);
});

test('selected server uses the short bot directory as the display name', () => {
  assert.equal(botList.getBotDisplayName(bots[0], 'server-b'), 'bot-2');
  assert.equal(botList.getBotDisplayName(bots[0], ''), 'server-b__bot-2');
});

test('older bot summaries fall back to parsing the composite id', () => {
  const legacyBot = { id: 'legacy-server__legacy-bot', username: 'Legacy' };
  assert.equal(botList.getBotServerDir(legacyBot), 'legacy-server');
  assert.equal(botList.getBotDisplayName(legacyBot, 'legacy-server'), 'legacy-bot');
});

test('instance directories fill missing grouping fields from older bot summaries', () => {
  const legacyBots = [
    { id: 'alpha-bot', username: 'Alpha' },
    { id: 'beta__beta-bot', username: 'Beta' }
  ];
  const resolved = botList.applyInstanceDirectories(legacyBots, [
    { id: 'alpha-bot', serverDir: 'alpha', botDir: 'alpha-bot' },
    { id: 'beta__beta-bot', serverDir: 'beta', botDir: 'beta-bot' }
  ]);

  assert.equal(botList.hasMissingServerDirectories(legacyBots), true);
  assert.equal(botList.resolveServerFilter(legacyBots, ''), '');
  assert.equal(botList.hasMissingServerDirectories(resolved), false);
  assert.deepEqual(botList.getServerOptions(resolved), ['alpha', 'beta']);
  assert.equal(botList.getBotDisplayName(resolved[0], 'alpha'), 'alpha-bot');
});
