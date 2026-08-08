const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.MultibotPanel = {
  formatters: {
    escapeHtml(value) { return String(value); },
    formatLockSummary() { return 'locked'; },
    formatStateText(value) { return value; },
    summarizeError(value) { return String(value); }
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

test('bot list metadata omits connection details but keeps actionable warnings', () => {
  const html = botList.buildBotChipsHtml({
    host: 'a.example',
    port: 25565,
    lock: { locked: true },
    lastError: 'authentication failed'
  });

  assert.doesNotMatch(html, /a\.example|25565/);
  assert.match(html, /locked/);
  assert.match(html, /authentication failed/);
});

test('hidden elements override component display styles', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
});

test('bot avatar uses valid Minecraft usernames without exposing email logins', () => {
  assert.equal(botList.getBotAvatarName({ username: 'APR_m' }), 'APR_m');
  assert.equal(botList.getBotAvatarName({ username: 'player@example.com' }), '');
});

test('bot avatar keeps a stable local fallback and never embeds third-party urls', () => {
  assert.equal(botList.getBotAvatarFallback({ username: 'APR_m', id: 'server__bot' }, 'server'), 'A');
  assert.equal(botList.getBotAvatarFallback({ username: 'player@example.com', botDir: 'fallback-bot' }, 'server'), 'F');

  const html = botList.buildBotAvatarHtml({ username: 'APR_m', id: 'server__bot' }, 'server');
  assert.match(html, /class="bot-avatar"/);
  assert.match(html, />A<\/span>/);
  assert.doesNotMatch(html, /mc-heads\.net/);
  assert.doesNotMatch(html, /<img/);
});

function createFakeCard(botId) {
  const slot = { dataset: {}, innerHTML: '' };
  return {
    slot,
    getAttribute(name) {
      return name === 'data-bot-id' ? botId : null;
    },
    querySelector(selector) {
      return selector === '[data-role="bot-avatar"]' ? slot : null;
    }
  };
}

function createFakeContainer(cards) {
  return {
    querySelectorAll(selector) {
      return selector === '[data-bot-card]' ? cards : [];
    }
  };
}

test('applyCachedAvatars inlines cached data urls into matching cards', () => {
  const cards = [createFakeCard('server__bot-1'), createFakeCard('server__bot-2')];
  const container = createFakeContainer(cards);
  const backend = {
    bots: {
      byId: {
        'server__bot-1': { id: 'server__bot-1', username: 'Alpha' },
        'server__bot-2': { id: 'server__bot-2', username: 'Beta' }
      }
    }
  };
  const avatarClient = {
    readCacheMap: () => ({
      Alpha: { dataUrl: 'data:image/png;base64,ALPHA', fetchedAt: 1 }
    })
  };

  botList.applyCachedAvatars(container, backend, avatarClient);
  assert.match(cards[0].slot.innerHTML, /data:image\/png;base64,ALPHA/);
  assert.equal(cards[0].slot.dataset.avatarLoaded, 'Alpha');
  assert.equal(cards[1].slot.innerHTML, '');
});

test('scheduleAvatarLoads fills avatars asynchronously and skips loaded slots', async () => {
  const cards = [createFakeCard('server__bot-1')];
  const container = createFakeContainer(cards);
  const backend = {
    bots: {
      byId: {
        'server__bot-1': { id: 'server__bot-1', username: 'Alpha' }
      }
    }
  };
  const avatarClient = {
    readCacheMap: () => ({}),
    getAvatar: async (username) => `data:image/png;base64,${username.toUpperCase()}`
  };

  botList.scheduleAvatarLoads(container, backend, avatarClient);
  assert.equal(cards[0].slot.innerHTML, '');
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(cards[0].slot.innerHTML, /data:image\/png;base64,ALPHA/);
  assert.equal(cards[0].slot.dataset.avatarLoaded, 'Alpha');

  const before = cards[0].slot.innerHTML;
  botList.scheduleAvatarLoads(container, backend, avatarClient);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cards[0].slot.innerHTML, before);
});

test('resetAvatarSlots clears loaded avatars and restores the fallback', async () => {
  const cards = [createFakeCard('server__bot-1')];
  const container = createFakeContainer(cards);
  const backend = {
    bots: {
      byId: {
        'server__bot-1': { id: 'server__bot-1', username: 'Alpha' }
      }
    }
  };
  const avatarClient = {
    readCacheMap: () => ({}),
    getAvatar: async () => 'data:image/png;base64,ALPHA'
  };

  botList.scheduleAvatarLoads(container, backend, avatarClient);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(cards[0].slot.innerHTML, /data:image\/png;base64,ALPHA/);

  botList.resetAvatarSlots(container, backend);
  assert.equal(cards[0].slot.dataset.avatarLoaded, undefined);
  assert.match(cards[0].slot.innerHTML, />A<\/span>/);

  botList.resetAvatarSlots(container, backend);
  assert.equal(cards[0].slot.innerHTML, '<span class="bot-avatar-fallback">A</span>');
});
