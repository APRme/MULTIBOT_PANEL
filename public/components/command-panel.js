(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};
  const formatters = namespace.formatters;

  function renderLastResult(result) {
    if (!result) {
      return '<div class="empty-state">发送后，控制台回复会显示在这里；普通聊天通常不会回显。</div>';
    }

    const messages = Array.isArray(result.messages) ? result.messages : [];
    if (messages.length > 0) {
      return `<div class="log-view">
        ${messages.map((item) => `
          <div class="log-line level-info">${formatters.escapeHtml(`${item.mode}: ${item.message}`)}</div>
        `).join('')}
      </div>`;
    }

    if (result.inputMode === 'chat') {
      return '<div class="empty-state">这次输入已按聊天发送，没有额外的控制回复。</div>';
    }

    if (result.inputMode === 'chat_fallback') {
      return '<div class="empty-state">未匹配到面板控制命令，已原样发送到游戏聊天。</div>';
    }

    if (result.inputMode === 'exit') {
      return '<div class="empty-state">已发送停止实例请求。</div>';
    }

    return '<div class="empty-state">这次输入没有额外回复。</div>';
  }

  function renderCommandPanel(container, props) {
    const bot = props.bot;
    const result = bot && bot.lastCommandResult ? bot.lastCommandResult : null;
    const commandDraft = String(props.commandDraft || '');

    container.innerHTML = `
      <div class="panel-section stack command-surface">
        <div class="stack section-heading-copy">
          <strong>控制台输入</strong>
          <span class="helper">以 "/" 开头执行控制命令，其余文本直接发送聊天。</span>
        </div>
        <form class="command-form" data-role="command-form">
          <input class="input mono" name="command" data-role="command-input" value="${formatters.escapeHtml(commandDraft)}" placeholder="例如：/health 或 你好" autocomplete="off" aria-label="控制台输入">
          <button class="button primary command-submit" type="submit" ${!props.canSend ? 'disabled' : ''}><span class="button-icon" aria-hidden="true">➜</span>发送</button>
        </form>
        <div class="stack command-history">
          <span class="helper">最近输入</span>
          <div class="chips">
            ${(props.commandHistory || []).length === 0
              ? '<span class="helper">暂无历史</span>'
              : props.commandHistory.map((command) => `
                  <button class="button ghost mono" data-command-history="${formatters.escapeHtml(command)}">${formatters.escapeHtml(command)}</button>
                `).join('')}
          </div>
        </div>
        <div class="stack command-result">
          <span class="helper">最近回复</span>
          ${renderLastResult(result)}
        </div>
      </div>
    `;

    const form = container.querySelector('[data-role="command-form"]');
    const commandInput = form ? form.command : null;

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!commandInput) {
        return;
      }

      // event.currentTarget 在 await 之后会被置为 null，这里用渲染时捕获的元素引用。
      const command = commandInput.value;
      const result = await Promise.resolve(props.onSendCommand(command));
      if (result === true) {
        commandInput.value = '';
        if (typeof props.onUpdateCommandDraft === 'function') {
          props.onUpdateCommandDraft('');
        }
      }
    });

    commandInput?.addEventListener('input', (event) => {
      if (typeof props.onUpdateCommandDraft === 'function') {
        props.onUpdateCommandDraft(event.target.value);
      }
    });

    container.querySelectorAll('[data-command-history]').forEach((element) => {
      element.addEventListener('click', () => {
        const command = element.getAttribute('data-command-history') || '';
        if (commandInput) {
          commandInput.value = command;
          commandInput.focus();
          commandInput.setSelectionRange(command.length, command.length);
        }
        if (typeof props.onUpdateCommandDraft === 'function') {
          props.onUpdateCommandDraft(command);
        }
        if (typeof props.onUseHistory === 'function') {
          props.onUseHistory(command);
        }
      });
    });
  }

  const api = {
    renderCommandPanel
  };

  namespace.components = namespace.components || {};
  namespace.components.commandPanel = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
