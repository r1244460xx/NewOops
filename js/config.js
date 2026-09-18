/**
 * Mr. Oops!! - Game Configuration & Parameter Manager
 * Handles loading, disk persistence (server POST + config.json), cross-tab sync,
 * and live updates for all gameplay-related numerical values.
 */

const DEFAULT_GAME_CONFIG = {
  warningMultiplier: 0.75,
  rockWarningBase: 1.15,
  cannonWarningBase: 0.95,
  laserWarningBase: 1.0,
  rockSpeed: 1.7,
  cannonSpeed: 6.3,
  laserDuration: 0.28,
  rockSpawnInterval: 1.6,
  cannonSpawnInterval: 1.35,
  laserSpawnInterval: 1.45,
  allstarSpawnInterval: 1.2,
  maxLines: 4,
  hopDuration: 0.11,
  wavesPerLevel: 5,
  starCooldown: 6,
  nearMissDistance: 0.95,
  versusCollisionMode: 'push',
  versusTargetWins: 3,
  versusHazardMode: 'allstar',
  momentumWindow: 0.32,
  momentumStepsRequired: 1
};

const CONFIG_SCHEMA = [
  // 1. 預警與節奏
  {
    key: 'warningMultiplier',
    category: '預警與節奏 (Timing & Warnings)',
    label: '彈道提示時間倍率 (Warning Multiplier)',
    min: 0.2,
    max: 2.0,
    step: 0.05,
    unit: '倍',
    placeholder: '0.75',
    desc: '全局預警時間縮放倍率（原版基準 × 此倍率）'
  },
  {
    key: 'rockWarningBase',
    category: '預警與節奏 (Timing & Warnings)',
    label: '慢速巨石基準預警 (Rock Warning Base)',
    min: 0.3,
    max: 3.0,
    step: 0.05,
    unit: '秒',
    placeholder: '1.15',
    desc: '巨石發射前紅箭頭提示的基準秒數'
  },
  {
    key: 'cannonWarningBase',
    category: '預警與節奏 (Timing & Warnings)',
    label: '中速砲彈基準預警 (Cannon Warning Base)',
    min: 0.3,
    max: 2.5,
    step: 0.05,
    unit: '秒',
    placeholder: '0.95',
    desc: '砲彈發射前紅箭頭提示的基準秒數'
  },
  {
    key: 'laserWarningBase',
    category: '預警與節奏 (Timing & Warnings)',
    label: '快速雷射基準預警 (Laser Warning Base)',
    min: 0.3,
    max: 2.5,
    step: 0.05,
    unit: '秒',
    placeholder: '1.00',
    desc: '雷射蓄力紅線閃爍的基準秒數'
  },
  {
    key: 'rockSpawnInterval',
    category: '預警與節奏 (Timing & Warnings)',
    label: '慢速巨石波次間隔 (Rock Spawn Interval)',
    min: 0.3,
    max: 4.0,
    step: 0.05,
    unit: '秒',
    placeholder: '1.60',
    desc: '巨石模式下，兩波巨石攻擊之間的冷卻間隔'
  },
  {
    key: 'cannonSpawnInterval',
    category: '預警與節奏 (Timing & Warnings)',
    label: '中速砲彈波次間隔 (Cannon Spawn Interval)',
    min: 0.3,
    max: 4.0,
    step: 0.05,
    unit: '秒',
    placeholder: '1.35',
    desc: '砲彈模式下，兩波砲彈攻擊之間的冷卻間隔'
  },
  {
    key: 'laserSpawnInterval',
    category: '預警與節奏 (Timing & Warnings)',
    label: '快速雷射波次間隔 (Laser Spawn Interval)',
    min: 0.3,
    max: 4.0,
    step: 0.05,
    unit: '秒',
    placeholder: '1.45',
    desc: '雷射模式下，兩波雷射攻擊之間的冷卻間隔'
  },
  {
    key: 'allstarSpawnInterval',
    category: '預警與節奏 (Timing & Warnings)',
    label: '全明星波次間隔 (All-Star Spawn Interval)',
    min: 0.3,
    max: 4.0,
    step: 0.05,
    unit: '秒',
    placeholder: '1.20',
    desc: '全明星大亂鬥模式下，兩波複合攻擊之間的冷卻間隔'
  },

  // 2. 飛行道具與難度
  {
    key: 'rockSpeed',
    category: '飛行道具數值 (Projectiles & Speed)',
    label: '慢速巨石滾動速度 (Rock Speed)',
    min: 0.5,
    max: 6.0,
    step: 0.1,
    unit: '格/秒',
    placeholder: '1.7',
    desc: '巨石在棋盤上的基礎滾動速度'
  },
  {
    key: 'cannonSpeed',
    category: '飛行道具數值 (Projectiles & Speed)',
    label: '中速砲彈飛行速度 (Cannon Speed)',
    min: 1.0,
    max: 15.0,
    step: 0.2,
    unit: '格/秒',
    placeholder: '6.3',
    desc: '鐵球砲彈疾馳而過的基礎速度'
  },
  {
    key: 'laserDuration',
    category: '飛行道具數值 (Projectiles & Speed)',
    label: '快速雷射持續光束 (Laser Active Beam)',
    min: 0.08,
    max: 1.0,
    step: 0.02,
    unit: '秒',
    placeholder: '0.28',
    desc: '雷射光束爆發在棋盤上的停留判定時間'
  },
  {
    key: 'maxLines',
    category: '飛行道具數值 (Projectiles & Speed)',
    label: '最大同時發射直線數 (Max Concurrent Lines)',
    min: 1,
    max: 5,
    step: 1,
    unit: '條',
    placeholder: '4',
    desc: '單波發射直線道具的最大上限（Level 4+ 鎖定上限）'
  },

  // 3. 角色與關卡機制
  {
    key: 'hopDuration',
    category: '角色與關卡 (Player & Mechanics)',
    label: '角色跳躍移動時間 (Player Hop Duration)',
    min: 0.05,
    max: 0.25,
    step: 0.01,
    unit: '秒',
    placeholder: '0.11',
    desc: 'Mr. Oops 從一格跳到鄰格的時間（越小越敏捷）'
  },
  {
    key: 'wavesPerLevel',
    category: '角色與關卡 (Player & Mechanics)',
    label: '升級所需波數 (Waves Per Level)',
    min: 1,
    max: 20,
    step: 1,
    unit: '波',
    placeholder: '5',
    desc: '每一等級需要避開的攻擊波次總數（閃避完此波數後升至下一等級）'
  },
  {
    key: 'starCooldown',
    category: '角色與關卡 (Player & Mechanics)',
    label: '金星刷新冷卻時間 (Star Spawn Cooldown)',
    min: 2,
    max: 20,
    step: 1,
    unit: '秒',
    placeholder: '6',
    desc: '地圖上隨機刷新額外加分星星的間隔'
  },
  {
    key: 'nearMissDistance',
    category: '角色與關卡 (Player & Mechanics)',
    label: '極限閃避判定半徑 (Near Miss Radius)',
    min: 0.5,
    max: 1.5,
    step: 0.05,
    unit: '格',
    placeholder: '0.95',
    desc: '剛離開的格子遭遇道具時觸發擦身閃避加分的距離'
  },

  // 4. 雙人對戰設定 (1v1 Versus Settings)
  {
    key: 'versusCollisionMode',
    category: '雙人對戰設定 (1v1 Versus Settings)',
    type: 'select',
    label: '單位碰撞規則 (Unit Collision Mode)',
    options: [
      { value: 'push', label: '動量推擠 (Momentum Push - 連走2格蓄力推飛 / 迎面對撞拼刀 / 無動量硬直彈回)' },
      { value: 'solid', label: '實體卡位 (Solid Block - 一格限一人，搶位阻擋)' },
      { value: 'ghost', label: '穿透重疊 (Ghost - 兩人可重疊，純比走位)' }
    ],
    placeholder: 'push',
    desc: '決定兩位玩家跳至同一個格子時的實體交互行為'
  },
  {
    key: 'momentumWindow',
    category: '雙人對戰設定 (1v1 Versus Settings)',
    type: 'number',
    label: '動量連續時間窗口 (Momentum Window)',
    min: 0.15,
    max: 0.60,
    step: 0.01,
    unit: 's',
    placeholder: '0.32',
    desc: '判定同方向連續前進的時間寬容度（格鬥遊戲建議約 0.30s～0.35s）'
  },
  {
    key: 'momentumStepsRequired',
    category: '雙人對戰設定 (1v1 Versus Settings)',
    type: 'number',
    label: '動量累積所需步數 (Momentum Steps Required)',
    min: 1,
    max: 3,
    step: 1,
    unit: '格',
    placeholder: '1',
    desc: '累積衝刺動量所需的連續移動格數（預設 1 格，中間隔一空格即可衝撞）'
  },
  {
    key: 'versusTargetWins',
    category: '雙人對戰設定 (1v1 Versus Settings)',
    type: 'number',
    label: '對戰獲勝局數 (Target Wins to Crown)',
    min: 1,
    max: 10,
    step: 1,
    unit: '勝',
    placeholder: '3',
    desc: '率先累積達到此勝場局數的玩家獲得整場比賽總冠軍'
  },
  {
    key: 'versusHazardMode',
    category: '雙人對戰設定 (1v1 Versus Settings)',
    type: 'select',
    label: '對戰飛行道具 (Versus Hazard Mode)',
    options: [
      { value: 'allstar', label: '全明星大亂鬥 (All-Star - 巨石+砲彈+雷射)' },
      { value: 'rock', label: '慢速巨石 (Rock - 考驗安全卡位)' },
      { value: 'cannon', label: '中速砲彈 (Cannon - 緊湊高速閃避)' },
      { value: 'laser', label: '快速雷射 (Laser - 極限預判紅線)' }
    ],
    placeholder: 'allstar',
    desc: '雙人對決時預設出現的飛行道具種類'
  }
];

class ConfigManager {
  constructor() {
    this.config = Object.assign({}, DEFAULT_GAME_CONFIG);
    this.listeners = [];
    this.statusListeners = [];
    this.channel = null;
    this.hasLocalCustomizations = false;
    this._saveDebounce = null;

    // 1. Cross-tab communication channel (real-time broadcast)
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel('mroops_config_channel');
        this.channel.onmessage = (e) => {
          if (e.data && e.data.type === 'CONFIG_UPDATED' && e.data.config) {
            this.applyValues(e.data.config);
            this.notify();
          }
        };
      } catch (err) {}
    }

    // 2. Storage event listener (native cross-tab sync when localStorage changes)
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('storage', (e) => {
        if (e.key === 'mroops_game_config' && e.newValue) {
          try {
            const parsed = JSON.parse(e.newValue);
            this.applyValues(parsed);
            this.notify();
          } catch (err) {}
        }
      });

      // 3. Tab Focus listener: When user switches from settings tab back to game tab,
      // immediately and synchronously re-read the latest parameters!
      window.addEventListener('focus', () => {
        this.syncLatest();
      });

      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          this.syncLatest();
        }
      });
    }

    this.syncLatest();
  }

  // Synchronously re-reads localStorage, then verifies against disk config.json.
  // Called whenever starting a new game, retrying after game over, or switching tabs.
  syncLatest() {
    // Step 1: SYNCHRONOUS read from localStorage (0ms latency, zero delay!)
    try {
      const saved = localStorage.getItem('mroops_game_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.applyValues(parsed);
        this.hasLocalCustomizations = true;
      }
    } catch (e) {}

    this.notify();

    // Step 2: Background fetch for disk config.json (in case modified in text editor)
    if (typeof fetch === 'function') {
      fetch('config.json?t=' + Date.now(), { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((diskJson) => {
          if (diskJson) {
            const localTs = parseInt(localStorage.getItem('mroops_config_updated_at') || '0', 10);
            const diskTs = diskJson._updatedAt ? parseInt(diskJson._updatedAt, 10) : 0;

            // If disk is newer or local is empty, update from disk
            if (diskTs > localTs || !localStorage.getItem('mroops_game_config')) {
              this.applyValues(diskJson);
              this.saveLocal(diskTs || Date.now());
              this.notify();
            }
          }
        })
        .catch(() => {});
    }

    return this.config;
  }

  // Alias for backward compatibility
  reloadFromDisk() {
    return this.syncLatest();
  }

  applyValues(source) {
    if (!source || typeof source !== 'object') return;
    for (const item of CONFIG_SCHEMA) {
      const key = item.key;
      if (source[key] !== undefined) {
        if (item.type === 'select') {
          this.config[key] = String(source[key]);
        } else {
          const val = parseFloat(source[key]);
          if (!isNaN(val)) {
            this.config[key] = val;
          }
        }
      }
    }
  }

  get(key) {
    return this.config[key] !== undefined ? this.config[key] : DEFAULT_GAME_CONFIG[key];
  }

  // Update a parameter: immediately updates memory, localStorage, broadcasts to game,
  // and triggers debounced auto-persist to disk.
  set(key, value) {
    const item = CONFIG_SCHEMA.find((s) => s.key === key);
    let finalVal = value;
    if (!item || item.type !== 'select') {
      const num = parseFloat(value);
      if (isNaN(num)) return;
      finalVal = num;
    } else {
      finalVal = String(value);
    }

    this.config[key] = finalVal;
    this.hasLocalCustomizations = true;
    const ts = Date.now();
    this.saveLocal(ts);
    this.notify();
    this.broadcast();

    // Automatically persist to disk without requiring manual button click!
    this.triggerAutoSave();
  }

  triggerAutoSave() {
    this.notifyStatus({ status: 'saving', message: '💾 自動儲存中...' });
    clearTimeout(this._saveDebounce);
    this._saveDebounce = setTimeout(() => {
      this.saveToDisk();
    }, 200);
  }

  saveLocal(ts = Date.now()) {
    try {
      localStorage.setItem('mroops_game_config', JSON.stringify(this.config));
      localStorage.setItem('mroops_config_updated_at', ts.toString());
    } catch (e) {}
  }

  broadcast() {
    if (this.channel) {
      try {
        this.channel.postMessage({
          type: 'CONFIG_UPDATED',
          config: this.config
        });
      } catch (e) {}
    }
  }

  // Persist configuration to disk (via server.py /api/config)
  async saveToDisk(newConfig) {
    if (newConfig) {
      this.applyValues(newConfig);
      this.hasLocalCustomizations = true;
    }
    const ts = Date.now();
    this.saveLocal(ts);
    this.broadcast();

    const cleanData = {};
    for (const item of CONFIG_SCHEMA) {
      cleanData[item.key] = this.get(item.key);
    }
    cleanData._updatedAt = ts;

    // Post to server to overwrite config.json on disk
    if (typeof fetch === 'function') {
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(cleanData, null, 2)
        });

        if (res.ok) {
          const result = await res.json();
          this.notifyStatus({
            status: 'saved',
            method: 'disk',
            message: '✅ 已自動儲存並寫入硬碟 config.json！'
          });
          return { success: true, method: 'disk', message: result.message || '已寫入硬碟 config.json！' };
        }
      } catch (e) {
        // Fall through to local status
      }
    }

    this.notifyStatus({
      status: 'saved',
      method: 'local',
      message: '⚡ 已自動儲存至瀏覽器本地 (如需寫入硬碟檔案請重啟 python3 server.py)'
    });

    return {
      success: true,
      method: 'local',
      message: '已儲存至瀏覽器本地'
    };
  }

  resetDefaults() {
    this.config = Object.assign({}, DEFAULT_GAME_CONFIG);
    this.hasLocalCustomizations = false;
    const ts = Date.now();
    this.saveLocal(ts);
    this.notify();
    this.broadcast();
    this.saveToDisk();
    return this.config;
  }

  onChange(callback) {
    this.listeners.push(callback);
  }

  notify() {
    for (const cb of this.listeners) {
      try { cb(this.config); } catch (e) {}
    }
  }

  onStatusChange(callback) {
    this.statusListeners.push(callback);
  }

  notifyStatus(info) {
    for (const cb of this.statusListeners) {
      try { cb(info); } catch (e) {}
    }
  }

  downloadJSON() {
    const jsonStr = JSON.stringify(this.config, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'config.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  copyJSON() {
    const jsonStr = JSON.stringify(this.config, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(jsonStr);
    }
    return Promise.reject('Clipboard not supported');
  }
}

// Global Singleton
window.configManager = new ConfigManager();
window.CONFIG_SCHEMA = CONFIG_SCHEMA;
