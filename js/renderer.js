/**
 * Mr. Oops!! - Canvas Renderer
 * Renders the 6x6 isometric-tilted platform, stick figure player, warnings,
 * projectiles (Rock, Cannon, Laser), particle effects, and comic visual FX.
 * Fully compatible with all browsers (no roundRect dependency).
 */

// Universal cross-browser rounded rectangle drawing helper
function drawRoundedRect(ctx, x, y, width, height, radius) {
  if (typeof radius === 'undefined') radius = 6;
  let tl = 6, tr = 6, br = 6, bl = 6;
  if (typeof radius === 'number') {
    tl = tr = br = bl = radius;
  } else if (Array.isArray(radius)) {
    tl = radius[0] || 0;
    tr = radius[1] !== undefined ? radius[1] : tl;
    br = radius[2] !== undefined ? radius[2] : tl;
    bl = radius[3] !== undefined ? radius[3] : tr;
  }
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + width - tr, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + tr);
  ctx.lineTo(x + width, y + height - br);
  ctx.quadraticCurveTo(x + width, y + height, x + width - br, y + height);
  ctx.lineTo(x + bl, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Grid configuration: 6x6
    this.gridSize = 6;
    this.tileSize = 60;
    this.boardWidth = 0;
    this.boardHeight = 0;
    this.boardOriginX = 0;
    this.boardOriginY = 0;

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewWidth = 600;
    this.viewHeight = 600;

    // Camera & Screen Shake
    this.shakeIntensity = 0;
    this.shakeDuration = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;

    // Particles & Floating texts
    this.particles = [];
    this.floatingTexts = [];
    this.afterimages = [];

    // Background animation phase
    this.bgTime = 0;

    // Offscreen Canvas Cache for 6x6 Platform
    this.platformCanvas = null;
    this.platformCtx = null;

    this.resize();
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', () => this.resize());
    }
    setTimeout(() => this.resize(), 100);
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const container = this.canvas.parentElement;
    
    // Determine available container bounds
    let availW = container ? container.clientWidth : window.innerWidth;
    let availH = container ? container.clientHeight : window.innerHeight;

    if (!availW || availW < 50) availW = window.innerWidth || 600;
    if (!availH || availH < 50) availH = (window.innerHeight ? window.innerHeight - 120 : 600);

    // Keep square aspect ratio with safe margins
    const size = Math.floor(Math.max(280, Math.min(availW - 16, availH - 16, 680)));
    
    this.viewWidth = size;
    this.viewHeight = size;

    // Set canvas internal resolution (scaled for DPR)
    this.canvas.width = Math.floor(size * this.dpr);
    this.canvas.height = Math.floor(size * this.dpr);

    // Set canvas CSS display size (strictly 1:1, prevent stretching)
    this.canvas.style.width = size + 'px';
    this.canvas.style.height = size + 'px';

    // Calculate tile dimensions centered on canvas
    this.tileSize = Math.floor(size * 0.12);
    this.boardWidth = this.tileSize * this.gridSize;
    this.boardHeight = this.tileSize * this.gridSize;
    this.boardOriginX = Math.floor((this.viewWidth - this.boardWidth) / 2);
    this.boardOriginY = Math.floor((this.viewHeight - this.boardHeight) / 2 + 8);

    // Pre-render static platform once into offscreen canvas
    this.preRenderPlatform();
  }

  preRenderPlatform() {
    if (!this.platformCanvas) {
      this.platformCanvas = document.createElement('canvas');
      this.platformCtx = this.platformCanvas.getContext('2d');
    }
    this.platformCanvas.width = this.canvas.width;
    this.platformCanvas.height = this.canvas.height;
    const ctx = this.platformCtx;
    if (!ctx) return;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewWidth, this.viewHeight);

    const ox = this.boardOriginX;
    const oy = this.boardOriginY;
    const bw = this.boardWidth;
    const bh = this.boardHeight;
    const depth = 16;

    ctx.save();

    // 1. Ground Drop Shadow under platform
    ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
    drawRoundedRect(ctx, ox - 8, oy + depth + 6, bw + 16, bh + 12, 16);
    ctx.fill();

    // 2. 3D Platform Side Bevel
    ctx.fillStyle = '#414b5c';
    drawRoundedRect(ctx, ox - 6, oy + bh - 4, bw + 12, depth + 8, [0, 0, 12, 12]);
    ctx.fill();

    ctx.fillStyle = '#2b3341';
    ctx.fillRect(ox - 6, oy + bh + depth, bw + 12, 4);

    // 3. Platform Top Border Frame
    ctx.fillStyle = '#64748b';
    drawRoundedRect(ctx, ox - 6, oy - 6, bw + 12, bh + 12, 12);
    ctx.fill();

    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(ox - 4, oy - 4, bw + 8, bh + 8);

    // 4. 6x6 Checkerboard Tiles
    for (let r = 0; r < this.gridSize; r++) {
      for (let c = 0; c < this.gridSize; c++) {
        const tx = ox + c * this.tileSize;
        const ty = oy + r * this.tileSize;
        const isEven = (r + c) % 2 === 0;

        ctx.fillStyle = isEven ? '#f8fafc' : '#e2e8f0';
        ctx.fillRect(tx, ty, this.tileSize, this.tileSize);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.lineWidth = 1;
        ctx.strokeRect(tx + 1, ty + 1, this.tileSize - 2, this.tileSize - 2);
      }
    }

    // Outer border stroke
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox, oy, bw, bh);

    ctx.restore();
  }

  // Convert grid coordinates (col, row: 0..5) to screen pixels
  gridToScreen(col, row) {
    return {
      x: this.boardOriginX + (col + 0.5) * this.tileSize,
      y: this.boardOriginY + (row + 0.5) * this.tileSize
    };
  }

  // Convert screen pixels to grid coordinates (col, row: 0..5)
  screenToGrid(screenX, screenY) {
    const col = Math.floor((screenX - this.boardOriginX) / this.tileSize);
    const row = Math.floor((screenY - this.boardOriginY) / this.tileSize);
    if (col >= 0 && col < this.gridSize && row >= 0 && row < this.gridSize) {
      return { col, row };
    }
    return null;
  }

  // Trigger screen shake
  triggerShake(intensity = 12, duration = 0.3) {
    this.shakeIntensity = intensity;
    this.shakeDuration = duration;
  }

  // Update timers & particle animations
  update(dt) {
    this.bgTime += dt;

    // Screen shake update
    if (this.shakeDuration > 0) {
      this.shakeDuration -= dt;
      const decay = Math.max(0, this.shakeDuration / 0.3);
      this.shakeOffsetX = (Math.random() * 2 - 1) * this.shakeIntensity * decay;
      this.shakeOffsetY = (Math.random() * 2 - 1) * this.shakeIntensity * decay;
    } else {
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }

    // Update particles (O(1) swap-and-pop removal)
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.gravity) p.vy += p.gravity * dt;
      if (p.rotation !== undefined) p.rotation += (p.vRot || 2) * dt;
      if (p.life <= 0) {
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
      }
    }

    // Update floating texts (O(1) swap-and-pop removal)
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const t = this.floatingTexts[i];
      t.y -= 45 * dt;
      t.life -= dt;
      t.scale = 1 + Math.sin((1 - t.life / t.maxLife) * Math.PI) * 0.2;
      t.alpha = Math.max(0, t.life / t.maxLife);
      if (t.life <= 0) {
        this.floatingTexts[i] = this.floatingTexts[this.floatingTexts.length - 1];
        this.floatingTexts.pop();
      }
    }

    // Update afterimages (O(1) swap-and-pop removal)
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      const af = this.afterimages[i];
      af.life -= dt;
      if (af.life <= 0) {
        this.afterimages[i] = this.afterimages[this.afterimages.length - 1];
        this.afterimages.pop();
      }
    }
  }

  // Spawn visual particle
  spawnParticle(config) {
    this.particles.push({
      x: config.x,
      y: config.y,
      vx: config.vx || (Math.random() * 80 - 40),
      vy: config.vy || (Math.random() * 80 - 40),
      radius: config.radius || 4,
      color: config.color || '#fff',
      life: config.life || 0.6,
      maxLife: config.life || 0.6,
      alpha: 1,
      gravity: config.gravity || 0,
      type: config.type || 'circle',
      rotation: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 6
    });
  }

  // Spawn afterimage ghost trail behind dashing player
  spawnAfterimage(player) {
    if (player.momentumTimer !== undefined && player.momentumTimer <= 0 && !player.isHopping) return;
    const pColor = player.id === 1 ? '#007aff' : (player.id === 2 ? '#ff3b30' : (player.color || '#34c759'));
    const screenX = this.boardOriginX + (player.animX + 0.5) * this.tileSize;
    const screenY = this.boardOriginY + (player.animY + 0.5) * this.tileSize;
    this.afterimages.push({
      x: screenX,
      y: screenY,
      hopElev: player.hopZ || 0,
      tiltAngle: player.tiltAngle || 0,
      color: pColor,
      life: 0.24,
      maxLife: 0.24
    });
  }

  // Head-on Clash particle explosion & shockwave burst
  spawnClashBurst(midX, midY) {
    // 1. Dual Shockwave Rings & Golden Spark Shower
    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const speed = 120 + Math.random() * 160;
      this.spawnParticle({
        x: midX,
        y: midY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 3 + Math.random() * 3,
        color: i % 2 === 0 ? '#ffd700' : '#ffffff',
        life: 0.35 + Math.random() * 0.15,
        gravity: 60
      });
    }

    // 2. High-speed spark lines
    for (let i = 0; i < 12; i++) {
      this.spawnParticle({
        x: midX,
        y: midY,
        vx: (Math.random() - 0.5) * 320,
        vy: (Math.random() - 0.5) * 320,
        radius: 2,
        color: '#fffae6',
        life: 0.2,
        gravity: 0
      });
    }

    // 3. Central bright flash particle
    this.spawnParticle({
      x: midX,
      y: midY,
      vx: 0,
      vy: 0,
      radius: 26,
      color: '#ffffff',
      life: 0.14
    });
  }

  // Knocked-away impact spark shower for pushed opponent
  spawnImpactSparks(x, y, dx, dy) {
    const baseAngle = Math.atan2(dy, dx);
    for (let i = 0; i < 20; i++) {
      const spread = (Math.random() - 0.5) * 1.4;
      const speed = 100 + Math.random() * 140;
      const angle = baseAngle + spread;
      this.spawnParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 2.5 + Math.random() * 2.5,
        color: i % 3 === 0 ? '#ff9500' : (i % 3 === 1 ? '#ff3b30' : '#ffffff'),
        life: 0.32 + Math.random() * 0.15,
        gravity: 80
      });
    }
  }

  // Add floating text popup
  addFloatingText(text, x, y, color = '#ffd60a') {
    this.floatingTexts.push({
      text,
      x,
      y,
      color,
      life: 0.8,
      maxLife: 0.8,
      scale: 1,
      alpha: 1
    });
  }

  // Draw translucent motion silhouette
  drawGhost(ghost) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(ghost.x, ghost.y - ghost.hopElev);
    ctx.rotate(ghost.tiltAngle);
    ctx.globalAlpha = Math.max(0, (ghost.life / ghost.maxLife) * 0.45);
    ctx.strokeStyle = ghost.color;
    ctx.fillStyle = ghost.color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const headRadius = 14;
    const headY = -30;
    const bodyTopY = headY + headRadius;
    const bodyBottomY = 2;

    // Head
    ctx.beginPath();
    ctx.arc(0, headY, headRadius, 0, Math.PI * 2);
    ctx.fill();

    // Spine & limbs
    ctx.beginPath();
    ctx.moveTo(0, bodyTopY);
    ctx.lineTo(0, bodyBottomY);
    ctx.moveTo(0, bodyBottomY);
    ctx.lineTo(-10, bodyBottomY + 12);
    ctx.moveTo(0, bodyBottomY);
    ctx.lineTo(10, bodyBottomY + 12);
    ctx.moveTo(-12, bodyTopY + 2);
    ctx.lineTo(0, bodyTopY + 3);
    ctx.lineTo(12, bodyTopY + 10);
    ctx.stroke();

    ctx.restore();
  }

  drawAfterimages() {
    for (let i = 0; i < this.afterimages.length; i++) {
      this.drawGhost(this.afterimages[i]);
    }
  }

  // --- Main Render Loop ---
  render(gameState, player, obstacles, warnings, collectibles, theme = 'rock') {
    const ctx = this.ctx;
    if (!ctx) return;

    // Reset transform to handle DPR cleanly every frame
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewWidth, this.viewHeight);

    ctx.save();

    // Apply Screen Shake
    if (this.shakeOffsetX !== 0 || this.shakeOffsetY !== 0) {
      ctx.translate(this.shakeOffsetX, this.shakeOffsetY);
    }

    // 1. Animated Background
    this.drawBackground(theme);

    // 2. 6x6 Stage Platform
    this.drawPlatform();

    // 3. Warning Indicators & Laser Charging Lines
    this.drawWarnings(warnings);

    // 4. Collectibles (Stars)
    if (collectibles) {
      for (const item of collectibles) {
        this.drawCollectible(item);
      }
    }

    // 5. Active Projectiles
    this.drawObstacles(obstacles);

    // 5.5 Player Afterimages (Momentum Sprint Trails)
    this.drawAfterimages();

    // 6. Player (Mr. Oops / 1v1 Versus Players)
    if (player) {
      if (Array.isArray(player)) {
        if (player.length === 2) {
          const p0 = player[0];
          const p1 = player[1];
          if ((p0.animY || 0) <= (p1.animY || 0)) {
            this.drawPlayer(p0, obstacles);
            this.drawPlayer(p1, obstacles);
          } else {
            this.drawPlayer(p1, obstacles);
            this.drawPlayer(p0, obstacles);
          }
        } else {
          // Sort players by animY for correct isometric/vertical depth
          const sorted = [...player].sort((a, b) => (a.animY || 0) - (b.animY || 0));
          for (let i = 0; i < sorted.length; i++) {
            this.drawPlayer(sorted[i], obstacles);
          }
        }
      } else {
        this.drawPlayer(player, obstacles);
      }
    }

    // 7. Particles
    this.drawParticles();

    // 8. Floating Texts
    this.drawFloatingTexts();

    ctx.restore();
  }

  drawBackground(theme) {
    const ctx = this.ctx;
    const w = this.viewWidth;
    const h = this.viewHeight;

    let c1 = '#1c2438';
    let c2 = '#0d131f';
    if (theme === 'rock') {
      c1 = '#28231d';
      c2 = '#13100d';
    } else if (theme === 'cannon') {
      c1 = '#1a2233';
      c2 = '#0d121c';
    } else if (theme === 'laser') {
      c1 = '#26172d';
      c2 = '#110915';
    } else if (theme === 'allstar') {
      c1 = '#251b2f';
      c2 = '#0e111a';
    } else if (theme === 'versus' || theme === 'versus4p' || theme === 'versus3p') {
      c1 = '#1c1f36';
      c2 = '#0b0d18';
    }

    const grad = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w * 0.75);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Grid background accents (Batched into a single stroke call)
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.lineWidth = 1;
    const offset = (this.bgTime * 15) % 40;
    ctx.beginPath();
    for (let x = -40; x < w + 40; x += 40) {
      ctx.moveTo(x + offset, 0);
      ctx.lineTo(x + offset, h);
    }
    for (let y = -40; y < h + 40; y += 40) {
      ctx.moveTo(0, y + offset);
      ctx.lineTo(w, y + offset);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawPlatform() {
    // Ultra-fast single drawImage call from pre-rendered offscreen canvas cache
    if (this.platformCanvas) {
      this.ctx.drawImage(this.platformCanvas, 0, 0, this.viewWidth, this.viewHeight);
    }
  }

  drawWarnings(warnings) {
    if (!warnings || warnings.length === 0) return;
    const ox = this.boardOriginX;
    const oy = this.boardOriginY;
    const bw = this.boardWidth;
    const bh = this.boardHeight;
    const ts = this.tileSize;

    // Pass 1: Draw laser targeting lanes underneath perimeter badges
    for (let i = 0; i < warnings.length; i++) {
      const w = warnings[i];
      if (w.type === 'laser') {
        this.drawLaserWarningLane(w, ox, oy, bw, bh, ts);
      }
    }

    // Pass 2: Draw perimeter warning badges
    for (let i = 0; i < warnings.length; i++) {
      this.drawWarningBadge(warnings[i], ox, oy, bw, bh, ts);
    }
  }

  drawLaserWarningLane(w, ox, oy, bw, bh, ts) {
    const ctx = this.ctx;
    ctx.save();

    const maxTimer = w.maxTimer || 0.8;
    const progress = Math.min(1, Math.max(0, 1 - (w.timer / maxTimer))); // 0 (start) -> 1 (fire)
    const urgencyFreq = 16 + progress * 26;
    const pulse = 0.5 + 0.5 * Math.sin(w.timer * urgencyFreq);
    const isCritical = w.timer <= 0.22; // Imminent firing phase

    let lx = ox, ly = oy, lw = bw, lh = bh;
    if (w.direction === 'horizontal') {
      ly = oy + w.index * ts;
      lh = ts;
    } else {
      lx = ox + w.index * ts;
      lw = ts;
    }

    // Dynamic transparency modulation across all warning elements (preserved)
    const bgAlpha = isCritical ? (0.14 + 0.14 * pulse) : (0.06 + 0.10 * pulse);
    const edgeAlpha = isCritical ? (0.55 + 0.40 * pulse) : (0.25 + 0.45 * pulse);
    const centerAlpha = isCritical ? (0.65 + 0.33 * pulse) : (0.35 + 0.45 * pulse);
    const chevronAlpha = isCritical ? (0.65 + 0.33 * pulse) : (0.30 + 0.50 * pulse);
    const bracketAlpha = isCritical ? (0.50 + 0.40 * pulse) : (0.20 + 0.45 * pulse);

    // 1. Warning Trajectory Corridor Fill (Laser pink approaching laser red, breathing with pulse)
    ctx.fillStyle = isCritical ? `rgba(255, 10, 65, ${bgAlpha})` : `rgba(255, 30, 85, ${bgAlpha})`;
    ctx.fillRect(lx, ly, lw, lh);

    // 2. Trajectory Boundary Dashed Edges (Laser pink dashed borders blinking with pulse)
    ctx.strokeStyle = isCritical ? `rgba(255, 15, 70, ${edgeAlpha})` : `rgba(255, 45, 95, ${edgeAlpha})`;
    ctx.lineWidth = isCritical ? 2.5 : 1.8;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(lx + 1, ly + 1, lw - 2, lh - 2);

    // 3. Dynamic Centerline Aiming Reticle (Laser pink dashed guide modulating in alpha)
    ctx.setLineDash([14, 10]);
    ctx.lineWidth = isCritical ? 3.2 : 2.0;
    ctx.strokeStyle = isCritical ? `rgba(255, 200, 215, ${centerAlpha})` : `rgba(255, 55, 105, ${centerAlpha})`;
    ctx.beginPath();
    if (w.direction === 'horizontal') {
      const centerY = ly + ts * 0.5;
      ctx.moveTo(lx, centerY);
      ctx.lineTo(lx + lw, centerY);
    } else {
      const centerX = lx + ts * 0.5;
      ctx.moveTo(centerX, ly);
      ctx.lineTo(centerX, ly + lh);
    }
    ctx.stroke();

    // 4. Animated Flowing Directional Chevrons (Streaming in laser firing direction, breathing in alpha)
    ctx.setLineDash([]);
    const chevronSpacing = ts * 0.75;
    const speed = isCritical ? 220 : 150;
    const flowTime = this.bgTime * speed;

    ctx.strokeStyle = isCritical ? `rgba(255, 220, 230, ${chevronAlpha})` : `rgba(255, 50, 105, ${chevronAlpha})`;
    ctx.lineWidth = isCritical ? 3.0 : 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (w.direction === 'horizontal') {
      const centerY = ly + ts * 0.5;
      const dir = (w.side === 'left') ? 1 : -1;
      const offset = ((dir * flowTime) % chevronSpacing + chevronSpacing) % chevronSpacing;
      const startX = lx;
      const endX = lx + lw;

      for (let x = startX + offset; x < endX; x += chevronSpacing) {
        ctx.beginPath();
        if (dir > 0) {
          ctx.moveTo(x - 7, centerY - 8);
          ctx.lineTo(x + 5, centerY);
          ctx.lineTo(x - 7, centerY + 8);
        } else {
          ctx.moveTo(x + 7, centerY - 8);
          ctx.lineTo(x - 5, centerY);
          ctx.lineTo(x + 7, centerY + 8);
        }
        ctx.stroke();
      }
    } else {
      const centerX = lx + ts * 0.5;
      const dir = (w.side === 'top') ? 1 : -1;
      const offset = ((dir * flowTime) % chevronSpacing + chevronSpacing) % chevronSpacing;
      const startY = ly;
      const endY = ly + lh;

      for (let y = startY + offset; y < endY; y += chevronSpacing) {
        ctx.beginPath();
        if (dir > 0) {
          ctx.moveTo(centerX - 8, y - 7);
          ctx.lineTo(centerX, y + 5);
          ctx.lineTo(centerX + 8, y - 7);
        } else {
          ctx.moveTo(centerX - 8, y + 7);
          ctx.lineTo(centerX, y - 5);
          ctx.lineTo(centerX + 8, y + 7);
        }
        ctx.stroke();
      }
    }

    // 5. Tactical Cell Corner Brackets at Grid Intersections (Breathing in alpha)
    ctx.strokeStyle = isCritical ? `rgba(255, 20, 75, ${bracketAlpha})` : `rgba(255, 40, 95, ${bracketAlpha})`;
    ctx.lineWidth = 1.8;
    const blen = 6;
    for (let i = 0; i < this.gridSize; i++) {
      const tx = (w.direction === 'horizontal') ? ox + i * ts : lx;
      const ty = (w.direction === 'horizontal') ? ly : oy + i * ts;
      ctx.beginPath();
      // Top-left
      ctx.moveTo(tx + blen, ty + 2);
      ctx.lineTo(tx + 2, ty + 2);
      ctx.lineTo(tx + 2, ty + blen);
      // Top-right
      ctx.moveTo(tx + ts - blen, ty + 2);
      ctx.lineTo(tx + ts - 2, ty + 2);
      ctx.lineTo(tx + ts - 2, ty + blen);
      // Bottom-left
      ctx.moveTo(tx + 2, ty + ts - blen);
      ctx.lineTo(tx + 2, ty + ts - 2);
      ctx.lineTo(tx + blen, ty + ts - 2);
      // Bottom-right
      ctx.moveTo(tx + ts - 2, ty + ts - blen);
      ctx.lineTo(tx + ts - 2, ty + ts - 2);
      ctx.lineTo(tx + ts - blen, ty + ts - 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawWarningBadge(w, ox, oy, bw, bh, ts) {
    const ctx = this.ctx;
    const isLaser = w.type === 'laser';
    const pulse = 0.85 + 0.3 * Math.sin(w.timer * (isLaser ? 26 : 22));

    let badgeX = 0;
    let badgeY = 0;
    let arrowChar = '▼';

    if (w.side === 'top') {
      badgeX = ox + (w.index + 0.5) * ts;
      badgeY = oy - 18;
      arrowChar = '▼';
    } else if (w.side === 'bottom') {
      badgeX = ox + (w.index + 0.5) * ts;
      badgeY = oy + bh + 18;
      arrowChar = '▲';
    } else if (w.side === 'left') {
      badgeX = ox - 18;
      badgeY = oy + (w.index + 0.5) * ts;
      arrowChar = '►';
    } else if (w.side === 'right') {
      badgeX = ox + bw + 18;
      badgeY = oy + (w.index + 0.5) * ts;
      arrowChar = '◄';
    }

    ctx.save();
    ctx.translate(badgeX, badgeY);

    if (isLaser) {
      // Laser expanding sonar ripple ring
      const ripplePhase = (this.bgTime * 2.5) % 1;
      const rippleRadius = 15 + ripplePhase * 14;
      const rippleAlpha = (1 - ripplePhase) * 0.7;
      ctx.strokeStyle = `rgba(255, 30, 85, ${rippleAlpha})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, rippleRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.scale(pulse, pulse);

      // Laser Pink Warning Badge (approaching laser red)
      ctx.fillStyle = '#ff1e56';
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffd60a';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '900 14px "Fredoka", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(arrowChar, 0, 1);

    } else {
      // Standard Cannon / Rock Red Badge
      ctx.scale(pulse, pulse);

      ctx.fillStyle = '#ff3b30';
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffd60a';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '900 14px "Fredoka", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(arrowChar, 0, 1);
    }

    ctx.restore();
  }

  drawCollectible(item) {
    const ctx = this.ctx;
    const pos = this.gridToScreen(item.col, item.row);
    const pulse = 1 + 0.15 * Math.sin(this.bgTime * 8);

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.scale(pulse, pulse);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 16, 12, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(this.bgTime * 2);
    ctx.fillStyle = '#ffd60a';
    ctx.strokeStyle = '#e0a800';
    ctx.lineWidth = 2;
    this.drawStar(ctx, 0, 0, 5, 14, 7);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius) {
    let rot = Math.PI / 2 * 3;
    let x = cx;
    let y = cy;
    const step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
      x = cx + Math.cos(rot) * outerRadius;
      y = cy + Math.sin(rot) * outerRadius;
      ctx.lineTo(x, y);
      rot += step;

      x = cx + Math.cos(rot) * innerRadius;
      y = cy + Math.sin(rot) * innerRadius;
      ctx.lineTo(x, y);
      rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
  }

  drawObstacles(obstacles) {
    if (!obstacles) return;
    for (const obs of obstacles) {
      if (obs.type === 'rock') {
        this.drawRock(obs);
      } else if (obs.type === 'cannon') {
        this.drawCannonball(obs);
      } else if (obs.type === 'laser') {
        this.drawLaserBeam(obs);
      }
    }
  }

  drawRock(obs) {
    const ctx = this.ctx;
    const screenX = this.boardOriginX + (obs.x + 0.5) * this.tileSize;
    const screenY = this.boardOriginY + (obs.y + 0.5) * this.tileSize;
    const radius = this.tileSize * 0.42;

    ctx.save();
    ctx.translate(screenX, screenY);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(0, radius * 0.9, radius * 0.95, radius * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(obs.rotation || 0);

    const rockGrad = ctx.createRadialGradient(-radius * 0.3, -radius * 0.3, radius * 0.1, 0, 0, radius);
    rockGrad.addColorStop(0, '#9e8d7c');
    rockGrad.addColorStop(0.5, '#6d5d4d');
    rockGrad.addColorStop(1, '#3b3127');

    ctx.fillStyle = rockGrad;
    ctx.beginPath();
    const segments = 8;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const bump = (i % 2 === 0 ? 1 : 0.92);
      const px = Math.cos(angle) * radius * bump;
      const py = Math.sin(angle) * radius * bump;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#2b231c';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-radius * 0.4, -radius * 0.2);
    ctx.lineTo(0, 0);
    ctx.lineTo(radius * 0.35, -radius * 0.15);
    ctx.moveTo(0, 0);
    ctx.lineTo(-radius * 0.1, radius * 0.4);
    ctx.stroke();

    ctx.restore();
  }

  drawCannonball(obs) {
    const ctx = this.ctx;
    const screenX = this.boardOriginX + (obs.x + 0.5) * this.tileSize;
    const screenY = this.boardOriginY + (obs.y + 0.5) * this.tileSize;
    const radius = this.tileSize * 0.35;

    ctx.save();
    ctx.translate(screenX, screenY);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(0, radius * 0.95, radius * 0.85, radius * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    const ballGrad = ctx.createRadialGradient(-radius * 0.35, -radius * 0.35, 1, 0, 0, radius);
    ballGrad.addColorStop(0, '#ffffff');
    ballGrad.addColorStop(0.2, '#b0b5be');
    ballGrad.addColorStop(0.6, '#3a414d');
    ballGrad.addColorStop(1, '#13161c');

    ctx.fillStyle = ballGrad;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#1a1f29';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  drawLaserBeam(obs) {
    const ctx = this.ctx;
    const ox = this.boardOriginX;
    const oy = this.boardOriginY;
    const bw = this.boardWidth;
    const bh = this.boardHeight;
    const ts = this.tileSize;

    ctx.save();

    let lx = ox;
    let ly = oy;
    let lw = bw;
    let lh = bh;

    if (obs.direction === 'horizontal') {
      ly = oy + obs.index * ts;
      lh = ts;
    } else {
      lx = ox + obs.index * ts;
      lw = ts;
    }

    const maxDur = obs.maxDuration || 0.28;
    const lifeRatio = Math.max(0, Math.min(1, obs.duration / maxDur)); // 1 at start, 0 at end
    // Rapid plasma vibration
    const flicker = 0.88 + 0.12 * Math.sin(this.bgTime * 95);
    const plasmaAlpha = Math.min(1, lifeRatio * 1.4) * flicker;

    // 1. Broad outer ionizing plasma aura (Gradient perpendicular to beam)
    ctx.save();
    ctx.globalAlpha = plasmaAlpha;
    if (obs.direction === 'horizontal') {
      const grad = ctx.createLinearGradient(lx, ly, lx, ly + lh);
      grad.addColorStop(0, 'rgba(255, 0, 60, 0)');
      grad.addColorStop(0.18, 'rgba(255, 0, 75, 0.45)');
      grad.addColorStop(0.5, 'rgba(255, 20, 100, 0.78)');
      grad.addColorStop(0.82, 'rgba(255, 0, 75, 0.45)');
      grad.addColorStop(1, 'rgba(255, 0, 60, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(lx, ly, lw, lh);
    } else {
      const grad = ctx.createLinearGradient(lx, ly, lx + lw, ly);
      grad.addColorStop(0, 'rgba(255, 0, 60, 0)');
      grad.addColorStop(0.18, 'rgba(255, 0, 75, 0.45)');
      grad.addColorStop(0.5, 'rgba(255, 20, 100, 0.78)');
      grad.addColorStop(0.82, 'rgba(255, 0, 75, 0.45)');
      grad.addColorStop(1, 'rgba(255, 0, 60, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(lx, ly, lw, lh);
    }
    ctx.restore();

    // 2. High-energy Neon Crimson Core Channel (~60% tile width)
    ctx.save();
    ctx.globalAlpha = plasmaAlpha;
    ctx.fillStyle = '#ff003c';
    ctx.shadowColor = '#ff0055';
    ctx.shadowBlur = 18;
    if (obs.direction === 'horizontal') {
      const coreH = ts * 0.58;
      const coreY = ly + (ts - coreH) * 0.5;
      ctx.fillRect(lx, coreY, lw, coreH);
    } else {
      const coreW = ts * 0.58;
      const coreX = lx + (ts - coreW) * 0.5;
      ctx.fillRect(coreX, ly, coreW, lh);
    }
    ctx.restore();

    // 3. Blinding Super-Hot White Core (~26% tile width)
    ctx.save();
    ctx.globalAlpha = Math.min(1, plasmaAlpha * 1.25);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 12;
    if (obs.direction === 'horizontal') {
      const whiteH = ts * 0.26;
      const whiteY = ly + (ts - whiteH) * 0.5;
      ctx.fillRect(lx, whiteY, lw, whiteH);
    } else {
      const whiteW = ts * 0.26;
      const whiteX = lx + (ts - whiteW) * 0.5;
      ctx.fillRect(whiteX, ly, whiteW, lh);
    }
    ctx.restore();

    // 4. Electric Arc / Crackling Lightning along beam edges
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.globalAlpha = Math.min(1, plasmaAlpha * 0.95);
    ctx.beginPath();
    const arcStep = 18;
    const tSeed = this.bgTime * 70;
    if (obs.direction === 'horizontal') {
      const cy = ly + ts * 0.5;
      const spread = ts * 0.25;
      // Upper lightning arc
      for (let x = lx; x <= lx + lw; x += arcStep) {
        const jitter = (Math.sin(x * 0.28 + tSeed) * Math.cos(x * 0.16 - tSeed)) * spread;
        if (x === lx) ctx.moveTo(x, cy - spread * 0.6 + jitter * 0.4);
        else ctx.lineTo(x, cy - spread * 0.6 + jitter * 0.4);
      }
      // Lower lightning arc
      for (let x = lx; x <= lx + lw; x += arcStep) {
        const jitter = (Math.cos(x * 0.25 - tSeed) * Math.sin(x * 0.14 + tSeed)) * spread;
        if (x === lx) ctx.moveTo(x, cy + spread * 0.6 + jitter * 0.4);
        else ctx.lineTo(x, cy + spread * 0.6 + jitter * 0.4);
      }
    } else {
      const cx = lx + ts * 0.5;
      const spread = ts * 0.25;
      // Left lightning arc
      for (let y = ly; y <= ly + lh; y += arcStep) {
        const jitter = (Math.sin(y * 0.28 + tSeed) * Math.cos(y * 0.16 - tSeed)) * spread;
        if (y === ly) ctx.moveTo(cx - spread * 0.6 + jitter * 0.4, y);
        else ctx.lineTo(cx - spread * 0.6 + jitter * 0.4, y);
      }
      // Right lightning arc
      for (let y = ly; y <= ly + lh; y += arcStep) {
        const jitter = (Math.cos(y * 0.25 - tSeed) * Math.sin(y * 0.14 + tSeed)) * spread;
        if (y === ly) ctx.moveTo(cx + spread * 0.6 + jitter * 0.4, y);
        else ctx.lineTo(cx + spread * 0.6 + jitter * 0.4, y);
      }
    }
    ctx.stroke();
    ctx.restore();

    // 5. Border Impact Flares (Blazing energy at entrance and exit boundaries)
    ctx.save();
    ctx.globalAlpha = Math.min(1, plasmaAlpha * 1.1);
    const flareR = ts * 0.44;
    if (obs.direction === 'horizontal') {
      const cy = ly + ts * 0.5;
      this.drawLaserFlare(ctx, lx, cy, flareR);
      this.drawLaserFlare(ctx, lx + lw, cy, flareR);
    } else {
      const cx = lx + ts * 0.5;
      this.drawLaserFlare(ctx, cx, ly, flareR);
      this.drawLaserFlare(ctx, cx, ly + lh, flareR);
    }
    ctx.restore();

    ctx.restore();
  }

  drawLaserFlare(ctx, x, y, radius) {
    const flareGrad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    flareGrad.addColorStop(0, '#ffffff');
    flareGrad.addColorStop(0.35, '#ff0055');
    flareGrad.addColorStop(0.7, 'rgba(255, 0, 80, 0.4)');
    flareGrad.addColorStop(1, 'rgba(255, 0, 60, 0)');
    ctx.fillStyle = flareGrad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  drawPlayer(player, obstacles) {
    const ctx = this.ctx;
    let screenX = this.boardOriginX + (player.animX + 0.5) * this.tileSize;
    let screenY = this.boardOriginY + (player.animY + 0.5) * this.tileSize;

    // Recoil bounce offset (for Option B blocked recoil or Clash)
    if (player.recoilX || player.recoilY) {
      screenX += (player.recoilX || 0) * this.tileSize;
      screenY += (player.recoilY || 0) * this.tileSize;
    }

    const isStunned = Boolean((player.stunTimer && player.stunTimer > 0) || player.isStunned);
    if (isStunned) {
      // Tremble during stun
      screenX += Math.sin(this.bgTime * 45) * 1.5;
    }

    const hopElev = player.hopZ || 0;

    const isScared = player.isScared || false;
    const isDead = player.isDead || false;

    ctx.save();
    ctx.translate(screenX, screenY);

    const shadowScale = Math.max(0.4, 1 - hopElev * 0.025);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 14, 14 * shadowScale, 6 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(0, -hopElev);
    ctx.rotate(player.tiltAngle || 0);

    const headRadius = 14;
    const headY = -30;
    const bodyTopY = headY + headRadius;
    const bodyBottomY = 2;

    const isInvulnerable = Boolean(!isDead && player.invulnerableTimer && player.invulnerableTimer > 0);
    if (isInvulnerable) {
      if (Math.floor(Date.now() / 70) % 2 === 0) {
        ctx.globalAlpha = 0.35;
      }
      // Glowing shield aura ring
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -Date.now() / 45;
      ctx.beginPath();
      ctx.arc(0, -14, 25, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (isDead) {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = '#1c1c1e';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(0, headY + 12, headRadius * 1.3, headRadius * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-8, headY + 8); ctx.lineTo(-4, headY + 14);
      ctx.moveTo(-4, headY + 8); ctx.lineTo(-8, headY + 14);
      ctx.moveTo(4, headY + 8); ctx.lineTo(8, headY + 14);
      ctx.moveTo(8, headY + 8); ctx.lineTo(4, headY + 14);
      ctx.stroke();

      ctx.strokeStyle = '#1c1c1e';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(0, headY + 16); ctx.lineTo(0, bodyBottomY);
      ctx.moveTo(-18, headY + 16); ctx.lineTo(18, headY + 16);
      ctx.moveTo(-14, bodyBottomY + 6); ctx.lineTo(0, bodyBottomY); ctx.lineTo(14, bodyBottomY + 6);
      ctx.stroke();

      if (player.id && player.id >= 1) {
        const colors = ['#007aff', '#ff3b30', '#30d158', '#ff9f0a'];
        const pColor = player.color || colors[(player.id - 1) % colors.length] || '#8e8e93';
        const badgeY = headY - 14;
        ctx.fillStyle = pColor;
        drawRoundedRect(ctx, -14, badgeY, 28, 13, 6);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        drawRoundedRect(ctx, -14, badgeY, 28, 13, 6);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '900 8.5px "Fredoka", "Bungee", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`P${player.id} 💀`, 0, badgeY + 7);
      } else {
        this.drawOopsBubble(ctx, 0, headY - 26);
      }

    } else {
      ctx.strokeStyle = '#1c1c1e';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(0, bodyTopY);
      ctx.lineTo(0, bodyBottomY);
      ctx.stroke();

      const legSpread = player.isHopping ? 12 : 7;
      const legLift = player.isHopping ? 6 : 0;
      ctx.beginPath();
      ctx.moveTo(0, bodyBottomY);
      ctx.lineTo(-legSpread, bodyBottomY + 14 - legLift);
      ctx.moveTo(0, bodyBottomY);
      ctx.lineTo(legSpread, bodyBottomY + 14 - legLift);
      ctx.stroke();

      ctx.beginPath();
      if (isScared) {
        const wave = Math.sin(this.bgTime * 20) * 4;
        ctx.moveTo(-14 + wave, bodyTopY - 8);
        ctx.lineTo(-4, bodyTopY + 4);
        ctx.lineTo(0, bodyTopY + 2);
        ctx.lineTo(4, bodyTopY + 4);
        ctx.lineTo(14 - wave, bodyTopY - 8);
      } else if (player.isHopping) {
        ctx.moveTo(-12, bodyTopY + 2);
        ctx.lineTo(0, bodyTopY + 3);
        ctx.lineTo(12, bodyTopY + 10);
      } else {
        ctx.moveTo(-10, bodyTopY + 12);
        ctx.lineTo(0, bodyTopY + 4);
        ctx.lineTo(10, bodyTopY + 12);
      }
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, headY, headRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#1c1c1e';
      if (isScared) {
        ctx.beginPath();
        ctx.arc(-5, headY - 2, 2.5, 0, Math.PI * 2);
        ctx.arc(5, headY - 2, 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#1c1c1e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, headY + 5, 3.5, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(-4, headY - 1, 2, 0, Math.PI * 2);
        ctx.arc(4, headY - 1, 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#1c1c1e';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(0, headY + 2, 4.5, 0.2 * Math.PI, 0.8 * Math.PI);
        ctx.stroke();
      }

      // Multiplayer Indicator (P1 Blue / P2 Red / P3 Green / P4 Yellow)
      if (player.id >= 1 || player.color) {
        const colors = ['#007aff', '#ff3b30', '#30d158', '#ff9f0a'];
        const pColor = player.color || colors[(player.id - 1) % colors.length] || '#007aff';
        const pLabel = player.id ? `P${player.id}${player.isAi ? ' [BOT]' : ''}` : 'P';

        // Colored Headband with border
        ctx.fillStyle = pColor;
        drawRoundedRect(ctx, -headRadius + 0.5, headY - 4, headRadius * 2 - 1, 5, 2);
        ctx.fill();

        // Animated headband flapping tail
        const tailSide = (player.id % 2 === 1) ? -1 : 1;
        const wave = Math.sin(this.bgTime * 14 + (player.id || 0)) * 3;
        ctx.beginPath();
        ctx.moveTo(tailSide * (headRadius - 1), headY - 2);
        ctx.quadraticCurveTo(tailSide * (headRadius + 7), headY - 5 + wave, tailSide * (headRadius + 12), headY + wave);
        ctx.lineWidth = 3;
        ctx.strokeStyle = pColor;
        ctx.stroke();

        // Floating P1~P4 pill badge above head
        const badgeY = headY - 24;
        const badgeW = player.isAi ? 46 : 24;
        ctx.fillStyle = pColor;
        drawRoundedRect(ctx, -badgeW / 2, badgeY, badgeW, 13, 6);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        drawRoundedRect(ctx, -badgeW / 2, badgeY, badgeW, 13, 6);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '900 8.5px "Fredoka", "Bungee", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pLabel, 0, badgeY + 7);
      }

      // Stunned dizzy stars effect
      if (isStunned) {
        const starAngleBase = this.bgTime * 9;
        for (let s = 0; s < 3; s++) {
          const angle = starAngleBase + (s * Math.PI * 2) / 3;
          const sx = Math.cos(angle) * 14;
          const sy = headY - 14 + Math.sin(angle) * 4;
          ctx.fillStyle = '#ffd700';
          ctx.beginPath();
          ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Momentum / Dash indicator (flaming trail badge) - only when momentum is genuinely active!
      if (player.momentumSteps >= 2 && (player.momentumTimer > 0 || player.isHopping) && !isDead) {
        ctx.save();
        const pulse = 1 + Math.sin(this.bgTime * 14) * 0.1;
        ctx.scale(pulse, pulse);
        const dashY = headY - 38;
        ctx.fillStyle = '#ff9500';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8;
        ctx.font = '900 8px "Fredoka", "Bungee", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeText('⚡DASH', 0, dashY);
        ctx.fillText('⚡DASH', 0, dashY);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  drawOopsBubble(ctx, bx, by) {
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(-0.08);

    ctx.fillStyle = '#ff3b30';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;

    ctx.beginPath();
    const spikes = 10;
    const rOuter = 26;
    const rInner = 19;
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? rOuter : rInner;
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const px = Math.cos(a) * r * 1.5;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 16px "Fredoka", "Bungee", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('OOPS!!', 0, 1);

    ctx.restore();
  }

  drawParticles() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;

      if (p.type === 'circle') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'star') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation || 0);
        this.drawStar(ctx, 0, 0, 4, p.radius, p.radius * 0.4);
        ctx.fill();
      } else if (p.type === 'blood') {
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.radius * 1.3, p.radius * 0.8, p.rotation || 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawFloatingTexts() {
    const ctx = this.ctx;
    for (const t of this.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = t.alpha;
      ctx.translate(t.x, t.y);
      ctx.scale(t.scale, t.scale);

      ctx.font = '900 17px "Fredoka", "Bungee", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.strokeStyle = '#1c1c1e';
      ctx.lineWidth = 4;
      ctx.strokeText(t.text, 0, 0);

      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);

      ctx.restore();
    }
  }
}

window.GameRenderer = GameRenderer;
