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

const instancesComponent = require('../public/components/instances.js');

function createEditor(mode) {
  return {
    open: true,
    mode,
    saving: false,
    error: '',
    presets: [],
    draft: {
      serverDir: 'example-server',
      botDir: 'example-bot',
      start: false,
      serverJson: '{}',
      defaultBotJson: '{}',
      botJson: '{}'
    }
  };
}

test('instance editor exposes the four configuration tabs', () => {
  assert.deepEqual(
    instancesComponent.EDITOR_TABS.map((tab) => tab.id),
    ['server', 'defaults', 'bot', 'json']
  );

  const html = instancesComponent.renderEditor(createEditor('edit'));
  for (const tab of instancesComponent.EDITOR_TABS) {
    assert.match(html, new RegExp(`role="tab"[\\s\\S]*?data-editor-tab="${tab.id}"`));
    assert.match(html, new RegExp(`role="tabpanel"[\\s\\S]*?data-editor-panel="${tab.id}"`));
    assert.match(html, new RegExp(`aria-controls="instance-editor-panel-${tab.id}"`));
    assert.match(html, new RegExp(`aria-labelledby="instance-editor-tab-${tab.id}"`));
  }
});

test('new instances open on server settings and edits open on current instance settings', () => {
  const createHtml = instancesComponent.renderEditor(createEditor('create'));
  const editHtml = instancesComponent.renderEditor(createEditor('edit'));

  assert.match(createHtml, /aria-selected="true"[\s\S]*?data-editor-tab="server"/);
  assert.match(createHtml, /data-editor-panel="server"\s*>/);
  assert.match(editHtml, /aria-selected="true"[\s\S]*?data-editor-tab="bot"/);
  assert.match(editHtml, /data-editor-panel="bot"\s*>/);
});

test('invalid editor tabs fall back according to editor mode', () => {
  assert.equal(instancesComponent.normalizeEditorTab('missing', 'create'), 'server');
  assert.equal(instancesComponent.normalizeEditorTab('missing', 'edit'), 'bot');
  assert.equal(instancesComponent.normalizeEditorTab('json', 'edit'), 'json');

  const html = instancesComponent.renderEditor(createEditor('edit'), 'missing');
  assert.match(html, /aria-selected="true"[\s\S]*?data-editor-tab="bot"/);
  assert.match(html, /data-editor-panel="server"\s+hidden>/);
});

const sampleInstances = [
  { serverDir: 'server-a', botDir: 'bot-1', id: 'Alpha', name: 'Alpha' },
  { serverDir: 'server-a', botDir: 'bot-2', id: 'Beta', name: 'Beta' },
  { serverDir: 'server-b', botDir: 'bot-3', id: 'Gamma', name: 'Gamma' }
];

test('instance filters combine server directory and name search', () => {
  assert.deepEqual(
    instancesComponent.applyInstanceFilters(sampleInstances, '', '').map((instance) => instance.botDir),
    ['bot-1', 'bot-2', 'bot-3']
  );
  assert.deepEqual(
    instancesComponent.applyInstanceFilters(sampleInstances, 'beta', '').map((instance) => instance.botDir),
    ['bot-2']
  );
  assert.deepEqual(
    instancesComponent.applyInstanceFilters(sampleInstances, 'bot-1', '').map((instance) => instance.botDir),
    ['bot-1']
  );
  assert.deepEqual(
    instancesComponent.applyInstanceFilters(sampleInstances, '', 'server-a').map((instance) => instance.botDir),
    ['bot-1', 'bot-2']
  );
  assert.deepEqual(instancesComponent.applyInstanceFilters(sampleInstances, 'alpha', 'server-b'), []);
});

test('instance server options are sorted and de-duplicated', () => {
  assert.deepEqual(instancesComponent.getInstanceServerOptions(sampleInstances), ['server-a', 'server-b']);
  assert.deepEqual(instancesComponent.getInstanceServerOptions([]), []);
  assert.deepEqual(instancesComponent.getInstanceServerOptions([{ botDir: 'x' }]), []);
});

test('instance editor uses a numeric view distance and keeps top-level-only fields out of the connection wrapper', () => {
  const editor = createEditor('edit');
  editor.draft.serverJson = JSON.stringify({
    connection: { host: 'wrapped.example.com' },
    openAuth: { enabled: true, requestTimeoutMs: 4500 },
    teleportPromptMatchers: { tpa: ['^x (?<sender>y)$'] },
    restartDelayScheduleMs: [1000]
  });

  const html = instancesComponent.renderEditor(editor, 'server');

  assert.match(html, /data-json-path="connection\.viewDistance"[\s\S]*?data-json-type="view-distance"/);
  assert.doesNotMatch(html, />extreme</);
  assert.match(html, /data-json-path="openAuth\.enabled"/);
  assert.match(html, /data-json-path="openAuth\.requestTimeoutMs"/);
  assert.match(html, /data-json-path="teleportPromptMatchers\.tpa"/);
  assert.match(html, /data-json-path="restartDelayScheduleMs"/);
  assert.match(html, /data-json-path="connection\.host"/);
  assert.doesNotMatch(html, /data-json-path="connection\.(?:openAuth|teleportPromptMatchers|restartDelaySchedule)/);
});

test('instance editor drops unwired behavior fields and exposes inventory handling', () => {
  const html = instancesComponent.renderEditor(createEditor('edit'), 'defaults');

  assert.doesNotMatch(html, /data-json-path="behavior\.enableSpawnActions"/);
  assert.doesNotMatch(html, /data-json-path="behavior\.whitelistReloadMinutes"/);
  assert.match(html, /data-json-path="capabilities\.inventoryHandling"/);
});

const FEATURE_GROUP_PATHS = [
  'attack.autoAttack',
  'attack.attackRange',
  'attack.attackInterval',
  'attack.targetFilter.excludePlayers',
  'attack.targetFilter.excludeItems',
  'attack.targetFilter.targetTypes',
  'monitoring.enabled',
  'monitoring.intervalSeconds',
  'monitoring.targetTypes',
  'blockBreakDetection.enabled',
  'blockBreakDetection.logToConsole',
  'blockBreakDetection.logToFile',
  'blockBreakDetection.logFilePath',
  'blockBreakDetection.excludeCreativeMode',
  'blockBreakDetection.alertTrustedPlayers',
  'blockBreakDetection.monitoredBlocks',
  'behavior.physicsStandby',
  'behavior.lockAfterExpireCommand',
  'chat.unknownWhisperReply',
  'autoRestart'
];

function getEditorPanel(html, panelId, nextPanelId) {
  return html.slice(html.indexOf(`data-editor-panel="${panelId}"`), html.indexOf(`data-editor-panel="${nextPanelId}"`));
}

test('feature groups are exposed in both the shared defaults and the current instance tab', () => {
  const html = instancesComponent.renderEditor(createEditor('edit'), 'defaults');
  const panels = [
    { root: 'defaultBotJson', panel: getEditorPanel(html, 'defaults', 'bot') },
    { root: 'botJson', panel: getEditorPanel(html, 'bot', 'json') }
  ];

  for (const { root, panel } of panels) {
    for (const fieldPath of FEATURE_GROUP_PATHS) {
      const escaped = fieldPath.replace(/\./g, '\\.');
      assert.match(
        panel,
        new RegExp(`data-json-field="${root}"[^>]*data-json-path="${escaped}"`),
        `${root} missing ${fieldPath}`
      );
      assert.equal(
        (panel.match(new RegExp(`data-json-path="${escaped}"`, 'g')) || []).length,
        1,
        `${fieldPath} should be rendered exactly once in the ${root} panel`
      );
    }
  }
});

test('openAuth locks the per-instance connection fields', () => {
  const lockedEditor = createEditor('edit');
  lockedEditor.draft.serverJson = JSON.stringify({ openAuth: { enabled: true } });
  const lockedBotPanel = getEditorPanel(instancesComponent.renderEditor(lockedEditor, 'bot'), 'bot', 'json');

  assert.match(lockedBotPanel, /openAuth/);
  for (const fieldPath of ['host', 'port', 'auth', 'version']) {
    const tag = lockedBotPanel.match(new RegExp(`<[^>]*data-json-path="${fieldPath}"[^>]*>`));
    assert.ok(tag, `missing field ${fieldPath}`);
    assert.match(tag[0], /disabled/, `${fieldPath} should be disabled while openAuth is enabled`);
  }

  const unlockedBotPanel = getEditorPanel(instancesComponent.renderEditor(createEditor('edit'), 'bot'), 'bot', 'json');
  const unlockedHost = unlockedBotPanel.match(/<[^>]*data-json-path="host"[^>]*>/);
  assert.doesNotMatch(unlockedHost[0], /disabled/);
});
