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
  const MINECRAFT_USERNAME_PATTERN = /^[A-Za-z0-9_]{1,16}$/;
  const containerStates = new WeakMap();

  function buildBotChipsHtml(bot) {
    const chips = [];
    if (bot.lock && bot.lock.locked) {
      chips.push(`<span class="chip">${formatters.escapeHtml(formatters.formatLockSummary(bot.lock))}</span>`);
    }
    if (bot.lastFailure || bot.lastError || bot.lastKick) {
      chips.push(`<span class="chip">${formatters.escapeHtml(formatters.summarizeError(bot.lastFailure || bot.lastError || bot.lastKick))}</span>`);
    }
    return chips.join('');
  }

  function getBotServerDir(bot) {
    const explicit = String(bot && bot.serverDir || '').trim();
    if (explicit) return explicit;
    const id = String(bot && bot.id || '');
    const separatorIndex = id.indexOf('__');
    return separatorIndex > 0 ? id.slice(0, separatorIndex) : '';
  }

  function getBotDisplayName(bot, selectedServerDir) {
    if (!bot) return '';
    if (selectedServerDir) {
      const botDir = String(bot.botDir || '').trim();
      if (botDir) return botDir;
      const prefix = `${selectedServerDir}__`;
      const id = String(bot.id || '');
      if (id.startsWith(prefix)) return id.slice(prefix.length);
    }
    return String(bot.id || '');
  }

  function getBotAvatarName(bot) {
    const username = String(bot && bot.username || '').trim();
    return MINECRAFT_USERNAME_PATTERN.test(username) ? username : '';
  }

  function getBotAvatarUrl(bot) {
    const avatarName = getBotAvatarName(bot);
    return avatarName ? `https://mc-heads.net/avatar/${encodeURIComponent(avatarName)}/40` : '';
  }

  function getBotAvatarFallback(bot, selectedServerDir) {
    const label = getBotAvatarName(bot) || getBotDisplayName(bot, selectedServerDir);
    return Array.from(String(label || '?').trim())[0]?.toUpperCase() || '?';
  }

  function buildBotAvatarHtml(bot, selectedServerDir) {
    const avatarName = getBotAvatarName(bot);
    const avatarUrl = getBotAvatarUrl(bot);
    return `
      <span class="bot-avatar" data-role="bot-avatar"${avatarName ? ` title="${formatters.escapeHtml(`${avatarName} 的皮肤头像`)}"` : ''} aria-hidden="true">
        <span class="bot-avatar-fallback">${formatters.escapeHtml(getBotAvatarFallback(bot, selectedServerDir))}</span>
        ${avatarUrl
          ? `<img class="bot-avatar-image" data-role="bot-avatar-image" src="${formatters.escapeHtml(avatarUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
          : ''}
      </span>
    `;
  }

  function bindBotAvatarImages(container) {
    container.querySelectorAll('[data-role="bot-avatar-image"]').forEach((image) => {
      const hideBrokenImage = () => {
        image.hidden = true;
      };
      image.addEventListener('error', hideBrokenImage, { once: true });
      if (image.complete && image.naturalWidth === 0) {
        hideBrokenImage();
      }
    });
  }

  function getServerOptions(bots) {
    return Array.from(new Set((bots || []).map(getBotServerDir).filter(Boolean)))
      .sort((left, right) => left.localeCompare(right));
  }

  function hasMissingServerDirectories(bots) {
    return (bots || []).some((bot) => !getBotServerDir(bot));
  }

  function applyInstanceDirectories(bots, instances) {
    const directoryByBotId = new Map();
    (instances || []).forEach((instance) => {
      const id = String(instance && instance.id || '').trim();
      const serverDir = String(instance && instance.serverDir || '').trim();
      const botDir = String(instance && instance.botDir || '').trim();
      if (id && serverDir) {
        directoryByBotId.set(id, { serverDir, botDir });
      }
    });

    return (bots || []).map((bot) => {
      const directory = directoryByBotId.get(String(bot && bot.id || '').trim());
      if (!directory) return bot;
      return {
        ...bot,
        serverDir: String(bot.serverDir || '').trim() || directory.serverDir,
        botDir: String(bot.botDir || '').trim() || directory.botDir
      };
    });
  }

  function resolveServerFilter(bots, requestedServerDir) {
    const options = getServerOptions(bots);
    const requested = String(requestedServerDir || '').trim();
    if (requested && options.includes(requested)) return requested;
    return hasMissingServerDirectories(bots) ? '' : options[0] || '';
  }

  function applyFilters(bots, filterText, filterState, filterServer) {
    const normalizedFilterText = String(filterText || '').trim().toLowerCase();
    const normalizedFilterState = String(filterState || 'all').trim().toLowerCase();
    const normalizedFilterServer = String(filterServer || '').trim().toLowerCase();

    return (bots || []).filter((bot) => {
      const matchesText = !normalizedFilterText || [
        bot.id,
        bot.username,
        bot.host,
        bot.state
      ].some((value) => String(value || '').toLowerCase().includes(normalizedFilterText));

      const matchesState = normalizedFilterState === 'all' ||
        String(bot.state || '').toLowerCase() === normalizedFilterState;
      const matchesServer = !normalizedFilterServer ||
        getBotServerDir(bot).toLowerCase() === normalizedFilterServer;

      return matchesText && matchesState && matchesServer;
    });
  }

  function renderBotList(container, props) {
    const backend = props.backend;

    if (!backend) {
      container.innerHTML = '<div class="empty-state empty-state-composed"><strong>尚未选择后端</strong><span>从顶部的“后端”入口选择或添加连接。</span></div>';
      containerStates.delete(container);
      return;
    }

    const bots = (backend.bots.allIds || [])
      .map((botId) => backend.bots.byId[botId])
      .filter(Boolean)
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));

    const initialFilterText = String(props.botFilterText || '');
    const initialFilterState = String(props.botFilterState || 'all');
    const serverOptions = getServerOptions(bots);
    const hasUngroupedBots = hasMissingServerDirectories(bots);
    const initialFilterServer = resolveServerFilter(bots, props.botFilterServer);
    const filteredBots = applyFilters(bots, initialFilterText, initialFilterState, initialFilterServer);
    const serverBotCount = initialFilterServer
      ? bots.filter((bot) => getBotServerDir(bot) === initialFilterServer).length
      : bots.length;

    const state = containerStates.get(container) || null;
    const structureKey = formatters.stableStringify({
      ids: bots.map((bot) => bot.id),
      servers: serverOptions,
      hasUngroupedBots,
      filterServer: initialFilterServer
    });

    if (!state || state.structureKey !== structureKey) {
      container.innerHTML = `
        <div class="panel-section stack bot-list-header">
          <div class="row space section-heading">
            <div class="stack section-heading-copy">
              <h2 class="title">Bot 列表</h2>
              <p class="subtitle" data-role="bot-count">${formatters.escapeHtml(backend.name)} · ${filteredBots.length}/${serverBotCount}</p>
            </div>
            <button class="button icon-button small" type="button" data-action="refresh-backend" aria-label="刷新 Bot 列表" title="刷新 Bot 列表"><span class="button-icon" aria-hidden="true">↻</span></button>
          </div>
          <div class="stack filter-surface">
            <label class="label search-field">
              <span class="sr-only">搜索 Bot</span>
              <input class="input grow" data-filter="text" value="${formatters.escapeHtml(props.botFilterText || '')}" placeholder="筛选 Bot、用户名、主机或状态">
            </label>
            <div class="filter-row">
              <select class="select" data-filter="server" aria-label="服务器筛选">
                ${serverOptions.length === 0
                  ? '<option value="">无服务器</option>'
                  : `${hasUngroupedBots ? '<option value="">全部服务器</option>' : ''}${serverOptions.map((serverDir) => `
                      <option value="${formatters.escapeHtml(serverDir)}" ${initialFilterServer === serverDir ? 'selected' : ''}>${formatters.escapeHtml(serverDir)}</option>
                    `).join('')}`}
              </select>
              <select class="select" data-filter="state" aria-label="状态筛选">
                ${FILTER_STATES.map((stateOption) => `
                  <option value="${stateOption.value}" ${props.botFilterState === stateOption.value ? 'selected' : ''}>${formatters.escapeHtml(stateOption.label)}</option>
                `).join('')}
              </select>
            </div>
          </div>
        </div>
        <div class="empty-state empty-state-composed" data-role="bot-empty-state" ${filteredBots.length === 0 ? '' : 'hidden'}><strong>没有匹配的 Bot</strong><span>调整服务器、状态或搜索条件。</span></div>
        <div class="list" data-scroll-id="bot-list" data-role="bot-list">
          ${filteredBots.length === 0
            ? ''
            : filteredBots.map((bot) => `
                <div
                  class="list-card ${backend.selectedBotId === bot.id ? 'selected' : ''}"
                  data-bot-card
                  data-bot-id="${formatters.escapeHtml(bot.id)}"
                  data-bot-state="${formatters.escapeHtml(String(bot.state || ''))}"
                  data-bot-server="${formatters.escapeHtml(getBotServerDir(bot))}"
                  data-bot-search="${formatters.escapeHtml([
                    bot.id,
                    bot.username,
                    bot.host,
                    bot.state
                  ].map((value) => String(value || '')).join(' '))}">
                  <div class="row space bot-card-primary">
                    <div class="bot-card-identity">
                      ${buildBotAvatarHtml(bot, initialFilterServer)}
                      <strong class="mono bot-card-name" data-role="bot-display-name">${formatters.escapeHtml(getBotDisplayName(bot, initialFilterServer))}</strong>
                    </div>
                    <span class="badge ${formatters.formatStateClass(bot.state)}" data-role="bot-state-badge">${formatters.escapeHtml(formatters.formatStateText(bot.state))}</span>
                  </div>
                  <div class="row wrap" data-role="bot-chips" ${buildBotChipsHtml(bot) ? '' : 'hidden'}>
                    ${buildBotChipsHtml(bot)}
                  </div>
                </div>
              `).join('')}
        </div>
      `;

      container.querySelector('[data-action="refresh-backend"]')?.addEventListener('click', () => props.onRefreshBackend());
      bindBotAvatarImages(container);
      containerStates.set(container, { structureKey });
    }

    container.querySelectorAll('[data-bot-card]').forEach((card) => {
      const botId = card.getAttribute('data-bot-id');
      const bot = backend.bots.byId[botId];
      if (!bot) return;

      card.classList.toggle('selected', backend.selectedBotId === botId);
      card.setAttribute('data-bot-state', String(bot.state || ''));
      card.setAttribute('data-bot-server', getBotServerDir(bot));

      const displayName = card.querySelector('[data-role="bot-display-name"]');
      if (displayName) {
        displayName.textContent = getBotDisplayName(bot, initialFilterServer);
      }
      const badge = card.querySelector('[data-role="bot-state-badge"]');
      if (badge) {
        badge.className = `badge ${formatters.formatStateClass(bot.state)}`;
        badge.textContent = formatters.formatStateText(bot.state);
      }
      const chips = card.querySelector('[data-role="bot-chips"]');
      if (chips) {
        const chipsHtml = buildBotChipsHtml(bot);
        chips.innerHTML = chipsHtml;
        chips.hidden = !chipsHtml;
      }

      card.setAttribute('data-bot-search', [
        bot.id,
        bot.username,
        bot.host,
        bot.state
      ].map((value) => String(value || '')).join(' '));
    });

    const textInput = container.querySelector('[data-filter="text"]');
    const stateSelect = container.querySelector('[data-filter="state"]');
    const serverSelect = container.querySelector('[data-filter="server"]');
    const subtitle = container.querySelector('[data-role="bot-count"]');
    const emptyState = container.querySelector('[data-role="bot-empty-state"]');
    const botCards = Array.from(container.querySelectorAll('[data-bot-card]'));

    function applyRenderedFilters(filterText, filterState, filterServer) {
      const normalizedFilterText = String(filterText || '').trim().toLowerCase();
      const normalizedFilterState = String(filterState || 'all').trim().toLowerCase();
      const normalizedFilterServer = String(filterServer || '').trim().toLowerCase();
      let visibleCount = 0;
      let serverCount = 0;

      botCards.forEach((card) => {
        const searchText = String(card.getAttribute('data-bot-search') || '').toLowerCase();
        const stateText = String(card.getAttribute('data-bot-state') || '').toLowerCase();
        const serverText = String(card.getAttribute('data-bot-server') || '').toLowerCase();
        const matchesText = !normalizedFilterText || searchText.includes(normalizedFilterText);
        const matchesState = normalizedFilterState === 'all' || stateText === normalizedFilterState;
        const matchesServer = !normalizedFilterServer || serverText === normalizedFilterServer;
        const visible = matchesText && matchesState && matchesServer;
        card.hidden = !visible;
        if (matchesServer) serverCount += 1;
        const bot = backend.bots.byId[card.getAttribute('data-bot-id')];
        const displayName = card.querySelector('[data-role="bot-display-name"]');
        if (displayName && bot) displayName.textContent = getBotDisplayName(bot, filterServer);
        if (visible) {
          visibleCount += 1;
        }
      });

      if (subtitle) {
        subtitle.textContent = `${backend.name} · ${visibleCount}/${serverCount}`;
      }

      if (emptyState) {
        emptyState.hidden = visibleCount !== 0;
      }
    }

    if (!state || state.structureKey !== structureKey) {
      textInput?.addEventListener('input', (event) => {
        const value = event.target.value;
        props.onChangeFilterText(value);
        applyRenderedFilters(value, stateSelect ? stateSelect.value : initialFilterState, serverSelect ? serverSelect.value : initialFilterServer);
      });
      stateSelect?.addEventListener('change', (event) => {
        const value = event.target.value;
        props.onChangeFilterState(value);
        applyRenderedFilters(textInput ? textInput.value : initialFilterText, value, serverSelect ? serverSelect.value : initialFilterServer);
      });
      serverSelect?.addEventListener('change', (event) => {
        const value = event.target.value;
        if (typeof props.onChangeFilterServer === 'function') {
          props.onChangeFilterServer(value);
        }
        applyRenderedFilters(textInput ? textInput.value : initialFilterText, stateSelect ? stateSelect.value : initialFilterState, value);
      });

      container.querySelectorAll('[data-bot-id]').forEach((element) => {
        element.addEventListener('click', () => {
          props.onSelectBot(element.getAttribute('data-bot-id'));
        });
      });
    }

    if (textInput) {
      textInput.value = initialFilterText;
    }
    if (stateSelect) {
      stateSelect.value = initialFilterState;
    }
    if (serverSelect) serverSelect.value = initialFilterServer;
    applyRenderedFilters(initialFilterText, initialFilterState, initialFilterServer);
  }

  const api = {
    applyFilters,
    buildBotAvatarHtml,
    buildBotChipsHtml,
    getBotAvatarFallback,
    getBotAvatarName,
    getBotAvatarUrl,
    getBotServerDir,
    getBotDisplayName,
    getServerOptions,
    hasMissingServerDirectories,
    applyInstanceDirectories,
    resolveServerFilter,
    renderBotList
  };

  namespace.components = namespace.components || {};
  namespace.components.botList = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
