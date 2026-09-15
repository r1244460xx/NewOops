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
    this.obstacleManager = new ObstacleManager(this.renderer, this.sound);

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

    // Player Object
    this.player = this.createPlayer(2, 3, 0);

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
      bufferedMove: null
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

  startGame(mode) {
    // 1. Instantly sync freshest configuration from localStorage (0ms latency) & check disk
    if (window.configManager) {
      window.configManager.syncLatest();
    }

    this.mode = mode;
    this.state = 'PLAYING';
    this.score = 0;
    this.wave = 1;
    this.survivalTimer = 0;
    this.starSpawnCooldown = 4;
    this.collectibles = [];
    this.hitFreezeTimer = 0;
    this.gameOverDelay = 0;
    this.bufferedMove = null;

    if (mode === 'versus') {
      this.isVersus = true;
      this.versusScores = { p1: 0, p2: 0 };
      this.versusWinner = null;
      this.versusRoundDelay = 0;
      const cfg = window.configManager;
      this.versusTargetWins = cfg ? Math.max(1, Math.round(cfg.get('versusTargetWins') || 3)) : 3;
      this.startVersusRound();
      return;
    }

    this.isVersus = false;
    this.player = this.createPlayer(2, 3, 0, false);
    this.players = [this.player];

    this.obstacleManager.reset(mode);

    // Audio resume
    this.sound.resume();
    this.sound.startBgm();

    this.showWaveBanner(`LEVEL ${this.wave}`, 'GET READY!');
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

    // Symmetrical spawns for P1 (Blue) at (1, 3) and P2 (Red) at (4, 3) on the 6x6 grid
    const p1 = this.createPlayer(1, 3, 0, true);
    const p2 = this.createPlayer(4, 3, 1, true);
    this.players = [p1, p2];
    this.player = p1;

    this.obstacleManager.reset('versus');

    this.sound.resume();
    this.sound.startBgm();

    const roundNum = this.versusScores.p1 + this.versusScores.p2 + 1;
    this.showWaveBanner(
      `ROUND ${roundNum}`,
      `P1 [${this.versusScores.p1}] ⚔️ [${this.versusScores.p2}] P2 (FIRST TO ${this.versusTargetWins})`
    );

    this.updateVersusHud();
  }

  updateVersusHud() {
    const valEl = document.getElementById('hud-versus-val');
    if (valEl) {
      valEl.innerHTML = `<span style="color:#007aff; font-weight:900;">P1: ${this.versusScores.p1}</span> <span style="color:#8e8e93;">-</span> <span style="color:#ff3b30; font-weight:900;">P2: ${this.versusScores.p2}</span>`;
    }
  }

  restartGame() {
    this.startGame(this.mode);
  }

  pauseGame() {
    if (this.state === 'PLAYING') {
      this.state = 'PAUSED';
    }
  }

  resumeGame() {
    if (this.state === 'PAUSED') {
      this.state = 'PLAYING';
    }
  }

  returnToMenu() {
    if (window.configManager) {
      window.configManager.syncLatest();
    }
    this.state = 'MENU';
    this.isVersus = false;
    this.sound.stopBgm();
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

    const p = this.isVersus ? this.players[playerIdx] : this.player;
    if (!p || p.isDead) return;

    // If already in middle of hop, buffer next move for snappy continuous control
    if (p.isHopping && p.hopProgress < 0.8) {
      p.bufferedMove = { dx, dy };
      return;
    }

    const newCol = p.col + dx;
    const newRow = p.row + dy;

    // Clamped inside 6x6 grid [0..5]
    if (newCol < 0 || newCol > 5 || newRow < 0 || newRow > 5) {
      return;
    }

    // Versus Collision Logic (solid, ghost, push)
    if (this.isVersus) {
      const oppIdx = 1 - playerIdx;
      const opponent = this.players[oppIdx];
      const cfg = window.configManager;
      const collisionMode = cfg ? cfg.get('versusCollisionMode') : 'solid';

      if (opponent && !opponent.isDead && opponent.col === newCol && opponent.row === newRow) {
        if (collisionMode === 'solid') {
          // Blocked! Cannot occupy same tile
          this.sound.playWarning();
          return;
        } else if (collisionMode === 'push') {
          const pushCol = opponent.col + dx;
          const pushRow = opponent.row + dy;
          if (pushCol >= 0 && pushCol <= 5 && pushRow >= 0 && pushRow <= 5) {
            opponent.prevCol = opponent.col;
            opponent.prevRow = opponent.row;
            opponent.col = pushCol;
            opponent.row = pushRow;
            opponent.isHopping = true;
            opponent.hopProgress = 0;
            opponent.tiltAngle = dx * 0.2 + dy * 0.1;
            const oppPos = this.renderer.gridToScreen(opponent.col, opponent.row);
            this.renderer.addFloatingText('PUSH!', oppPos.x, oppPos.y - 20, '#ff9500');
            this.sound.playHop();
          } else {
            // Against edge of grid: cannot be pushed, block movement
            return;
          }
        }
        // If 'ghost': pass through freely
      }
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
    for (let i = 0; i < 3; i++) {
      this.renderer.spawnParticle({
        x: oldScreenPos.x + (Math.random() - 0.5) * 10,
        y: oldScreenPos.y + 12,
        vx: -dx * 30 + (Math.random() - 0.5) * 20,
        vy: -dy * 30 + (Math.random() - 0.5) * 20,
        radius: 2.5,
        color: '#cbd5e1',
        life: 0.25
      });
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
    let nearMiss = false;
    for (const obs of this.obstacleManager.obstacles) {
      if (obs.type === 'rock' || obs.type === 'cannon') {
        const dist = Math.hypot(obs.x - prevCol, obs.y - prevRow);
        if (dist < nearDist) {
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

  showWaveBanner(title, sub) {
    const banner = document.getElementById('wave-banner');
    const bTitle = document.getElementById('wave-banner-title');
    const bSub = document.getElementById('wave-banner-sub');
    if (banner && bTitle && bSub) {
      bTitle.textContent = title;
      bSub.textContent = sub;
      banner.classList.remove('hidden');

      clearTimeout(this.bannerTimer);
      this.bannerTimer = setTimeout(() => {
        banner.classList.add('hidden');
      }, 1600);
    }
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

    if (this.state !== 'PLAYING') return;

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
              targetWins: this.versusTargetWins
            });
          }
        }
        return;
      }

      // 1. Update hop animation for each player
      for (const pl of this.players) {
        if (pl.isDead) continue;
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
        const waveEl = document.getElementById('hud-wave-val');
        if (waveEl) waveEl.textContent = this.wave;
        this.updateVersusHud();
      } else {
        const scoreEl = document.getElementById('hud-score-val');
        const waveEl = document.getElementById('hud-wave-val');
        const bestEl = document.getElementById('hud-best-val');
        if (scoreEl) scoreEl.textContent = this.score;
        if (waveEl) waveEl.textContent = this.wave;
        if (bestEl) bestEl.textContent = Math.max(this.score, this.getBestScore(this.mode));
      }
    }

    requestAnimationFrame((t) => this.gameLoop(t));
  }
}

window.Game = Game;
