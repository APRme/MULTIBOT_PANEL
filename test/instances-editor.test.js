const test = require('node:test');
const assert = require('node:assert/strict');

global.MultibotPanel = {
  formatters: {
    escapeHtml(value) {
      return String(value == null ? '' : value);
    }
  }
};

const { parseNumberListText, applyReconnectModeToggle } = require('../public/components/instances.js');

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

test('applyReconnectModeToggle respects the connection wrapper', () => {
  const next = applyReconnectModeToggle(JSON.stringify({
    connection: {
      host: '127.0.0.1',
      restartDelayMs: 60000
    }
  }), true);

  const parsed = JSON.parse(next);
  assert.deepEqual(parsed.connection.restartDelayScheduleMs, [60000, 300000, 600000, 900000, 1800000, 3600000, 7200000]);
  assert.equal(parsed.connection.restartDelayMs, undefined);
});
