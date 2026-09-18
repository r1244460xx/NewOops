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

    this.state = 'MENU';
    this.mode = 'rock';
    this.bloodyMode = false;
    this.enableVirtualDpad = false;

    // Versus Mode state
    this.isVersus = false;
    this.versusScores = { p1: 0, p2: 0 };
    this.versusTargetWins = 3;
    this.versusWinner = null;
    this.versusRoundDelay = 0;
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

  createPlayer(col, row, index = 0, isVersus = false) {
    const hopDuration = window.configManager ? window.configManager.get('hopDuration') : 0.11;
    return {
      id: isVersus ? index + 1 : 0,
      playerIndex: index,
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
      afterimageTimer: 0
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

    net.onInput = (payload) => {
      if (this.netRole === 'host' && this.isVersus && this.state === 'PLAYING') {
        this.movePlayer(1, payload.dx, payload.dy);
      }
    };

    net.onState = (msg) => {
      if (this.netRole === 'client') {
        this.applyRemoteState(msg);
      }
    };

    net.onJoined = (msg) => {
      if (this.netRole === 'host') {
        if (msg.opponent_present && (this.state === 'WAITING_FOR_PLAYERS' || this.waitingForOpponent)) {
          this.waitingForOpponent = false;
          const badge = document.getElementById('hud-net-badge');
          if (badge) {
            badge.textContent = '🟢 P2 已連線';
            badge.className = 'hud-net-badge connected';
          }
          this.startMatchCountdown(3);
        }
      } else if (this.netRole === 'client') {
        const badge = document.getElementById('hud-net-badge');
        if (badge) {
          badge.textContent = msg.host_present ? '🟢 P1 已連線' : '🟡 等待房主...';
          badge.className = 'hud-net-badge ' + (msg.host_present ? 'connected' : 'waiting');
        }
      }
    };

    net.onOpponentJoined = () => {
      const badge = document.getElementById('hud-net-badge');
      if (badge) {
        badge.textContent = '🟢 P2 已連線';
        badge.className = 'hud-net-badge connected';
      }
      if (this.netRole === 'host') {
        if (this.state === 'WAITING_FOR_PLAYERS' || this.waitingForOpponent) {
          this.waitingForOpponent = false;
          this.startMatchCountdown(3);
        }
      }
    };

    net.onHostReady = () => {
      const badge = document.getElementById('hud-net-badge');
      if (badge) {
        badge.textContent = '🟢 P1 已連線';
        badge.className = 'hud-net-badge connected';
      }
    };

    net.onOpponentLeft = () => {
      const badge = document.getElementById('hud-net-badge');
      if (badge) {
        badge.textContent = '🟡 等待對手...';
        badge.className = 'hud-net-badge waiting';
      }
      if (this.isVersus && (this.state === 'GAME_OVER' || this.rematchStarting)) {
        if (typeof window.returnToMenuFromVersus === 'function') {
          window.returnToMenuFromVersus('對手已離開房間（視為拒絕再來一局）');
        } else {
          this.returnToMenu();
        }
        return;
      }
      if (this.netRole === 'host') {
        this.showWaveBanner('OPPONENT LEFT', 'P2 DISCONNECTED', 0);
        this.pauseGame('p2_left');
      } else if (this.netRole === 'client') {
        this.showWaveBanner('HOST LEFT', 'ROOM CLOSED', 0);
        if (typeof window.returnToMenuFromVersus === 'function') {
          window.returnToMenuFromVersus('房主已關閉房間，已返回主選單');
        } else {
          this.returnToMenu();
        }
      }
    };

    net.onDisconnect = () => {
      if (this.isVersus && (this.state === 'GAME_OVER' || this.rematchStarting)) {
        if (typeof window.returnToMenuFromVersus === 'function') {
          window.returnToMenuFromVersus('連線已中斷，已返回主選單');
        } else {
          this.returnToMenu();
        }
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

    net.onRematchReject = (msg) => {
      if (this.isVersus) {
        if (typeof window.returnToMenuFromVersus === 'function') {
          window.returnToMenuFromVersus('對手已返回主選單（拒絕再來一局）');
        } else {
          this.returnToMenu();
        }
      }
    };

    net.onRematchSync = (msg) => {
      if (this.netRole === 'client') {
        this.rematchVotes = msg.rematchVotes || { p1: false, p2: false };
        this.updateRematchUi(msg.startingSoon);
        if (msg.startingSoon) {
          this.playSound('gem');
          if (this.clientRematchTimeout) clearTimeout(this.clientRematchTimeout);
          this.clientRematchTimeout = setTimeout(() => {
            const goOverlay = document.getElementById('gameover-overlay');
            if (goOverlay) goOverlay.classList.add('hidden');
          }, 1500);
        }
      }
    };
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
    window.networkManager.sendState({
      state: this.state,
      mode: this.mode,
      wave: this.wave,
      versusScores: this.versusScores,
      versusWinner: this.versusWinner,
      pausedBy: this.pausedBy,
      waitingForOpponent: this.waitingForOpponent,
      rematchVotes: this.rematchVotes,
      players: this.players.map(p => ({
        id: p.id,
        playerIndex: p.playerIndex,
        col: p.col,
        row: p.row,
        animX: p.animX,
        animY: p.animY,
        hopZ: p.hopZ,
        tiltAngle: p.tiltAngle,
        isHopping: p.isHopping,
        isScared: p.isScared,
        isDead: p.isDead,
        momentumSteps: p.momentumSteps || 0,
        momentumTimer: p.momentumTimer || 0,
        stunTimer: p.stunTimer || 0,
        recoilX: p.recoilX || 0,
        recoilY: p.recoilY || 0
      })),
      obstacles: this.obstacleManager.obstacles.map(o => ({
        type: o.type,
        x: o.x,
        y: o.y,
        vx: o.vx,
        vy: o.vy,
        side: o.side,
        index: o.index,
        rotation: o.rotation,
        direction: o.direction,
        duration: o.duration,
        maxDuration: o.maxDuration
      })),
      warnings: this.obstacleManager.warnings.map(w => ({
        type: w.type,
        side: w.side,
        index: w.index,
        direction: w.direction,
        timer: w.timer,
        maxTimer: w.maxTimer
      })),
      collectibles: this.collectibles.map(c => ({
        col: c.col,
        row: c.row,
        life: c.life
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

    if (msg.players && Array.isArray(msg.players)) {
      this.players = msg.players;
      this.player = this.players[1] || this.players[0];
      for (let i = 0; i < this.players.length; i++) {
        const pl = this.players[i];
        if (pl.momentumSteps >= 1 && pl.isHopping && (pl.momentumTimer > 0 || pl.momentumTimer === undefined) && !pl.isDead) {
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
        mode: 'versus',
        wave: this.versusScores.p1 + this.versusScores.p2,
        score: Math.max(this.versusScores.p1, this.versusScores.p2),
        versusScores: { ...this.versusScores },
        winner: this.versusWinner,
        targetWins: this.versusTargetWins,
        netRole: 'client'
      });
      this.updateRematchUi(false);
    } else if (this.state === 'PLAYING') {
      this._gameOverFired = false;
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

    this.isVersus = false;
    this.state = 'PLAYING';
    this.player = this.createPlayer(2, 3, 0, false);
    this.players = [this.player];

    this.obstacleManager.reset(mode);

    // Audio resume
    this.sound.resume();
    this.sound.startBgm();

    this.showWaveBanner(`LEVEL ${this.wave}`, 'GET READY!');
  }

  setupVersusBoard() {
    const p1 = this.createPlayer(1, 3, 0, true);
    const p2 = this.createPlayer(4, 3, 1, true);
    this.players = [p1, p2];
    this.player = this.netRole === 'client' ? p2 : p1;
    this.obstacleManager.reset('versus');
    this.updateVersusHud();
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
        this.startVersusRound();
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

      if (this.rematchTimeout) clearTimeout(this.rematchTimeout);
      this.rematchTimeout = setTimeout(() => {
        this.rematchTimeout = null;
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
    if (this.rematchTimeout) {
      clearTimeout(this.rematchTimeout);
      this.rematchTimeout = null;
    }
    if (this.clientRematchTimeout) {
      clearTimeout(this.clientRematchTimeout);
      this.clientRematchTimeout = null;
    }
    this.rematchVotes = { p1: false, p2: false };
    this.rematchStarting = false;
    this.versusScores = { p1: 0, p2: 0 };
    this.versusWinner = null;
    this.waitingForOpponent = false;
    this._gameOverFired = false;
    this.hideWaveBanner();

    if (window.configManager) {
      window.configManager.syncLatest();
    }
    this.state = 'MENU';
    this.isVersus = false;
    this.netRole = null;
    this.sound.stopBgm();
    if (window.networkManager) {
      window.networkManager.disconnect();
    }
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

    // Client Mode: immediately forward input over WebSocket to Host
    if (this.netRole === 'client') {
      if (window.networkManager) {
        window.networkManager.sendInput(dx, dy);
      }
      return;
    }

    const p = this.isVersus ? this.players[playerIdx] : this.player;
    if (!p || p.isDead) return;

    // Stun check: player cannot move during stun penalty (Option B or Clash recoil)
    if (p.stunTimer && p.stunTimer > 0) {
      return;
    }

    // If already in middle of hop, buffer next move for snappy continuous control
    if (p.isHopping && p.hopProgress < 0.8) {
      p.bufferedMove = { dx, dy };
      return;
    }

    const cfg = window.configManager;
    const momentumWindow = cfg ? (cfg.get('momentumWindow') || 0.32) : 0.32;
    const stepsRequired = cfg ? (cfg.get('momentumStepsRequired') || 1) : 1;

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
    if (this.isVersus) {
      const oppIdx = 1 - playerIdx;
      const opponent = this.players[oppIdx];
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
            if (pushCol >= 0 && pushCol <= 5 && pushRow >= 0 && pushRow <= 5) {
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
              // Against edge of grid: pinned against wall, cannot be pushed
              p.stunTimer = 0.25;
              p.recoilX = -dx * 0.25;
              p.recoilY = -dy * 0.25;
              p.momentumSteps = 0;
              p.momentumTimer = 0;
              p.momentumDir = { dx: 0, dy: 0 };
              this.playSound('playBlocked');
              const pPos = this.renderer.gridToScreen(p.col, p.row);
              this.renderer.addFloatingText('WALL PIN!', pPos.x, pPos.y - 20, '#ff3b30');
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
    const isDashing = Boolean(p.momentumSteps >= 1);
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
    const targetPlayer = this.isVersus ? this.players[0] : this.player;
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
      if (!this.isVersus) {
        this.score += 100;
      }
      this.sound.playNearMiss();
      const pos = this.renderer.gridToScreen(p.col, p.row);
      const tag = this.isVersus ? (p.playerIndex === 0 ? 'P1 DODGE!' : 'P2 DODGE!') : 'NICE DODGE! +100';
      const color = this.isVersus ? (p.playerIndex === 0 ? '#007aff' : '#ff3b30') : '#34c759';
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
        if (!this.isVersus) {
          this.score += 300;
        }
        this.sound.playStarCollect();

        const pos = this.renderer.gridToScreen(pl.col, pl.row);
        const tag = this.isVersus ? (pl.playerIndex === 0 ? 'P1 STAR!' : 'P2 STAR!') : 'STAR! +300';
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

    if (this.isVersus) {
      if (this.players.some(p => p.col === col && p.row === row)) return;
    } else {
      if (col === this.player.col && row === this.player.row) return;
    }

    this.collectibles.push({ col, row, life: 7 });
  }

  nextWave() {
    this.wave++;
    const waveBonus = this.wave * 250;
    if (!this.isVersus) {
      this.score += waveBonus;
    }

    this.sound.playWaveClear();
    this.obstacleManager.setWave(this.wave);

    const refPlayer = this.isVersus ? this.players[0] : this.player;
    const pos = this.renderer.gridToScreen(refPlayer.col, refPlayer.row);
    this.renderer.addFloatingText(`LEVEL CLEAR!`, pos.x, pos.y - 40, '#ffd60a');

    this.showWaveBanner(`LEVEL ${this.wave}`, 'SPEED UP!');
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

  hideWaveBanner() {
    const banner = document.getElementById('wave-banner');
    if (banner) {
      banner.classList.add('hidden');
    }
    clearTimeout(this.bannerTimer);
    this.activeBanner = null;
    this.lastShownBannerKey = null;
  }

  triggerGameOver() {
    if (this.player.isDead) return;
    this.player.isDead = true;

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
      // Locally advance warnings and active obstacle timers between 30Hz network snapshots for smooth 120fps display
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
        }
      }
      return;
    }

    if (this.hitFreezeTimer > 0) {
      this.hitFreezeTimer -= dt;
      return;
    }

    // ================= Versus Mode Update =================
    if (this.isVersus) {
      if (this.versusRoundDelay > 0) {
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

      if (this.gameOverDelay > 0) {
        this.gameOverDelay -= dt;
        if (this.gameOverDelay <= 0) {
          this.state = 'GAME_OVER';
          this.sound.playGameOver();
          if (window.onGameOverCallback) {
            window.onGameOverCallback({
              mode: 'versus',
              wave: this.versusScores.p1 + this.versusScores.p2,
              score: Math.max(this.versusScores.p1, this.versusScores.p2),
              versusScores: { ...this.versusScores },
              winner: this.versusWinner,
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
        if (pl.momentumSteps >= 1 && !pl.isDead && pl.isHopping) {
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
        this.handleVersusRoundEnd(hitPlayers);
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

      // 5. Update collectibles
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
    if (this.player.momentumSteps >= 1 && !this.player.isDead && this.player.isHopping && this.player.momentumTimer > 0) {
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
        if (this.bufferedMove) {
          const m = this.bufferedMove;
          this.bufferedMove = null;
          this.movePlayer(m.dx, m.dy);
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
    if (this.obstacleManager.checkCollisions(this.player)) {
      this.triggerGameOver();
      return;
    }

    // 5. Update scared reaction face
    this.player.isScared = this.obstacleManager.isHazardNearPlayer(this.player);

    // 6. Check Wave Completion
    if (this.obstacleManager.isWaveComplete) {
      this.nextWave();
    }

    // 7. Update Collectibles
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
  }

  gameLoop(currentTime) {
    if (!this.lastTime) this.lastTime = currentTime;
    const dt = Math.min((currentTime - this.lastTime) / 1000, 0.1);
    this.lastTime = currentTime;

    this.update(dt);

    this.renderer.render(
      this.state,
      this.isVersus ? this.players : this.player,
      this.obstacleManager.obstacles,
      this.obstacleManager.warnings,
      this.collectibles,
      this.mode
    );

    if (this.state === 'PLAYING') {
      if (this.isVersus) {
        if (!this.domElements.wave) this.domElements.wave = document.getElementById('hud-wave-val');
        if (this.domElements.wave && this.lastRenderedWave !== this.wave) {
          this.domElements.wave.textContent = this.wave;
          this.lastRenderedWave = this.wave;
        }
        this.updateVersusHud();
      } else {
        if (!this.domElements.score) this.domElements.score = document.getElementById('hud-score-val');
        if (!this.domElements.wave) this.domElements.wave = document.getElementById('hud-wave-val');
        if (!this.domElements.best) this.domElements.best = document.getElementById('hud-best-val');

        if (this.domElements.score && this.lastRenderedScore !== this.score) {
          this.domElements.score.textContent = this.score;
          this.lastRenderedScore = this.score;
        }
        if (this.domElements.wave && this.lastRenderedWave !== this.wave) {
          this.domElements.wave.textContent = this.wave;
          this.lastRenderedWave = this.wave;
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
