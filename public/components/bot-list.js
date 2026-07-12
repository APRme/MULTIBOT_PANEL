(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};
  const formatters = namespace.formatters;
  const FILTER_STATES = [
    { value: 'all', label: '全部' },
    { value: 'online', label: formatters.formatStateText('online') },
    { value: 'starting', label: formatters.formatStateText('starting') },
    { value: 'stopped', label: formatters.formatStateText('stopped') },
    { value: 'waiting_restart', label: formatters.formatStateText('waiting_restart') },
    { value: 'stopping', label: formatters.formatStateText('stopping') },
    { value: 'idle', label: formatters.formatStateText('idle') },
    { value: 'running', label: formatters.formatStateText('running') }
  ];

  function applyFilters(bots, filterText, filterState) {
    const normalizedFilterText = String(filterText || '').trim().toLowerCase();
    const normalizedFilterState = String(filterState || 'all').trim().toLowerCase();

    return (bots || []).filter((bot) => {
      const matchesText = !normalizedFilterText || [
        bot.id,
        bot.username,
        bot.host,
        bot.state
      ].some((value) => String(value || '').toLowerCase().includes(normalizedFilterText));

      const matchesState = normalizedFilterState === 'all' ||
        String(bot.state || '').toLowerCase() === normalizedFilterState;

      return matchesText && matchesState;
    });
  }

  function renderBotList(container, props) {
    const backend = props.backend;

    if (!backend) {
      container.innerHTML = '<div class="empty-state">请先选择一个后端。</div>';
      return;
    }

    const bots = (backend.bots.allIds || [])
      .map((botId) => backend.bots.byId[botId])
      .filter(Boolean)
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));

    const initialFilterText = String(props.botFilterText || '');
    const initialFilterState = String(props.botFilterState || 'all');
    const filteredBots = applyFilters(bots, initialFilterText, initialFilterState);

    container.innerHTML = `
      <div class="panel-section stack">
        <div class="row space">
          <div class="stack">
            <h2 class="title">Bot 列表</h2>
            <p class="subtitle" data-role="bot-count">${formatters.escapeHtml(backend.name)} · ${filteredBots.length}/${bots.length}</p>
          </div>
          <button class="button primary small" data-action="refresh-backend">刷新</button>
        </div>
        <div class="stack">
          <input class="input grow" data-filter="text" value="${formatters.escapeHtml(props.botFilterText || '')}" placeholder="筛选 bot / 用户名 / 主机 / 状态">
          <select class="select" data-filter="state">
            ${FILTER_STATES.map((state) => `
              <option value="${state.value}" ${props.botFilterState === state.value ? 'selected' : ''}>${formatters.escapeHtml(state.label)}</option>
            `).join('')}
          </select>
        </div>
      </div>
      <div class="empty-state" data-role="bot-empty-state" ${filteredBots.length === 0 ? '' : 'hidden'}>没有匹配的 Bot。</div>
      <div class="list" data-scroll-id="bot-list" data-role="bot-list">
        ${bots.length === 0
          ? ''
          : bots.map((bot) => `
              <div
                class="list-card ${backend.selectedBotId === bot.id ? 'selected' : ''}"
                data-bot-card
                data-bot-id="${formatters.escapeHtml(bot.id)}"
                data-bot-state="${formatters.escapeHtml(String(bot.state || ''))}"
                data-bot-search="${formatters.escapeHtml([
                  bot.id,
                  bot.username,
                  bot.host,
                  bot.state
                ].map((value) => String(value || '')).join(' '))}">
                <div class="row space">
                  <div class="stack">
                    <strong class="mono">${formatters.escapeHtml(bot.id)}</strong>
                    <span class="subtitle">${formatters.escapeHtml(bot.username || '—')}</span>
                  </div>
                  <span class="badge ${formatters.formatStateClass(bot.state)}">${formatters.escapeHtml(formatters.formatStateText(bot.state))}</span>
                </div>
                <div class="row wrap">
                  <span class="chip mono">${formatters.escapeHtml(`${bot.host || '—'}:${bot.port || '—'}`)}</span>
                  ${bot.lock && bot.lock.locked
                    ? `<span class="chip">${formatters.escapeHtml(formatters.formatLockSummary(bot.lock))}</span>`
                    : ''}
                  ${bot.lastFailure || bot.lastError || bot.lastKick
                    ? `<span class="chip">${formatters.escapeHtml(formatters.summarizeError(bot.lastFailure || bot.lastError || bot.lastKick))}</span>`
                    : ''}
                </div>
              </div>
            `).join('')}
      </div>
    `;

    container.querySelector('[data-action="refresh-backend"]')?.addEventListener('click', () => props.onRefreshBackend());
    const textInput = container.querySelector('[data-filter="text"]');
    const stateSelect = container.querySelector('[data-filter="state"]');
    const subtitle = container.querySelector('[data-role="bot-count"]');
    const emptyState = container.querySelector('[data-role="bot-empty-state"]');
    const botCards = Array.from(container.querySelectorAll('[data-bot-card]'));

    function applyRenderedFilters(filterText, filterState) {
      const normalizedFilterText = String(filterText || '').trim().toLowerCase();
      const normalizedFilterState = String(filterState || 'all').trim().toLowerCase();
      let visibleCount = 0;

      botCards.forEach((card) => {
        const searchText = String(card.getAttribute('data-bot-search') || '').toLowerCase();
        const stateText = String(card.getAttribute('data-bot-state') || '').toLowerCase();
        const matchesText = !normalizedFilterText || searchText.includes(normalizedFilterText);
        const matchesState = normalizedFilterState === 'all' || stateText === normalizedFilterState;
        const visible = matchesText && matchesState;
        card.hidden = !visible;
        if (visible) {
          visibleCount += 1;
        }
      });

      if (subtitle) {
        subtitle.textContent = `${backend.name} · ${visibleCount}/${botCards.length}`;
      }

      if (emptyState) {
        emptyState.hidden = visibleCount !== 0;
      }
    }

    textInput?.addEventListener('input', (event) => {
      const value = event.target.value;
      props.onChangeFilterText(value);
      applyRenderedFilters(value, stateSelect ? stateSelect.value : initialFilterState);
    });
    stateSelect?.addEventListener('change', (event) => {
      const value = event.target.value;
      props.onChangeFilterState(value);
      applyRenderedFilters(textInput ? textInput.value : initialFilterText, value);
    });

    container.querySelectorAll('[data-bot-id]').forEach((element) => {
      element.addEventListener('click', () => {
        props.onSelectBot(element.getAttribute('data-bot-id'));
      });
    });

    if (textInput) {
      textInput.value = initialFilterText;
    }
    if (stateSelect) {
      stateSelect.value = initialFilterState;
    }
    applyRenderedFilters(initialFilterText, initialFilterState);
  }

  const api = {
    applyFilters,
    renderBotList
  };

  namespace.components = namespace.components || {};
  namespace.components.botList = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
