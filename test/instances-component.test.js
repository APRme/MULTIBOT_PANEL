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
