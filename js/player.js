// ╔══════════════════════════════════════════════════════════════╗
// ║  player.js  –  Particle system & Player entity              ║
// ║  Depends on: main.js globals (C, GW, GH, PLAYER_SPD,       ║
// ║    keys, mousePos, chips, chipsGot, score, EXIT,            ║
// ║    dist, moveWithCollision, setGameState)                   ║
// ╚══════════════════════════════════════════════════════════════╝
'use strict';


// ╔══════════════════════════════════════════════════════════════╗
// ║  PARTICLE SYSTEM                                            ║
// ╚══════════════════════════════════════════════════════════════╝

class Particle {
  /**
   * @param {number} x        Spawn X
   * @param {number} y        Spawn Y
   * @param {number} vx       Horizontal velocity (px/s)
   * @param {number} vy       Vertical velocity (px/s)
   * @param {string} color    CSS color string
   * @param {number} life     Lifetime in seconds
   * @param {number} size     Radius in pixels
   */
  constructor(x, y, vx, vy, color, life, size) {
    Object.assign(this, { x, y, vx, vy, color, life, maxLife: life, size });
  }

  update(dt) {
    this.x    += this.vx * dt;
    this.y    += this.vy * dt;
    this.vx   *= 0.92;
    this.vy   *= 0.92;
    this.life -= dt;
  }

  draw(ctx) {
    const alpha = Math.max(0, this.life / this.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * alpha, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  get dead() { return this.life <= 0; }
}

// Global particle pool – updated and drawn by main.js
let particles = [];

/**
 * Emit a radial burst of particles at (x, y).
 * @param {number} x
 * @param {number} y
 * @param {string} color
 * @param {number} [n=10]        Particle count
 * @param {number} [speedMul=1]  Speed multiplier
 */
function burst(x, y, color, n = 10, speedMul = 1) {
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (50 + Math.random() * 110) * speedMul;
    particles.push(new Particle(
      x, y,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      color,
      0.35 + Math.random() * 0.5,
      1.5  + Math.random() * 3
    ));
  }
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  PLAYER                                                     ║
// ╚══════════════════════════════════════════════════════════════╝

class Player {
  /**
   * @param {number} x  Spawn X
   * @param {number} y  Spawn Y
   */
  constructor(x, y) {
    this.x      = x;
    this.y      = y;
    this.r      = 10;       // collision radius
    this.hp     = 100;
    this.maxHp  = 100;
    this.angle    = 0;
    this.pulse    = 0;
    this.hitTimer = 0;
    this.alive    = true;
    this.hiding   = false; // true when inside a hiding spot
  }

  update(dt) {
    if (!this.alive) return;

    // ── Movement (WASD / Arrow keys) ────────────────────────────
    let dx = 0, dy = 0;
    if (keys['KeyW']  || keys['ArrowUp'])    dy -= 1;
    if (keys['KeyS']  || keys['ArrowDown'])  dy += 1;
    if (keys['KeyA']  || keys['ArrowLeft'])  dx -= 1;
    if (keys['KeyD']  || keys['ArrowRight']) dx += 1;

    // Normalize diagonal movement
    const len = Math.hypot(dx, dy);
    if (len) { dx /= len; dy /= len; }

    moveWithCollision(this, dx, dy, PLAYER_SPD, dt);

    // Clamp inside world bounds
    this.x = Math.max(this.r + 12, Math.min(GW - this.r - 12, this.x));
    this.y = Math.max(this.r + 12, Math.min(GH - this.r - 12, this.y));

    // ── Aim towards mouse ────────────────────────────────────────
    this.angle    = Math.atan2(mousePos.y - this.y, mousePos.x - this.x);
    this.pulse   += dt * 3;
    this.hitTimer = Math.max(0, this.hitTimer - dt);

    // ── Hiding spot detection ────────────────────────────────────
    this.hiding = HIDING_SPOTS.some(
      s => this.x >= s.x && this.x <= s.x + s.w &&
           this.y >= s.y && this.y <= s.y + s.h
    );
    chips.forEach(chip => {
      if (!chip.collected && dist(this, chip) < 22) {
        chip.collected = true;
        chipsGot++;
        score += 100;
        burst(chip.x, chip.y, C.chipFill, 18);
        // Custom event: chipCollected
        window.dispatchEvent(new CustomEvent('chipCollected', { detail: chip }));
      }
    });

    // ── Exit detection ──────────────────────────────────────────
    if (chipsGot >= chips.length && dist(this, EXIT) < EXIT.r + this.r) {
      score += 300;
      burst(this.x, this.y, C.exit, 30);
      if (currentLevel < LEVELS.length) {
        setGameState('LEVEL_CLEAR');
      } else {
        setGameState('WIN');
      }
    }
  }

  /**
   * Apply damage to the player.
   * @param {number} dmg  Damage amount
   */
  hit(dmg) {
    if (!this.alive) return;
    this.hp      -= dmg;
    this.hitTimer = 0.3;
    burst(this.x, this.y, '#ff4444', 8, 0.6);

    if (this.hp <= 0) {
      this.hp    = 0;
      this.alive = false;
      burst(this.x, this.y, '#ff0000', 28);
      setGameState('GAMEOVER');
    }
  }

  draw(ctx) {
    const glow  = Math.sin(this.pulse) * 0.35 + 0.65;
    const isHit = this.hitTimer > 0;

    // When hidden and no guard is chasing, render semi-transparent
    const alpha = this.hiding ? 0.35 : 1.0;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowBlur  = 22 * glow;
    ctx.shadowColor = C.playerShadow;

    // Outer ring
    ctx.strokeStyle = isHit ? '#ff8888' : C.player;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.stroke();

    // Fill
    ctx.fillStyle = isHit ? 'rgba(255,80,80,0.35)' : 'rgba(0,229,255,0.25)';
    ctx.fill();

    // Direction indicator
    ctx.strokeStyle = isHit ? '#ff8888' : C.player;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(
      this.x + Math.cos(this.angle) * (this.r + 8),
      this.y + Math.sin(this.angle) * (this.r + 8)
    );
    ctx.stroke();
    ctx.restore();

    // Shield ring while hiding (always shown when in a crate)
    if (this.hiding) {
      const shieldPulse = Math.sin(this.pulse * 1.5) * 0.4 + 0.6;
      ctx.save();
      ctx.globalAlpha = shieldPulse * 0.7;
      ctx.strokeStyle = '#00ffcc';
      ctx.lineWidth   = 1.5;
      ctx.shadowBlur  = 10;
      ctx.shadowColor = '#00ffcc';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
}
