(function (global) {
  const namespace = global.MultibotPanel = global.MultibotPanel || {};

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function stringifyJson(value) {
    try {
      return JSON.stringify(value == null ? {} : value, null, 2);
    } catch (error) {
      return '{}';
    }
  }

  function parseJsonObject(text, label) {
    const source = String(text || '').trim();
    if (!source) {
      return {};
    }

    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      throw new Error(`${label} JSON 解析失败: ${error.message}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} JSON 必须是对象`);
    }

    return parsed;
  }

  function deepMerge(baseValue, overrideValue) {
    if (!isPlainObject(baseValue)) {
      return isPlainObject(overrideValue) ? { ...overrideValue } : overrideValue;
    }

    const output = { ...baseValue };
    if (!isPlainObject(overrideValue)) {
      return output;
    }

    for (const [key, value] of Object.entries(overrideValue)) {
      if (isPlainObject(value) && isPlainObject(output[key])) {
        output[key] = deepMerge(output[key], value);
        continue;
      }

      output[key] = value;
    }

    return output;
  }

  function valuesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function isPatchApplied(currentValue, patchValue) {
    if (isPlainObject(patchValue)) {
      if (!isPlainObject(currentValue)) {
        return false;
      }

      return Object.entries(patchValue).every(([key, value]) => {
        return isPatchApplied(currentValue[key], value);
      });
    }

    return valuesEqual(currentValue, patchValue);
  }

  function removePatch(currentValue, patchValue) {
    if (isPlainObject(patchValue)) {
      if (!isPlainObject(currentValue)) {
        return currentValue;
      }

      const output = { ...currentValue };
      for (const [key, value] of Object.entries(patchValue)) {
        if (!(key in output)) {
          continue;
        }

        if (isPlainObject(value)) {
          const nextValue = removePatch(output[key], value);
          if (isPlainObject(nextValue) && Object.keys(nextValue).length === 0) {
            delete output[key];
          } else {
            output[key] = nextValue;
          }
          continue;
        }

        if (valuesEqual(output[key], value)) {
          delete output[key];
        }
      }

      return output;
    }

    return valuesEqual(currentValue, patchValue) ? undefined : currentValue;
  }

  const PRESET_DEFINITIONS = [
    {
      id: 'auto_start',
      title: '自动启动',
      description: '把当前 bot 设为 autoStart=true。',
      patch: {
        bot: {
          autoStart: true
        }
      }
    },
    {
      id: 'whitelist_teleport',
      title: '白名单传送',
      description: '启用白名单传送模式，并使用 ../whitelist.txt。',
      patch: {
        bot: {
          teleport: {
            mode: 'whitelist',
            whitelistFile: '../whitelist.txt'
          }
        }
      }
    },
    {
      id: 'resource_pack',
      title: '接受资源包',
      description: '启用 behavior.enableResourcePack=true；再次点击会撤销这个模板项。',
      patch: {
        bot: {
          behavior: {
            enableResourcePack: true
          }
        }
      }
    },
    {
      id: 'disable_entity_handling',
      title: '禁用实体处理',
      description: '设置 capabilities.entityHandling=false，禁用依赖实体处理的能力。',
      patch: {
        bot: {
          capabilities: {
            entityHandling: false
          }
        }
      }
    },
    {
      id: 'disable_terrain_handling',
      title: '禁用地形处理',
      description: '设置 capabilities.terrainHandling=false，禁用依赖地形处理的能力。',
      patch: {
        bot: {
          capabilities: {
            terrainHandling: false
          }
        }
      }
    },
    {
      id: 'auto_fish',
      title: '自动钓鱼',
      description: '启用 fish 自动钓鱼。',
      patch: {
        bot: {
          fish: true
        }
      }
    },
    {
      id: 'trader_monitor',
      title: '行商监控',
      description: '启用 wandering trader / trader llama 监控。',
      patch: {
        bot: {
          monitoring: {
            enabled: true,
            intervalSeconds: 10,
            targetTypes: [
              'minecraft:wandering_trader',
              'minecraft:trader_llama'
            ]
          }
        }
      }
    },
    {
      id: 'auto_attack',
      title: '自动攻击',
      description: '启用自动攻击，并填入一套保守默认值。',
      patch: {
        bot: {
          attack: {
            autoAttack: true,
            attackRange: 3,
            attackInterval: 2000,
            targetFilter: {
              excludeItems: true,
              targetTypes: []
            }
          }
        }
      }
    },
    {
      id: 'recording',
      title: '开启录制',
      description: '启用 flashback 录制。',
      patch: {
        bot: {
          recording: {
            enabled: true
          }
        }
      }
    }
  ];

  function getPresetDefinitions() {
    return PRESET_DEFINITIONS.map((preset) => ({
      id: preset.id,
      title: preset.title,
      description: preset.description
    }));
  }

  function isPresetAppliedToDraft(draft, presetId) {
    const preset = PRESET_DEFINITIONS.find((entry) => entry.id === presetId);
    if (!preset) {
      return false;
    }

    const serverObject = parseJsonObject(draft && draft.serverJson, 'server');
    const botObject = parseJsonObject(draft && draft.botJson, 'bot');
    const serverPatch = preset.patch && isPlainObject(preset.patch.server) ? preset.patch.server : null;
    const botPatch = preset.patch && isPlainObject(preset.patch.bot) ? preset.patch.bot : null;

    const serverApplied = !serverPatch || isPatchApplied(serverObject, serverPatch);
    const botApplied = !botPatch || isPatchApplied(botObject, botPatch);
    return serverApplied && botApplied;
  }

  function applyPresetToDraft(draft, presetId) {
    const preset = PRESET_DEFINITIONS.find((entry) => entry.id === presetId);
    if (!preset) {
      throw new Error(`未知的一键配置: ${presetId}`);
    }

    const serverObject = parseJsonObject(draft && draft.serverJson, 'server');
    const botObject = parseJsonObject(draft && draft.botJson, 'bot');
    const serverPatch = preset.patch && isPlainObject(preset.patch.server) ? preset.patch.server : null;
    const botPatch = preset.patch && isPlainObject(preset.patch.bot) ? preset.patch.bot : null;

    return {
      ...(draft || {}),
      serverJson: stringifyJson(serverPatch ? deepMerge(serverObject, serverPatch) : serverObject),
      botJson: stringifyJson(botPatch ? deepMerge(botObject, botPatch) : botObject)
    };
  }

  function removePresetFromDraft(draft, presetId) {
    const preset = PRESET_DEFINITIONS.find((entry) => entry.id === presetId);
    if (!preset) {
      throw new Error(`未知的一键配置: ${presetId}`);
    }

    const serverObject = parseJsonObject(draft && draft.serverJson, 'server');
    const botObject = parseJsonObject(draft && draft.botJson, 'bot');
    const serverPatch = preset.patch && isPlainObject(preset.patch.server) ? preset.patch.server : null;
    const botPatch = preset.patch && isPlainObject(preset.patch.bot) ? preset.patch.bot : null;

    return {
      ...(draft || {}),
      serverJson: stringifyJson(serverPatch ? removePatch(serverObject, serverPatch) : serverObject),
      botJson: stringifyJson(botPatch ? removePatch(botObject, botPatch) : botObject)
    };
  }

  function togglePresetInDraft(draft, presetId) {
    return isPresetAppliedToDraft(draft, presetId)
      ? removePresetFromDraft(draft, presetId)
      : applyPresetToDraft(draft, presetId);
  }

  const api = {
    getPresetDefinitions,
    isPresetAppliedToDraft,
    applyPresetToDraft,
    removePresetFromDraft,
    togglePresetInDraft
  };

  namespace.instancePresets = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
