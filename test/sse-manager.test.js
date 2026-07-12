const test = require('node:test');
const assert = require('node:assert/strict');
const { createSseManager, consumeEventStreamBuffer } = require('../public/sse.js');

function createReaderFromChunks(chunks) {
  const queue = chunks.slice();
  return {
    async read() {
      if (!queue.length) {
        return { done: true, value: undefined };
      }

      return {
        done: false,
        value: queue.shift()
      };
    }
  };
}

async function waitFor(predicate, timeoutMs = 1000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('consumeEventStreamBuffer parses event blocks and preserves trailing partial data', () => {
  const events = [];
  const remainder = consumeEventStreamBuffer(
    'event: botStatus\ndata: {"id":"bot-1"}\n\n:event comment\nevent: log\ndata: {"botId":"bot-1","message":"hello"}\n\nevent: partial',
    (event) => events.push(event)
  );

  assert.deepEqual(events, [
    {
      event: 'botStatus',
      data: { id: 'bot-1' }
    },
    {
      event: 'log',
      data: { botId: 'bot-1', message: 'hello' }
    }
  ]);
  assert.equal(remainder, 'event: partial');
});

test('createSseManager streams events with auth header and emits state changes', async () => {
  const states = [];
  const events = [];
  const scheduledReconnects = [];
  const fetchCalls = [];

  const manager = createSseManager({
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return {
        ok: true,
        status: 200,
        body: {
          getReader() {
            return createReaderFromChunks([
              Buffer.from('event: botStatus\ndata: {"id":"bot-1","state":"running"}\n\n'),
              Buffer.from('event: log\ndata: {"botId":"bot-1","level":"info","message":"spawned"}\n\n')
            ]);
          }
        }
      };
    },
    setTimeoutFn(callback, delayMs) {
      scheduledReconnects.push({ callback, delayMs });
      return scheduledReconnects.length;
    },
    clearTimeoutFn() {},
    onEvent(backendId, event) {
      events.push({ backendId, event });
    },
    onStateChange(backendId, info) {
      states.push({ backendId, info });
    },
    onError() {
      assert.fail('unexpected SSE error');
    }
  });

  manager.connect({
    id: 'backend-1',
    baseUrl: 'http://127.0.0.1:18080',
    token: 'token-1'
  });

  await waitFor(() => states.some((entry) => entry.info.phase === 'closed'));

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'http://127.0.0.1:18080/api/events');
  assert.equal(fetchCalls[0].init.headers.Authorization, 'Bearer token-1');

  assert.deepEqual(events, [
    {
      backendId: 'backend-1',
      event: {
        event: 'botStatus',
        data: { id: 'bot-1', state: 'running' }
      }
    },
    {
      backendId: 'backend-1',
      event: {
        event: 'log',
        data: { botId: 'bot-1', level: 'info', message: 'spawned' }
      }
    }
  ]);

  assert.deepEqual(states.map((entry) => entry.info.phase), ['connecting', 'open', 'closed']);
  assert.equal(scheduledReconnects.length, 1);
});

