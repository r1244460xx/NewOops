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

    // 6. Player (Mr. Oops / 1v1 Versus Players)
    if (player) {
      if (Array.isArray(player)) {
        // Zero-allocation depth sorting for 2 players
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
          for (let i = 0; i < player.length; i++) {
            this.drawPlayer(player[i], obstacles);
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
    } else if (theme === 'versus') {
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
    const ctx = this.ctx;
    const ox = this.boardOriginX;
    const oy = this.boardOriginY;
    const bw = this.boardWidth;
    const bh = this.boardHeight;
    const ts = this.tileSize;

    for (const w of warnings) {
      const pulse = 0.85 + 0.3 * Math.sin(w.timer * 22);
      const isLaser = w.type === 'laser';

      ctx.save();

      // Laser warning targeting line
      if (isLaser) {
        ctx.save();
        ctx.fillStyle = `rgba(255, 42, 109, ${0.18 + 0.16 * Math.sin(w.timer * 25)})`;
        ctx.strokeStyle = `rgba(255, 75, 120, ${0.5 + 0.4 * Math.sin(w.timer * 25)})`;
        ctx.lineWidth = 2;

        if (w.direction === 'horizontal') {
          const ly = oy + w.index * ts;
          ctx.fillRect(ox, ly, bw, ts);
          ctx.strokeRect(ox, ly + 2, bw, ts - 4);
        } else {
          const lx = ox + w.index * ts;
          ctx.fillRect(lx, oy, ts, bh);
          ctx.strokeRect(lx + 2, oy, ts - 4, bh);
        }
        ctx.restore();
      }

      // Warning badge position
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

      ctx.translate(badgeX, badgeY);
      ctx.scale(pulse, pulse);

      ctx.fillStyle = isLaser ? '#ff2a6d' : '#ff3b30';
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

      ctx.restore();
    }
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

    ctx.fillStyle = 'rgba(255, 42, 109, 0.55)';
    ctx.fillRect(lx, ly, lw, lh);

    ctx.fillStyle = '#ff3b30';
    if (obs.direction === 'horizontal') {
      ctx.fillRect(lx, ly + ts * 0.2, lw, ts * 0.6);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(lx, ly + ts * 0.35, lw, ts * 0.3);
    } else {
      ctx.fillRect(lx + ts * 0.2, ly, ts * 0.6, lh);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(lx + ts * 0.35, ly, ts * 0.3, lh);
    }

    ctx.restore();
  }

  drawPlayer(player, obstacles) {
    const ctx = this.ctx;
    const screenX = this.boardOriginX + (player.animX + 0.5) * this.tileSize;
    const screenY = this.boardOriginY + (player.animY + 0.5) * this.tileSize;
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

    if (isDead) {
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

      this.drawOopsBubble(ctx, 0, headY - 26);

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

      // Versus Mode: Headband & Floating Player Indicator (P1 Blue / P2 Red)
      if (player.id === 1 || player.id === 2 || player.color) {
        const pColor = player.id === 1 ? '#007aff' : (player.id === 2 ? '#ff3b30' : (player.color || '#34c759'));
        const pLabel = player.id === 1 ? 'P1' : (player.id === 2 ? 'P2' : 'P');

        // Colored Headband with border
        ctx.fillStyle = pColor;
        drawRoundedRect(ctx, -headRadius + 0.5, headY - 4, headRadius * 2 - 1, 5, 2);
        ctx.fill();

        // Animated headband flapping tail
        const tailSide = player.id === 1 ? -1 : 1;
        const wave = Math.sin(this.bgTime * 14) * 3;
        ctx.beginPath();
        ctx.moveTo(tailSide * (headRadius - 1), headY - 2);
        ctx.quadraticCurveTo(tailSide * (headRadius + 7), headY - 5 + wave, tailSide * (headRadius + 12), headY + wave);
        ctx.lineWidth = 3;
        ctx.strokeStyle = pColor;
        ctx.stroke();

        // Floating P1/P2 pill badge above head
        const badgeY = headY - 24;
        ctx.fillStyle = pColor;
        drawRoundedRect(ctx, -12, badgeY, 24, 13, 6);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        drawRoundedRect(ctx, -12, badgeY, 24, 13, 6);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '900 9px "Fredoka", "Bungee", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pLabel, 0, badgeY + 7);
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
