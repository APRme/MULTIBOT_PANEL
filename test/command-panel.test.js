const test = require('node:test');
const assert = require('node:assert/strict');

global.MultibotPanel = {
  formatters: {
    escapeHtml(value) {
      return String(value == null ? '' : value);
    }
  }
};

const commandPanel = require('../public/components/command-panel.js');

function createFormHarness(initialValue = '') {
  const listeners = new Map();
  const fakeInput = {
    value: initialValue,
    addEventListener(type, handler) {
      listeners.set(`input:${type}`, handler);
    },
    focus() {},
    setSelectionRange() {}
  };
  const fakeForm = {
    command: fakeInput,
    addEventListener(type, handler) {
      listeners.set(`form:${type}`, handler);
    }
  };
  const container = {
    innerHTML: '',
    querySelector(selector) {
      return selector === '[data-role="command-form"]' ? fakeForm : null;
    },
    querySelectorAll() {
      return [];
    }
  };

  return { container, listeners, fakeForm, fakeInput };
}

async function renderAndSubmit(harness, props, options = {}) {
  const { nullCurrentTarget = true } = options;
  commandPanel.renderCommandPanel(harness.container, props);

  const handler = harness.listeners.get('form:submit');
  assert.equal(typeof handler, 'function', 'submit handler should be registered');

  const event = {
    preventDefault() {},
    currentTarget: harness.fakeForm
  };

  const pending = handler(event);
  // 浏览器行为：监听器一进入 await，事件派发即结束，currentTarget 归 null。
  if (nullCurrentTarget) {
    event.currentTarget = null;
  }

  await pending;
}

test('submit clears the input and the draft without relying on event.currentTarget', async () => {
  const harness = createFormHarness('你好');
  const sent = [];
  let draft = '你好';

  await renderAndSubmit(harness, {
    commandDraft: '你好',
    commandHistory: [],
    canSend: true,
    onSendCommand(command) {
      sent.push(command);
      return Promise.resolve(true);
    },
    onUpdateCommandDraft(value) {
      draft = value;
    }
  });

  assert.deepEqual(sent, ['你好']);
  assert.equal(harness.fakeInput.value, '');
  assert.equal(draft, '');
});

test('submit keeps the input and the draft when the send is rejected', async () => {
  const harness = createFormHarness('/health');
  const sent = [];
  let draft = '/health';

  await renderAndSubmit(harness, {
    commandDraft: '/health',
    commandHistory: [],
    canSend: true,
    onSendCommand(command) {
      sent.push(command);
      return Promise.resolve(false);
    },
    onUpdateCommandDraft(value) {
      draft = value;
    }
  });

  assert.deepEqual(sent, ['/health']);
  assert.equal(harness.fakeInput.value, '/health');
  assert.equal(draft, '/health');
});

test('submit keeps the input when the send handler resolves without a result', async () => {
  const harness = createFormHarness('/time set day');

  await renderAndSubmit(harness, {
    commandDraft: '/time set day',
    commandHistory: [],
    canSend: true,
    onSendCommand() {
      return undefined;
    }
  });

  assert.equal(harness.fakeInput.value, '/time set day');
});

test('submit accepts a synchronous true result', async () => {
  const harness = createFormHarness('hi');
  let draft = 'hi';

  await renderAndSubmit(harness, {
    commandDraft: 'hi',
    commandHistory: [],
    canSend: true,
    onSendCommand() {
      return true;
    },
    onUpdateCommandDraft(value) {
      draft = value;
    }
  });

  assert.equal(harness.fakeInput.value, '');
  assert.equal(draft, '');
});

test('input events feed the command draft', () => {
  const harness = createFormHarness('');
  let draft = '';

  commandPanel.renderCommandPanel(harness.container, {
    commandDraft: '',
    commandHistory: [],
    canSend: true,
    onSendCommand() {
      return false;
    },
    onUpdateCommandDraft(value) {
      draft = value;
    }
  });

  const inputHandler = harness.listeners.get('input:input');
  assert.equal(typeof inputHandler, 'function');
  inputHandler({ target: { value: 'abc' } });
  assert.equal(draft, 'abc');
});

test('renders the draft, the history chips and the disabled state', () => {
  const harness = createFormHarness('');

  commandPanel.renderCommandPanel(harness.container, {
    commandDraft: '你好',
    commandHistory: ['/health', '/list'],
    canSend: false,
    onSendCommand() {
      return false;
    }
  });

  assert.match(harness.container.innerHTML, /value="你好"/);
  assert.match(harness.container.innerHTML, /data-command-history="\/health"/);
  assert.match(harness.container.innerHTML, /data-command-history="\/list"/);
  assert.match(harness.container.innerHTML, /type="submit" disabled/);
});
