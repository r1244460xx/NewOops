/**
 * Mr. Oops!! - Obstacles & Spawner Logic
 * Controls the warning indicators, movement, and collision detection for
 * Slow Rocks, Medium Cannonballs, and Fast Lasers.
 * 
 * Fine-tuned Difficulty Mechanics:
 * 1. Warning indicator duration cut in half (~0.5s before launch).
 * 2. Level progression:
 *    - Level 1: exactly 1 line
 *    - Level 2: exactly 2 lines simultaneously
 *    - Level 3: exactly 3 lines simultaneously
 *    - Level 4+: exactly 4 lines simultaneously (max 4 lines)
 * 3. Targeted Hazard: At least one line MUST target the player's current row or column!
 */

class ObstacleManager {
  constructor(renderer, soundEngine, game = null) {
    this.renderer = renderer;
    this.sound = soundEngine;
    this.game = game;
    this.gridSize = 8;

    this.warnings = [];
    this.obstacles = [];
    
    this.currentMode = 'rock';
    this.wave = 1;
    this.spawnsThisLevel = 0;
    this.spawnCooldown = 0;
    this.isWaveComplete = false;
  }

  playSound(name) {
    if (this.game && typeof this.game.playSound === 'function') {
      this.game.playSound(name);
    } else if (this.sound && typeof this.sound[name] === 'function') {
      this.sound[name]();
    }
  }

  reset(mode = 'rock') {
    this.currentMode = mode;
    this.wave = 1;
    this.warnings = [];
    this.obstacles = [];
    this.spawnsThisLevel = 0;
    this.spawnCooldown = 0.8; // Brief initial grace period
    this.isWaveComplete = false;
  }

  getTargetWavesForLevel() {
    const cfg = window.configManager;
    return cfg ? Math.max(1, Math.round(cfg.get('wavesPerLevel'))) : 5;
  }

  setWave(wave) {
    this.wave = wave;
    this.warnings = [];
    this.obstacles = [];
    this.spawnsThisLevel = 0;
    this.spawnCooldown = 0.8;
    this.isWaveComplete = false;
  }

  update(dt, player) {
    // 1. Update active warnings and spawn projectiles when warning timer ends
    for (let i = this.warnings.length - 1; i >= 0; i--) {
      const w = this.warnings[i];
      w.timer -= dt;

      // Pulse urgency sound when timer is close to launch
      if (w.timer <= 0.22 && !w.soundPlayed) {
        w.soundPlayed = true;
        if (w.type === 'laser') {
          this.playSound('playLaserCharge');
        } else {
          this.playSound('playWarning');
        }
      }

      if (w.timer <= 0) {
        this.spawnFromWarning(w);
        this.warnings.splice(i, 1);
      }
    }

    // 2. Update active projectiles
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      
      if (obs.type === 'rock') {
        this.updateRock(obs, dt);
      } else if (obs.type === 'cannon') {
        this.updateCannonball(obs, dt);
      } else if (obs.type === 'laser') {
        this.updateLaser(obs, dt);
      }

      if (obs.isFinished) {
        this.obstacles.splice(i, 1);
      }
    }

    // 3. Handle Wave progression & spawner by wave count (not seconds)
    const targetWaves = this.getTargetWavesForLevel();

    if (this.spawnsThisLevel < targetWaves) {
      this.spawnCooldown -= dt;

      if (this.spawnCooldown <= 0) {
        this.generatePattern(player);
        this.spawnsThisLevel++;
        this.spawnCooldown = this.getSpawnInterval();
      }
    } else {
      // All required attack waves for this level have been dispatched.
      // Once all current warnings and projectiles finish, advance to next level!
      if (this.warnings.length === 0 && this.obstacles.length === 0) {
        this.isWaveComplete = true;
      }
    }
  }

  getSpawnInterval() {
    const cfg = window.configManager;
    let base = 1.35;
    if (this.currentMode === 'rock') {
      base = cfg ? cfg.get('rockSpawnInterval') : 1.6;
    } else if (this.currentMode === 'cannon') {
      base = cfg ? cfg.get('cannonSpawnInterval') : 1.35;
    } else if (this.currentMode === 'laser') {
      base = cfg ? cfg.get('laserSpawnInterval') : 1.45;
    } else if (this.currentMode === 'versus') {
      const vHazard = cfg ? cfg.get('versusHazardMode') : 'allstar';
      if (vHazard === 'rock') base = cfg ? cfg.get('rockSpawnInterval') : 1.6;
      else if (vHazard === 'cannon') base = cfg ? cfg.get('cannonSpawnInterval') : 1.35;
      else if (vHazard === 'laser') base = cfg ? cfg.get('laserSpawnInterval') : 1.45;
      else base = cfg ? cfg.get('allstarSpawnInterval') : 1.2;
    } else {
      // All-Star mode
      base = cfg ? cfg.get('allstarSpawnInterval') : 1.2;
    }

    const waveFactor = Math.min(0.35, (this.wave - 1) * 0.03);
    return Math.max(0.35, base - waveFactor);
  }

  // Warning duration set using configManager parameters
  getWarningDuration(type) {
    const cfg = window.configManager;
    const mult = cfg ? cfg.get('warningMultiplier') : 0.75;
    const waveFactor = Math.min(1, (this.wave - 1) / 15);

    if (type === 'rock') {
      const base = cfg ? cfg.get('rockWarningBase') : 1.15;
      return (base - waveFactor * 0.35) * mult;
    } else if (type === 'cannon') {
      const base = cfg ? cfg.get('cannonWarningBase') : 0.95;
      return (base - waveFactor * 0.25) * mult;
    } else if (type === 'laser') {
      const base = cfg ? cfg.get('laserWarningBase') : 1.0;
      return (base - waveFactor * 0.3) * mult;
    }
    return 0.75;
  }

  addWarning(type, side, index) {
    const exists = this.warnings.some(w => w.side === side && w.index === index && w.type === type);
    if (exists) return;

    const duration = this.getWarningDuration(type);
    const direction = (side === 'left' || side === 'right') ? 'horizontal' : 'vertical';
    this.warnings.push({
      type,
      side,
      index, // row or column 0..5
      direction,
      timer: duration,
      maxTimer: duration,
      soundPlayed: false
    });
    this.playSound('playWarning');
  }

  spawnFromWarning(w) {
    const waveFactor = Math.min(1, (this.wave - 1) / 15);
    const cfg = window.configManager;

    if (w.type === 'rock') {
      // Slow rock
      const baseSpeed = cfg ? cfg.get('rockSpeed') : 1.7;
      const speed = baseSpeed + waveFactor * 0.7;
      let startX = 0, startY = 0, vx = 0, vy = 0;

      if (w.side === 'left') {
        startX = -1.2;
        startY = w.index;
        vx = speed;
      } else if (w.side === 'right') {
        startX = this.gridSize + 0.2;
        startY = w.index;
        vx = -speed;
      } else if (w.side === 'top') {
        startX = w.index;
        startY = -1.2;
        vy = speed;
      } else if (w.side === 'bottom') {
        startX = w.index;
        startY = this.gridSize + 0.2;
        vy = -speed;
      }

      this.obstacles.push({
        type: 'rock',
        x: startX,
        y: startY,
        vx,
        vy,
        side: w.side,
        index: w.index,
        rotation: 0,
        isFinished: false
      });
      this.playSound('playRockRoll');

    } else if (w.type === 'cannon') {
      // Medium-fast cannonball
      const baseSpeed = cfg ? cfg.get('cannonSpeed') : 6.3;
      const speed = baseSpeed + waveFactor * 2.2;
      let startX = 0, startY = 0, vx = 0, vy = 0;

      if (w.side === 'left') {
        startX = -0.8;
        startY = w.index;
        vx = speed;
      } else if (w.side === 'right') {
        startX = this.gridSize + 0.8;
        startY = w.index;
        vx = -speed;
      } else if (w.side === 'top') {
        startX = w.index;
        startY = -0.8;
        vy = speed;
      } else if (w.side === 'bottom') {
        startX = w.index;
        startY = this.gridSize + 0.8;
        vy = -speed;
      }

      this.obstacles.push({
        type: 'cannon',
        x: startX,
        y: startY,
        vx,
        vy,
        side: w.side,
        index: w.index,
        smokeTimer: 0,
        isFinished: false
      });
      this.playSound('playCannonShot');

    } else if (w.type === 'laser') {
      // Fast instantaneous laser beam
      const duration = cfg ? cfg.get('laserDuration') : 0.28;
      this.obstacles.push({
        type: 'laser',
        direction: w.direction,
        index: w.index,
        duration: duration,
        maxDuration: duration,
        isFinished: false
      });
      this.playSound('playLaserBlast');
      this.renderer.triggerShake(6, 0.2);

      const ts = this.renderer.tileSize;
      const ox = this.renderer.boardOriginX;
      const oy = this.renderer.boardOriginY;
      for (let i = 0; i < 8; i++) {
        const randTile = Math.random() * 6;
        let px = 0, py = 0;
        if (w.direction === 'horizontal') {
          px = ox + randTile * ts;
          py = oy + (w.index + 0.5) * ts;
        } else {
          px = ox + (w.index + 0.5) * ts;
          py = oy + randTile * ts;
        }
        this.renderer.spawnParticle({
          x: px,
          y: py,
          vx: (Math.random() - 0.5) * 120,
          vy: (Math.random() - 0.5) * 120,
          color: '#ffffff',
          radius: 3,
          life: 0.3
        });
      }
    }
  }

  updateRock(obs, dt) {
    obs.x += obs.vx * dt;
    obs.y += obs.vy * dt;
    obs.rotation += (obs.vx !== 0 ? Math.sign(obs.vx) : Math.sign(obs.vy)) * 3.5 * dt;

    if (Math.random() < 0.35) {
      const pos = this.renderer.gridToScreen(obs.x, obs.y);
      this.renderer.spawnParticle({
        x: pos.x + (Math.random() - 0.5) * 15,
        y: pos.y + (Math.random() - 0.5) * 15,
        vx: -obs.vx * 10,
        vy: -obs.vy * 10,
        radius: 3,
        color: '#b0a495',
        life: 0.35
      });
    }

    if (obs.x < -2 || obs.x > this.gridSize + 2 || obs.y < -2 || obs.y > this.gridSize + 2) {
      obs.isFinished = true;
    }
  }

  updateCannonball(obs, dt) {
    obs.x += obs.vx * dt;
    obs.y += obs.vy * dt;

    obs.smokeTimer += dt;
    if (obs.smokeTimer >= 0.03) {
      obs.smokeTimer = 0;
      const pos = this.renderer.gridToScreen(obs.x, obs.y);
      this.renderer.spawnParticle({
        x: pos.x + (Math.random() - 0.5) * 6,
        y: pos.y + (Math.random() - 0.5) * 6,
        vx: -obs.vx * 8 + (Math.random() - 0.5) * 20,
        vy: -obs.vy * 8 + (Math.random() - 0.5) * 20,
        radius: 4,
        color: 'rgba(200, 205, 215, 0.7)',
        life: 0.4
      });
    }

    if (obs.x < -2 || obs.x > this.gridSize + 2 || obs.y < -2 || obs.y > this.gridSize + 2) {
      obs.isFinished = true;
    }
  }

  updateLaser(obs, dt) {
    obs.duration -= dt;
    if (obs.duration <= 0) {
      obs.isFinished = true;
    }
  }

  /**
   * Generates projectile patterns according to User Rules:
   * 1. Level 1: exactly 1 line
   * 2. Level 2: exactly 2 lines
   * 3. Level 3: exactly 3 lines
   * 4. Level 4+: exactly 4 lines (capped at 4)
   * 5. In single-player: One line MUST target player row or col.
   * 6. In versus mode: Targets BOTH P1 and P2 (when numLines >= 2).
   */
  generatePattern(playerOrPlayers) {
    const cfg = window.configManager;
    const maxLines = cfg ? cfg.get('maxLines') : 4;
    const numLines = Math.min(maxLines, Math.max(1, this.wave));

    const selectedLines = [];
    const usedH = new Set();
    const usedV = new Set();

    const addTargetForPlayer = (pl) => {
      const pCol = pl ? pl.col : Math.floor(Math.random() * this.gridSize);
      const pRow = pl ? pl.row : Math.floor(Math.random() * this.gridSize);
      const hAvailable = !usedH.has(pRow);
      const vAvailable = !usedV.has(pCol);

      let targetH = Math.random() < 0.5;
      if (hAvailable && !vAvailable) targetH = true;
      else if (!hAvailable && vAvailable) targetH = false;
      else if (!hAvailable && !vAvailable) return null; // Both lines already occupied

      const line = {
        dir: targetH ? 'horizontal' : 'vertical',
        side: targetH ? (Math.random() < 0.5 ? 'left' : 'right') : (Math.random() < 0.5 ? 'top' : 'bottom'),
        index: targetH ? pRow : pCol
      };
      if (targetH) usedH.add(pRow);
      else usedV.add(pCol);
      return line;
    };

    if (Array.isArray(playerOrPlayers)) {
      const alivePlayers = playerOrPlayers.filter(p => p && !p.isDead);
      if (alivePlayers.length >= 2 && numLines >= 2) {
        // Multi-targeting: Target P1 and P2
        const l0 = addTargetForPlayer(alivePlayers[0]);
        if (l0) selectedLines.push(l0);
        const l1 = addTargetForPlayer(alivePlayers[1]);
        if (l1) selectedLines.push(l1);
      } else if (alivePlayers.length > 0) {
        const targetPl = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
        const l = addTargetForPlayer(targetPl);
        if (l) selectedLines.push(l);
      }
    } else {
      const l = addTargetForPlayer(playerOrPlayers);
      if (l) selectedLines.push(l);
    }

    // Build candidate pool of remaining available rows and columns
    const candidates = [];
    for (let r = 0; r < this.gridSize; r++) {
      if (!usedH.has(r)) {
        candidates.push({
          dir: 'horizontal',
          side: Math.random() < 0.5 ? 'left' : 'right',
          index: r
        });
      }
    }
    for (let c = 0; c < this.gridSize; c++) {
      if (!usedV.has(c)) {
        candidates.push({
          dir: 'vertical',
          side: Math.random() < 0.5 ? 'top' : 'bottom',
          index: c
        });
      }
    }

    // Shuffle candidates randomly
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    // Pick remaining lines up to numLines without duplicating row or column
    for (const cand of candidates) {
      if (selectedLines.length >= numLines) break;
      if (cand.dir === 'horizontal' && !usedH.has(cand.index)) {
        usedH.add(cand.index);
        selectedLines.push(cand);
      } else if (cand.dir === 'vertical' && !usedV.has(cand.index)) {
        usedV.add(cand.index);
        selectedLines.push(cand);
      }
    }

    // Spawn warnings for all selected lines simultaneously
    const obstacleTypes = ['rock', 'cannon', 'laser'];
    for (const line of selectedLines) {
      let type = this.currentMode;
      if (type === 'allstar' || type === 'versus') {
        const vHazard = (type === 'versus' && cfg) ? (cfg.get('versusHazardMode') || 'allstar') : type;
        if (vHazard === 'allstar' || type === 'allstar') {
          type = obstacleTypes[Math.floor(Math.random() * obstacleTypes.length)];
        } else {
          type = vHazard;
        }
      }
      this.addWarning(type, line.side, line.index);
    }
  }

  checkCollisions(playerOrPlayers) {
    if (Array.isArray(playerOrPlayers)) {
      return playerOrPlayers.filter(p => this.checkSingleCollision(p));
    }
    return this.checkSingleCollision(playerOrPlayers);
  }

  checkSingleCollision(player) {
    if (!player || player.isDead) return false;

    const px = player.animX;
    const py = player.animY;

    for (const obs of this.obstacles) {
      if (obs.type === 'rock') {
        const dx = obs.x - px;
        const dy = obs.y - py;
        // 0.7 * 0.7 = 0.49 (eliminate Math.sqrt)
        if (dx * dx + dy * dy < 0.49) {
          return true;
        }
      } else if (obs.type === 'cannon') {
        const dx = obs.x - px;
        const dy = obs.y - py;
        // 0.62 * 0.62 = 0.3844 (eliminate Math.sqrt)
        if (dx * dx + dy * dy < 0.3844) {
          return true;
        }
      } else if (obs.type === 'laser') {
        if (obs.direction === 'horizontal') {
          if (Math.abs(py - obs.index) < 0.48) {
            return true;
          }
        } else {
          if (Math.abs(px - obs.index) < 0.48) {
            return true;
          }
        }
      }
    }

    return false;
  }

  isHazardNearPlayer(player) {
    if (!player || player.isDead) return false;
    const px = player.col;
    const py = player.row;

    for (const w of this.warnings) {
      if (w.direction === 'horizontal' && w.index === py && w.timer < 0.4) return true;
      if (w.direction === 'vertical' && w.index === px && w.timer < 0.4) return true;
    }

    for (const obs of this.obstacles) {
      if (obs.type === 'rock' || obs.type === 'cannon') {
        const dx = obs.x - px;
        const dy = obs.y - py;
        // 1.8 * 1.8 = 3.24 (eliminate Math.hypot)
        if (dx * dx + dy * dy < 3.24) return true;
      }
    }

    return false;
  }
}

window.ObstacleManager = ObstacleManager;
