(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};
  const formatters = namespace.formatters;
  const EDITOR_TABS = Object.freeze([
    { id: 'server', label: '服务器' },
    { id: 'defaults', label: '共享默认' },
    { id: 'bot', label: '当前实例' },
    { id: 'json', label: '高级 JSON' }
  ]);
  const editorViewStates = new WeakMap();

  function normalizeEditorTab(tabId, mode = 'edit') {
    const requestedTab = String(tabId || '').trim();
    if (EDITOR_TABS.some((tab) => tab.id === requestedTab)) {
      return requestedTab;
    }
    return mode === 'create' ? 'server' : 'bot';
  }

  function resolveEditorViewState(container, editor) {
    const mode = editor && editor.mode === 'create' ? 'create' : 'edit';
    const previousState = editorViewStates.get(container);
    const editorOpen = Boolean(editor && editor.open);
    const activeTab = previousState && previousState.open && previousState.mode === mode
      ? normalizeEditorTab(previousState.activeTab, mode)
      : normalizeEditorTab('', mode);
    const nextState = {
      open: editorOpen,
      mode,
      activeTab
    };
    editorViewStates.set(container, nextState);
    return nextState;
  }

  function applyEditorTab(container, tabId, mode = 'edit') {
    const activeTab = normalizeEditorTab(tabId, mode);

    container.querySelectorAll('[data-editor-tab]').forEach((element) => {
      const selected = element.getAttribute('data-editor-tab') === activeTab;
      element.classList.toggle('active', selected);
      element.setAttribute('aria-selected', selected ? 'true' : 'false');
      element.tabIndex = selected ? 0 : -1;
    });

    container.querySelectorAll('[data-editor-panel]').forEach((element) => {
      element.hidden = element.getAttribute('data-editor-panel') !== activeTab;
    });

    editorViewStates.set(container, {
      open: true,
      mode,
      activeTab
    });
    return activeTab;
  }

  function stringifyJson(value) {
    try {
      return JSON.stringify(value == null ? {} : value, null, 2);
    } catch (error) {
      return '{}';
    }
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function safeParseJsonObject(text) {
    const source = String(text || '').trim();
    if (!source) {
      return {};
    }

    try {
      const parsed = JSON.parse(source);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function cloneJsonValue(value) {
    try {
      return JSON.parse(JSON.stringify(value == null ? {} : value));
    } catch (error) {
      return {};
    }
  }

  function getJsonPathValue(object, pathText) {
    const segments = String(pathText || '').split('.').filter(Boolean);
    let current = object;
    for (const segment of segments) {
      if (!current || typeof current !== 'object') {
        return undefined;
      }
      current = current[segment];
    }
    return current;
  }

  // 这些路径后端只在 server.json 顶层读取，写进旧式 connection 包裹会被静默忽略。
  const SERVER_TOP_LEVEL_ONLY_PATHS = Object.freeze([
    'restartDelayScheduleMs',
    'restartDelayScheduleRepeatLast',
    'openAuth',
    'teleportPromptMatchers'
  ]);

  function isServerTopLevelOnlyPath(pathText) {
    const text = String(pathText || '');
    return SERVER_TOP_LEVEL_ONLY_PATHS.some((prefix) => {
      return text === prefix || text.startsWith(`${prefix}.`);
    });
  }

  // 后端 extractRuntimeOverrides 先读顶层、再用 connection 覆盖；顶层专用路径不参与这层兼容。
  function getEffectiveServerValue(serverObject, fieldName) {
    if (!isServerTopLevelOnlyPath(fieldName) && isPlainObject(serverObject && serverObject.connection)) {
      const connectionValue = serverObject.connection[fieldName];
      if (connectionValue !== undefined && connectionValue !== null) {
        return connectionValue;
      }
    }

    return serverObject ? serverObject[fieldName] : undefined;
  }

  function getServerJsonFieldValue(serverObject, pathText, fallbackValue) {
    if (!isServerTopLevelOnlyPath(pathText) && isPlainObject(serverObject && serverObject.connection)) {
      const connectionValue = getJsonPathValue(serverObject.connection, pathText);
      if (connectionValue !== undefined) {
        return connectionValue;
      }
    }

    const topLevelValue = getJsonPathValue(serverObject, pathText);
    if (topLevelValue !== undefined) {
      return topLevelValue;
    }

    return fallbackValue;
  }

  function getServerJsonFieldPath(serverObject, pathText) {
    if (isServerTopLevelOnlyPath(pathText)) {
      return pathText;
    }

    return isPlainObject(serverObject && serverObject.connection)
      ? `connection.${pathText}`
      : pathText;
  }

  function getServerJsonListValue(serverObject, pathText) {
    const value = getServerJsonFieldValue(serverObject, pathText);
    return Array.isArray(value) ? value : [];
  }

  function getJsonListValue(object, pathText) {
    const value = getJsonPathValue(object, pathText);
    return Array.isArray(value) ? value : [];
  }

  // 下面三组功能字段同时出现在“共享默认”和“当前实例”两个标签，共用同一份定义避免两边漂移。
  function renderAttackFields(fieldRoot, sourceObject) {
    return `
      ${renderJsonBooleanField(fieldRoot, 'attack.autoAttack', '自动攻击', getJsonPathValue(sourceObject, 'attack.autoAttack') === true, '自动攻击附近目标')}
      ${renderJsonNumberField(fieldRoot, 'attack.attackRange', '攻击半径', getJsonPathValue(sourceObject, 'attack.attackRange') ?? 3, '格；小于等于 0 时回落后端默认 3', '0.1')}
      ${renderJsonNumberField(fieldRoot, 'attack.attackInterval', '攻击间隔', getJsonPathValue(sourceObject, 'attack.attackInterval') ?? 2000, '毫秒；小于等于 0 时回落后端默认 2000', '1')}
      ${renderJsonBooleanField(fieldRoot, 'attack.targetFilter.excludePlayers', '排除玩家', getJsonPathValue(sourceObject, 'attack.targetFilter.excludePlayers') === true, '默认不排除玩家')}
      ${renderJsonBooleanField(fieldRoot, 'attack.targetFilter.excludeItems', '排除掉落物', getJsonPathValue(sourceObject, 'attack.targetFilter.excludeItems') !== false, '默认排除掉落物与经验球')}
      ${renderJsonListField(fieldRoot, 'attack.targetFilter.targetTypes', '目标类型白名单', getJsonListValue(sourceObject, 'attack.targetFilter.targetTypes'), '一行一个实体类型；留空=全部匹配')}
    `;
  }

  function renderMonitoringFields(fieldRoot, sourceObject) {
    return `
      ${renderJsonBooleanField(fieldRoot, 'monitoring.enabled', '启用实体监控', getJsonPathValue(sourceObject, 'monitoring.enabled') === true, '监控流浪商人等实体')}
      ${renderJsonNumberField(fieldRoot, 'monitoring.intervalSeconds', '扫描间隔', getJsonPathValue(sourceObject, 'monitoring.intervalSeconds') ?? 10, '秒；小于等于 0 时回落后端默认 10', '1')}
      ${renderJsonListField(fieldRoot, 'monitoring.targetTypes', '监控目标类型', getJsonListValue(sourceObject, 'monitoring.targetTypes'), '一行一个实体类型；留空=只匹配 mob')}
    `;
  }

  function renderBlockBreakDetectionFields(fieldRoot, sourceObject) {
    return `
      ${renderJsonBooleanField(fieldRoot, 'blockBreakDetection.enabled', '启用方块破坏监控', getJsonPathValue(sourceObject, 'blockBreakDetection.enabled') === true, '需要实体处理与地形处理都开启')}
      ${renderJsonBooleanField(fieldRoot, 'blockBreakDetection.logToConsole', '打印到控制台', getJsonPathValue(sourceObject, 'blockBreakDetection.logToConsole') !== false, '默认开启')}
      ${renderJsonBooleanField(fieldRoot, 'blockBreakDetection.logToFile', '写入日志文件', getJsonPathValue(sourceObject, 'blockBreakDetection.logToFile') === true, '默认关闭')}
      ${renderJsonTextField(fieldRoot, 'blockBreakDetection.logFilePath', '日志文件路径', getJsonPathValue(sourceObject, 'blockBreakDetection.logFilePath') || '', '相对 bot 目录', './block-break.log')}
      ${renderJsonBooleanField(fieldRoot, 'blockBreakDetection.excludeCreativeMode', '忽略创造模式', getJsonPathValue(sourceObject, 'blockBreakDetection.excludeCreativeMode') !== false, '默认忽略创造模式破坏')}
      ${renderJsonListField(fieldRoot, 'blockBreakDetection.alertTrustedPlayers', '私聊提醒名单', getJsonListValue(sourceObject, 'blockBreakDetection.alertTrustedPlayers'), '一行一个玩家名')}
      ${renderJsonListField(fieldRoot, 'blockBreakDetection.monitoredBlocks', '监控方块', getJsonListValue(sourceObject, 'blockBreakDetection.monitoredBlocks'), '一行一个方块名；留空=不过滤')}
    `;
  }

  function renderBehaviorExtraFields(fieldRoot, sourceObject) {
    return `
      ${renderJsonBooleanField(fieldRoot, 'behavior.physicsStandby', '挂机省电', getJsonPathValue(sourceObject, 'behavior.physicsStandby') === true, '空闲时关闭物理模拟')}
      ${renderJsonTextField(fieldRoot, 'behavior.lockAfterExpireCommand', '锁到期执行命令', getJsonPathValue(sourceObject, 'behavior.lockAfterExpireCommand') ?? '/home', '清空=删除该字段并回落后端默认 /home；要禁用请到“高级 JSON”写 空字符串', '/home')}
      ${renderJsonTextField(fieldRoot, 'chat.unknownWhisperReply', '未知私聊回复', getJsonPathValue(sourceObject, 'chat.unknownWhisperReply') || '', '收到非命令私聊时回复的文本；留空=静默不回复')}
      ${renderJsonNumberField(fieldRoot, 'autoRestart', '定时重启间隔', getJsonPathValue(sourceObject, 'autoRestart') ?? 0, '分钟；0=关闭', '1')}
    `;
  }

  function setJsonPathValue(object, pathText, value) {
    const segments = String(pathText || '').split('.').filter(Boolean);
    if (segments.length === 0) {
      return object;
    }

    let current = object;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      if (!current[segment] || typeof current[segment] !== 'object' || Array.isArray(current[segment])) {
        current[segment] = {};
      }
      current = current[segment];
    }

    current[segments[segments.length - 1]] = value;
    return object;
  }

  function deleteJsonPathValue(object, pathText) {
    const segments = String(pathText || '').split('.').filter(Boolean);
    if (segments.length === 0) {
      return object;
    }

    function prune(current, index) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return false;
      }

      const key = segments[index];
      if (!Object.prototype.hasOwnProperty.call(current, key)) {
        return false;
      }

      if (index === segments.length - 1) {
        delete current[key];
      } else {
        const child = current[key];
        if (!child || typeof child !== 'object' || Array.isArray(child)) {
          delete current[key];
        } else if (prune(child, index + 1)) {
          delete current[key];
        }
      }

      return Object.keys(current).length === 0;
    }

    prune(object, 0);
    return object;
  }

  function updateJsonFieldValue(currentJsonText, pathText, value) {
    const nextObject = cloneJsonValue(safeParseJsonObject(currentJsonText));
    if (value === undefined) {
      deleteJsonPathValue(nextObject, pathText);
    } else {
      setJsonPathValue(nextObject, pathText, value);
    }
    return stringifyJson(nextObject);
  }

  function renderJsonBooleanField(fieldRoot, pathText, label, checked, helperText = '') {
    return `
      <label class="switch-control">
        <span class="switch-copy">
          <strong>${formatters.escapeHtml(label)}</strong>
          ${helperText ? `<span class="helper">${formatters.escapeHtml(helperText)}</span>` : ''}
        </span>
        <input
          type="checkbox"
          data-json-field="${formatters.escapeHtml(fieldRoot)}"
          data-json-path="${formatters.escapeHtml(pathText)}"
          data-json-type="boolean"
          aria-label="${formatters.escapeHtml(label)}"
          ${checked === true ? 'checked' : ''}>
        <span class="switch-track" aria-hidden="true"></span>
      </label>
    `;
  }

  function renderJsonTextField(fieldRoot, pathText, label, value, helperText = '', placeholder = '', disabled = false) {
    return `
      <label class="label">
        <span>${formatters.escapeHtml(label)}</span>
        <input
          class="input mono"
          data-json-field="${formatters.escapeHtml(fieldRoot)}"
          data-json-path="${formatters.escapeHtml(pathText)}"
          data-json-type="string"
          value="${formatters.escapeHtml(value == null ? '' : value)}"
          placeholder="${formatters.escapeHtml(placeholder || '')}"
          ${disabled ? 'disabled' : ''}>
        ${helperText ? `<span class="helper">${formatters.escapeHtml(helperText)}</span>` : ''}
      </label>
    `;
  }

  function renderJsonNumberField(fieldRoot, pathText, label, value, helperText = '', step = '1', disabled = false) {
    return `
      <label class="label">
        <span>${formatters.escapeHtml(label)}</span>
        <input
          class="input mono"
          type="number"
          step="${formatters.escapeHtml(step)}"
          data-json-field="${formatters.escapeHtml(fieldRoot)}"
          data-json-path="${formatters.escapeHtml(pathText)}"
          data-json-type="number"
          value="${formatters.escapeHtml(value == null ? '' : value)}"
          ${disabled ? 'disabled' : ''}>
        ${helperText ? `<span class="helper">${formatters.escapeHtml(helperText)}</span>` : ''}
      </label>
    `;
  }

  // 视距：后端默认是数字 2，mineflayer 也接受 tiny/short/normal/far，因此这里统一用数字输入。
  function renderJsonViewDistanceField(fieldRoot, pathText, label, display, helperText = '') {
    const source = display && typeof display === 'object' ? display : {};
    const invalid = source.valid === false;
    return `
      <label class="label">
        <span>${formatters.escapeHtml(label)}</span>
        <input
          class="input mono${invalid ? ' input-invalid' : ''}"
          type="number"
          min="1"
          step="1"
          data-json-field="${formatters.escapeHtml(fieldRoot)}"
          data-json-path="${formatters.escapeHtml(pathText)}"
          data-json-type="view-distance"
          value="${formatters.escapeHtml(source.value == null ? '' : source.value)}">
        <span class="helper">${formatters.escapeHtml(helperText || '')}</span>
      </label>
    `;
  }

  function renderJsonSelectField(fieldRoot, pathText, label, value, options, helperText = '', disabled = false) {
    return `
      <label class="label">
        <span>${formatters.escapeHtml(label)}</span>
        <select
          class="select"
          data-json-field="${formatters.escapeHtml(fieldRoot)}"
          data-json-path="${formatters.escapeHtml(pathText)}"
          data-json-type="select"
          ${disabled ? 'disabled' : ''}>
          ${(options || []).map((option) => `
            <option value="${formatters.escapeHtml(option.value)}" ${String(value || '') === String(option.value) ? 'selected' : ''}>${formatters.escapeHtml(option.label)}</option>
          `).join('')}
        </select>
        ${helperText ? `<span class="helper">${formatters.escapeHtml(helperText)}</span>` : ''}
      </label>
    `;
  }

  function renderJsonListField(fieldRoot, pathText, label, values, helperText = '') {
    const listValue = Array.isArray(values) ? values.join('\n') : '';
    return `
      <label class="label">
        <span>${formatters.escapeHtml(label)}</span>
        <textarea
          class="textarea mono instance-editor-textarea"
          data-json-field="${formatters.escapeHtml(fieldRoot)}"
          data-json-path="${formatters.escapeHtml(pathText)}"
          data-json-type="string-list"
          spellcheck="false">${formatters.escapeHtml(listValue)}</textarea>
        ${helperText ? `<span class="helper">${formatters.escapeHtml(helperText)}</span>` : ''}
      </label>
    `;
  }

  function renderJsonNumberListField(fieldRoot, pathText, label, values, helperText = '') {
    const listValue = Array.isArray(values) ? values.join('\n') : '';
    return `
      <label class="label">
        <span>${formatters.escapeHtml(label)}</span>
        <textarea
          class="textarea mono instance-editor-textarea"
          data-json-field="${formatters.escapeHtml(fieldRoot)}"
          data-json-path="${formatters.escapeHtml(pathText)}"
          data-json-type="number-list"
          spellcheck="false">${formatters.escapeHtml(listValue)}</textarea>
        ${helperText ? `<span class="helper">${formatters.escapeHtml(helperText)}</span>` : ''}
      </label>
    `;
  }

  const DEFAULT_RECONNECT_SCHEDULE_MS = [60000, 300000, 600000, 900000, 1800000, 3600000, 7200000];

  function parseNumberListText(text) {
    const numbers = Array.from(new Set(
      String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => Number(line))
        .filter((number) => Number.isInteger(number) && number >= 0)
    ));
    return numbers.length > 0 ? numbers : undefined;
  }

  // 后端只从 server.json 顶层读分级重连，因此这里恒写顶层，不受 connection 包裹影响。
  function applyReconnectModeToggle(serverJsonText, enabled) {
    const nextObject = cloneJsonValue(safeParseJsonObject(serverJsonText));
    const schedulePath = 'restartDelayScheduleMs';
    const repeatLastPath = 'restartDelayScheduleRepeatLast';

    if (enabled) {
      const currentSchedule = getJsonPathValue(nextObject, schedulePath);
      const schedule = Array.isArray(currentSchedule) && currentSchedule.length > 0
        ? currentSchedule
        : DEFAULT_RECONNECT_SCHEDULE_MS;
      setJsonPathValue(nextObject, schedulePath, schedule);
      // 固定延迟与分级延迟互斥：后端 connection 优先级高于顶层，两处都要清掉。
      deleteJsonPathValue(nextObject, 'restartDelayMs');
      deleteJsonPathValue(nextObject, 'connection.restartDelayMs');
    } else {
      deleteJsonPathValue(nextObject, schedulePath);
      deleteJsonPathValue(nextObject, repeatLastPath);
    }

    return stringifyJson(nextObject);
  }

  // mineflayer 把字符串档位映射为位值，数字则直接当位值用，因此两者可以等效换算。
  const VIEW_DISTANCE_TIER_BITS = Object.freeze({
    tiny: 6,
    short: 8,
    normal: 10,
    far: 12
  });

  function formatViewDistanceForDisplay(rawValue) {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return { value: '', valid: true, helper: '数字即视距位值；留空=继承（后端默认 2），常用 2-12' };
    }

    if (typeof rawValue === 'number') {
      if (Number.isInteger(rawValue) && rawValue >= 1) {
        return { value: String(rawValue), valid: true, helper: '数字即视距位值，常用 2-12' };
      }
      return {
        value: '',
        valid: false,
        helper: `当前值 ${JSON.stringify(rawValue)} 非法：视距必须是 ≥1 的整数，否则该 bot 登录会失败`
      };
    }

    const tier = String(rawValue).trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(VIEW_DISTANCE_TIER_BITS, tier)) {
      return {
        value: String(VIEW_DISTANCE_TIER_BITS[tier]),
        valid: true,
        helper: `当前文件为 '${tier}'，等效数字 ${VIEW_DISTANCE_TIER_BITS[tier]}；改动后会写成数字`
      };
    }

    return {
      value: '',
      valid: false,
      helper: `当前值 '${String(rawValue)}' 非法：仅支持 ≥1 的整数（数字即视距位值），否则该 bot 登录会失败`
    };
  }

  function normalizeViewDistanceInput(rawText) {
    const text = String(rawText == null ? '' : rawText).trim();
    if (!text) {
      return { value: undefined, valid: true };
    }

    const parsedValue = Number(text);
    if (!Number.isInteger(parsedValue) || parsedValue < 1) {
      return { value: undefined, valid: false };
    }

    return { value: parsedValue, valid: true };
  }

  function validateViewDistanceValue(rawValue) {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return '';
    }

    if (typeof rawValue === 'number') {
      return Number.isInteger(rawValue) && rawValue >= 1
        ? ''
        : '视距（viewDistance）必须是 ≥1 的整数';
    }

    if (typeof rawValue === 'string') {
      const tier = rawValue.trim().toLowerCase();
      return Object.prototype.hasOwnProperty.call(VIEW_DISTANCE_TIER_BITS, tier)
        ? ''
        : `视距（viewDistance）取值非法：${rawValue}`;
    }

    return '视距（viewDistance）类型非法，必须是数字';
  }

  // 后端 openAuth 强校验：任一条件不满足都会让配置加载直接抛错。
  function validateOpenAuthConstraints(serverObject) {
    const openAuth = isPlainObject(serverObject && serverObject.openAuth) ? serverObject.openAuth : {};
    if (openAuth.enabled !== true) {
      return '';
    }

    const host = getEffectiveServerValue(serverObject, 'host');
    if (typeof host !== 'string' || !host.trim()) {
      return 'server.json 启用了 openAuth：必须显式填写 host';
    }

    const port = Number(getEffectiveServerValue(serverObject, 'port'));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return 'server.json 启用了 openAuth：port 必须是 1-65535 的整数';
    }

    if (getEffectiveServerValue(serverObject, 'auth') !== 'microsoft') {
      return "server.json 启用了 openAuth：auth 必须是 'microsoft'";
    }

    if (getEffectiveServerValue(serverObject, 'version') !== '1.21.11') {
      return "server.json 启用了 openAuth：version 必须是 '1.21.11'";
    }

    if (openAuth.requestTimeoutMs !== undefined && openAuth.requestTimeoutMs !== null) {
      const timeoutMs = Number(openAuth.requestTimeoutMs);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 5000) {
        return 'openAuth.requestTimeoutMs 必须是 1000-5000 的整数';
      }
    }

    return '';
  }

  // 后端 teleportPromptMatchers 校验：非空、≤500 字符、^ 与 $ 锚定、合法正则，tpa/tpahere 需 (?<sender>。
  function validateTeleportPromptMatchers(serverObject) {
    const matchers = isPlainObject(serverObject && serverObject.teleportPromptMatchers)
      ? serverObject.teleportPromptMatchers
      : null;
    if (!matchers) {
      return '';
    }

    const groups = [
      { key: 'stripLines', requireSender: false },
      { key: 'tpa', requireSender: true },
      { key: 'tpahere', requireSender: true }
    ];

    for (const group of groups) {
      const list = matchers[group.key];
      if (list === undefined || list === null) {
        continue;
      }

      if (!Array.isArray(list)) {
        return `teleportPromptMatchers.${group.key} 必须是字符串数组`;
      }

      if (list.length > 20) {
        return `teleportPromptMatchers.${group.key} 最多 20 条`;
      }

      for (const entry of list) {
        if (typeof entry !== 'string') {
          return `teleportPromptMatchers.${group.key} 的每一项都必须是字符串`;
        }

        const source = entry.trim();
        if (!source || source.length > 500) {
          return `teleportPromptMatchers.${group.key} 每条需为 1-500 字符的正则`;
        }

        if (!source.startsWith('^') || !source.endsWith('$')) {
          return `teleportPromptMatchers.${group.key} 每条必须以 ^ 开头、$ 结尾`;
        }

        if (group.requireSender && !source.includes('(?<sender>')) {
          return `teleportPromptMatchers.${group.key} 每条必须包含 (?<sender>`;
        }

        try {
          new RegExp(source, 'i');
        } catch (error) {
          return `teleportPromptMatchers.${group.key} 存在非法正则：${source}`;
        }
      }
    }

    return '';
  }

  function validateReconnectSchedule(serverObject) {
    const source = isPlainObject(serverObject) ? serverObject : {};
    const schedule = source.restartDelayScheduleMs;
    if (schedule !== undefined) {
      if (!Array.isArray(schedule) || schedule.length === 0) {
        return 'server.json 的 restartDelayScheduleMs 必须是非空数组（留空请删除该字段）';
      }

      if (!schedule.every((entry) => Number.isInteger(entry) && entry >= 0)) {
        return 'server.json 的 restartDelayScheduleMs 每一项都必须是非负整数';
      }
    }

    const repeatLast = source.restartDelayScheduleRepeatLast;
    if (repeatLast !== undefined && typeof repeatLast !== 'boolean') {
      return 'server.json 的 restartDelayScheduleRepeatLast 必须是布尔值';
    }

    return '';
  }

  // 保存前统一校验：这些字段一旦写坏，后端 loadMasterConfig 会直接抛错。
  function validateInstanceConfig(options = {}) {
    const serverObject = isPlainObject(options.serverObject) ? options.serverObject : {};
    const defaultBotObject = isPlainObject(options.defaultBotObject) ? options.defaultBotObject : {};
    const botObject = isPlainObject(options.botObject) ? options.botObject : {};

    const messages = [
      validateViewDistanceValue(getEffectiveServerValue(serverObject, 'viewDistance')),
      validateViewDistanceValue(defaultBotObject.viewDistance),
      validateViewDistanceValue(botObject.viewDistance),
      validateOpenAuthConstraints(serverObject),
      validateTeleportPromptMatchers(serverObject),
      validateReconnectSchedule(serverObject)
    ];

    return messages.find((message) => Boolean(message)) || '';
  }

  function getInstanceKey(serverDir, botDir) {
    return `${String(serverDir || '').trim()}/${String(botDir || '').trim()}`;
  }

  function sortInstances(instances) {
    return (instances || []).slice().sort((left, right) => {
      const leftKey = getInstanceKey(left && left.serverDir, left && left.botDir);
      const rightKey = getInstanceKey(right && right.serverDir, right && right.botDir);
      return leftKey.localeCompare(rightKey);
    });
  }

  function getInstanceServerOptions(instances) {
    return Array.from(new Set((instances || []).map((instance) => String(instance && instance.serverDir || '').trim()).filter(Boolean)))
      .sort((left, right) => left.localeCompare(right));
  }

  function applyInstanceFilters(instances, filterText, filterServer) {
    const text = String(filterText || '').trim().toLowerCase();
    const server = String(filterServer || '').trim().toLowerCase();
    return (instances || []).filter((instance) => {
      const matchesServer = !server || String(instance && instance.serverDir || '').toLowerCase() === server;
      const matchesText = !text || [
        instance && instance.id,
        instance && instance.name,
        instance && instance.serverDir,
        instance && instance.botDir
      ].some((value) => String(value || '').toLowerCase().includes(text));
      return matchesServer && matchesText;
    });
  }

  function formatInstanceEnabledText(enabled) {
    return enabled === false ? '已禁用' : '已启用';
  }

  function formatInstanceStartModeText(autoStart) {
    return autoStart === true ? '自动启动' : '手动启动';
  }

  function formatInstanceSourceText(sourceType) {
    return `来源：${String(sourceType || '未知')}`;
  }

  function renderJsonPanel(title, payload, emptyText) {
    return `
      <div class="panel-section stack">
        <strong>${formatters.escapeHtml(title)}</strong>
        <pre class="log-view instance-json-view">${formatters.escapeHtml(
          payload ? stringifyJson(payload) : emptyText
        )}</pre>
      </div>
    `;
  }

  function renderInstanceSummary(instance) {
    if (!instance) {
      return '<div class="panel-section"><div class="empty-state">请先选择一个实例查看详情。</div></div>';
    }

    return `
      <div class="panel-section stack">
        <div class="detail-header">
          <div class="stack">
            <h2 class="title mono">${formatters.escapeHtml(`${instance.serverDir}/${instance.botDir}`)}</h2>
            <p class="subtitle">${formatters.escapeHtml(instance.id || '未命名实例')}</p>
          </div>
          <div class="row wrap">
            <span class="badge ${formatters.formatStateClass(instance.state)}">${formatters.escapeHtml(formatters.formatStateText(instance.state || 'unknown'))}</span>
            <span class="chip">${formatters.escapeHtml(formatInstanceEnabledText(instance.enabled))}</span>
            <span class="chip">${formatters.escapeHtml(formatInstanceStartModeText(instance.autoStart))}</span>
            <span class="chip">${formatters.escapeHtml(formatInstanceSourceText(instance.sourceType))}</span>
          </div>
        </div>
      </div>
      <div class="panel-section stack">
        <div class="toolbar">
          <div class="toolbar-group">
            <button class="button" data-action="refresh-instance">刷新详情</button>
            <button class="button primary" data-action="edit-instance">编辑</button>
            <button class="button success" data-action="start-instance" ${String(instance.state || '').toLowerCase() !== 'stopped' ? 'disabled' : ''}>启动</button>
            <button class="button" data-action="focus-instance-bot">定位到对应 Bot</button>
            <button class="button danger" data-action="delete-instance">删除</button>
          </div>
        </div>
        <div class="instance-warning">
          修改 <code>server.json</code> 会影响同一 <code>serverDir</code> 下的全部 Bot，并触发它们重新同步。
        </div>
        <div class="meta-grid">
          <div class="meta-item"><strong>${formatters.escapeHtml(instance.username || '—')}</strong><span class="helper">用户名</span></div>
          <div class="meta-item"><strong>${formatters.escapeHtml(`${instance.host || '—'}:${instance.port || '—'}`)}</strong><span class="helper">地址</span></div>
          <div class="meta-item"><strong>${formatters.escapeHtml(instance.serverDir || '—')}</strong><span class="helper">服务器目录</span></div>
          <div class="meta-item"><strong>${formatters.escapeHtml(instance.botDir || '—')}</strong><span class="helper">Bot 目录</span></div>
        </div>
      </div>
      <div class="panel-section stack">
        <strong>路径</strong>
        <div class="detail-info-list">
          <div class="detail-info-item">
            <div class="helper">Bot 目录路径</div>
            <div class="mono">${formatters.escapeHtml(instance.paths && instance.paths.botDir || '—')}</div>
          </div>
          <div class="detail-info-item">
            <div class="helper">Bot 配置文件</div>
            <div class="mono">${formatters.escapeHtml(instance.paths && instance.paths.botConfigPath || '—')}</div>
          </div>
          <div class="detail-info-item">
            <div class="helper">共享默认 Bot 配置</div>
            <div class="mono">${formatters.escapeHtml(instance.paths && instance.paths.defaultBotConfigPath || '—')}</div>
          </div>
          <div class="detail-info-item">
            <div class="helper">服务器配置文件</div>
            <div class="mono">${formatters.escapeHtml(instance.paths && instance.paths.serverConfigPath || '—')}</div>
          </div>
          <div class="detail-info-item">
            <div class="helper">白名单文件</div>
            <div class="mono">${formatters.escapeHtml(instance.paths && instance.paths.whitelistPath || '—')}</div>
          </div>
        </div>
      </div>
      <div class="instances-json-grid">
        ${renderJsonPanel('server.json', instance.serverConfig, '当前未加载 server.json 内容')}
        ${renderJsonPanel('default.config.json', instance.defaultBotConfig, '当前未加载 default.config.json 内容')}
        ${renderJsonPanel('config.json', instance.botConfig, '当前未加载 config.json 内容')}
      </div>
    `;
  }

  function renderEditor(editor, activeTabId) {
    const draft = editor && editor.draft ? editor.draft : {};
    const presets = Array.isArray(editor && editor.presets) ? editor.presets : [];
    const serverObject = safeParseJsonObject(draft.serverJson);
    const defaultBotObject = safeParseJsonObject(draft.defaultBotJson);
    const botObject = safeParseJsonObject(draft.botJson);
    const reconnectScheduleValues = getServerJsonFieldValue(serverObject, 'restartDelayScheduleMs', []);
    const multiLevelReconnect = Array.isArray(reconnectScheduleValues) && reconnectScheduleValues.length > 0;
    const openAuthConfig = isPlainObject(serverObject.openAuth) ? serverObject.openAuth : {};
    const openAuthEnabled = openAuthConfig.enabled === true;
    const openAuthLockHelper = 'server.json 启用了 openAuth：该字段由 server.json 接管，此处修改不生效';
    const serverViewDistance = formatViewDistanceForDisplay(getEffectiveServerValue(serverObject, 'viewDistance'));
    const botViewDistance = formatViewDistanceForDisplay(botObject.viewDistance);
    const activeTab = normalizeEditorTab(activeTabId, editor && editor.mode);

    return `
      <div class="instance-editor-shell" data-editor-mode="${editor.mode === 'create' ? 'create' : 'edit'}">
        <div class="panel-section stack instance-editor-header">
          <div class="toolbar">
            <div class="stack">
              <strong>${editor.mode === 'edit' ? '编辑实例' : '新建实例'}</strong>
              <span class="helper">${editor.mode === 'edit'
                ? '配置按服务器共享、共享默认和当前实例分区保存。实例目录名称不可修改。'
                : '先设置服务器和实例目录，再按需调整共享默认或当前实例配置。'}</span>
            </div>
            <div class="toolbar-group">
              <button class="button" data-action="cancel-instance-editor">取消</button>
              <button class="button primary" data-action="save-instance-editor" ${editor.saving ? 'disabled' : ''}>${editor.saving ? '保存中...' : '保存'}</button>
            </div>
          </div>
          ${editor.error ? `<div class="message-banner">${formatters.escapeHtml(editor.error)}</div>` : ''}
          <div class="instance-editor-tabs" role="tablist" aria-label="实例配置区域">
            ${EDITOR_TABS.map((tab) => `
              <button
                class="instance-editor-tab ${activeTab === tab.id ? 'active' : ''}"
                type="button"
                role="tab"
                id="instance-editor-tab-${tab.id}"
                aria-controls="instance-editor-panel-${tab.id}"
                aria-selected="${activeTab === tab.id ? 'true' : 'false'}"
                tabindex="${activeTab === tab.id ? '0' : '-1'}"
                data-editor-tab="${tab.id}">
                ${tab.label}
              </button>
            `).join('')}
          </div>
        </div>
        <section
          class="instance-editor-panel"
          role="tabpanel"
          id="instance-editor-panel-server"
          aria-labelledby="instance-editor-tab-server"
          data-editor-panel="server"
          ${activeTab === 'server' ? '' : 'hidden'}>
          <div class="config-section stack">
            <div class="config-section-heading">
              <strong>实例位置</strong>
              <span class="helper">目录用于定位配置文件；已有实例的目录名称不可修改。</span>
            </div>
            <div class="instance-form-grid">
              <label class="label">
                <span>serverDir</span>
                <input
                  class="input mono"
                  data-editor-field="serverDir"
                  value="${formatters.escapeHtml(draft.serverDir || '')}"
                  ${editor.mode === 'edit' ? 'readonly' : ''}
                  placeholder="例如 my_server_localhost">
              </label>
              <label class="label">
                <span>botDir</span>
                <input
                  class="input mono"
                  data-editor-field="botDir"
                  value="${formatters.escapeHtml(draft.botDir || '')}"
                  ${editor.mode === 'edit' ? 'readonly' : ''}
                  placeholder="例如 Nitager">
              </label>
            </div>
            <label class="switch-control">
              <span class="switch-copy">
                <strong>保存后启动</strong>
                <span class="helper">保存成功后尝试启动该实例</span>
              </span>
              <input type="checkbox" data-editor-field="start" aria-label="保存后启动" ${draft.start === true ? 'checked' : ''}>
              <span class="switch-track" aria-hidden="true"></span>
            </label>
          </div>
          <div class="config-section stack">
            <div class="config-section-heading">
              <strong>服务器共享配置</strong>
              <span class="helper">写入 <code>server.json</code>，同一 <code>serverDir</code> 共用；但实例 <code>config.json</code> 里的同名字段会覆盖这里的值。</span>
            </div>
            <div class="instance-warning">
              修改这里会同步影响同服务器目录下的其他 Bot，并触发它们重新加载连接配置。
            </div>
            ${openAuthEnabled
              ? `<div class="instance-warning">
                  server.json 启用了 <code>openAuth</code>：<code>auth</code> 必须是 <code>microsoft</code>、<code>version</code> 必须是 <code>1.21.11</code>，且 <code>host</code>/<code>port</code>/<code>auth</code>/<code>version</code> 会被强制使用这里的值，实例级覆盖不再生效。
                </div>`
              : ''}
          <div class="instance-form-grid">
            ${renderJsonTextField('serverJson', getServerJsonFieldPath(serverObject, 'host'), '主机地址', getServerJsonFieldValue(serverObject, 'host', '') ?? '', '', 'mc.example.com')}
            ${renderJsonNumberField('serverJson', getServerJsonFieldPath(serverObject, 'port'), '端口', getServerJsonFieldValue(serverObject, 'port', 25565) ?? 25565, '', '1')}
            ${renderJsonSelectField('serverJson', getServerJsonFieldPath(serverObject, 'auth'), '认证方式', getServerJsonFieldValue(serverObject, 'auth', 'microsoft') ?? 'microsoft', [
              { value: 'microsoft', label: 'microsoft' },
              { value: 'offline', label: 'offline' }
            ], openAuthEnabled ? "openAuth 要求固定为 'microsoft'" : '通常填 microsoft；离线服可用 offline')}
            ${renderJsonTextField('serverJson', getServerJsonFieldPath(serverObject, 'version'), '游戏版本', getServerJsonFieldValue(serverObject, 'version', '') ?? '', openAuthEnabled ? "openAuth 要求固定为 '1.21.11'" : '', '1.21.11')}
            ${renderJsonViewDistanceField('serverJson', getServerJsonFieldPath(serverObject, 'viewDistance'), '视距', serverViewDistance, serverViewDistance.helper)}
            ${renderJsonNumberField('serverJson', getServerJsonFieldPath(serverObject, 'chunkBatchReplyChunksPerTick'), '区块批回包速率', getServerJsonFieldValue(serverObject, 'chunkBatchReplyChunksPerTick', '') ?? '', '0=不回包；有效范围 0.01-64，默认 0.01', '0.01')}
            ${renderJsonBooleanField('serverJson', getServerJsonFieldPath(serverObject, 'disableChatSigning'), '关闭聊天签名', getServerJsonFieldValue(serverObject, 'disableChatSigning', true) !== false, '兼容旧服聊天')}
            ${renderJsonNumberField('serverJson', getServerJsonFieldPath(serverObject, 'checkTimeoutInterval'), 'KeepAlive 超时', getServerJsonFieldValue(serverObject, 'checkTimeoutInterval', 30000) ?? 30000, '毫秒', '1')}
            ${renderJsonBooleanField('serverJson', getServerJsonFieldPath(serverObject, 'restartOnDisconnect'), '断线自动重连', getServerJsonFieldValue(serverObject, 'restartOnDisconnect', true) !== false, '总开关：关闭后不自动重连')}
            <label class="switch-control">
              <span class="switch-copy">
                <strong>多级重连</strong>
                <span class="helper">用分级延迟数组替代固定延迟，与固定重连延迟互斥</span>
              </span>
              <input type="checkbox" data-reconnect-mode="multi" aria-label="多级重连" ${multiLevelReconnect ? 'checked' : ''}>
              <span class="switch-track" aria-hidden="true"></span>
            </label>
            ${multiLevelReconnect
              ? `
                ${renderJsonBooleanField('serverJson', getServerJsonFieldPath(serverObject, 'restartDelayScheduleRepeatLast'), '分级耗尽后重复最后一级', getServerJsonFieldValue(serverObject, 'restartDelayScheduleRepeatLast', true) !== false, '关闭后数组用尽即停止自动重连')}
                ${renderJsonNumberListField('serverJson', getServerJsonFieldPath(serverObject, 'restartDelayScheduleMs'), '分级延迟（毫秒）', reconnectScheduleValues, '一行一个毫秒数；实际延迟 = 当前级 + restartJitterMs 随机抖动')}
              `
              : `
                ${renderJsonNumberField('serverJson', getServerJsonFieldPath(serverObject, 'restartDelayMs'), '固定重连延迟', getServerJsonFieldValue(serverObject, 'restartDelayMs', 60000) ?? 60000, '未启用多级重连时生效', '1')}
              `}
            ${renderJsonNumberField('serverJson', getServerJsonFieldPath(serverObject, 'restartJitterMs'), '重连抖动', getServerJsonFieldValue(serverObject, 'restartJitterMs', 120000) ?? 120000, '两种模式共用', '1')}
            </div>
          </div>
          <div class="config-section stack">
            <div class="config-section-heading">
              <strong>OpenAuth 与传送提示匹配</strong>
              <span class="helper">这两组字段只在 <code>server.json</code> 顶层生效，写进旧式 <code>connection</code> 包裹会被后端忽略。</span>
            </div>
            <div class="instance-warning">
              openAuth 启用后后端会强校验：host 必填、port 为 1-65535、auth 必须是 <code>microsoft</code>、version 必须是 <code>1.21.11</code>，任一不满足都会导致配置加载失败。
            </div>
            <div class="instance-form-grid">
              ${renderJsonBooleanField('serverJson', getServerJsonFieldPath(serverObject, 'openAuth.enabled'), 'OpenAuth 认证', getServerJsonFieldValue(serverObject, 'openAuth.enabled', false) === true, 'ViaProxy 直连认证')}
              ${renderJsonNumberField('serverJson', getServerJsonFieldPath(serverObject, 'openAuth.requestTimeoutMs'), 'OpenAuth 请求超时', getServerJsonFieldValue(serverObject, 'openAuth.requestTimeoutMs', 4500) ?? 4500, '1000-5000 毫秒', '1')}
            </div>
            ${renderJsonListField('serverJson', getServerJsonFieldPath(serverObject, 'teleportPromptMatchers.stripLines'), '整行忽略匹配', getServerJsonListValue(serverObject, 'teleportPromptMatchers.stripLines'), '一行一个正则；须以 ^ 开头、$ 结尾，最多 20 条')}
            ${renderJsonListField('serverJson', getServerJsonFieldPath(serverObject, 'teleportPromptMatchers.tpa'), 'TPA 提示匹配', getServerJsonListValue(serverObject, 'teleportPromptMatchers.tpa'), '一行一个正则；须含 (?<sender>，最多 20 条')}
            ${renderJsonListField('serverJson', getServerJsonFieldPath(serverObject, 'teleportPromptMatchers.tpahere'), 'TPAHERE 提示匹配', getServerJsonListValue(serverObject, 'teleportPromptMatchers.tpahere'), '一行一个正则；须含 (?<sender>，最多 20 条')}
          </div>
        </section>
        <section
          class="instance-editor-panel"
          role="tabpanel"
          id="instance-editor-panel-defaults"
          aria-labelledby="instance-editor-tab-defaults"
          data-editor-panel="defaults"
          ${activeTab === 'defaults' ? '' : 'hidden'}>
          <div class="config-section stack">
            <div class="config-section-heading">
              <strong>共享默认配置</strong>
              <span class="helper">写入 <code>default.config.json</code>；当前实例自己的 <code>config.json</code> 仍然优先。</span>
            </div>
            <div class="instance-warning">
              这里的设置会影响同一 <code>serverDir</code> 下未在实例配置中覆盖对应字段的 Bot。
            </div>
          <div class="instance-form-grid">
            ${renderJsonBooleanField('defaultBotJson', 'enabled', '启用实例', getJsonPathValue(defaultBotObject, 'enabled') !== false, '默认开启')}
            ${renderJsonBooleanField('defaultBotJson', 'autoStart', '自动启动', getJsonPathValue(defaultBotObject, 'autoStart') === true, '保存后尝试自动启动')}
            ${renderJsonBooleanField('defaultBotJson', 'trustedPlayersMergeParent', '合并上层名单', getJsonPathValue(defaultBotObject, 'trustedPlayersMergeParent') === true, '影响 trustedPlayers 和 trustedPlayersFile')}
            ${renderJsonTextField('defaultBotJson', 'trustedPlayersFile', '额外信任名单文件', getJsonPathValue(defaultBotObject, 'trustedPlayersFile') || '', '按账号目录解析；仅当“合并上层名单”开启时才参与')}
            ${renderJsonSelectField('defaultBotJson', 'teleport.mode', 'TPA 模式', getJsonPathValue(defaultBotObject, 'teleport.mode') || 'whitelist', [
              { value: 'whitelist', label: 'whitelist' },
              { value: 'trustedPlayers', label: 'trustedPlayers' },
              { value: 'all', label: 'all' }
            ], '普通 TPA 的自动接受模式')}
            ${renderJsonTextField('defaultBotJson', 'teleport.whitelistFile', 'TPA 白名单文件', getJsonPathValue(defaultBotObject, 'teleport.whitelistFile') || '', '相对当前 bot 目录；填 ../whitelist.txt = 用 serverDir 共享名单', '../whitelist.txt')}
            ${renderJsonBooleanField('defaultBotJson', 'logging.logToFile', '写聊天日志', getJsonPathValue(defaultBotObject, 'logging.logToFile') !== false, '单实例聊天日志')}
            ${renderJsonTextField('defaultBotJson', 'logging.logFilePath', '聊天日志路径', getJsonPathValue(defaultBotObject, 'logging.logFilePath') || '', '相对 bot 目录')}
            ${renderJsonBooleanField('defaultBotJson', 'logging.logPlayerList', '写玩家列表', getJsonPathValue(defaultBotObject, 'logging.logPlayerList') !== false, '单实例玩家列表日志')}
            ${renderJsonTextField('defaultBotJson', 'logging.playerListPath', '玩家列表路径', getJsonPathValue(defaultBotObject, 'logging.playerListPath') || '', '相对 bot 目录')}
            ${renderJsonNumberField('defaultBotJson', 'logging.playerListIntervalMinutes', '玩家列表间隔', getJsonPathValue(defaultBotObject, 'logging.playerListIntervalMinutes') ?? 1, '分钟', '1')}
            ${renderJsonBooleanField('defaultBotJson', 'behavior.enableResourcePack', '自动接受资源包', getJsonPathValue(defaultBotObject, 'behavior.enableResourcePack') === true, '资源包提示自动接受')}
            ${renderJsonBooleanField('defaultBotJson', 'capabilities.entityHandling', '启用实体处理', getJsonPathValue(defaultBotObject, 'capabilities.entityHandling') !== false, '关闭后会禁用实体相关能力')}
            ${renderJsonBooleanField('defaultBotJson', 'capabilities.terrainHandling', '启用地形处理', getJsonPathValue(defaultBotObject, 'capabilities.terrainHandling') !== false, '关闭后会禁用地形相关能力')}
            ${renderJsonBooleanField('defaultBotJson', 'capabilities.inventoryHandling', '启用背包处理', getJsonPathValue(defaultBotObject, 'capabilities.inventoryHandling') !== false, '关闭后禁用背包相关能力（轻量模式）')}
            ${renderJsonBooleanField('defaultBotJson', 'fish', '自动钓鱼', getJsonPathValue(defaultBotObject, 'fish') === true, '上线后自动进入钓鱼')}
            ${renderJsonBooleanField('defaultBotJson', 'recording.enabled', '启用录制', getJsonPathValue(defaultBotObject, 'recording.enabled') === true, 'Flashback 录制器')}
            ${renderJsonTextField('defaultBotJson', 'recording.outputDir', '录制输出目录', getJsonPathValue(defaultBotObject, 'recording.outputDir') || '', '相对 bot 目录')}
          </div>
          ${renderJsonListField('defaultBotJson', 'trustedPlayers', '信任玩家列表', getJsonListValue(defaultBotObject, 'trustedPlayers'), '一行一个玩家名')}
          </div>
          <div class="config-group stack">
            <strong class="config-group-title">攻击</strong>
            <div class="instance-form-grid">
              ${renderAttackFields('defaultBotJson', defaultBotObject)}
            </div>
          </div>
          <div class="config-group stack">
            <strong class="config-group-title">实体监控</strong>
            <div class="instance-form-grid">
              ${renderMonitoringFields('defaultBotJson', defaultBotObject)}
            </div>
          </div>
          <div class="config-group stack">
            <strong class="config-group-title">方块破坏监控</strong>
            <div class="instance-form-grid">
              ${renderBlockBreakDetectionFields('defaultBotJson', defaultBotObject)}
            </div>
          </div>
          <div class="config-group stack">
            <strong class="config-group-title">行为与其他</strong>
            <div class="instance-form-grid">
              ${renderBehaviorExtraFields('defaultBotJson', defaultBotObject)}
            </div>
          </div>
        </section>
        <section
          class="instance-editor-panel"
          role="tabpanel"
          id="instance-editor-panel-bot"
          aria-labelledby="instance-editor-tab-bot"
          data-editor-panel="bot"
          ${activeTab === 'bot' ? '' : 'hidden'}>
        <div class="preset-surface stack">
          <div class="config-section-heading">
            <strong>一键配置</strong>
            <span class="helper">模板只修改当前实例的 <code>config.json</code>。</span>
          </div>
          <div class="chips">
            ${presets.length === 0
              ? '<span class="helper">当前没有可用模板</span>'
              : presets.map((preset) => `
                  <button
                    class="button small ${preset.active ? 'primary' : 'ghost'}"
                    type="button"
                    data-instance-preset="${formatters.escapeHtml(preset.id)}"
                    title="${formatters.escapeHtml(preset.description || '')}">
                    ${formatters.escapeHtml(preset.title)}
                  </button>
                `).join('')}
          </div>
          <span class="helper">选中后会常亮；再次点击会撤销该模板写入的配置项。</span>
        </div>
        <div class="config-section stack">
          <div class="config-section-heading">
            <strong>当前实例配置</strong>
            <span class="helper">这些字段写入 <code>config.json</code>（优先级最高）；未设置的字段按 <code>config.json &gt; default.config.json &gt; server.json &gt; 后端内建默认值</code> 继承。</span>
          </div>
          <div class="config-group stack">
            <strong class="config-group-title">基础</strong>
            ${openAuthEnabled
              ? `<div class="instance-warning">server.json 启用了 <code>openAuth</code>：host / port / auth / version 由 server.json 接管，这里修改不生效。</div>`
              : ''}
            <div class="instance-form-grid">
              ${renderJsonBooleanField('botJson', 'enabled', '启用实例', getJsonPathValue(botObject, 'enabled') !== false, '停用后不会自动连接')}
              ${renderJsonBooleanField('botJson', 'autoStart', '自动启动', getJsonPathValue(botObject, 'autoStart') === true, '保存后尝试自动启动')}
              ${renderJsonTextField('botJson', 'host', '主机地址', getJsonPathValue(botObject, 'host') || '', openAuthEnabled ? openAuthLockHelper : '', 'mc.example.com', openAuthEnabled)}
              ${renderJsonNumberField('botJson', 'port', '端口', getJsonPathValue(botObject, 'port') ?? 25565, openAuthEnabled ? openAuthLockHelper : '', '1', openAuthEnabled)}
              ${renderJsonSelectField('botJson', 'auth', '认证方式', getJsonPathValue(botObject, 'auth') || 'microsoft', [
                { value: 'microsoft', label: 'microsoft' },
                { value: 'offline', label: 'offline' }
              ], openAuthEnabled ? openAuthLockHelper : '通常填 microsoft；离线服可用 offline', openAuthEnabled)}
              ${renderJsonTextField('botJson', 'version', '游戏版本', getJsonPathValue(botObject, 'version') || '', openAuthEnabled ? openAuthLockHelper : '', '1.21.11', openAuthEnabled)}
              ${renderJsonTextField('botJson', 'username', '用户名', getJsonPathValue(botObject, 'username') || '', '', 'ExampleBot')}
              ${renderJsonTextField('botJson', 'email', '邮箱', getJsonPathValue(botObject, 'email') || '', '', 'example@outlook.com')}
              ${renderJsonViewDistanceField('botJson', 'viewDistance', '视距', botViewDistance, botViewDistance.helper)}
              ${renderJsonBooleanField('botJson', 'disableChatSigning', '关闭聊天签名', getJsonPathValue(botObject, 'disableChatSigning') !== false, '兼容旧服聊天')}
              ${renderJsonNumberField('botJson', 'checkTimeoutInterval', 'KeepAlive 超时', getJsonPathValue(botObject, 'checkTimeoutInterval') ?? 30000, '毫秒', '1')}
              ${renderJsonBooleanField('botJson', 'restartOnDisconnect', '断线自动重连', getJsonPathValue(botObject, 'restartOnDisconnect') !== false, '断线后自动拉起')}
              ${renderJsonNumberField('botJson', 'restartDelayMs', '重连延迟', getJsonPathValue(botObject, 'restartDelayMs') ?? 60000, '毫秒', '1')}
              ${renderJsonNumberField('botJson', 'restartJitterMs', '重连抖动', getJsonPathValue(botObject, 'restartJitterMs') ?? 120000, '毫秒', '1')}
            </div>
          </div>
          <div class="config-group stack">
            <strong class="config-group-title">信任与传送</strong>
            <div class="instance-form-grid">
              ${renderJsonBooleanField('botJson', 'trustedPlayersMergeParent', '合并上层信任名单', getJsonPathValue(botObject, 'trustedPlayersMergeParent') === true, '影响 trustedPlayers 和 trustedPlayersFile')}
              ${renderJsonTextField('botJson', 'trustedPlayersFile', '额外信任名单文件', getJsonPathValue(botObject, 'trustedPlayersFile') || '', '按账号目录解析；仅当“合并上层信任名单”开启时才参与')}
              ${renderJsonSelectField('botJson', 'teleport.mode', 'TPA 模式', getJsonPathValue(botObject, 'teleport.mode') || 'whitelist', [
                { value: 'whitelist', label: 'whitelist' },
                { value: 'trustedPlayers', label: 'trustedPlayers' },
                { value: 'all', label: 'all' }
              ], '普通 TPA 的自动接受模式')}
              ${renderJsonTextField('botJson', 'teleport.whitelistFile', 'TPA 白名单文件', getJsonPathValue(botObject, 'teleport.whitelistFile') || '', '相对当前 bot 目录；填 ../whitelist.txt = 用 serverDir 共享名单', '../whitelist.txt')}
            </div>
            ${renderJsonListField('botJson', 'trustedPlayers', '信任玩家列表', Array.isArray(getJsonPathValue(botObject, 'trustedPlayers')) ? getJsonPathValue(botObject, 'trustedPlayers') : [], '一行一个玩家名')}
          </div>
          <div class="config-group stack">
            <strong class="config-group-title">能力与功能</strong>
            <div class="instance-form-grid">
              ${renderJsonBooleanField('botJson', 'capabilities.entityHandling', '启用实体处理', getJsonPathValue(botObject, 'capabilities.entityHandling') !== false, '关闭后会禁用实体相关命令')}
              ${renderJsonBooleanField('botJson', 'capabilities.terrainHandling', '启用地形处理', getJsonPathValue(botObject, 'capabilities.terrainHandling') !== false, '关闭后会禁用地形相关命令')}
              ${renderJsonBooleanField('botJson', 'behavior.enableResourcePack', '自动接受资源包', getJsonPathValue(botObject, 'behavior.enableResourcePack') === true, '资源包提示自动接受')}
              ${renderJsonBooleanField('botJson', 'recording.enabled', '启用录制', getJsonPathValue(botObject, 'recording.enabled') === true, 'Flashback 录制器')}
              ${renderJsonBooleanField('botJson', 'fish', '自动钓鱼', getJsonPathValue(botObject, 'fish') === true, '上线后自动进入钓鱼')}
            </div>
          </div>
          <div class="config-group stack">
            <strong class="config-group-title">攻击</strong>
            <div class="instance-form-grid">
              ${renderAttackFields('botJson', botObject)}
            </div>
          </div>
          <div class="config-group stack">
            <strong class="config-group-title">实体监控</strong>
            <div class="instance-form-grid">
              ${renderMonitoringFields('botJson', botObject)}
            </div>
          </div>
          <div class="config-group stack">
            <strong class="config-group-title">方块破坏监控</strong>
            <div class="instance-form-grid">
              ${renderBlockBreakDetectionFields('botJson', botObject)}
            </div>
          </div>
          <div class="config-group stack">
            <strong class="config-group-title">行为与其他</strong>
            <div class="instance-form-grid">
              ${renderBehaviorExtraFields('botJson', botObject)}
            </div>
          </div>
        </div>
        </section>
        <section
          class="instance-editor-panel"
          role="tabpanel"
          id="instance-editor-panel-json"
          aria-labelledby="instance-editor-tab-json"
          data-editor-panel="json"
          ${activeTab === 'json' ? '' : 'hidden'}>
          <div class="config-section stack">
            <div class="config-section-heading">
              <strong>高级 JSON</strong>
              <span class="helper">保存时仍按整文件替换。删除字段后，该字段会恢复继承上层配置或后端内建默认值。</span>
            </div>
            <div class="advanced-json-grid">
              <label class="label">
                <span>server.json</span>
                <textarea class="textarea mono instance-editor-textarea" data-editor-field="serverJson" spellcheck="false">${formatters.escapeHtml(draft.serverJson || '{}')}</textarea>
              </label>
              <label class="label">
                <span>default.config.json</span>
                <textarea class="textarea mono instance-editor-textarea" data-editor-field="defaultBotJson" spellcheck="false">${formatters.escapeHtml(draft.defaultBotJson || '{}')}</textarea>
              </label>
              <label class="label">
                <span>config.json</span>
                <textarea class="textarea mono instance-editor-textarea" data-editor-field="botJson" spellcheck="false">${formatters.escapeHtml(draft.botJson || '{}')}</textarea>
              </label>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  function renderInstancesPanel(container, props) {
    const backend = props.backend;
    const instances = sortInstances(props.instances);
    const filterText = String(props.filterText || '');
    const filterServer = String(props.filterServer || '');
    const serverOptions = getInstanceServerOptions(instances);
    const filteredInstances = applyInstanceFilters(instances, filterText, filterServer);
    const selectedInstance = props.selectedInstance || null;
    const editor = props.editor || {
      open: false,
      mode: 'create',
      draft: {},
      error: '',
      saving: false,
      presets: []
    };
    const editorViewState = resolveEditorViewState(container, editor);

    if (!backend) {
      container.innerHTML = '<div class="panel-section"><div class="empty-state">请先选择一个后端。</div></div>';
      return;
    }

    container.innerHTML = `
      <div class="panel-section stack">
        <div class="toolbar">
          <div class="stack">
            <h2 class="title">实例管理</h2>
            <p class="subtitle">${formatters.escapeHtml(backend.name)} · ${formatters.escapeHtml(backend.baseUrl)}</p>
          </div>
          <div class="toolbar-group">
            <button class="button" data-action="refresh-instances" ${props.loadingList ? 'disabled' : ''}>${props.loadingList ? '刷新中...' : '刷新'}</button>
            <button class="button" data-action="clear-avatar-cache">清除头像缓存</button>
            <button class="button primary" data-action="create-instance">新增实例</button>
            <button class="button" data-action="close-instances">关闭</button>
          </div>
        </div>
        ${props.error ? `<div class="message-banner">${formatters.escapeHtml(props.error)}</div>` : ''}
      </div>
      <div class="instances-layout">
        <div class="instances-list-pane">
          <div class="stack filter-surface">
            <label class="label search-field">
              <span class="sr-only">筛选实例</span>
              <input class="input grow" data-instance-filter="text" value="${formatters.escapeHtml(filterText)}" placeholder="筛选实例名、服务器或 Bot 目录">
            </label>
            <div class="filter-row">
              <select class="select" data-instance-filter="server" aria-label="服务器筛选">
                <option value="">全部服务器</option>
                ${serverOptions.map((serverDir) => `
                  <option value="${formatters.escapeHtml(serverDir)}" ${filterServer === serverDir ? 'selected' : ''}>${formatters.escapeHtml(serverDir)}</option>
                `).join('')}
              </select>
            </div>
          </div>
          <div class="list" data-scroll-id="instance-list">
            ${instances.length === 0
              ? '<div class="empty-state">当前后端还没有实例。</div>'
              : filteredInstances.length === 0
                ? '<div class="empty-state" data-role="instance-filter-empty">没有匹配的实例。</div>'
                : filteredInstances.map((instance) => {
                  const key = getInstanceKey(instance.serverDir, instance.botDir);
                  return `
                    <div class="list-card ${props.selectedKey === key ? 'selected' : ''}" data-instance-key="${formatters.escapeHtml(key)}" data-instance-server="${formatters.escapeHtml(instance.serverDir || '')}" data-instance-search="${formatters.escapeHtml([
                      instance.id,
                      instance.name,
                      instance.serverDir,
                      instance.botDir
                    ].map((value) => String(value || '')).join(' '))}">
                      <div class="row space">
                        <div class="stack">
                          <strong class="mono">${formatters.escapeHtml(`${instance.serverDir}/${instance.botDir}`)}</strong>
                          <span class="subtitle">${formatters.escapeHtml(instance.id || '未命名实例')}</span>
                        </div>
                        <span class="badge ${formatters.formatStateClass(instance.state)}">${formatters.escapeHtml(formatters.formatStateText(instance.state || 'unknown'))}</span>
                      </div>
                      <div class="row wrap">
                        <span class="chip mono">${formatters.escapeHtml(`${instance.host || '—'}:${instance.port || '—'}`)}</span>
                        <span class="chip">${formatters.escapeHtml(formatInstanceEnabledText(instance.enabled))}</span>
                        <span class="chip">${formatters.escapeHtml(formatInstanceStartModeText(instance.autoStart))}</span>
                      </div>
                    </div>
                  `;
                }).join('')}
          </div>
        </div>
        <div class="instances-detail-pane" data-scroll-id="instance-detail">
          ${editor.open
            ? renderEditor(editor, editorViewState.activeTab)
            : props.loadingDetail
              ? '<div class="panel-section"><div class="empty-state">实例详情加载中...</div></div>'
              : renderInstanceSummary(selectedInstance)}
        </div>
      </div>
    `;

    container.querySelector('[data-action="refresh-instances"]')?.addEventListener('click', () => {
      props.onRefreshInstances();
    });
    container.querySelector('[data-action="clear-avatar-cache"]')?.addEventListener('click', () => {
      if (typeof props.onClearAvatarCache === 'function') {
        props.onClearAvatarCache();
      }
    });
    container.querySelector('[data-action="create-instance"]')?.addEventListener('click', () => {
      props.onCreateInstance();
    });
    container.querySelector('[data-action="close-instances"]')?.addEventListener('click', () => {
      props.onClose();
    });

    const filterTextInput = container.querySelector('[data-instance-filter="text"]');
    const filterServerSelect = container.querySelector('[data-instance-filter="server"]');

    function applyRenderedInstanceFilters(text, server) {
      const normalizedText = String(text || '').trim().toLowerCase();
      const normalizedServer = String(server || '').trim().toLowerCase();
      let visibleCount = 0;
      container.querySelectorAll('[data-instance-key]').forEach((card) => {
        const searchText = String(card.getAttribute('data-instance-search') || '').toLowerCase();
        const serverText = String(card.getAttribute('data-instance-server') || '').toLowerCase();
        const matchesText = !normalizedText || searchText.includes(normalizedText);
        const matchesServer = !normalizedServer || serverText === normalizedServer;
        const visible = matchesText && matchesServer;
        card.hidden = !visible;
        if (visible) visibleCount += 1;
      });
      const emptyState = container.querySelector('[data-role="instance-filter-empty"]');
      if (emptyState) emptyState.hidden = visibleCount !== 0;
    }

    filterTextInput?.addEventListener('input', (event) => {
      const value = event.target.value;
      if (typeof props.onChangeFilterText === 'function') {
        props.onChangeFilterText(value);
      }
      applyRenderedInstanceFilters(value, filterServerSelect ? filterServerSelect.value : filterServer);
    });
    filterServerSelect?.addEventListener('change', (event) => {
      const value = event.target.value;
      if (typeof props.onChangeFilterServer === 'function') {
        props.onChangeFilterServer(value);
      }
      applyRenderedInstanceFilters(filterTextInput ? filterTextInput.value : filterText, value);
    });

    container.querySelectorAll('[data-instance-key]').forEach((element) => {
      element.addEventListener('click', () => {
        const [serverDir, botDir] = String(element.getAttribute('data-instance-key') || '').split('/');
        props.onSelectInstance(serverDir, botDir);
      });
    });

    container.querySelector('[data-action="refresh-instance"]')?.addEventListener('click', () => {
      if (selectedInstance) {
        props.onRefreshInstance(selectedInstance.serverDir, selectedInstance.botDir);
      }
    });
    container.querySelector('[data-action="edit-instance"]')?.addEventListener('click', () => {
      props.onEditInstance();
    });
    container.querySelector('[data-action="start-instance"]')?.addEventListener('click', () => {
      if (selectedInstance) {
        props.onStartInstance(selectedInstance.serverDir, selectedInstance.botDir);
      }
    });
    container.querySelector('[data-action="focus-instance-bot"]')?.addEventListener('click', () => {
      if (selectedInstance) {
        props.onFocusBot(selectedInstance.id);
      }
    });
    container.querySelector('[data-action="delete-instance"]')?.addEventListener('click', () => {
      if (selectedInstance) {
        props.onDeleteInstance(selectedInstance.serverDir, selectedInstance.botDir);
      }
    });

    container.querySelector('[data-action="cancel-instance-editor"]')?.addEventListener('click', () => {
      props.onCancelEditor();
    });
    container.querySelector('[data-action="save-instance-editor"]')?.addEventListener('click', () => {
      props.onSaveEditor();
    });

    const editorTabs = Array.from(container.querySelectorAll('[data-editor-tab]'));
    editorTabs.forEach((element, index) => {
      element.addEventListener('click', () => {
        applyEditorTab(container, element.getAttribute('data-editor-tab'), editor.mode);
      });
      element.addEventListener('keydown', (event) => {
        let nextIndex = index;
        if (event.key === 'ArrowRight') {
          nextIndex = (index + 1) % editorTabs.length;
        } else if (event.key === 'ArrowLeft') {
          nextIndex = (index - 1 + editorTabs.length) % editorTabs.length;
        } else if (event.key === 'Home') {
          nextIndex = 0;
        } else if (event.key === 'End') {
          nextIndex = editorTabs.length - 1;
        } else {
          return;
        }

        event.preventDefault();
        const nextElement = editorTabs[nextIndex];
        applyEditorTab(container, nextElement.getAttribute('data-editor-tab'), editor.mode);
        nextElement.focus();
      });
    });

    container.querySelectorAll('[data-instance-preset]').forEach((element) => {
      element.addEventListener('click', () => {
        props.onApplyPreset(element.getAttribute('data-instance-preset') || '');
      });
    });

    container.querySelectorAll('[data-editor-field]').forEach((element) => {
      const field = element.getAttribute('data-editor-field');
      const eventName = element.type === 'checkbox' ? 'change' : 'input';
      element.addEventListener(eventName, () => {
        const value = element.type === 'checkbox' ? element.checked : element.value;
        props.onUpdateEditorField(field, value);
      });
    });

    container.querySelectorAll('[data-json-field][data-json-path]').forEach((element) => {
      const fieldRoot = element.getAttribute('data-json-field');
      const pathText = element.getAttribute('data-json-path');
      const fieldType = element.getAttribute('data-json-type') || 'string';
      const eventName = fieldType === 'boolean' || fieldType === 'select' ? 'change' : 'input';

      element.addEventListener(eventName, () => {
        let value;

        if (fieldType === 'boolean') {
          value = element.checked;
        } else if (fieldType === 'number') {
          const rawValue = String(element.value || '').trim();
          if (!rawValue) {
            value = undefined;
          } else {
            const parsedValue = Number(rawValue);
            if (!Number.isFinite(parsedValue)) {
              return;
            }
            value = parsedValue;
          }
        } else if (fieldType === 'view-distance') {
          const parsed = normalizeViewDistanceInput(element.value);
          if (!parsed.valid) {
            element.classList.add('input-invalid');
            return;
          }
          element.classList.remove('input-invalid');
          value = parsed.value;
        } else if (fieldType === 'string-list') {
          value = Array.from(new Set(
            String(element.value || '')
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
          ));
        } else if (fieldType === 'number-list') {
          value = parseNumberListText(element.value);
        } else {
          const rawValue = String(element.value || '');
          value = rawValue.trim() ? rawValue : undefined;
        }

        const currentJsonText = editor && editor.draft && fieldRoot ? editor.draft[fieldRoot] : '';
        const nextJsonText = updateJsonFieldValue(currentJsonText, pathText, value);
        if (fieldType === 'number' && value === undefined) {
          element.value = '';
        }
        const jsonTextarea = container.querySelector(`[data-editor-field="${fieldRoot}"]`);
        if (jsonTextarea) {
          jsonTextarea.value = nextJsonText;
        }
        props.onUpdateEditorField(fieldRoot, nextJsonText);
      });
    });

    container.querySelectorAll('[data-reconnect-mode]').forEach((element) => {
      element.addEventListener('change', () => {
        const fieldRoot = 'serverJson';
        const currentJsonText = editor && editor.draft && editor.draft[fieldRoot] || '';
        const nextJsonText = applyReconnectModeToggle(currentJsonText, element.checked);
        const jsonTextarea = container.querySelector(`[data-editor-field="${fieldRoot}"]`);
        if (jsonTextarea) {
          jsonTextarea.value = nextJsonText;
        }
        props.onUpdateEditorField(fieldRoot, nextJsonText);
      });
    });
  }

  const api = {
    EDITOR_TABS,
    VIEW_DISTANCE_TIER_BITS,
    normalizeEditorTab,
    applyEditorTab,
    renderEditor,
    parseNumberListText,
    applyReconnectModeToggle,
    isServerTopLevelOnlyPath,
    getEffectiveServerValue,
    formatViewDistanceForDisplay,
    normalizeViewDistanceInput,
    validateInstanceConfig,
    getInstanceKey,
    getInstanceServerOptions,
    applyInstanceFilters,
    renderInstancesPanel
  };

  namespace.components = namespace.components || {};
  namespace.components.instances = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
