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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAbortableReader(init) {
  return {
    async read() {
      await new Promise((resolve, reject) => {
        const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (init.signal.aborted) {
          onAbort();
          return;
        }
        init.signal.addEventListener('abort', onAbort, { once: true });
      });
      return { done: true, value: undefined };
    }
  };
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

test('switching profiles does not emit errors for the aborted previous stream', async () => {
  const states = [];
  const errors = [];
  const scheduledReconnects = [];
  const fetchCalls = [];

  const manager = createSseManager({
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      if (url.includes(':18081')) {
        return {
          ok: true,
          status: 200,
          body: {
            getReader() {
              return createReaderFromChunks([]);
            }
          }
        };
      }

      return {
        ok: true,
        status: 200,
        body: {
          getReader() {
            return createAbortableReader(init);
          }
        }
      };
    },
    setTimeoutFn(callback, delayMs) {
      scheduledReconnects.push({ callback, delayMs });
      return scheduledReconnects.length;
    },
    clearTimeoutFn() {},
    onEvent() {
    },
    onStateChange(backendId, info) {
      states.push({ backendId, info });
    },
    onError(backendId, error) {
      errors.push({ backendId, error });
    }
  });

  manager.connect({
    id: 'backend-1',
    baseUrl: 'http://127.0.0.1:18080',
    token: 'token-1'
  });
  manager.connect({
    id: 'backend-2',
    baseUrl: 'http://127.0.0.1:18081',
    token: 'token-2'
  });

  await waitFor(() => states.some((entry) => entry.backendId === 'backend-2' && entry.info.phase === 'closed'));

  assert.equal(errors.length, 0);
  assert.deepEqual(
    states.filter((entry) => entry.backendId === 'backend-1').map((entry) => entry.info.phase),
    ['connecting', 'open']
  );
  assert.equal(scheduledReconnects.length, 1);
});

test('explicit disconnect does not emit errors or error state', async () => {
  const states = [];
  const errors = [];
  const scheduledReconnects = [];

  const manager = createSseManager({
    fetchImpl: async (url, init) => ({
      ok: true,
      status: 200,
      body: {
        getReader() {
          return createAbortableReader(init);
        }
      }
    }),
    setTimeoutFn(callback, delayMs) {
      scheduledReconnects.push({ callback, delayMs });
      return scheduledReconnects.length;
    },
    clearTimeoutFn() {},
    onEvent() {
    },
    onStateChange(backendId, info) {
      states.push({ backendId, info });
    },
    onError(backendId, error) {
      errors.push({ backendId, error });
    }
  });

  manager.connect({
    id: 'backend-1',
    baseUrl: 'http://127.0.0.1:18080',
    token: 'token-1'
  });
  manager.disconnect();
  await wait(20);

  assert.equal(errors.length, 0);
  assert.equal(scheduledReconnects.length, 0);
  assert.equal(
    states.some((entry) => entry.backendId === 'backend-1' && (
      entry.info.phase === 'error' || entry.info.phase === 'closed'
    )),
    false
  );
});
