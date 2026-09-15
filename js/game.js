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

    // Player Object
    this.player = {
      col: 2,
      row: 3,
      animX: 2,
      animY: 3,
      hopProgress: 1,
      hopDuration: 0.11, // snappy 110ms hop
      hopZ: 0,
      tiltAngle: 0,
      isHopping: false,
      isScared: false,
      isDead: false,
      targetCol: 2,
      targetRow: 3,
      prevCol: 2,
      prevRow: 3
    };

    // Connect hopDuration to live config updates
    if (window.configManager) {
      this.player.hopDuration = window.configManager.get('hopDuration');
      window.configManager.onChange((newCfg) => {
        if (newCfg.hopDuration) this.player.hopDuration = newCfg.hopDuration;
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
      this.player.hopDuration = window.configManager.get('hopDuration');
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

    // Reset Player to center
    this.player.col = 2;
    this.player.row = 3;
    this.player.animX = 2;
    this.player.animY = 3;
    this.player.targetCol = 2;
    this.player.targetRow = 3;
    this.player.prevCol = 2;
    this.player.prevRow = 3;
    this.player.hopProgress = 1;
    this.player.isHopping = false;
    this.player.isScared = false;
    this.player.isDead = false;
    this.player.hopZ = 0;
    this.player.tiltAngle = 0;

    this.obstacleManager.reset(mode);

    // Audio resume
    this.sound.resume();
    this.sound.startBgm();

    this.showWaveBanner(`LEVEL ${this.wave}`, 'GET READY!');
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
    this.sound.stopBgm();
  }

  // Handle Player Movement (Up, Down, Left, Right)
  movePlayer(dx, dy) {
    if (this.state !== 'PLAYING' || this.player.isDead) return;

    // If already in middle of hop, buffer next move for snappy continuous control
    if (this.player.isHopping && this.player.hopProgress < 0.8) {
      this.bufferedMove = { dx, dy };
      return;
    }

    const newCol = this.player.col + dx;
    const newRow = this.player.row + dy;

    // Clamped inside 6x6 grid [0..5]
    if (newCol < 0 || newCol > 5 || newRow < 0 || newRow > 5) {
      return;
    }

    this.bufferedMove = null;

    this.player.prevCol = this.player.col;
    this.player.prevRow = this.player.row;
    this.player.col = newCol;
    this.player.row = newRow;
    this.player.isHopping = true;
    this.player.hopProgress = 0;
    this.player.tiltAngle = dx * 0.14 + dy * 0.05;

    this.sound.playHop();

    const oldScreenPos = this.renderer.gridToScreen(this.player.prevCol, this.player.prevRow);
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

    this.checkNearMiss(this.player.prevCol, this.player.prevRow);
    this.checkCollectiblePickup();
  }

  // Move towards clicked tile (adjacent only)
  moveToTile(col, row) {
    if (this.state !== 'PLAYING' || this.player.isDead) return;
    const dx = col - this.player.col;
    const dy = row - this.player.row;

    if (Math.abs(dx) + Math.abs(dy) === 1) {
      this.movePlayer(dx, dy);
    } else if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
      // Prioritize larger axis
      if (Math.abs(dx) >= Math.abs(dy)) {
        this.movePlayer(Math.sign(dx), 0);
      } else {
        this.movePlayer(0, Math.sign(dy));
      }
    }
  }

  checkNearMiss(prevCol, prevRow) {
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
      this.score += 100;
      this.sound.playNearMiss();
      const pos = this.renderer.gridToScreen(this.player.col, this.player.row);
      this.renderer.addFloatingText('NICE DODGE! +100', pos.x, pos.y - 25, '#34c759');
    }
  }

  checkCollectiblePickup() {
    for (let i = this.collectibles.length - 1; i >= 0; i--) {
      const star = this.collectibles[i];
      if (star.col === this.player.col && star.row === this.player.row) {
        this.collectibles.splice(i, 1);
        this.score += 300;
        this.sound.playStarCollect();

        const pos = this.renderer.gridToScreen(this.player.col, this.player.row);
        this.renderer.addFloatingText('STAR! +300', pos.x, pos.y - 30, '#ffd60a');

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

    if (col === this.player.col && row === this.player.row) return;

    this.collectibles.push({ col, row, life: 7 });
  }

  nextWave() {
    this.wave++;
    const waveBonus = this.wave * 250;
    this.score += waveBonus;

    this.sound.playWaveClear();
    this.obstacleManager.setWave(this.wave);

    const pos = this.renderer.gridToScreen(this.player.col, this.player.row);
    this.renderer.addFloatingText(`LEVEL CLEAR! +${waveBonus}`, pos.x, pos.y - 40, '#ffd60a');

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

  update(dt) {
    this.renderer.update(dt);

    if (this.state !== 'PLAYING') return;

    if (this.hitFreezeTimer > 0) {
      this.hitFreezeTimer -= dt;
      return;
    }

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
      this.player,
      this.obstacleManager.obstacles,
      this.obstacleManager.warnings,
      this.collectibles,
      this.mode
    );

    if (this.state === 'PLAYING') {
      const scoreEl = document.getElementById('hud-score-val');
      const waveEl = document.getElementById('hud-wave-val');
      const bestEl = document.getElementById('hud-best-val');
      if (scoreEl) scoreEl.textContent = this.score;
      if (waveEl) waveEl.textContent = this.wave;
      if (bestEl) bestEl.textContent = Math.max(this.score, this.getBestScore(this.mode));
    }

    requestAnimationFrame((t) => this.gameLoop(t));
  }
}

window.Game = Game;
