/**
 * Mr. Oops!! - Game Controller & State Machine
 * Manages player mechanics, input buffering, wave transitions, scoring,
 * collectibles, and game state.
 */

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new GameRenderer(canvas);
    this.sound = window.soundEngine;
    this.obstacleManager = new ObstacleManager(this.renderer, this.sound, this);

    // Prewarm GPU rendering pipelines in main menu to eliminate in-game JIT stutter
    this.renderer.prewarm();

    this.state = 'MENU';
    this.mode = 'rock';
    this.bloodyMode = false;
    this.enableVirtualDpad = false;

    // Versus Mode state
    this.isVersus = false;
    this.isVersus4p = false;
    this.versusScores = { p1: 0, p2: 0 };
    this.versus4pScores = [0, 0, 0, 0];
    this.versusPlayerCount = 4;
    this.versusTargetWins = 3;
    this.versusWinner = null;
    this.versus4pWinner = null;
    this.versusRoundDelay = 0;
    this.versus4pRoundDelay = 0;
    this.aiUpdateCooldown = 0;
    this.humanP2Controlled = false;
    this.humanP3Controlled = false;
    this.humanP4Controlled = false;
    this.players = [];

    // LAN Multiplayer state
    this.netRole = null; // null (offline local) | 'host' | 'client'
    this.pausedBy = null; // 'p1' | 'p2' | 'p2_left' | null
    this.waitingForOpponent = false;
    this.startCountdownTimer = 0;
    this.lastCountdownSec = 0;
    this.rematchVotes = { p1: false, p2: false };
    this.rematchStarting = false;
    this.pendingSounds = [];
    this.activeBanner = null;
    this.lastShownBannerKey = null;
    this._gameOverFired = false;

    // Player Object
    this.player = this.createPlayer(2, 3, 0, false);

    this.initNetwork();

    // Connect hopDuration to live config updates
    if (window.configManager) {
      this.player.hopDuration = window.configManager.get('hopDuration');
      window.configManager.onChange((newCfg) => {
        if (newCfg.hopDuration) {
          this.player.hopDuration = newCfg.hopDuration;
          for (const p of this.players) {
            p.hopDuration = newCfg.hopDuration;
          }
        }
      });
    }

    // Input buffer for fast, seamless movement
    this.bufferedMove = null;

    // Progression & Scores
    this.score = 0;
    this.wave = 1;
    this.survivalTimer = 0;
    this.highScores = {
      rock: 0,
      cannon: 0,
      laser: 0,
      allstar: 0
    };

    // Collectibles (Stars)
    this.collectibles = [];
    this.starSpawnCooldown = 5;

    // Hit Freeze / Death transition
    this.hitFreezeTimer = 0;
    this.gameOverDelay = 0;

    // Timing loop
    this.lastTime = 0;

    // DOM Element Caching & Dirty Checking
    this.domElements = {
      score: null,
      wave: null,
      best: null,
      versusVal: null
    };
    this.lastRenderedScore = -1;
    this.lastRenderedWave = -1;
    this.lastRenderedBest = -1;
    this.lastVersusP1 = -1;
    this.lastVersusP2 = -1;

    // 30 Hz Network Broadcast Throttling (33ms tickrate for state snapshots)
    this.netBroadcastTimer = 0;
    this.netBroadcastInterval = 1 / 30;

    this.loadHighScores();

    // Start animation loop
    requestAnimationFrame((t) => this.gameLoop(t));
  }

  createPlayer(col, row, index = 0, isVersus = false, color = null) {
    const hopDuration = window.configManager ? window.configManager.get('hopDuration') : 0.11;
    return {
      id: isVersus ? index + 1 : 0,
      playerIndex: index,
      color: color,
      isAi: false,
      col: col,
      row: row,
      animX: col,
      animY: row,
      hopProgress: 1,
      hopDuration: hopDuration,
      hopZ: 0,
      tiltAngle: 0,
      isHopping: false,
      isScared: false,
      isDead: false,
      targetCol: col,
      targetRow: row,
      prevCol: col,
      prevRow: row,
      bufferedMove: null,
      momentumDir: { dx: 0, dy: 0 },
      momentumSteps: 0,
      momentumTimer: 0,
      stunTimer: 0,
      recoilX: 0,
      recoilY: 0,
      afterimageTimer: 0,
      invulnerableTimer: 0
    };
  }

  loadHighScores() {
    try {
      const saved = localStorage.getItem('mroops_high_scores');
      if (saved) {
        this.highScores = Object.assign(this.highScores, JSON.parse(saved));
      }
    } catch (e) {
      console.warn('LocalStorage unavailable', e);
    }
  }

  saveHighScore(mode, score) {
    if (score > (this.highScores[mode] || 0)) {
      this.highScores[mode] = score;
      try {
        localStorage.setItem('mroops_high_scores', JSON.stringify(this.highScores));
      } catch (e) {}
      return true;
    }
    return false;
  }

  getBestScore(mode) {
    return this.highScores[mode] || 0;
  }

  initNetwork() {
    const net = window.networkManager;
    if (!net) return;

    net.onInput = (payload, playerIndex) => {
      if (this.netRole === 'host' && (this.isVersus || this.isVersus4p) && this.state === 'PLAYING') {
        const pIdx = (typeof playerIndex === 'number') ? playerIndex : 1;
        this.movePlayer(pIdx, payload.dx, payload.dy);
      }
    };

    net.onState = (msg) => {
      if (this.netRole === 'client') {
        this.applyRemoteState(msg);
      }
    };

    net.onJoined = (msg) => {
      if (this.isVersus4p) {
        const totalReq = this.versusPlayerCount || (this.mode === 'versus3p' ? 3 : 4);
        const neededClients = totalReq - 1;
        if (this.netRole === 'host') {
          const clientCount = net ? net.connectedClientCount : 0;
          if (clientCount < neededClients) {
            this.waitingForOpponent = true;
            this.state = 'WAITING_FOR_PLAYERS';
            this.showWaveBanner('WAITING FOR PLAYERS', `已加入 ${clientCount + 1}/${totalReq} 人，等待全員到齊後開打...`, 0);
          }
          this.updateNetHudBadge();
        } else if (this.netRole === 'client') {
          this.waitingForOpponent = true;
          this.state = 'WAITING_FOR_PLAYERS';
          const pIdx = (typeof msg.playerIndex === 'number') ? msg.playerIndex : 1;
          this.showWaveBanner(`你是 P${pIdx + 1} 號玩家`, `等待房主與其他玩家全員到齊 (${totalReq}/${totalReq})...`, 0);
          this.updateNetHudBadge();
        }
        return;
      }

      if (this.netRole === 'host') {
        if (msg.opponent_present && (this.state === 'WAITING_FOR_PLAYERS' || this.waitingForOpponent)) {
          this.waitingForOpponent = false;
          this.updateNetHudBadge();
          // WebRTC P2P handshake starts automatically; countdown triggers on onP2PConnected
        } else {
          this.updateNetHudBadge();
        }
      } else if (this.netRole === 'client') {
        this.updateNetHudBadge();
      }
    };

    net.onOpponentJoined = (msg) => {
      this.updateNetHudBadge();
      if (this.netRole === 'host') {
        if (this.isVersus4p) {
          const totalReq = this.versusPlayerCount || (this.mode === 'versus3p' ? 3 : 4);
          const neededClients = totalReq - 1;
          const pIdx = msg && typeof msg.playerIndex === 'number' ? msg.playerIndex : null;
          if (pIdx !== null && this.players && this.players[pIdx]) {
            this.players[pIdx].isAi = false;
            this.updateVersus4pHud();
          }
          const clientCount = net ? net.connectedClientCount : 0;
          if (clientCount < neededClients) {
            this.waitingForOpponent = true;
            this.state = 'WAITING_FOR_PLAYERS';
            const total = (msg && msg.totalClients ? msg.totalClients : clientCount) + 1;
            this.showWaveBanner('WAITING FOR PLAYERS', `已加入 ${total}/${totalReq} 人，等待全員到齊後開打...`, 0);
          }
        } else {
          if (this.state === 'WAITING_FOR_PLAYERS' || this.waitingForOpponent) {
            this.waitingForOpponent = false;
            // WebRTC P2P handshake starts automatically; countdown triggers on onP2PConnected
          }
        }
      }
    };

    net.onP2PConnecting = () => {
      console.log('[Game] P2P connecting...');
      const badge = document.getElementById('hud-net-badge');
      if (badge) {
        badge.textContent = '🟡 P2P 配對中...';
        badge.className = 'hud-net-badge waiting';
      }
    };

    net.onP2PConnected = (info) => {
      console.log('[Game] ⚡ WebRTC P2P Connected successfully!', info);
      this.updateNetHudBadge();

      if (this.isVersus4p) {
        const totalReq = this.versusPlayerCount || (this.mode === 'versus3p' ? 3 : 4);
        const neededClients = totalReq - 1;
        if (info && typeof info.playerIndex === 'number' && this.players && this.players[info.playerIndex]) {
          this.players[info.playerIndex].isAi = false;
          this.updateVersus4pHud();
        }

        const clientCount = net ? net.connectedClientCount : 0;
        if (clientCount >= neededClients) {
          // Exactly all players ready: Host (P1) + Clients
          this.waitingForOpponent = false;
          if (this.netRole === 'host' && (this.state === 'WAITING_FOR_PLAYERS' || this.waitingForOpponent || this.state === 'START_COUNTDOWN')) {
            this.startMatchCountdown(3);
          }
        } else {
          this.waitingForOpponent = true;
          this.state = 'WAITING_FOR_PLAYERS';
          this.showWaveBanner('WAITING FOR PLAYERS', `已連線 ${clientCount + 1}/${totalReq} 人，等待全員到齊後開打...`, 0);
          if (this.netRole === 'host') {
            this.broadcastHostState();
          }
        }
        return;
      }

      // 1v1 versus mode
      this.waitingForOpponent = false;
      if (this.netRole === 'host' && (this.state === 'WAITING_FOR_PLAYERS' || this.waitingForOpponent || this.state === 'START_COUNTDOWN')) {
        this.startMatchCountdown(3);
      }
    };

    net.onP2PFailed = (reason) => {
      console.warn('[Game] ❌ WebRTC P2P Failed:', reason);
      const badge = document.getElementById('hud-net-badge');
      if (badge) {
        badge.textContent = '🔴 P2P 失敗';
        badge.className = 'hud-net-badge bad';
      }
      this.showWaveBanner('P2P FAILED', '3秒無法直連，已終止對戰', 4500);
      this.state = 'WAITING_FOR_PLAYERS';
      this.waitingForOpponent = true;
    };

    net.onHostReady = () => {
      this.updateNetHudBadge();
    };

    net.onOpponentLeft = (msg) => {
      this.updateNetHudBadge();
      if (this.isVersus4p) {
        const totalReq = this.versusPlayerCount || (this.mode === 'versus3p' ? 3 : 4);
        const pIdx = msg && typeof msg.playerIndex === 'number' ? msg.playerIndex : null;
        const pNames = ['P1', 'P2', 'P3', 'P4'];
        const leftName = (pIdx !== null && pNames[pIdx]) ? pNames[pIdx] : '有玩家';

        if (this.netRole === 'host') {
          const clientCount = net ? net.connectedClientCount : 0;
          this.waitingForOpponent = true;
          this.state = 'WAITING_FOR_PLAYERS';
          this.showWaveBanner('PLAYER LEFT', `${leftName} 已離線！目前 ${clientCount + 1}/${totalReq} 人，等待全員到齊...`, 0);
          this.sound.stopBgm();
          this.broadcastHostState();
        } else if (this.netRole === 'client') {
          this.state = 'WAITING_FOR_PLAYERS';
          if (msg && msg.role === 'host') {
            this.showWaveBanner('HOST LEFT', '房主已離開房間，連線已關閉', 0);
          } else {
            this.showWaveBanner('PLAYER LEFT', `${leftName} 已離線，等待全員到齊...`, 0);
          }
          this.sound.stopBgm();
        }
        return;
      }

      if (this.netRole === 'host') {
        this.showWaveBanner('OPPONENT LEFT', 'P2 DISCONNECTED', 0);
        this.pauseGame('p2_left');
      } else if (this.netRole === 'client') {
        this.showWaveBanner('HOST LEFT', 'ROOM CLOSED', 0);
      }
    };

    const prevOnPing = net.onPing;
    net.onPing = (pingMs, isP2P) => {
      if (typeof prevOnPing === 'function') {
        prevOnPing(pingMs, isP2P);
      }
      if ((this.mode === 'versus' || this.mode === 'versus4p') && isP2P) {
        this.updateNetHudBadge(pingMs);
      }
    };

    net.onPauseRequest = (msg) => {
      if (this.netRole === 'host') {
        this.pauseGame(msg.pausedBy || 'p2');
      }
    };

    net.onResumeRequest = () => {
      if (this.netRole === 'host') {
        this.resumeGame();
      }
    };

    net.onRematchVote = (msg) => {
      if (this.netRole === 'host') {
        this.setRematchVote('p2', Boolean(msg.ready));
      }
    };

    net.onRematchSync = (msg) => {
      if (this.netRole === 'client') {
        this.rematchVotes = msg.rematchVotes || { p1: false, p2: false };
        this.updateRematchUi(msg.startingSoon);
        if (msg.startingSoon) {
          this.playSound('gem');
          setTimeout(() => {
            const goOverlay = document.getElementById('gameover-overlay');
            if (goOverlay) goOverlay.classList.add('hidden');
          }, 1500);
        }
      }
    };
  }

  updateNetHudBadge(pingMs) {
    const badge = document.getElementById('hud-net-badge');
    if (!badge) return;

    const net = window.networkManager;

    if (this.mode === 'versus4p' || this.mode === 'versus3p' || this.isVersus4p) {
      const totalReq = this.versusPlayerCount || (this.mode === 'versus3p' ? 3 : 4);
      const targetClients = totalReq - 1;
      if (!this.netRole) {
        badge.textContent = `⚡ 本機${totalReq}人 (0ms)`;
        badge.className = `hud-net-badge connected`;
        return;
      }
      const clientCount = net ? net.connectedClientCount : 0;
      let ping = null;
      if (typeof pingMs === 'number' && !isNaN(pingMs)) {
        ping = pingMs;
      } else if (net && typeof net.p2pPing === 'number' && !isNaN(net.p2pPing)) {
        ping = net.p2pPing;
      }
      const pingStr = ping !== null ? `${ping}ms` : '-- ms';

      if (this.netRole === 'host') {
        if (clientCount < targetClients) {
          badge.textContent = `🟡 等待玩家加入 (${clientCount + 1}/${totalReq})...`;
          badge.className = 'hud-net-badge waiting';
        } else {
          badge.textContent = `🟢 ${totalReq} 人已到齊 · ${pingStr}`;
          badge.className = 'hud-net-badge connected';
        }
      } else {
        const myIdx = (net && typeof net.playerIndex === 'number') ? (net.playerIndex + 1) : 2;
        if (!net || !net.isP2PActive) {
          badge.textContent = `🟡 P${myIdx} 連線中 (等待全員 ${totalReq}/${totalReq})...`;
          badge.className = 'hud-net-badge waiting';
        } else {
          badge.textContent = `🟢 P${myIdx} 已連線 · ${pingStr}`;
          badge.className = 'hud-net-badge connected';
        }
      }
      return;
    }

    if (this.mode === 'versus') {
      const isP2P = Boolean(net && net.isP2PActive);
      let ping = null;
      if (isP2P) {
        if (typeof pingMs === 'number' && !isNaN(pingMs)) {
          ping = pingMs;
        } else if (net && typeof net.p2pPing === 'number' && !isNaN(net.p2pPing)) {
          ping = net.p2pPing;
        }
      }
      const pingStr = ping !== null ? `${ping}ms` : '-- ms';

      let colorClass = 'connected';
      let dot = '🟢';
      if (ping === null) {
        colorClass = 'waiting';
        dot = '🟡';
      } else if (ping > 60) {
        colorClass = 'bad';
        dot = '🔴';
      } else if (ping > 30) {
        colorClass = 'warn';
        dot = '🟡';
      }

      if (this.netRole === 'host') {
        const isClientConnected = net && net.opponentConnected;
        if (!isClientConnected) {
          badge.textContent = '🟡 等待對手加入...';
          badge.className = 'hud-net-badge waiting';
        } else if (!isP2P) {
          badge.textContent = '🟡 P2P 配對中...';
          badge.className = 'hud-net-badge waiting';
        } else {
          badge.textContent = `${dot} P1 ↔ P2 · ${pingStr}`;
          badge.className = `hud-net-badge ${colorClass}`;
        }
      } else if (this.netRole === 'client') {
        const isHostConnected = net && net.opponentConnected;
        if (!isHostConnected) {
          badge.textContent = '🟡 等待房主...';
          badge.className = 'hud-net-badge waiting';
        } else if (!isP2P) {
          badge.textContent = '🟡 P2P 配對中...';
          badge.className = 'hud-net-badge waiting';
        } else {
          badge.textContent = `${dot} P2 ↔ P1 · ${pingStr}`;
          badge.className = `hud-net-badge ${colorClass}`;
        }
      } else {
        badge.textContent = `${dot} ${pingStr}`;
        badge.className = `hud-net-badge ${colorClass}`;
      }
    } else {
      // Single player is 100% client-side 0ms
      badge.textContent = `⚡ 本機 (0ms)`;
      badge.className = `hud-net-badge connected`;
    }
  }

  playSound(name) {
    if (this.sound && typeof this.sound[name] === 'function') {
      this.sound[name]();
    }
    if (this.netRole === 'host') {
      this.pendingSounds.push(name);
    }
  }

  broadcastHostState() {
    if (!window.networkManager || !window.networkManager.isConnected) return;
    const sounds = this.pendingSounds.splice(0);
    const r2 = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);

    window.networkManager.sendState({
      state: this.state,
      mode: this.mode,
      wave: this.wave,
      isVersus4p: this.isVersus4p,
      versusPlayerCount: this.versusPlayerCount,
      versusScores: this.versusScores,
      versusWinner: this.versusWinner,
      versus4pScores: this.versus4pScores,
      versus4pWinner: this.versus4pWinner,
      pausedBy: this.pausedBy,
      waitingForOpponent: this.waitingForOpponent,
      rematchVotes: this.rematchVotes,
      players: this.players.map(p => ({
        id: p.id,
        playerIndex: p.playerIndex,
        color: p.color,
        isAi: p.isAi,
        col: p.col,
        row: p.row,
        prevCol: p.prevCol !== undefined ? p.prevCol : p.col,
        prevRow: p.prevRow !== undefined ? p.prevRow : p.row,
        animX: r2(p.animX),
        animY: r2(p.animY),
        hopZ: r2(p.hopZ),
        tiltAngle: r2(p.tiltAngle),
        isHopping: p.isHopping,
        hopProgress: r2(p.hopProgress || 0),
        hopDuration: p.hopDuration || 0.16,
        isScared: p.isScared,
        isDead: p.isDead,
        momentumSteps: p.momentumSteps || 0,
        momentumTimer: r2(p.momentumTimer || 0),
        stunTimer: r2(p.stunTimer || 0),
        recoilX: r2(p.recoilX || 0),
        recoilY: r2(p.recoilY || 0)
      })),
      obstacles: this.obstacleManager.obstacles.map(o => ({
        type: o.type,
        x: r2(o.x),
        y: r2(o.y),
        vx: r2(o.vx),
        vy: r2(o.vy),
        side: o.side,
        index: o.index,
        rotation: r2(o.rotation),
        direction: o.direction,
        duration: r2(o.duration),
        maxDuration: o.maxDuration
      })),
      warnings: this.obstacleManager.warnings.map(w => ({
        type: w.type,
        side: w.side,
        index: w.index,
        direction: w.direction,
        timer: r2(w.timer),
        maxTimer: w.maxTimer
      })),
      collectibles: this.collectibles.map(c => ({
        col: c.col,
        row: c.row,
        life: r2(c.life)
      })),
      banner: this.activeBanner,
      sounds: sounds
    });
  }

  applyRemoteState(msg) {
    if (this.netRole !== 'client') return;

    const prevRemoteState = this.state;
    this.state = msg.state;
    this.mode = msg.mode || 'versus';
    this.isVersus4p = Boolean(msg.isVersus4p);
    this.wave = msg.wave || 1;
    this.pausedBy = msg.pausedBy || null;
    if (msg.rematchVotes) {
      this.rematchVotes = msg.rematchVotes;
    }

    if (this.state === 'PAUSED') {
      this.showPauseUi(this.pausedBy);
    } else if (prevRemoteState === 'PAUSED' && (this.state === 'PLAYING' || this.state === 'START_COUNTDOWN')) {
      this.hidePauseUi();
    }

    if (msg.versusScores) {
      this.versusScores = msg.versusScores;
      this.updateVersusHud();
    }
    if (msg.versusWinner) {
      this.versusWinner = msg.versusWinner;
    }

    if (msg.versus4pScores) {
      this.versus4pScores = msg.versus4pScores;
      this.updateVersus4pHud();
    }
    if (msg.versus4pWinner !== undefined) {
      this.versus4pWinner = msg.versus4pWinner;
    }
    if (msg.versusPlayerCount) {
      this.versusPlayerCount = msg.versusPlayerCount;
    }

    if (msg.players && Array.isArray(msg.players)) {
      const net = window.networkManager;
      const myIdx = (net && typeof net.playerIndex === 'number')
        ? net.playerIndex
        : (this.isVersus4p ? 1 : 1);

      if (!this.players || this.players.length !== msg.players.length) {
        this.players = msg.players.map(p => ({ ...p }));
      } else {
        for (let i = 0; i < msg.players.length; i++) {
          const remoteP = msg.players[i];
          const localP = this.players[i];
          if (!localP) continue;

          localP.id = remoteP.id;
          localP.playerIndex = remoteP.playerIndex;
          localP.color = remoteP.color;
          localP.isAi = remoteP.isAi;
          localP.isScared = remoteP.isScared;
          localP.isDead = remoteP.isDead;
          localP.stunTimer = remoteP.stunTimer || 0;
          localP.recoilX = remoteP.recoilX || 0;
          localP.recoilY = remoteP.recoilY || 0;
          localP.momentumSteps = remoteP.momentumSteps || 0;
          localP.momentumTimer = remoteP.momentumTimer || 0;

          if (remoteP.isDead) {
            localP.col = remoteP.col;
            localP.row = remoteP.row;
            localP.animX = remoteP.animX;
            localP.animY = remoteP.animY;
            localP.hopZ = 0;
            localP.isHopping = false;
            continue;
          }

          const isLocalHuman = (i === myIdx);

          if (isLocalHuman) {
            // Reconcile client predicted player
            if (remoteP.col === localP.col && remoteP.row === localP.row) {
              if (!localP.isHopping && remoteP.isHopping && remoteP.hopProgress < 0.6) {
                localP.prevCol = remoteP.prevCol !== undefined ? remoteP.prevCol : localP.col;
                localP.prevRow = remoteP.prevRow !== undefined ? remoteP.prevRow : localP.row;
                localP.isHopping = true;
                localP.hopProgress = remoteP.hopProgress;
                localP.hopDuration = remoteP.hopDuration || 0.16;
              }
            } else {
              // Position mismatch (e.g. push or clash on host): reconcile gracefully
              if (!localP.isHopping || localP.hopProgress >= 0.6) {
                localP.prevCol = remoteP.prevCol !== undefined ? remoteP.prevCol : remoteP.col;
                localP.prevRow = remoteP.prevRow !== undefined ? remoteP.prevRow : remoteP.row;
                localP.col = remoteP.col;
                localP.row = remoteP.row;
                localP.isHopping = remoteP.isHopping;
                localP.hopProgress = remoteP.hopProgress || 0;
                localP.hopDuration = remoteP.hopDuration || 0.16;
                localP.tiltAngle = remoteP.tiltAngle || 0;
              }
            }
          } else {
            // Reconcile remote opponent players
            if (remoteP.col !== localP.col || remoteP.row !== localP.row) {
              localP.prevCol = remoteP.prevCol !== undefined ? remoteP.prevCol : localP.col;
              localP.prevRow = remoteP.prevRow !== undefined ? remoteP.prevRow : localP.row;
              localP.col = remoteP.col;
              localP.row = remoteP.row;
              localP.isHopping = remoteP.isHopping;
              localP.hopProgress = remoteP.hopProgress || 0;
              localP.hopDuration = remoteP.hopDuration || 0.16;
              localP.tiltAngle = remoteP.tiltAngle || 0;
            } else if (remoteP.isHopping && !localP.isHopping) {
              localP.prevCol = remoteP.prevCol !== undefined ? remoteP.prevCol : localP.col;
              localP.prevRow = remoteP.prevRow !== undefined ? remoteP.prevRow : localP.row;
              localP.isHopping = true;
              localP.hopProgress = remoteP.hopProgress || 0;
              localP.hopDuration = remoteP.hopDuration || 0.16;
            } else if (!remoteP.isHopping && localP.isHopping && localP.hopProgress >= 0.85) {
              localP.isHopping = false;
              localP.animX = localP.col;
              localP.animY = localP.row;
              localP.hopZ = 0;
              localP.tiltAngle = 0;
            }
          }
        }
      }

      this.player = this.players[myIdx] || this.players[1] || this.players[0];
      for (let i = 0; i < this.players.length; i++) {
        const pl = this.players[i];
        if (pl.momentumSteps >= 2 && pl.isHopping && (pl.momentumTimer > 0 || pl.momentumTimer === undefined) && !pl.isDead) {
          this.renderer.spawnAfterimage(pl);
        }
      }
    }

    if (msg.obstacles && Array.isArray(msg.obstacles)) {
      this.obstacleManager.obstacles = msg.obstacles;
    }

    if (msg.warnings && Array.isArray(msg.warnings)) {
      this.obstacleManager.warnings = msg.warnings;
    }

    if (msg.collectibles && Array.isArray(msg.collectibles)) {
      this.collectibles = msg.collectibles;
    }

    if (msg.banner) {
      const bannerKey = `${msg.banner.title}|${msg.banner.sub}`;
      if (this.lastShownBannerKey !== bannerKey) {
        this.lastShownBannerKey = bannerKey;
        this.showWaveBanner(msg.banner.title, msg.banner.sub, msg.banner.duration !== undefined ? msg.banner.duration : 1600);
      }
    } else {
      this.lastShownBannerKey = null;
    }

    if (msg.sounds && Array.isArray(msg.sounds)) {
      for (const sName of msg.sounds) {
        if (this.sound && typeof this.sound[sName] === 'function') {
          this.sound[sName]();
        }
        if (sName === 'playLaserBlast') {
          this.renderer.triggerShake(6, 0.2);
        }
      }
    }

    if (this.state === 'GAME_OVER' && window.onGameOverCallback && !this._gameOverFired) {
      this._gameOverFired = true;
      window.onGameOverCallback({
        mode: this.isVersus4p ? (this.versusPlayerCount === 3 ? 'versus3p' : 'versus4p') : 'versus',
        wave: this.isVersus4p ? (this.versus4pScores ? this.versus4pScores.reduce((a, b) => a + b, 0) : 0) : (this.versusScores.p1 + this.versusScores.p2),
        score: this.isVersus4p ? Math.max(...(this.versus4pScores || [0])) : Math.max(this.versusScores.p1, this.versusScores.p2),
        versusScores: { ...this.versusScores },
        versus4pScores: this.versus4pScores ? [...this.versus4pScores] : [0, 0, 0, 0],
        winner: this.isVersus4p ? this.versus4pWinner : this.versusWinner,
        targetWins: this.versusTargetWins,
        netRole: 'client'
      });
      this.updateRematchUi(false);
    } else if (this.state === 'PLAYING') {
      this._gameOverFired = false;
      const goOverlay = document.getElementById('gameover-overlay');
      if (goOverlay) goOverlay.classList.add('hidden');
    }
  }

  startGame(mode, netRole = null) {
    // 1. Instantly sync freshest configuration from localStorage (0ms latency) & check disk
    if (window.configManager) {
      window.configManager.syncLatest();
    }

    this.netRole = netRole;
    this._gameOverFired = false;
    this.pendingSounds = [];
    this.mode = mode;
    this.score = 0;
    this.wave = 1;
    this.survivalTimer = 0;
    this.starSpawnCooldown = 4;
    this.collectibles = [];
    this.hitFreezeTimer = 0;
    this.gameOverDelay = 0;
    this.bufferedMove = null;
    this.pausedBy = null;
    this.rematchVotes = { p1: false, p2: false };
    this.rematchStarting = false;

    this.isVersus = false;
    this.isVersus4p = false;

    if (mode === 'versus') {
      this.isVersus = true;
      this.versusScores = { p1: 0, p2: 0 };
      this.versusWinner = null;
      this.versusRoundDelay = 0;
      const cfg = window.configManager;
      this.versusTargetWins = cfg ? Math.max(1, Math.round(cfg.get('versusTargetWins') || 3)) : 3;

      if (this.netRole === 'host') {
        const net = window.networkManager;
        this.setupVersusBoard();
        if (net && net.opponentConnected) {
          this.waitingForOpponent = false;
          this.startMatchCountdown(3);
        } else {
          this.waitingForOpponent = true;
          this.state = 'WAITING_FOR_PLAYERS';
          this.showWaveBanner('WAITING FOR OPPONENT', 'SHARE URL WITH P2 TO START!', 0);
          this.broadcastHostState();
        }
        return;
      } else if (this.netRole === 'client') {
        this.state = 'WAITING_FOR_PLAYERS';
        this.setupVersusBoard();
        this.showWaveBanner('CONNECTING...', 'WAITING FOR HOST TO START', 0);
        return;
      }

      this.startVersusRound();
      return;
    }

    if (mode === 'versus4p' || mode === 'versus3p') {
      this.isVersus4p = true;
      this.versusPlayerCount = (mode === 'versus3p') ? 3 : 4;
      this.versus4pScores = [0, 0, 0, 0];
      this.versus4pWinner = null;
      this.versus4pRoundDelay = 0;
      this.humanP2Controlled = false;
      this.humanP3Controlled = false;
      this.humanP4Controlled = false;
      const cfg = window.configManager;
      this.versusTargetWins = cfg ? Math.max(1, Math.round(cfg.get('versusTargetWins') || 3)) : 3;

      const neededClients = this.versusPlayerCount - 1;

      if (this.netRole === 'host') {
        const net = window.networkManager;
        this.setupVersus4pBoard(this.versusPlayerCount);
        if (net && net.connectedClientCount >= neededClients) {
          this.waitingForOpponent = false;
          this.startMatchCountdown(3);
        } else {
          this.waitingForOpponent = true;
          this.state = 'WAITING_FOR_PLAYERS';
          const count = net ? net.connectedClientCount + 1 : 1;
          this.showWaveBanner('WAITING FOR PLAYERS', `已加入 ${count}/${this.versusPlayerCount} 人，等待全員到齊後開打...`, 0);
          this.broadcastHostState();
        }
        return;
      } else if (this.netRole === 'client') {
        this.state = 'WAITING_FOR_PLAYERS';
        this.setupVersus4pBoard(this.versusPlayerCount);
        this.showWaveBanner('CONNECTING...', `等待房主與其他玩家全員到齊 (${this.versusPlayerCount}/${this.versusPlayerCount})...`, 0);
        return;
      }

      this.startVersus4pRound();
      return;
    }

    this.state = 'PLAYING';
    const maxLives = window.configManager ? Math.max(1, parseInt(window.configManager.get('singlePlayerLives'), 10) || 3) : 3;
    this.maxLives = maxLives;
    this.lives = maxLives;
    this.invulnerableTimer = 0;
    this.updateLivesHud();

    this.player = this.createPlayer(2, 3, 0, false);
    this.players = [this.player];

    this.obstacleManager.reset(mode);

    // Audio resume
    this.sound.resume();
    this.sound.startBgm();

    const hearts = this.lives <= 5 ? '❤️'.repeat(this.lives) : `❤️ x ${this.lives}`;
    this.showWaveBanner(`LEVEL ${this.wave}`, `GET READY! 生命：${hearts}`);
  }

  setupVersusBoard() {
    const p1 = this.createPlayer(1, 3, 0, true);
    const p2 = this.createPlayer(4, 3, 1, true);
    this.players = [p1, p2];
    this.player = this.netRole === 'client' ? p2 : p1;
    this.obstacleManager.reset('versus');
    this.updateVersusHud();
  }

  setupVersus4pBoard(playerCount) {
    const pCount = playerCount || this.versusPlayerCount || (this.mode === 'versus3p' ? 3 : 4);
    this.versusPlayerCount = pCount;
    const p1 = this.createPlayer(2, 2, 0, true, '#007aff');
    const p2 = this.createPlayer(3, 2, 1, true, '#ff3b30');
    const p3 = this.createPlayer(2, 3, 2, true, '#30d158');
    const p4 = this.createPlayer(3, 3, 3, true, '#ff9f0a');

    const all = [p1, p2, p3, p4];
    this.players = all.slice(0, pCount);

    // In online/LAN mode, NO AI: all slots are human players
    if (this.netRole) {
      for (const p of this.players) p.isAi = false;
    } else {
      p1.isAi = false;
      p2.isAi = !this.humanP2Controlled;
      p3.isAi = !this.humanP3Controlled;
      if (pCount >= 4) {
        p4.isAi = !this.humanP4Controlled;
      }
    }

    const net = window.networkManager;
    const myIdx = (this.netRole === 'client' && net && typeof net.playerIndex === 'number')
      ? net.playerIndex
      : 0;
    this.player = this.players[myIdx] || p1;

    this.obstacleManager.reset(pCount === 3 ? 'versus3p' : 'versus4p');
    this.updateVersus4pHud();
  }

  startMatchCountdown(seconds = 3) {
    this.state = 'START_COUNTDOWN';
    this.startCountdownTimer = seconds;
    this.lastCountdownSec = seconds;
    this.playSound('step');
    this.showWaveBanner('GET READY!', `MATCH STARTING IN ${seconds}...`, 1200);
    if (this.netRole === 'host') {
      this.broadcastHostState();
    }
  }

  updateCountdown(dt) {
    if (this.startCountdownTimer > 0) {
      this.startCountdownTimer -= dt;
      const sec = Math.ceil(this.startCountdownTimer);
      if (sec !== this.lastCountdownSec) {
        this.lastCountdownSec = sec;
        if (sec > 0) {
          this.playSound('step');
          this.showWaveBanner('GET READY!', `MATCH STARTING IN ${sec}...`, 1200);
        } else {
          this.playSound('gem');
          this.showWaveBanner('BATTLE START!', 'FIGHT!', 1500);
        }
        if (this.netRole === 'host') {
          this.netBroadcastTimer = 0;
          this.broadcastHostState();
        }
      }
      if (this.startCountdownTimer <= 0) {
        if (this.isVersus4p) {
          this.startVersus4pRound();
        } else {
          this.startVersusRound();
        }
      } else if (this.netRole === 'host') {
        this.netBroadcastTimer += dt;
        if (this.netBroadcastTimer >= this.netBroadcastInterval) {
          this.netBroadcastTimer = 0;
          this.broadcastHostState();
        }
      }
    }
  }

  startVersusRound() {
    this.state = 'PLAYING';
    this.wave = 1;
    this.survivalTimer = 0;
    this.starSpawnCooldown = 4;
    this.collectibles = [];
    this.hitFreezeTimer = 0;
    this.gameOverDelay = 0;
    this.versusRoundDelay = 0;
    this.lastShownBannerKey = null;

    // Symmetrical spawns for P1 (Blue) at (1, 3) and P2 (Red) at (4, 3) on the 6x6 grid
    const p1 = this.createPlayer(1, 3, 0, true);
    const p2 = this.createPlayer(4, 3, 1, true);
    this.players = [p1, p2];
    this.player = this.netRole === 'client' ? p2 : p1;

    this.obstacleManager.reset('versus');

    this.sound.resume();
    this.sound.startBgm();

    const roundNum = this.versusScores.p1 + this.versusScores.p2 + 1;
    this.showWaveBanner(
      `ROUND ${roundNum}`,
      `P1 [${this.versusScores.p1}] ⚔️ [${this.versusScores.p2}] P2 (FIRST TO ${this.versusTargetWins})`
    );

    this.updateVersusHud();
    if (this.netRole === 'host') {
      this.broadcastHostState();
    }
  }

  updateVersusHud() {
    if (!this.domElements.versusVal) {
      this.domElements.versusVal = document.getElementById('hud-versus-val');
    }
    const valEl = this.domElements.versusVal;
    if (valEl && (this.lastVersusP1 !== this.versusScores.p1 || this.lastVersusP2 !== this.versusScores.p2)) {
      this.lastVersusP1 = this.versusScores.p1;
      this.lastVersusP2 = this.versusScores.p2;
      valEl.innerHTML = `<span style="color:#007aff; font-weight:900;">P1: ${this.versusScores.p1}</span> <span style="color:#8e8e93;">-</span> <span style="color:#ff3b30; font-weight:900;">P2: ${this.versusScores.p2}</span>`;
    }
  }

  startVersus4pRound() {
    this.state = 'PLAYING';
    this.wave = 1;
    this.survivalTimer = 0;
    this.starSpawnCooldown = 4;
    this.collectibles = [];
    this.hitFreezeTimer = 0;
    this.gameOverDelay = 0;
    this.versus4pRoundDelay = 0;
    this.lastShownBannerKey = null;

    const pCount = this.versusPlayerCount || (this.mode === 'versus3p' ? 3 : 4);
    // Center 2x2: (2,2), (3,2), (2,3), (3,3)
    const p1 = this.createPlayer(2, 2, 0, true, '#007aff');
    const p2 = this.createPlayer(3, 2, 1, true, '#ff3b30');
    const p3 = this.createPlayer(2, 3, 2, true, '#30d158');
    const p4 = this.createPlayer(3, 3, 3, true, '#ff9f0a');

    const all = [p1, p2, p3, p4];
    this.players = all.slice(0, pCount);

    // In online/LAN mode, NO AI: all slots are human players
    if (this.netRole) {
      for (const p of this.players) p.isAi = false;
    } else {
      p1.isAi = false;
      p2.isAi = !this.humanP2Controlled;
      p3.isAi = !this.humanP3Controlled;
      if (pCount >= 4) {
        p4.isAi = !this.humanP4Controlled;
      }
    }

    const net = window.networkManager;
    const myIdx = (this.netRole === 'client' && net && typeof net.playerIndex === 'number')
      ? net.playerIndex
      : 0;
    this.player = this.players[myIdx] || p1;

    this.obstacleManager.reset(pCount === 3 ? 'versus3p' : 'versus4p');

    this.sound.resume();
    this.sound.startBgm();

    const roundNum = this.versus4pScores.slice(0, pCount).reduce((a, b) => a + b, 0) + 1;
    this.showWaveBanner(
      `ROUND ${roundNum}`,
      `${pCount}-PLAYER BATTLE ROYALE (FIRST TO ${this.versusTargetWins} WINS)`
    );

    this.updateVersus4pHud();
    if (this.netRole === 'host') {
      this.broadcastHostState();
    }
  }

  updateVersus4pHud() {
    if (!this.isVersus4p) return;
    const pNames = ['p1', 'p2', 'p3', 'p4'];
    const pCount = this.players ? this.players.length : (this.versusPlayerCount || 4);
    for (let i = 0; i < 4; i++) {
      const pill = document.getElementById(`pill-${pNames[i]}`) || document.getElementById(`v4p-s${i + 1}`);
      if (pill) {
        if (i >= pCount) {
          pill.style.display = 'none';
          continue;
        }
        pill.style.display = 'inline-block';
        const score = this.versus4pScores[i] || 0;
        const pl = this.players[i];
        const isDead = pl ? pl.isDead : false;
        const isAi = pl ? pl.isAi : false;
        const botTag = (!this.netRole && isAi) ? ' [BOT]' : '';
        pill.textContent = `P${i + 1}${botTag}: ${score}${isDead ? ' 💀' : ''}`;
        if (isDead) {
          pill.classList.add('dead');
        } else {
          pill.classList.remove('dead');
        }
      }
    }
  }

  showPauseUi(pausedBy) {
    const pauseOverlay = document.getElementById('pause-overlay');
    if (!pauseOverlay) return;
    pauseOverlay.classList.remove('hidden');

    const pauseSubtitle = document.getElementById('pause-subtitle');
    const btnRestartPause = document.getElementById('btn-restart-pause');

    if (this.isVersus && this.netRole) {
      if (btnRestartPause) btnRestartPause.style.display = 'none';
      if (pauseSubtitle) {
        pauseSubtitle.style.display = 'block';
        if (pausedBy === 'p1') {
          pauseSubtitle.innerHTML = '<span style="color:#007aff; font-weight:bold;">🔵 由 P1 (藍方) 暫停</span>';
        } else if (pausedBy === 'p2') {
          pauseSubtitle.innerHTML = '<span style="color:#ff3b30; font-weight:bold;">🔴 由 P2 (紅方) 暫停</span>';
        } else if (pausedBy === 'p2_left') {
          pauseSubtitle.innerHTML = '<span style="color:#ff9500; font-weight:bold;">⚠️ 對手已斷線，等待重新加入...</span>';
        } else {
          pauseSubtitle.textContent = '連線對戰暫停中';
        }
      }
    } else {
      if (btnRestartPause) btnRestartPause.style.display = 'inline-block';
      if (pauseSubtitle) pauseSubtitle.style.display = 'none';
    }
  }

  hidePauseUi() {
    const pauseOverlay = document.getElementById('pause-overlay');
    if (pauseOverlay) pauseOverlay.classList.add('hidden');
  }

  pauseGame(pausedBy = null) {
    if (this.netRole === 'client') {
      if (window.networkManager) {
        window.networkManager.sendPause('p2');
      }
      return;
    }

    if (this.state === 'PLAYING' || this.state === 'START_COUNTDOWN') {
      this.state = 'PAUSED';
      this.pausedBy = pausedBy || (this.isVersus ? 'p1' : 'player');
      this.sound.stopBgm();
      this.showPauseUi(this.pausedBy);
      if (this.netRole === 'host') {
        this.broadcastHostState();
      }
    }
  }

  resumeGame() {
    if (this.netRole === 'client') {
      if (window.networkManager) {
        window.networkManager.sendResume();
      }
      return;
    }

    if (this.state === 'PAUSED') {
      this.state = 'PLAYING';
      this.pausedBy = null;
      this.sound.startBgm();
      this.hidePauseUi();
      if (this.netRole === 'host') {
        this.broadcastHostState();
      }
    }
  }

  setRematchVote(player, ready = true) {
    if (!this.isVersus || !this.netRole) {
      const goOverlay = document.getElementById('gameover-overlay');
      if (goOverlay) goOverlay.classList.add('hidden');
      this.restartGame();
      return;
    }

    if (this.netRole === 'client') {
      this.rematchVotes.p2 = ready;
      if (window.networkManager) {
        window.networkManager.sendRematchVote(ready);
      }
      this.updateRematchUi();
      return;
    }

    // Host
    this.rematchVotes[player] = ready;
    if (window.networkManager) {
      window.networkManager.sendRematchSync(this.rematchVotes, false);
    }
    this.updateRematchUi();

    // Check mutual agreement
    if (this.rematchVotes.p1 && this.rematchVotes.p2 && !this.rematchStarting) {
      this.rematchStarting = true;
      if (window.networkManager) {
        window.networkManager.sendRematchSync(this.rematchVotes, true);
      }
      this.updateRematchUi(true);
      this.playSound('gem');

      setTimeout(() => {
        this.rematchVotes = { p1: false, p2: false };
        this.rematchStarting = false;
        const goOverlay = document.getElementById('gameover-overlay');
        if (goOverlay) goOverlay.classList.add('hidden');

        this.versusScores = { p1: 0, p2: 0 };
        this.versusWinner = null;
        this.setupVersusBoard();
        this.startMatchCountdown(3);
      }, 1500);
    }
  }

  updateRematchUi(startingSoon = false) {
    const btnRetry = document.getElementById('btn-retry');
    const bar = document.getElementById('rematch-status-bar');
    const pillP1 = document.getElementById('rematch-pill-p1');
    const pillP2 = document.getElementById('rematch-pill-p2');

    if (!this.isVersus || !this.netRole) {
      if (bar) bar.style.display = 'none';
      if (btnRetry) {
        btnRetry.textContent = '再來一局 (SPACE)';
        btnRetry.disabled = false;
      }
      return;
    }

    if (bar) bar.style.display = 'flex';

    if (pillP1) {
      if (this.rematchVotes.p1) {
        pillP1.className = 'rematch-pill ready';
        pillP1.textContent = '🔵 P1: ✅ 已同意';
      } else {
        pillP1.className = 'rematch-pill';
        pillP1.textContent = '🔵 P1: ⏳ 等待中';
      }
    }

    if (pillP2) {
      if (this.rematchVotes.p2) {
        pillP2.className = 'rematch-pill ready';
        pillP2.textContent = '🔴 P2: ✅ 已同意';
      } else {
        pillP2.className = 'rematch-pill';
        pillP2.textContent = '🔴 P2: ⏳ 等待中';
      }
    }

    if (btnRetry) {
      if (startingSoon) {
        btnRetry.textContent = '🚀 雙方皆已同意！準備開戰...';
        btnRetry.disabled = true;
      } else {
        const myRole = this.netRole === 'host' ? 'p1' : 'p2';
        if (this.rematchVotes[myRole]) {
          btnRetry.textContent = '✅ 已同意 (等待對手 1/2...)';
          btnRetry.disabled = true;
        } else {
          btnRetry.textContent = '⚔️ 同意再來一局';
          btnRetry.disabled = false;
        }
      }
    }
  }

  restartGame() {
    this.startGame(this.mode, this.netRole);
  }

  returnToMenu() {
    if (window.configManager) {
      window.configManager.syncLatest();
    }
    this.state = 'MENU';
    this.isVersus = false;
    this.isVersus4p = false;
    this.netRole = null;
    this.sound.stopBgm();
    if (window.networkManager) {
      window.networkManager.disconnect();
    }
  }

  // Client-Side Prediction for instant responsive controls in LAN/Online mode
  predictClientMove(dx, dy) {
    if (this.state !== 'PLAYING') return;
    const net = window.networkManager;
    const myIdx = (net && typeof net.playerIndex === 'number') ? net.playerIndex : (this.isVersus4p ? 1 : 1);
    const p = this.players[myIdx];
    if (!p || p.isDead || (p.stunTimer && p.stunTimer > 0)) return;

    // Buffer move if already hopping
    if (p.isHopping && p.hopProgress < 0.75) {
      p.bufferedMove = { dx, dy };
      return;
    }

    const newCol = p.col + dx;
    const newRow = p.row + dy;
    if (newCol < 0 || newCol > 5 || newRow < 0 || newRow > 5) return;

    // Check collision with opponents: do not predict through opponents to avoid misprediction
    const hasOpponent = this.players.some((other, idx) => idx !== myIdx && !other.isDead && other.col === newCol && other.row === newRow);
    if (hasOpponent) {
      return;
    }

    const cfg = window.configManager;
    const momentumWindow = cfg ? (cfg.get('momentumWindow') || 0.32) : 0.32;
    const isSameStraight = Boolean(p.momentumDir && p.momentumDir.dx === dx && p.momentumDir.dy === dy && p.momentumTimer > 0);
    if (isSameStraight) {
      p.momentumSteps = (p.momentumSteps || 0) + 1;
    } else {
      p.momentumSteps = 1;
      p.momentumDir = { dx, dy };
    }
    p.momentumTimer = momentumWindow;

    p.prevCol = p.col;
    p.prevRow = p.row;
    p.col = newCol;
    p.row = newRow;
    p.isHopping = true;
    p.hopProgress = 0;
    p.hopDuration = (cfg ? cfg.get('playerHopDuration') : 0.16) || 0.16;
    p.tiltAngle = dx * 0.25 + dy * 0.12;

    this.sound.playHop();
  }

  // Handle Player Movement (Up, Down, Left, Right)
  // Supports both movePlayer(dx, dy) and movePlayer(playerIdx, dx, dy)
  movePlayer(arg1, arg2, arg3) {
    let playerIdx = 0;
    let dx = 0;
    let dy = 0;

    if (arg3 !== undefined) {
      playerIdx = arg1;
      dx = arg2;
      dy = arg3;
    } else {
      playerIdx = 0;
      dx = arg1;
      dy = arg2;
    }

    if (this.state !== 'PLAYING') return;

    // Client Mode: immediately forward input over WebSocket to Host, and predict local hop
    if (this.netRole === 'client') {
      if (window.networkManager) {
        window.networkManager.sendInput(dx, dy);
      }
      this.predictClientMove(dx, dy);
      return;
    }

    const p = (this.isVersus || this.isVersus4p) ? this.players[playerIdx] : this.player;
    if (!p || p.isDead) return;

    // In 4P mode, if human input moves an AI player, take over control
    if (this.isVersus4p && playerIdx > 0 && p.isAi) {
      p.isAi = false;
      if (playerIdx === 1) this.humanP2Controlled = true;
      if (playerIdx === 2) this.humanP3Controlled = true;
      if (playerIdx === 3) this.humanP4Controlled = true;
      this.updateVersus4pHud();
    }

    // Stun check: player cannot move during stun penalty (Option B or Clash recoil)
    if (p.stunTimer && p.stunTimer > 0) {
      return;
    }

    // If already in middle of hop, buffer next move for snappy continuous control
    if (p.isHopping && p.hopProgress < 0.8) {
      p.bufferedMove = { dx, dy };
      if (!this.isVersus && !this.isVersus4p) {
        this.bufferedMove = { dx, dy };
      }
      return;
    }

    const cfg = window.configManager;
    const momentumWindow = cfg ? (cfg.get('momentumWindow') || 0.32) : 0.32;
    const stepsRequired = cfg ? (cfg.get('momentumStepsRequired') || 2) : 2;

    const newCol = p.col + dx;
    const newRow = p.row + dy;

    // Clamped inside 6x6 grid [0..5]
    if (newCol < 0 || newCol > 5 || newRow < 0 || newRow > 5) {
      // Hitting grid boundary interrupts and clears momentum
      p.momentumSteps = 0;
      p.momentumTimer = 0;
      p.momentumDir = { dx: 0, dy: 0 };
      return;
    }

    // Check momentum continuity before resolving move (applies to all modes):
    // Momentum requires moving in the EXACT same straight direction within momentumWindow.
    // Turning 90 degrees (直角) or reversing breaks momentum!
    const isSameStraight = Boolean(p.momentumDir && p.momentumDir.dx === dx && p.momentumDir.dy === dy && p.momentumTimer > 0);
    const currentSteps = isSameStraight ? (p.momentumSteps || 0) : 0;
    const hasMomentum = Boolean(currentSteps >= stepsRequired && isSameStraight);
    let pushedOpponent = false;

    // Versus Collision Logic (solid, ghost, push)
    if (this.isVersus || this.isVersus4p) {
      const opponent = this.players.find((other, idx) => idx !== playerIdx && !other.isDead && other.col === newCol && other.row === newRow);
      const collisionMode = cfg ? cfg.get('versusCollisionMode') : 'push';

      if (opponent && !opponent.isDead && opponent.col === newCol && opponent.row === newRow) {
        if (collisionMode === 'solid') {
          // Blocked! Cannot occupy same tile
          this.sound.playWarning();
          return;
        } else if (collisionMode === 'push') {
          // 1. Check Head-on Clash:
          // Both players have momentum and charge face-to-face in opposing directions!
          const oppIsSameStraight = Boolean(opponent.momentumDir && opponent.momentumDir.dx === -dx && opponent.momentumDir.dy === -dy && opponent.momentumTimer > 0);
          const oppHasMomentum = Boolean((opponent.momentumSteps || 0) >= stepsRequired && oppIsSameStraight);

          if (hasMomentum && oppHasMomentum) {
            // == HEAD-ON CLASH ==
            // Reset momenta for both
            p.momentumSteps = 0;
            p.momentumTimer = 0;
            p.momentumDir = { dx: 0, dy: 0 };
            opponent.momentumSteps = 0;
            opponent.momentumTimer = 0;
            opponent.momentumDir = { dx: 0, dy: 0 };

            // Apply stun penalty to both
            p.stunTimer = 0.32;
            opponent.stunTimer = 0.32;

            // Recoil offsets (both bounce back towards their own tile)
            p.recoilX = -dx * 0.35;
            p.recoilY = -dy * 0.35;
            p.tiltAngle = -dx * 0.25 - dy * 0.12;

            opponent.recoilX = dx * 0.35;
            opponent.recoilY = dy * 0.35;
            opponent.tiltAngle = dx * 0.25 + dy * 0.12;

            // Sound & Shake
            this.playSound('playClash');
            this.renderer.triggerShake(16, 0.35);

            // Particles and clash burst
            const pScreen = this.renderer.gridToScreen(p.col, p.row);
            const oppScreen = this.renderer.gridToScreen(opponent.col, opponent.row);
            const midX = (pScreen.x + oppScreen.x) / 2;
            const midY = (pScreen.y + oppScreen.y) / 2;
            this.renderer.spawnClashBurst(midX, midY);
            this.renderer.addFloatingText('⚡ CLASH! ⚡', midX, midY - 24, '#ffd700');

            if (this.netRole === 'host') this.broadcastHostState();
            return;
          }

          // 2. Check Momentum Push:
          if (hasMomentum) {
            const pushCol = opponent.col + dx;
            const pushRow = opponent.row + dy;
            const isTileBlocked = this.players.some(o => !o.isDead && o !== opponent && o.col === pushCol && o.row === pushRow);
            if (pushCol >= 0 && pushCol <= 5 && pushRow >= 0 && pushRow <= 5 && !isTileBlocked) {
              // Opponent is knocked away!
              opponent.prevCol = opponent.col;
              opponent.prevRow = opponent.row;
              opponent.col = pushCol;
              opponent.row = pushRow;
              opponent.isHopping = true;
              opponent.hopProgress = 0;
              opponent.tiltAngle = dx * 0.45 + dy * 0.22;
              opponent.momentumSteps = 0;
              opponent.momentumTimer = 0;
              opponent.momentumDir = { dx: 0, dy: 0 };

              // Knocked-away impact FX
              const oppPos = this.renderer.gridToScreen(opponent.col, opponent.row);
              this.renderer.spawnImpactSparks(oppPos.x, oppPos.y, dx, dy);
              this.renderer.addFloatingText('PUSH!', oppPos.x, oppPos.y - 20, '#ff9500');
              this.renderer.triggerShake(9, 0.25);
              this.playSound('playPush');

              // Attacker pushes opponent: momentum is strictly reset to 0 upon pushing someone
              pushedOpponent = true;
              p.momentumSteps = 0;
              p.momentumTimer = 0;
              p.momentumDir = { dx: 0, dy: 0 };
            } else {
              // Against edge of grid or blocked by another player: pinned!
              p.stunTimer = 0.25;
              p.recoilX = -dx * 0.25;
              p.recoilY = -dy * 0.25;
              p.momentumSteps = 0;
              p.momentumTimer = 0;
              p.momentumDir = { dx: 0, dy: 0 };
              this.playSound('playBlocked');
              const pPos = this.renderer.gridToScreen(p.col, p.row);
              const pinMsg = isTileBlocked ? 'BLOCKED!' : 'WALL PIN!';
              this.renderer.addFloatingText(pinMsg, pPos.x, pPos.y - 20, '#ff3b30');
              if (this.netRole === 'host') this.broadcastHostState();
              return;
            }
          } else {
            // 3. Option B: Insufficient Momentum Attempt
            p.momentumSteps = 0;
            p.momentumTimer = 0;
            p.momentumDir = { dx: 0, dy: 0 };
            p.stunTimer = 0.28; // Stun penalty
            p.recoilX = dx * 0.22; // Quick bounce-back recoil
            p.recoilY = dy * 0.22;
            p.tiltAngle = -dx * 0.18 - dy * 0.08;

            this.playSound('playBlocked');

            const pPos = this.renderer.gridToScreen(p.col, p.row);
            const contactX = pPos.x + dx * 20;
            const contactY = pPos.y + dy * 20;
            for (let i = 0; i < 8; i++) {
              this.renderer.spawnParticle({
                x: contactX,
                y: contactY,
                vx: -dx * 40 + (Math.random() - 0.5) * 40,
                vy: -dy * 40 + (Math.random() - 0.5) * 40,
                radius: 2.5,
                color: '#cbd5e1',
                life: 0.2
              });
            }
            this.renderer.addFloatingText('BLOCKED!', pPos.x, pPos.y - 20, '#ff3b30');
            if (this.netRole === 'host') this.broadcastHostState();
            return;
          }
        }
        // If 'ghost': pass through freely
      }
    }

    // Normal successful step: update momentum accumulator (applies to all modes)
    if (pushedOpponent) {
      // Pusher's momentum is strictly reset to 0 upon pushing someone
      p.momentumSteps = 0;
      p.momentumTimer = 0;
      p.momentumDir = { dx: 0, dy: 0 };
    } else if (isSameStraight) {
      p.momentumSteps = (p.momentumSteps || 0) + 1;
      p.momentumTimer = momentumWindow;
    } else {
      p.momentumSteps = 1;
      p.momentumDir = { dx, dy };
      p.momentumTimer = momentumWindow;
    }

    p.bufferedMove = null;
    p.prevCol = p.col;
    p.prevRow = p.row;
    p.col = newCol;
    p.row = newRow;
    p.isHopping = true;
    p.hopProgress = 0;
    p.tiltAngle = dx * 0.14 + dy * 0.05;

    this.sound.playHop();

    const oldScreenPos = this.renderer.gridToScreen(p.prevCol, p.prevRow);
    const isDashing = Boolean(p.momentumSteps >= 2);
    const dustCount = isDashing ? 6 : 3;
    for (let i = 0; i < dustCount; i++) {
      this.renderer.spawnParticle({
        x: oldScreenPos.x + (Math.random() - 0.5) * 10,
        y: oldScreenPos.y + 12,
        vx: -dx * (isDashing ? 45 : 30) + (Math.random() - 0.5) * 20,
        vy: -dy * (isDashing ? 45 : 30) + (Math.random() - 0.5) * 20,
        radius: isDashing ? 3.5 : 2.5,
        color: isDashing ? (p.id === 1 ? '#60a5fa' : (p.id === 2 ? '#f87171' : '#38bdf8')) : '#cbd5e1',
        life: 0.26
      });
    }

    if (isDashing) {
      this.renderer.spawnAfterimage(p);
    }

    this.checkNearMiss(p.prevCol, p.prevRow, p);
    this.checkCollectiblePickup(p);
  }

  // Move towards clicked tile (adjacent only)
  moveToTile(col, row) {
    if (this.state !== 'PLAYING') return;
    const targetPlayer = (this.isVersus || this.isVersus4p) ? this.players[0] : this.player;
    if (!targetPlayer || targetPlayer.isDead) return;

    const dx = col - targetPlayer.col;
    const dy = row - targetPlayer.row;

    if (Math.abs(dx) + Math.abs(dy) === 1) {
      this.movePlayer(0, dx, dy);
    } else if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
      // Prioritize larger axis
      if (Math.abs(dx) >= Math.abs(dy)) {
        this.movePlayer(0, Math.sign(dx), 0);
      } else {
        this.movePlayer(0, 0, Math.sign(dy));
      }
    }
  }

  checkNearMiss(prevCol, prevRow, player) {
    const nearDist = window.configManager ? window.configManager.get('nearMissDistance') : 0.95;
    const nearDistSq = nearDist * nearDist;
    let nearMiss = false;
    for (const obs of this.obstacleManager.obstacles) {
      if (obs.type === 'rock' || obs.type === 'cannon') {
        const dx = obs.x - prevCol;
        const dy = obs.y - prevRow;
        if (dx * dx + dy * dy < nearDistSq) {
          nearMiss = true;
          break;
        }
      } else if (obs.type === 'laser') {
        if ((obs.direction === 'horizontal' && obs.index === prevRow) ||
            (obs.direction === 'vertical' && obs.index === prevCol)) {
          nearMiss = true;
          break;
        }
      }
    }

    if (nearMiss) {
      const p = player || this.player;
      if (!this.isVersus && !this.isVersus4p) {
        this.score += 100;
      }
      this.sound.playNearMiss();
      const pos = this.renderer.gridToScreen(p.col, p.row);
      const isMulti = this.isVersus || this.isVersus4p;
      const colors = ['#007aff', '#ff3b30', '#30d158', '#ff9f0a'];
      const tag = isMulti ? `P${p.playerIndex + 1} DODGE!` : 'NICE DODGE! +100';
      const color = isMulti ? (colors[p.playerIndex] || '#007aff') : '#34c759';
      this.renderer.addFloatingText(tag, pos.x, pos.y - 25, color);
    }
  }

  checkCollectiblePickup(player) {
    const pl = player || this.player;
    if (!pl || pl.isDead) return;

    for (let i = this.collectibles.length - 1; i >= 0; i--) {
      const star = this.collectibles[i];
      if (star.col === pl.col && star.row === pl.row) {
        this.collectibles.splice(i, 1);
        if (!this.isVersus && !this.isVersus4p) {
          this.score += 300;
        }
        this.sound.playStarCollect();

        const pos = this.renderer.gridToScreen(pl.col, pl.row);
        const isMulti = this.isVersus || this.isVersus4p;
        const tag = isMulti ? `P${pl.playerIndex + 1} STAR!` : 'STAR! +300';
        this.renderer.addFloatingText(tag, pos.x, pos.y - 30, '#ffd60a');

        for (let j = 0; j < 12; j++) {
          const angle = (j / 12) * Math.PI * 2;
          this.renderer.spawnParticle({
            x: pos.x,
            y: pos.y,
            vx: Math.cos(angle) * 90,
            vy: Math.sin(angle) * 90,
            color: '#ffd60a',
            radius: 5,
            type: 'star',
            life: 0.5
          });
        }
      }
    }
  }

  spawnStar() {
    if (this.collectibles.length >= 2) return;
    const col = Math.floor(Math.random() * 6);
    const row = Math.floor(Math.random() * 6);

    if (this.isVersus || this.isVersus4p) {
      if (this.players.some(p => p.col === col && p.row === row)) return;
    } else {
      if (col === this.player.col && row === this.player.row) return;
    }

    this.collectibles.push({ col, row, life: 7 });
  }

  nextWave() {
    this.wave++;
    const waveBonus = this.wave * 250;
    if (!this.isVersus && !this.isVersus4p) {
      this.score += waveBonus;
    }

    this.obstacleManager.advanceWave(this.wave);
  }

  nextWaveFromObstacles() {
    this.wave++;
    const waveBonus = this.wave * 250;
    if (!this.isVersus && !this.isVersus4p) {
      this.score += waveBonus;
    }
    this.obstacleManager.wave = this.wave;
  }

  showWaveBanner(title, sub, duration = 1600) {
    const banner = document.getElementById('wave-banner');
    const bTitle = document.getElementById('wave-banner-title');
    const bSub = document.getElementById('wave-banner-sub');
    if (banner && bTitle && bSub) {
      bTitle.textContent = title;
      bSub.textContent = sub;
      banner.classList.remove('hidden');

      this.activeBanner = { title, sub, duration };

      clearTimeout(this.bannerTimer);
      if (duration > 0) {
        this.bannerTimer = setTimeout(() => {
          banner.classList.add('hidden');
          this.activeBanner = null;
        }, duration);
      }
    }
  }

  updateLivesHud() {
    if (!this.domElements.lives) {
      this.domElements.lives = document.getElementById('hud-lives-val');
    }
    const hudLivesItem = document.getElementById('hud-lives-item');
    if (this.isVersus || this.isVersus4p) {
      if (hudLivesItem) hudLivesItem.classList.add('hidden');
      return;
    }
    if (hudLivesItem) hudLivesItem.classList.remove('hidden');

    if (this.domElements.lives) {
      const remaining = Math.max(0, this.lives || 0);
      if (remaining <= 5) {
        this.domElements.lives.textContent = '❤️'.repeat(remaining) || '💀 0';
      } else {
        this.domElements.lives.textContent = `❤️ x ${remaining}`;
      }
    }
  }

  handleSinglePlayerDeath() {
    if (this.player.isDead) return;
    if (this.invulnerableTimer > 0) return;

    this.lives--;
    this.updateLivesHud();

    if (this.lives <= 0) {
      this.triggerGameOver();
      return;
    }

    // Still has lives! Revive and retry current level
    this.sound.playHit();
    this.renderer.triggerShake(16, 0.35);

    const pos = this.renderer.gridToScreen(this.player.animX, this.player.animY);
    if (this.bloodyMode) {
      for (let i = 0; i < 22; i++) {
        const speed = Math.random() * 140 + 30;
        const angle = Math.random() * Math.PI * 2;
        this.renderer.spawnParticle({
          x: pos.x,
          y: pos.y - 15,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 40,
          color: '#d90429',
          radius: Math.random() * 3 + 2,
          type: 'blood',
          gravity: 400,
          life: 0.7
        });
      }
    } else {
      for (let i = 0; i < 14; i++) {
        const speed = Math.random() * 100 + 20;
        const angle = Math.random() * Math.PI * 2;
        this.renderer.spawnParticle({
          x: pos.x,
          y: pos.y - 20,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: '#ffd60a',
          radius: 4,
          type: 'star',
          life: 0.6
        });
      }
    }

    this.hitFreezeTimer = 0.15;

    // Reset player position to safe center (2, 2)
    this.player.col = 2;
    this.player.row = 2;
    this.player.targetCol = 2;
    this.player.targetRow = 2;
    this.player.prevCol = 2;
    this.player.prevRow = 2;
    this.player.animX = 2;
    this.player.animY = 2;
    this.player.isHopping = false;
    this.player.hopZ = 0;
    this.player.tiltAngle = 0;
    this.player.momentumSteps = 0;
    this.player.momentumTimer = 0;
    this.player.momentumDir = { dx: 0, dy: 0 };
    this.player.stunTimer = 0;
    this.player.recoilX = 0;
    this.player.recoilY = 0;
    this.player.isScared = false;
    this.bufferedMove = null;

    // Invulnerability timer
    this.invulnerableTimer = 1.8;
    this.player.invulnerableTimer = 1.8;

    // Restart obstacles of current level without resetting wave/level number!
    this.obstacleManager.setWave(this.wave);

    const hearts = this.lives <= 5 ? '❤️'.repeat(this.lives) : `❤️ x ${this.lives}`;
    this.renderer.addFloatingText(`REVIVE! 剩餘 ${this.lives} 命`, pos.x, pos.y - 25, '#ff3b30');
    this.showWaveBanner(`LEVEL ${this.wave} RETRY`, `剩餘生命：${hearts}`, 1200);
  }

  triggerGameOver() {
    if (this.player.isDead) return;
    this.player.isDead = true;
    this.lives = 0;
    this.updateLivesHud();

    this.hitFreezeTimer = 0.18;
    this.gameOverDelay = 0.85;
    this.sound.playHit();
    this.renderer.triggerShake(20, 0.45);

    const pos = this.renderer.gridToScreen(this.player.animX, this.player.animY);

    if (this.bloodyMode) {
      for (let i = 0; i < 35; i++) {
        const speed = Math.random() * 160 + 40;
        const angle = Math.random() * Math.PI * 2;
        this.renderer.spawnParticle({
          x: pos.x,
          y: pos.y - 15,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 60,
          color: '#d90429',
          radius: Math.random() * 4 + 3,
          type: 'blood',
          gravity: 400,
          life: 0.9
        });
      }
    } else {
      for (let i = 0; i < 16; i++) {
        const speed = Math.random() * 120 + 30;
        const angle = Math.random() * Math.PI * 2;
        this.renderer.spawnParticle({
          x: pos.x,
          y: pos.y - 20,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: '#ffd60a',
          radius: 5,
          type: 'star',
          life: 0.7
        });
      }
    }

    this.sound.stopBgm();
  }

  handleVersusRoundEnd(hitPlayers) {
    if (this.state !== 'PLAYING') return;

    this.hitFreezeTimer = 0.2;
    this.sound.playHit();
    this.renderer.triggerShake(20, 0.45);

    for (const pl of hitPlayers) {
      pl.isDead = true;
      const pos = this.renderer.gridToScreen(pl.animX, pl.animY);

      if (this.bloodyMode) {
        for (let i = 0; i < 35; i++) {
          const speed = Math.random() * 160 + 40;
          const angle = Math.random() * Math.PI * 2;
          this.renderer.spawnParticle({
            x: pos.x,
            y: pos.y - 15,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 60,
            color: '#d90429',
            radius: Math.random() * 4 + 3,
            type: 'blood',
            gravity: 400,
            life: 0.9
          });
        }
      } else {
        const color = pl.playerIndex === 0 ? '#007aff' : '#ff3b30';
        for (let i = 0; i < 20; i++) {
          const speed = Math.random() * 120 + 30;
          const angle = Math.random() * Math.PI * 2;
          this.renderer.spawnParticle({
            x: pos.x,
            y: pos.y - 20,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color: color,
            radius: 5,
            type: 'star',
            life: 0.7
          });
        }
      }
    }

    // Determine round outcome
    if (hitPlayers.length >= 2) {
      // Simultaneous Double KO -> Draw, no score added
      this.showWaveBanner('DOUBLE KO!', 'DRAW ROUND - NO SCORE!');
    } else if (hitPlayers[0].playerIndex === 0) {
      // P1 died -> P2 scores
      this.versusScores.p2++;
      this.showWaveBanner('P2 (RED) SCORES!', `P1: ${this.versusScores.p1} ⚔️ P2: ${this.versusScores.p2}`);
    } else {
      // P2 died -> P1 scores
      this.versusScores.p1++;
      this.showWaveBanner('P1 (BLUE) SCORES!', `P1: ${this.versusScores.p1} ⚔️ P2: ${this.versusScores.p2}`);
    }

    this.updateVersusHud();

    // Check Match Victory
    if (this.versusScores.p1 >= this.versusTargetWins || this.versusScores.p2 >= this.versusTargetWins) {
      this.versusWinner = this.versusScores.p1 >= this.versusTargetWins ? 'p1' : 'p2';
      this.gameOverDelay = 1.6;
      this.sound.stopBgm();
      this.sound.playWaveClear();
    } else {
      // Next round
      this.versusRoundDelay = 1.8;
    }
  }

  handleVersus4pRoundEnd(hitPlayers) {
    if (this.state !== 'PLAYING') return;

    this.hitFreezeTimer = 0.2;
    this.sound.playHit();
    this.renderer.triggerShake(20, 0.45);

    const pColors = ['#007aff', '#ff3b30', '#30d158', '#ff9f0a'];
    const pNames = ['P1 (藍色)', 'P2 (紅色)', 'P3 (綠色)', 'P4 (黃色)'];

    for (const pl of hitPlayers) {
      if (pl.isDead) continue;
      pl.isDead = true;
      const pos = this.renderer.gridToScreen(pl.animX, pl.animY);

      if (this.bloodyMode) {
        for (let i = 0; i < 35; i++) {
          const speed = Math.random() * 160 + 40;
          const angle = Math.random() * Math.PI * 2;
          this.renderer.spawnParticle({
            x: pos.x,
            y: pos.y - 15,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 60,
            color: '#d90429',
            radius: Math.random() * 4 + 3,
            type: 'blood',
            gravity: 400,
            life: 0.9
          });
        }
      } else {
        const color = pColors[pl.playerIndex] || '#ffffff';
        for (let i = 0; i < 22; i++) {
          const speed = Math.random() * 120 + 30;
          const angle = Math.random() * Math.PI * 2;
          this.renderer.spawnParticle({
            x: pos.x,
            y: pos.y - 20,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color: color,
            radius: 5,
            type: 'star',
            life: 0.75
          });
        }
      }
    }

    this.updateVersus4pHud();

    const livingPlayers = this.players.filter(p => !p.isDead);

    if (livingPlayers.length === 1) {
      // 1 survivor remains -> scores point!
      const winner = livingPlayers[0];
      const winIdx = winner.playerIndex;
      this.versus4pScores[winIdx]++;
      this.updateVersus4pHud();

      const bannerTitle = `🏆 ${pNames[winIdx]} 獲勝！`;
      let scoreBoard = `目前戰績: P1 [${this.versus4pScores[0]}] | P2 [${this.versus4pScores[1]}] | P3 [${this.versus4pScores[2]}]`;
      if (this.players.length >= 4) {
        scoreBoard += ` | P4 [${this.versus4pScores[3]}]`;
      }
      this.showWaveBanner(bannerTitle, scoreBoard);
      this.sound.playWaveClear();

      if (this.versus4pScores[winIdx] >= this.versusTargetWins) {
        this.versus4pWinner = winIdx;
        this.gameOverDelay = 1.8;
        this.sound.stopBgm();
      } else {
        this.versus4pRoundDelay = 2.0;
      }
    } else if (livingPlayers.length === 0) {
      // Simultaneous elimination of all survivors -> Draw
      this.showWaveBanner('DOUBLE KO!', 'DRAW ROUND - 全員陣亡！本局平手');
      this.versus4pRoundDelay = 2.0;
    } else {
      // 2 or 3 players still alive! Round continues!
      for (const pl of hitPlayers) {
        const pos = this.renderer.gridToScreen(pl.animX, pl.animY);
        this.renderer.addFloatingText(`${pNames[pl.playerIndex]} 出局!`, pos.x, pos.y - 24, '#ff3b30');
      }
    }
  }

  runAiBots(dt) {
    if (!this.isVersus4p || this.netRole) return;
    this.aiUpdateCooldown = (this.aiUpdateCooldown || 0) - dt;
    if (this.aiUpdateCooldown > 0) return;
    this.aiUpdateCooldown = 0.16 + Math.random() * 0.08;

    const moves = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 }
    ];

    for (const bot of this.players) {
      if (!bot.isAi || bot.isDead || bot.isHopping || (bot.stunTimer && bot.stunTimer > 0)) continue;

      const candidates = [{ dx: 0, dy: 0 }, ...moves];
      let bestMove = null;
      let bestScore = -Infinity;

      for (const m of candidates) {
        const targetCol = bot.col + m.dx;
        const targetRow = bot.row + m.dy;

        // Boundaries: 0..5
        if (targetCol < 0 || targetCol > 5 || targetRow < 0 || targetRow > 5) {
          continue;
        }

        const occupiedOther = this.players.find(o => !o.isDead && o !== bot && o.col === targetCol && o.row === targetRow);
        const hasBotMomentum = (bot.momentumSteps || 0) >= 2;
        if (occupiedOther && !hasBotMomentum) {
          continue;
        }

        let score = 0;

        // 1. Center preference
        const distToCenter = Math.abs(targetCol - 2.5) + Math.abs(targetRow - 2.5);
        score -= distToCenter * 4;

        // 2. Warning avoidance
        if (this.obstacleManager && this.obstacleManager.warnings) {
          for (const w of this.obstacleManager.warnings) {
            if (w.side === 'left' || w.side === 'right') {
              if (w.index === targetRow) score -= 180;
            } else if (w.side === 'top' || w.side === 'bottom') {
              if (w.index === targetCol) score -= 180;
            }
          }
        }

        // 3. Projectile proximity
        if (this.obstacleManager && this.obstacleManager.obstacles) {
          for (const obs of this.obstacleManager.obstacles) {
            if (obs.type === 'laser') {
              if (obs.direction === 'horizontal' && obs.index === targetRow) score -= 350;
              if (obs.direction === 'vertical' && obs.index === targetCol) score -= 350;
            } else {
              const dX = (obs.x || 0) - targetCol;
              const dY = (obs.y || 0) - targetRow;
              const dist = Math.hypot(dX, dY);
              if (dist < 2.0) {
                score -= (2.0 - dist) * 220;
              }
            }
          }
        }

        // 4. Momentum bonus
        if (m.dx !== 0 || m.dy !== 0) {
          if (bot.momentumDir && bot.momentumDir.dx === m.dx && bot.momentumDir.dy === m.dy && bot.momentumTimer > 0) {
            score += 20;
          }
        }

        // 5. Staying put comfort bonus if safe
        if (m.dx === 0 && m.dy === 0) {
          score += 15;
        }

        score += Math.random() * 6;

        if (score > bestScore) {
          bestScore = score;
          bestMove = m;
        }
      }

      if (bestMove && (bestMove.dx !== 0 || bestMove.dy !== 0)) {
        this.movePlayer(bot.playerIndex, bestMove.dx, bestMove.dy);
      }
    }
  }

  update(dt) {
    this.renderer.update(dt);

    if (this.state === 'START_COUNTDOWN') {
      if (this.netRole === 'host') {
        this.updateCountdown(dt);
      }
      return;
    }

    if (this.state === 'WAITING_FOR_PLAYERS') {
      if (this.netRole === 'host') {
        this.netBroadcastTimer += dt;
        if (this.netBroadcastTimer >= this.netBroadcastInterval) {
          this.netBroadcastTimer = 0;
          this.broadcastHostState();
        }
      }
      return;
    }

    if (this.state !== 'PLAYING') return;

    // Client Mode: game simulation is driven by Host via applyRemoteState()
    if (this.netRole === 'client') {
      // 1. Locally advance warnings and active obstacle timers between 30Hz network snapshots for smooth 120fps display
      for (let i = this.obstacleManager.warnings.length - 1; i >= 0; i--) {
        const w = this.obstacleManager.warnings[i];
        w.timer -= dt;
      }
      for (let i = this.obstacleManager.obstacles.length - 1; i >= 0; i--) {
        const obs = this.obstacleManager.obstacles[i];
        if (obs.type === 'laser') {
          obs.duration -= dt;
          if (obs.duration <= 0) {
            this.obstacleManager.obstacles.splice(i, 1);
          }
        } else {
          // Smoothly advance rock and cannonball positions between snapshots
          obs.x += (obs.vx || 0) * dt;
          obs.y += (obs.vy || 0) * dt;
          if (obs.type === 'rock') {
            obs.rotation = (obs.rotation || 0) + ((obs.vx !== 0 ? Math.sign(obs.vx) : Math.sign(obs.vy)) || 1) * 3.5 * dt;
          }
        }
      }

      // 2. Locally advance player hop animations at 60/120/144 FPS
      const net = window.networkManager;
      const myIdx = (net && typeof net.playerIndex === 'number') ? net.playerIndex : (this.isVersus4p ? 1 : 1);

      if (this.players && this.players.length > 0) {
        for (let i = 0; i < this.players.length; i++) {
          const pl = this.players[i];
          if (!pl || pl.isDead) continue;

          // Recoil spring-back dampening
          if (pl.recoilX) {
            pl.recoilX *= Math.max(0, 1 - dt * 14);
            if (Math.abs(pl.recoilX) < 0.005) pl.recoilX = 0;
          }
          if (pl.recoilY) {
            pl.recoilY *= Math.max(0, 1 - dt * 14);
            if (Math.abs(pl.recoilY) < 0.005) pl.recoilY = 0;
          }

          // Stun timer decay
          if (pl.stunTimer > 0) {
            pl.stunTimer -= dt;
            if (pl.stunTimer <= 0) pl.stunTimer = 0;
          }

          // Momentum timer decay
          if (pl.momentumTimer > 0) {
            pl.momentumTimer -= dt;
            if (pl.momentumTimer <= 0) {
              pl.momentumSteps = 0;
            }
          }

          // Afterimages during active momentum hop
          if (pl.momentumSteps >= 2 && !pl.isDead && pl.isHopping) {
            pl.afterimageTimer = (pl.afterimageTimer || 0) + dt;
            if (pl.afterimageTimer >= 0.035) {
              pl.afterimageTimer = 0;
              this.renderer.spawnAfterimage(pl);
            }
          }

          if (pl.isHopping) {
            pl.hopProgress += dt / (pl.hopDuration || 0.16);
            if (pl.hopProgress >= 1) {
              pl.hopProgress = 1;
              pl.isHopping = false;
              pl.animX = pl.col;
              pl.animY = pl.row;
              pl.hopZ = 0;
              pl.tiltAngle = 0;

              // Process client buffered move upon landing
              if (i === myIdx && pl.bufferedMove) {
                const m = pl.bufferedMove;
                pl.bufferedMove = null;
                this.movePlayer(m.dx, m.dy);
              }
            } else {
              const t = pl.hopProgress;
              const pCol = pl.prevCol !== undefined ? pl.prevCol : pl.col;
              const pRow = pl.prevRow !== undefined ? pl.prevRow : pl.row;
              pl.animX = pCol + (pl.col - pCol) * t;
              pl.animY = pRow + (pl.row - pRow) * t;
              pl.hopZ = Math.sin(t * Math.PI) * 16;
            }
          } else {
            // Smoothly interpolate towards target col/row if slight mismatch
            pl.animX += (pl.col - pl.animX) * Math.min(1, dt * 25);
            pl.animY += (pl.row - pl.animY) * Math.min(1, dt * 25);
            pl.hopZ = 0;
          }
        }
      }

      return;
    }

    if (this.hitFreezeTimer > 0) {
      this.hitFreezeTimer -= dt;
      return;
    }

    // ================= Versus / 4P Mode Update =================
    if (this.isVersus || this.isVersus4p) {
      if (this.isVersus && this.versusRoundDelay > 0) {
        this.versusRoundDelay -= dt;
        if (this.versusRoundDelay <= 0) {
          this.startVersusRound();
        } else if (this.netRole === 'host') {
          this.netBroadcastTimer += dt;
          if (this.netBroadcastTimer >= this.netBroadcastInterval) {
            this.netBroadcastTimer = 0;
            this.broadcastHostState();
          }
        }
        return;
      }

      if (this.isVersus4p && this.versus4pRoundDelay > 0) {
        this.versus4pRoundDelay -= dt;
        if (this.versus4pRoundDelay <= 0) {
          this.startVersus4pRound();
        } else if (this.netRole === 'host') {
          this.netBroadcastTimer += dt;
          if (this.netBroadcastTimer >= this.netBroadcastInterval) {
            this.netBroadcastTimer = 0;
            this.broadcastHostState();
          }
        }
        return;
      }

      if (this.gameOverDelay > 0) {
        this.gameOverDelay -= dt;
        if (this.gameOverDelay <= 0) {
          this.state = 'GAME_OVER';
          this.sound.playGameOver();
          if (window.onGameOverCallback) {
            window.onGameOverCallback({
              mode: this.isVersus4p ? (this.versusPlayerCount === 3 ? 'versus3p' : 'versus4p') : 'versus',
              wave: this.isVersus4p ? this.versus4pScores.reduce((a, b) => a + b, 0) : this.versusScores.p1 + this.versusScores.p2,
              score: this.isVersus4p ? Math.max(...this.versus4pScores) : Math.max(this.versusScores.p1, this.versusScores.p2),
              versusScores: { ...this.versusScores },
              versus4pScores: [...this.versus4pScores],
              winner: this.isVersus4p ? this.versus4pWinner : this.versusWinner,
              targetWins: this.versusTargetWins,
              netRole: this.netRole
            });
          }
          this.updateRematchUi(false);
          if (this.netRole === 'host') this.broadcastHostState();
        } else if (this.netRole === 'host') {
          this.netBroadcastTimer += dt;
          if (this.netBroadcastTimer >= this.netBroadcastInterval) {
            this.netBroadcastTimer = 0;
            this.broadcastHostState();
          }
        }
        return;
      }

      // 0. Run AI bots for 4P mode
      if (this.isVersus4p) {
        this.runAiBots(dt);
      }

      // 1. Update hop animation, timers, and recoil for each player
      for (const pl of this.players) {
        if (pl.isDead) continue;

        // Momentum timeout decay
        if (pl.momentumTimer > 0) {
          pl.momentumTimer -= dt;
          if (pl.momentumTimer <= 0) {
            pl.momentumSteps = 0;
            pl.momentumDir = { dx: 0, dy: 0 };
          }
        }

        // Stun timer decay (penalty for blocked push or head-on clash)
        if (pl.stunTimer > 0) {
          pl.stunTimer -= dt;
          if (pl.stunTimer <= 0) {
            pl.stunTimer = 0;
          }
        }

        // Recoil spring-back dampening
        if (pl.recoilX) {
          pl.recoilX *= Math.max(0, 1 - dt * 14);
          if (Math.abs(pl.recoilX) < 0.005) pl.recoilX = 0;
        }
        if (pl.recoilY) {
          pl.recoilY *= Math.max(0, 1 - dt * 14);
          if (Math.abs(pl.recoilY) < 0.005) pl.recoilY = 0;
        }

        // Afterimages during active momentum hop
        if (pl.momentumSteps >= 2 && !pl.isDead && pl.isHopping) {
          pl.afterimageTimer = (pl.afterimageTimer || 0) + dt;
          if (pl.afterimageTimer >= 0.035) {
            pl.afterimageTimer = 0;
            this.renderer.spawnAfterimage(pl);
          }
        }

        if (pl.isHopping) {
          pl.hopProgress += dt / pl.hopDuration;
          if (pl.hopProgress >= 1) {
            pl.hopProgress = 1;
            pl.isHopping = false;
            pl.animX = pl.col;
            pl.animY = pl.row;
            pl.hopZ = 0;
            pl.tiltAngle = 0;

            if (pl.bufferedMove) {
              const m = pl.bufferedMove;
              pl.bufferedMove = null;
              this.movePlayer(pl.playerIndex, m.dx, m.dy);
            }
          } else {
            const t = pl.hopProgress;
            pl.animX = pl.prevCol + (pl.col - pl.prevCol) * t;
            pl.animY = pl.prevRow + (pl.row - pl.prevRow) * t;
            pl.hopZ = Math.sin(t * Math.PI) * 16;
          }
        } else {
          pl.animX = pl.col;
          pl.animY = pl.row;
          pl.hopZ = 0;
        }
      }

      // 2. Obstacles update & multi-player collision check
      this.obstacleManager.update(dt, this.players);

      const hitPlayers = this.obstacleManager.checkCollisions(this.players);
      if (hitPlayers && hitPlayers.length > 0) {
        if (this.isVersus4p) {
          this.handleVersus4pRoundEnd(hitPlayers);
        } else {
          this.handleVersusRoundEnd(hitPlayers);
        }
        if (this.netRole === 'host') this.broadcastHostState();
        return;
      }

      // 3. Update scared reaction face for each player
      for (const pl of this.players) {
        if (!pl.isDead) {
          pl.isScared = this.obstacleManager.isHazardNearPlayer(pl);
        }
      }

      // 4. Wave progression inside round
      if (this.obstacleManager.isWaveComplete) {
        this.nextWave();
      }

      // 5. Update collectibles (暫時移除吃星星機制，保留邏輯供未來加回)
      /*
      this.starSpawnCooldown -= dt;
      if (this.starSpawnCooldown <= 0) {
        this.spawnStar();
        const cd = window.configManager ? window.configManager.get('starCooldown') : 6;
        this.starSpawnCooldown = Math.random() * (cd * 0.5) + cd;
      }

      for (let i = this.collectibles.length - 1; i >= 0; i--) {
        this.collectibles[i].life -= dt;
        if (this.collectibles[i].life <= 0) {
          this.collectibles.splice(i, 1);
        }
      }
      */

      // 6. Broadcast authoritative state to client (LAN Relay throttled to 30 Hz)
      if (this.netRole === 'host') {
        this.netBroadcastTimer += dt;
        if (this.netBroadcastTimer >= this.netBroadcastInterval) {
          this.netBroadcastTimer = 0;
          this.broadcastHostState();
        }
      }

      return;
    }

    // ================= Single Player Update =================
    if (this.player.isDead) {
      if (this.gameOverDelay > 0) {
        this.gameOverDelay -= dt;
        if (this.gameOverDelay <= 0) {
          this.state = 'GAME_OVER';
          this.sound.playGameOver();
          if (window.onGameOverCallback) {
            const isNewBest = this.saveHighScore(this.mode, this.score);
            window.onGameOverCallback({
              mode: this.mode,
              wave: this.wave,
              score: this.score,
              best: this.getBestScore(this.mode),
              isNewBest
            });
          }
        }
      }
      return;
    }

    // Invulnerability timer decay (Single Player)
    if (this.invulnerableTimer > 0) {
      this.invulnerableTimer -= dt;
      if (this.invulnerableTimer < 0) this.invulnerableTimer = 0;
      this.player.invulnerableTimer = this.invulnerableTimer;
    } else {
      this.player.invulnerableTimer = 0;
    }

    // Momentum timeout decay (Single Player)
    if (this.player.momentumTimer > 0) {
      this.player.momentumTimer -= dt;
      if (this.player.momentumTimer <= 0) {
        this.player.momentumTimer = 0;
        this.player.momentumSteps = 0;
        this.player.momentumDir = { dx: 0, dy: 0 };
      }
    }

    // Afterimages during active momentum hop (Single Player)
    if (this.player.momentumSteps >= 2 && !this.player.isDead && this.player.isHopping && this.player.momentumTimer > 0) {
      this.player.afterimageTimer = (this.player.afterimageTimer || 0) + dt;
      if (this.player.afterimageTimer >= 0.035) {
        this.player.afterimageTimer = 0;
        this.renderer.spawnAfterimage(this.player);
      }
    }

    // 1. Update Player Hop Animation
    if (this.player.isHopping) {
      this.player.hopProgress += dt / this.player.hopDuration;
      if (this.player.hopProgress >= 1) {
        this.player.hopProgress = 1;
        this.player.isHopping = false;
        this.player.animX = this.player.col;
        this.player.animY = this.player.row;
        this.player.hopZ = 0;
        this.player.tiltAngle = 0;

        // Process buffered move immediately upon landing
        const pendingMove = this.bufferedMove || this.player.bufferedMove;
        if (pendingMove) {
          this.bufferedMove = null;
          this.player.bufferedMove = null;
          this.movePlayer(pendingMove.dx, pendingMove.dy);
        }
      } else {
        const t = this.player.hopProgress;
        this.player.animX = this.player.prevCol + (this.player.col - this.player.prevCol) * t;
        this.player.animY = this.player.prevRow + (this.player.row - this.player.prevRow) * t;
        this.player.hopZ = Math.sin(t * Math.PI) * 16;
      }
    } else {
      this.player.animX = this.player.col;
      this.player.animY = this.player.row;
      this.player.hopZ = 0;
    }

    // 2. Score accrual over time
    this.survivalTimer += dt;
    if (this.survivalTimer >= 0.1) {
      this.score += 1;
      this.survivalTimer = 0;
    }

    // 3. Update Obstacles & Hazards
    this.obstacleManager.update(dt, this.player);

    // 4. Check Collision
    if (this.invulnerableTimer <= 0 && this.obstacleManager.checkCollisions(this.player)) {
      this.handleSinglePlayerDeath();
      return;
    }

    // 5. Update scared reaction face
    this.player.isScared = (this.invulnerableTimer <= 0) && this.obstacleManager.isHazardNearPlayer(this.player);

    // 6. Check Wave Completion
    if (this.obstacleManager.isWaveComplete) {
      this.nextWave();
    }

    // 7. Update Collectibles (暫時移除吃星星機制，保留邏輯供未來加回)
    /*
    this.starSpawnCooldown -= dt;
    if (this.starSpawnCooldown <= 0) {
      this.spawnStar();
      const cd = window.configManager ? window.configManager.get('starCooldown') : 6;
      this.starSpawnCooldown = Math.random() * (cd * 0.5) + cd;
    }

    for (let i = this.collectibles.length - 1; i >= 0; i--) {
      this.collectibles[i].life -= dt;
      if (this.collectibles[i].life <= 0) {
        this.collectibles.splice(i, 1);
      }
    }
    */
  }

  gameLoop(currentTime) {
    if (!this.lastTime) this.lastTime = currentTime;
    const dt = Math.min((currentTime - this.lastTime) / 1000, 0.1);
    this.lastTime = currentTime;

    this.update(dt);

    this.renderer.render(
      this.state,
      (this.isVersus || this.isVersus4p) ? this.players : this.player,
      this.obstacleManager.obstacles,
      this.obstacleManager.warnings,
      this.collectibles,
      this.isVersus4p ? 'versus4p' : this.mode
    );

    if (this.state === 'PLAYING') {
      if (this.isVersus4p) {
        if (!this.domElements.wave) this.domElements.wave = document.getElementById('hud-wave-val');
        if (this.domElements.wave && this.lastRenderedWave !== this.wave) {
          this.domElements.wave.textContent = this.wave;
          this.lastRenderedWave = this.wave;
        }
        this.updateVersus4pHud();
      } else if (this.isVersus) {
        if (!this.domElements.wave) this.domElements.wave = document.getElementById('hud-wave-val');
        if (this.domElements.wave && this.lastRenderedWave !== this.wave) {
          this.domElements.wave.textContent = this.wave;
          this.lastRenderedWave = this.wave;
        }
        this.updateVersusHud();
      } else {
        if (!this.domElements.score) this.domElements.score = document.getElementById('hud-score-val');
        if (!this.domElements.wave) this.domElements.wave = document.getElementById('hud-wave-val');
        if (!this.domElements.lives) this.domElements.lives = document.getElementById('hud-lives-val');
        if (!this.domElements.best) this.domElements.best = document.getElementById('hud-best-val');

        if (this.domElements.score && this.lastRenderedScore !== this.score) {
          this.domElements.score.textContent = this.score;
          this.lastRenderedScore = this.score;
        }
        if (this.domElements.wave && this.lastRenderedWave !== this.wave) {
          this.domElements.wave.textContent = this.wave;
          this.lastRenderedWave = this.wave;
        }
        if (this.domElements.lives && this.lastRenderedLives !== this.lives) {
          const remaining = Math.max(0, this.lives || 0);
          this.domElements.lives.textContent = (remaining <= 5) ? ('❤️'.repeat(remaining) || '💀 0') : `❤️ x ${remaining}`;
          this.lastRenderedLives = this.lives;
        }
        const best = Math.max(this.score, this.getBestScore(this.mode));
        if (this.domElements.best && this.lastRenderedBest !== best) {
          this.domElements.best.textContent = best;
          this.lastRenderedBest = best;
        }
      }
    }

    requestAnimationFrame((t) => this.gameLoop(t));
  }
}

window.Game = Game;
