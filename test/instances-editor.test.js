const test = require('node:test');
const assert = require('node:assert/strict');

global.MultibotPanel = {
  formatters: {
    escapeHtml(value) {
      return String(value == null ? '' : value);
    }
  }
};

const {
  parseNumberListText,
  applyReconnectModeToggle,
  formatViewDistanceForDisplay,
  normalizeViewDistanceInput,
  validateInstanceConfig,
  isServerTopLevelOnlyPath,
  getEffectiveServerValue
} = require('../public/components/instances.js');

test('parseNumberListText parses non-negative integers and drops invalid lines', () => {
  assert.deepEqual(parseNumberListText('60000\n300000\n0\n'), [60000, 300000, 0]);
  assert.deepEqual(parseNumberListText('abc\n1.5\n-1\n1000'), [1000]);
  assert.deepEqual(parseNumberListText('500\n500\n1000'), [500, 1000]);
  assert.equal(parseNumberListText(''), undefined);
  assert.equal(parseNumberListText('abc\n'), undefined);
});

test('applyReconnectModeToggle enables multi-level reconnect and removes fixed delay', () => {
  const next = applyReconnectModeToggle(JSON.stringify({
    host: '127.0.0.1',
    restartOnDisconnect: true,
    restartDelayMs: 60000,
    restartJitterMs: 120000
  }, null, 2), true);

  const parsed = JSON.parse(next);
  assert.deepEqual(parsed.restartDelayScheduleMs, [60000, 300000, 600000, 900000, 1800000, 3600000, 7200000]);
  assert.equal(parsed.restartDelayMs, undefined);
  assert.equal(parsed.restartOnDisconnect, true);
  assert.equal(parsed.restartJitterMs, 120000);
});

test('applyReconnectModeToggle keeps an existing schedule when enabling', () => {
  const next = applyReconnectModeToggle(JSON.stringify({
    restartDelayScheduleMs: [1000, 2000],
    restartDelayMs: 60000
  }), true);

  const parsed = JSON.parse(next);
  assert.deepEqual(parsed.restartDelayScheduleMs, [1000, 2000]);
  assert.equal(parsed.restartDelayMs, undefined);
});

test('applyReconnectModeToggle disables multi-level reconnect and keeps fixed delay', () => {
  const next = applyReconnectModeToggle(JSON.stringify({
    restartOnDisconnect: true,
    restartDelayMs: 60000,
    restartDelayScheduleMs: [1000, 2000],
    restartDelayScheduleRepeatLast: false
  }, null, 2), false);

  const parsed = JSON.parse(next);
  assert.equal(parsed.restartDelayScheduleMs, undefined);
  assert.equal(parsed.restartDelayScheduleRepeatLast, undefined);
  assert.equal(parsed.restartDelayMs, 60000);
});

test('applyReconnectModeToggle writes the schedule at the top level even with a connection wrapper', () => {
  const next = applyReconnectModeToggle(JSON.stringify({
    connection: {
      host: '127.0.0.1',
      restartDelayMs: 60000
    }
  }), true);

  const parsed = JSON.parse(next);
  assert.deepEqual(parsed.restartDelayScheduleMs, [60000, 300000, 600000, 900000, 1800000, 3600000, 7200000]);
  assert.equal(parsed.connection.restartDelayScheduleMs, undefined);
  assert.equal(parsed.connection.restartDelayMs, undefined);
  assert.equal(parsed.connection.host, '127.0.0.1');
});

test('applyReconnectModeToggle clears fixed delays in both locations', () => {
  const next = applyReconnectModeToggle(JSON.stringify({
    restartDelayMs: 45000,
    connection: {
      restartDelayMs: 60000
    }
  }), true);

  const parsed = JSON.parse(next);
  assert.equal(parsed.restartDelayMs, undefined);
  // connection 被清空后按删除语义整块移除，等价于后端读到的“无 connection 覆盖”
  assert.equal(parsed.connection, undefined);
});

test('top-level-only server paths ignore the connection wrapper', () => {
  assert.equal(isServerTopLevelOnlyPath('host'), false);
  assert.equal(isServerTopLevelOnlyPath('restartDelayScheduleMs'), true);
  assert.equal(isServerTopLevelOnlyPath('openAuth.enabled'), true);
  assert.equal(isServerTopLevelOnlyPath('teleportPromptMatchers.tpa'), true);

  const serverObject = {
    connection: { host: 'wrapped.example.com', restartDelayMs: 1000 },
    restartDelayScheduleMs: [2000]
  };
  assert.equal(getEffectiveServerValue(serverObject, 'host'), 'wrapped.example.com');
  assert.deepEqual(getEffectiveServerValue(serverObject, 'restartDelayScheduleMs'), [2000]);
});

test('formatViewDistanceForDisplay maps tier strings to equivalent bit values', () => {
  assert.equal(formatViewDistanceForDisplay(2).value, '2');
  assert.equal(formatViewDistanceForDisplay(undefined).value, '');
  assert.equal(formatViewDistanceForDisplay('tiny').value, '6');
  assert.equal(formatViewDistanceForDisplay('far').value, '12');
  assert.match(formatViewDistanceForDisplay('tiny').helper, /tiny/);

  assert.equal(formatViewDistanceForDisplay('extreme').valid, false);
  assert.equal(formatViewDistanceForDisplay('extreme').value, '');
  assert.equal(formatViewDistanceForDisplay(0).valid, false);
  assert.equal(formatViewDistanceForDisplay(1.5).valid, false);
});

test('normalizeViewDistanceInput accepts positive integers and clears on empty input', () => {
  assert.deepEqual(normalizeViewDistanceInput('2'), { value: 2, valid: true });
  assert.deepEqual(normalizeViewDistanceInput(' 12 '), { value: 12, valid: true });
  assert.deepEqual(normalizeViewDistanceInput(''), { value: undefined, valid: true });
  assert.deepEqual(normalizeViewDistanceInput('1.5'), { value: undefined, valid: false });
  assert.deepEqual(normalizeViewDistanceInput('0'), { value: undefined, valid: false });
  assert.deepEqual(normalizeViewDistanceInput('-3'), { value: undefined, valid: false });
  assert.deepEqual(normalizeViewDistanceInput('abc'), { value: undefined, valid: false });
});

test('validateInstanceConfig accepts defaults and rejects broken values', () => {
  assert.equal(validateInstanceConfig({}), '');
  assert.equal(validateInstanceConfig({ serverObject: { viewDistance: 2 } }), '');
  assert.equal(validateInstanceConfig({ serverObject: { viewDistance: 'tiny' } }), '');

  assert.match(validateInstanceConfig({ serverObject: { viewDistance: 'extreme' } }), /viewDistance/);
  assert.match(validateInstanceConfig({ botObject: { viewDistance: 0 } }), /viewDistance/);
  assert.match(validateInstanceConfig({ defaultBotObject: { viewDistance: 'big' } }), /viewDistance/);
});

test('validateInstanceConfig enforces the openAuth connection requirements', () => {
  const openAuthServer = {
    openAuth: { enabled: true },
    host: 'eden.via',
    port: 20034,
    auth: 'microsoft',
    version: '1.21.11'
  };

  assert.equal(validateInstanceConfig({ serverObject: openAuthServer }), '');
  assert.equal(validateInstanceConfig({ serverObject: { openAuth: { enabled: false } } }), '');
  assert.match(validateInstanceConfig({ serverObject: { ...openAuthServer, auth: 'offline' } }), /auth/);
  assert.match(validateInstanceConfig({ serverObject: { ...openAuthServer, version: '1.21.10' } }), /version/);
  assert.match(validateInstanceConfig({ serverObject: { ...openAuthServer, port: 70000 } }), /port/);
  assert.match(validateInstanceConfig({ serverObject: { ...openAuthServer, host: '   ' } }), /host/);
  assert.match(validateInstanceConfig({
    serverObject: { ...openAuthServer, openAuth: { enabled: true, requestTimeoutMs: 999 } }
  }), /requestTimeoutMs/);
});

test('validateInstanceConfig checks reconnect schedule and prompt matchers', () => {
  assert.match(validateInstanceConfig({ serverObject: { restartDelayScheduleMs: [] } }), /restartDelayScheduleMs/);
  assert.match(validateInstanceConfig({
    serverObject: { restartDelayScheduleMs: [60000, -1] }
  }), /restartDelayScheduleMs/);
  assert.match(validateInstanceConfig({
    serverObject: { restartDelayScheduleMs: [60000], restartDelayScheduleRepeatLast: 'yes' }
  }), /restartDelayScheduleRepeatLast/);

  assert.match(validateInstanceConfig({
    serverObject: { teleportPromptMatchers: { tpa: ['missing anchors'] } }
  }), /tpa/);
  assert.match(validateInstanceConfig({
    serverObject: { teleportPromptMatchers: { tpa: ['^no sender$'] } }
  }), /sender/);
  assert.match(validateInstanceConfig({
    serverObject: { teleportPromptMatchers: { stripLines: ['^(unclosed$'] } }
  }), /stripLines/);
  assert.equal(validateInstanceConfig({
    serverObject: {
      teleportPromptMatchers: {
        stripLines: ['^\\[Tip\\] .*$'],
        tpa: ['^\\[YuTeleport\\]\\s+(?<sender>[A-Za-z0-9_]{1,16})\\s+wants to teleport to you\\.$']
      }
    }
  }), '');
});
