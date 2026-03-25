// ╔══════════════════════════════════════════════════════════════╗
// ║  enemy.js  –  Guard entity with FSM-controlled AI           ║
// ║  Depends on: fsm.js (FSM class)                             ║
// ║             main.js globals (C, WALLS, SIGHT_RANGE,         ║
// ║               FOV_ANGLE, ATTACK_DIST, ATK_DMG, ATK_CD,     ║
// ║               SPD_PATROL, SPD_CHASE, SPD_SEARCH,            ║
// ║               dist, hasLOS, moveWithCollision)              ║
// ╚══════════════════════════════════════════════════════════════╝
'use strict';


// ╔══════════════════════════════════════════════════════════════╗
// ║  GUARD                                                      ║
// ║                                                             ║
// ║  FSM States:                                                ║
// ║    PATROL  → walks waypoint loop                            ║
// ║    ALERT   → freezes, "!" pops up (0.8 s)                  ║
// ║    CHASE   → sprints toward player                          ║
// ║    ATTACK  → strikes player at close range                  ║
// ║    SEARCH  → moves to last known player position            ║
// ║    RETURN  → walks back to first waypoint                   ║
// ║    HUNT    → global hunt; omniscient, max speed, no FOV     ║
// ║              (triggered when alert level hits 100 %)        ║
// ╚══════════════════════════════════════════════════════════════╝

class Guard {
  /**
   * @param {{ id:number, x:number, y:number, wp:Array<{x,y}> }} def
   */
  constructor(def) {
    this.id    = def.id;
    this.x     = def.x;
    this.y     = def.y;
    this.r     = 12;          // collision radius
    this.angle = 0;           // facing direction (radians)
    this.atkCD = 0;           // attack cooldown timer (seconds)

    this.lastKnown = null;    // last known player position
    this.flashT    = 0;       // alert-ring flash timer
    this.exclT     = 0;       // "!" exclamation timer

    // ── Random-wander patrol state ───────────────────────────────
    this._wanderTarget    = null;   // current patrol destination {x, y}
    this._wanderIdleT     = 0;      // seconds to idle before picking next target
    this._returnTarget    = null;   // current RETURN destination (normally home, can repath)
    this._homeX           = def.x;  // spawn X – used as RETURN target
    this._homeY           = def.y;  // spawn Y

    // ── A* navigation state ──────────────────────────────────────
    this._navPath         = [];     // current string-pulled waypoint list
    this._navWpIdx        = 0;      // index of the waypoint we're heading to
    this._navGoal         = null;   // goal {x,y} we last computed a path for
    this._navRecomputeDist = 40;    // recompute path if goal drifted > this (px)

    // ── Movement / wall-avoidance state ─────────────────────────
    this._stuckTimer       = 0;
    this._prevPos          = null;
    this._wallBounceCount  = 0;
    this._steerLockedAngle = null;
    this._steerLockTimer   = 0;
    this._targetAngle      = 0;

    // ── Player velocity estimator ────────────────────────────────
    this._prevPlayerPos = null;
    this._playerVel     = { x: 0, y: 0 };

    // ── Neural Network brain (survives game restarts) ────────────
    this.brain = new GuardBrain(def.id);

    // ── Build FSM ────────────────────────────────────────────────
    this.fsm = new FSM('PATROL');
    this._buildFSM();
  }

  // ── FSM construction ──────────────────────────────────────────
  _buildFSM() {
    const f = this.fsm;
    const g = this;

    // ── HUNT transitions (highest priority – checked first) ──────

    // Any non-HUNT, non-ATTACK state → HUNT : global alarm hit 100 %
    f.addTransition(
      ['PATROL', 'ALERT', 'CHASE', 'SEARCH', 'RETURN'],
      'HUNT',
      ctx => ctx.huntMode
    );

    // ATTACK → HUNT : player backs away while still hunting
    f.addTransition('ATTACK', 'HUNT',
      ctx => ctx.huntMode && ctx.d >= ATTACK_DIST + 14);

    // HUNT → ATTACK : close enough to strike
    f.addTransition('HUNT', 'ATTACK',
      ctx => ctx.d < ATTACK_DIST);

    // HUNT → SEARCH : hunt mode ended — save last known position and investigate
    f.addTransition('HUNT', 'SEARCH',
      ctx => !ctx.huntMode,
      ctx => { g.lastKnown = ctx.pp ? { ...ctx.pp } : g.lastKnown; });

    // ── Normal transitions ────────────────────────────────────────

    // PATROL → ALERT : player steps into FOV + line of sight
    f.addTransition('PATROL', 'ALERT',
      ctx => !ctx.huntMode && ctx.see);

    // ALERT → CHASE : 0.8 s reaction delay
    f.addTransition('ALERT', 'CHASE',
      (ctx, t) => t > 0.8,
      () => { g.exclT = 0; });

    // CHASE → ATTACK : player within strike range
    f.addTransition('CHASE', 'ATTACK',
      ctx => ctx.d < ATTACK_DIST);

    // ATTACK → CHASE : player backed away (normal mode only)
    f.addTransition('ATTACK', 'CHASE',
      ctx => !ctx.huntMode && ctx.d >= ATTACK_DIST + 14);

    // CHASE / ATTACK → SEARCH : visual contact lost for 1.5 s (normal mode only)
    f.addTransition(['CHASE', 'ATTACK'], 'SEARCH',
      (ctx, t) => !ctx.huntMode && !ctx.see && t > 1.5,
      ctx => { g.lastKnown = ctx.pp ? { ...ctx.pp } : g.lastKnown; });

    // SEARCH → RETURN : searched area for 4.5 s (only when not hunting)
    f.addTransition('SEARCH', 'RETURN',
      (ctx, t) => !ctx.huntMode && t > 4.5,
      () => { g.lastKnown = null; });

    // RETURN → PATROL : arrived back at home position (only when not hunting)
    f.addTransition('RETURN', 'PATROL',
      ctx => !ctx.huntMode && ctx.nearHome);

    // SEARCH / RETURN / PATROL → ALERT : spotted player (normal mode only)
    f.addTransition(['SEARCH', 'RETURN', 'PATROL'], 'ALERT',
      ctx => !ctx.huntMode && ctx.see,
      () => { g.exclT = 1.2; g.flashT = 0.15; });
  }

  // ── Per-frame update ─────────────────────────────────────────
  update(dt, player) {
    // Tick timers
    if (this.atkCD  > 0) this.atkCD  -= dt;
    if (this.flashT > 0) this.flashT -= dt;
    if (this.exclT  > 0) this.exclT  -= dt;

    // ── Smooth turn: interpolate this.angle toward _targetAngle ──
    // State-dependent turn speed: faster when chasing/hunting, slower on patrol.
    const state0 = this.fsm.state;
    const turnSpd = (state0 === 'CHASE' || state0 === 'HUNT' || state0 === 'ATTACK')
      ? TURN_SPEED_FAST : TURN_SPEED_SLOW;
    let angleDiff = this._targetAngle - this.angle;
    // Normalise to [-π, π] to always rotate the short way
    while (angleDiff >  Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    const maxStep = turnSpd * dt;
    this.angle += Math.abs(angleDiff) <= maxStep
      ? angleDiff
      : Math.sign(angleDiff) * maxStep;

    // ── Estimate player velocity (EMA) ───────────────────────────
    if (player.alive) {
      if (this._prevPlayerPos) {
        const rawVx = (player.x - this._prevPlayerPos.x) / dt;
        const rawVy = (player.y - this._prevPlayerPos.y) / dt;
        this._playerVel.x = 0.65 * this._playerVel.x + 0.35 * rawVx;
        this._playerVel.y = 0.65 * this._playerVel.y + 0.35 * rawVy;
      }
      this._prevPlayerPos = { x: player.x, y: player.y };
    }

    // Build context for FSM condition functions
    const d = dist(this, player);

    // A guard can only spot a hiding player if it is ALREADY chasing/attacking them.
    // PATROL, ALERT, SEARCH, RETURN, and HUNT (omniscient) are all blocked by hiding.
    const activelyChasing = this.fsm.state === 'CHASE' || this.fsm.state === 'ATTACK';
    const hidden = player.hiding && !activelyChasing;

    const see = !hidden && (huntMode
      ? player.alive
      : d < SIGHT_RANGE &&
        this._inFOV(player) &&
        hasLOS(this, player) &&
        player.alive);

    const fsmCtx = {
      see,
      d,
      huntMode,
      pp:       player.alive ? { x: player.x, y: player.y } : null,
      nearHome: Math.hypot(this.x - this._homeX, this.y - this._homeY) < 22,
    };

    // Track last known player position while visible
    if (see) {
      this.lastKnown = { x: player.x, y: player.y };
      if (this.fsm.state === 'PATROL') this.exclT = 1.2;
    }

    // ── Neural Network: observe + train ──────────────────────────
    // NN learns player movement for heatmap-guided patrol,
    // but A* always routes to the real player position (not an
    // NN-predicted intercept) so walls are correctly avoided.
    if (see || huntMode) this.brain.observe(this, player, this._playerVel);
    this.brain.maybeTrain(dt);

    // Advance FSM; reset stuck state on any state change
    const prevState = this.fsm.state;
    this.fsm.update(dt, fsmCtx);
    if (this.fsm.state !== prevState) this._resetStuck();

    // Execute per-state behavior
    switch (this.fsm.state) {
      case 'PATROL':
        this._doPatrol(dt);
        break;

      case 'ALERT':
        this._targetAngle = Math.atan2(player.y - this.y, player.x - this.x);
        this.flashT = 0.12;
        break;

      case 'CHASE':
        // A* routes to the actual player position so walls are never ignored.
        // recomputeDist=18 keeps the path fresh as the player moves.
        this._navigate(player.x, player.y, SPD_CHASE, dt, 18);
        break;

      case 'HUNT':
        if (player.alive) {
          this.lastKnown = { x: player.x, y: player.y };
          // Same as CHASE – always path to real player, not an NN estimate.
          this._navigate(player.x, player.y, SPD_HUNT, dt, 18);
        }
        break;

      case 'ATTACK':
        this._targetAngle = Math.atan2(player.y - this.y, player.x - this.x);
        if (this.atkCD <= 0) {
          player.hit(ATK_DMG);
          this.atkCD = ATK_CD;
        }
        break;

      case 'SEARCH':
        if (this.lastKnown && dist(this, this.lastKnown) > 10)
          this._navigate(this.lastKnown.x, this.lastKnown.y, SPD_SEARCH, dt, 80);
        break;

      case 'RETURN': {
        if (!this._returnTarget) {
          this._returnTarget    = { x: this._homeX, y: this._homeY };
          this._wallBounceCount = 0;
        }
        if (this._wallBounceCount >= BOUNCE_REPATH_LIMIT) {
          this._wallBounceCount = 0;
          const brainPt = this.brain.pickHeatTarget(this, this.lastKnown, this._playerVel, 55);
          if (brainPt) {
            this._returnTarget = brainPt;
            this._navGoal      = null;
          } else {
            const cell = getNavGrid().randomOpenCell(this._homeX, this._homeY, 60);
            this._returnTarget = { x: cell.x, y: cell.y };
            this._navGoal      = null;
          }
        }
        this._navigate(this._returnTarget.x, this._returnTarget.y, SPD_SEARCH, dt, 80);
        break;
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  /** Returns true if target t is within the guard's field of view. */
  _inFOV(t) {
    const a = Math.atan2(t.y - this.y, t.x - this.x);
    let delta = a - this.angle;
    // Normalise to [-π, π]
    while (delta >  Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return Math.abs(delta) < FOV_ANGLE / 2;
  }

  /**
   * Random-wander patrol using A* navigation.
   * Picks random open cells via NavGrid.  Repaths if stuck
   * more than BOUNCE_REPATH_LIMIT times.
   */
  _doPatrol(dt) {
    // Force repath if stuck too many times toward the current target
    if (this._wallBounceCount >= BOUNCE_REPATH_LIMIT) {
      this._wanderTarget    = null;
      this._navGoal         = null;
      this._wallBounceCount = 0;
      this._wanderIdleT     = 0;
    }

    // Idle pause after arriving at a waypoint
    if (this._wanderIdleT > 0) {
      this._wanderIdleT -= dt;
      return;
    }

    // Pick a new target when we have none or have just arrived
    if (!this._wanderTarget || dist(this, this._wanderTarget) < 16) {
      this._wallBounceCount = 0;
      this._navGoal         = null;              // force fresh A* for new target
      this._wanderTarget    = this._pickWanderTarget();
      this._wanderIdleT     = 0.5 + Math.random() * 1.2; // idle BEFORE moving
      return;                                    // start moving next frame
    }

    this._navigate(this._wanderTarget.x, this._wanderTarget.y, SPD_PATROL, dt, 80);
  }

  _pickWanderTarget() {
    // Brain-guided: heatmap → NN prediction
    const brainPt = this.brain.pickHeatTarget(this, this.lastKnown, this._playerVel);
    if (brainPt) return brainPt;
    // Fallback: random open nav cell
    const cell = getNavGrid().randomOpenCell(this._homeX, this._homeY, 80);
    return { x: cell.x, y: cell.y, source: 'random' };
  }

  /**
   * High-level navigate: run A* to (tx,ty) then follow the waypoint path.
   * The guard moves toward the NEXT WAYPOINT (not directly to the goal),
   * so it routes around walls.  The low-level _moveTo handles corner
   * polish for the last few pixels of each waypoint segment.
   *
   * @param {number} tx              Goal X (world)
   * @param {number} ty              Goal Y (world)
   * @param {number} spd             Movement speed (px/s)
   * @param {number} dt              Delta time (s)
   * @param {number} [recomputeDist] Recompute path when goal drifts > this (px)
   */
  _navigate(tx, ty, spd, dt, recomputeDist = 50) {
    // ── Decide if we need a new path ──────────────────────────────
    const goalDrifted = !this._navGoal ||
      Math.hypot(tx - this._navGoal.x, ty - this._navGoal.y) > recomputeDist;

    if (goalDrifted || this._navPath.length === 0) {
      this._navPath  = getNavGrid().findPath(this.x, this.y, tx, ty);
      this._navGoal  = { x: tx, y: ty };
      this._navWpIdx = 0;
    }

    // ── Follow path waypoints ─────────────────────────────────────
    if (this._navPath.length === 0) {
      // No path found (unreachable) – fall back to direct move
      this._moveTo(tx, ty, spd, dt);
      return;
    }

    // Advance past waypoints we've already reached
    while (
      this._navWpIdx < this._navPath.length - 1 &&
      Math.hypot(this.x - this._navPath[this._navWpIdx].x,
                 this.y - this._navPath[this._navWpIdx].y) < 14
    ) {
      this._navWpIdx++;
    }

    const wp = this._navPath[this._navWpIdx];
    this._moveTo(wp.x, wp.y, spd, dt);
  }

  /**
   *
   * Uses a commit-and-hold wall avoidance system:
   *   1. Cast a direct ray toward the target (and two narrow flanking rays).
   *   2. If the path is CLEAR → move straight, clear any lock.
   *   3. If BLOCKED → sweep 24 candidate angles, score each by clear distance
   *      weighted toward the goal, pick the best, lock onto it.
   *   4. During a lock hold → keep using the locked angle, no re-evaluation.
   *   5. Stuck detection increments _wallBounceCount for repath if the guard
   *      truly hasn't moved (e.g. trapped in a corner the sweep can't escape).
   */
  _moveTo(tx, ty, spd, dt) {
    const d = Math.hypot(tx - this.x, ty - this.y);
    if (d < 2) {
      this._stuckTimer      = 0;
      this._prevPos         = null;
      this._steerLockTimer  = 0;
      this._steerLockedAngle = null;
      return;
    }

    const baseAngle = Math.atan2(ty - this.y, tx - this.x);

    // ── Tick the lock hold timer ──────────────────────────────────
    if (this._steerLockTimer > 0) {
      this._steerLockTimer -= dt;
      if (this._steerLockTimer <= 0) this._steerLockedAngle = null;
    }

    // ── Determine movement angle ──────────────────────────────────
    let finalAngle;

    if (this._steerLockedAngle !== null) {
      // Currently committed to a detour direction – keep it
      finalAngle = this._steerLockedAngle;
    } else {
      // Check if the direct path is clear
      if (this._pathClear(baseAngle)) {
        finalAngle = baseAngle;
      } else {
        // Path blocked – find and commit to best clear angle
        finalAngle = this._findClearAngle(baseAngle);
        this._steerLockedAngle = finalAngle;
        this._steerLockTimer   = STEER_LOCK_DURATION;
        this._wallBounceCount  = (this._wallBounceCount || 0) + 1;
      }
    }

    this._targetAngle = finalAngle;

    // ── Stuck detection (for repath trigger) ─────────────────────
    this._stuckTimer = (this._stuckTimer || 0) + dt;
    if (!this._prevPos) this._prevPos = { x: this.x, y: this.y };
    if (this._stuckTimer >= 0.5) {
      const moved = Math.hypot(this.x - this._prevPos.x, this.y - this._prevPos.y);
      if (moved < spd * this._stuckTimer * 0.12) {
        // Truly stuck even after steering – force a new lock toward open space
        this._steerLockedAngle = this._findClearAngle(baseAngle + Math.PI * 0.5);
        this._steerLockTimer   = STEER_LOCK_DURATION * 1.5;
        this._wallBounceCount  = (this._wallBounceCount || 0) + 1;
      }
      this._prevPos    = { x: this.x, y: this.y };
      this._stuckTimer = 0;
    }

    // Move using the SMOOTHED angle (this.angle), not the target.
    // This means the guard physically travels in the direction it's
    // visually facing, preventing the body sliding sideways.
    moveWithCollision(this, Math.cos(this.angle), Math.sin(this.angle), spd, dt);
  }

  /**
   * Cast the direct-path probe: one centre ray + two narrow flanking rays
   * (±12°) at LOOK_AHEAD distance.  Returns true only if ALL three are clear.
   * The flanking rays catch wall edges that the centre ray would miss.
   */
  _pathClear(angle) {
    const LOOK_AHEAD = STEER_PROBE_DIST;
    const FLANK      = Math.PI / 15; // 12°
    for (const offset of [0, -FLANK, FLANK]) {
      const a  = angle + offset;
      const ex = this.x + Math.cos(a) * LOOK_AHEAD;
      const ey = this.y + Math.sin(a) * LOOK_AHEAD;
      for (const w of WALLS) {
        if (rayHitT({ x: this.x, y: this.y }, { x: ex, y: ey }, w) !== null) return false;
      }
    }
    return true;
  }

  /**
   * Sweep STEER_CANDIDATES evenly-spaced angles across a full circle,
   * score each by (clearDist − goalBias), and return the best.
   *
   * clearDist: how far the ray travels before hitting a wall (0–LOOK_AHEAD).
   * goalBias : bonus for angles that point toward the target (0–1 × GOAL_WEIGHT).
   *
   * This guarantees we pick a direction that is (a) actually open and
   * (b) still broadly aimed at the goal, avoiding arbitrary U-turns.
   */
  _findClearAngle(preferAngle) {
    const LOOK     = STEER_PROBE_DIST;
    const N        = STEER_CANDIDATES;
    let bestScore  = -Infinity;
    let bestAngle  = preferAngle;

    for (let i = 0; i < N; i++) {
      const a  = (i / N) * Math.PI * 2;
      const ex = this.x + Math.cos(a) * LOOK;
      const ey = this.y + Math.sin(a) * LOOK;

      // Distance to nearest wall along this ray
      let minT = 1.0; // treat 1.0 as fully clear
      for (const w of WALLS) {
        const t = rayHitT({ x: this.x, y: this.y }, { x: ex, y: ey }, w);
        if (t !== null && t < minT) minT = t;
      }
      const clearDist = minT * LOOK; // 0 = blocked immediately, LOOK = fully clear

      // Angular closeness to the preferred angle (0 = same, π = opposite)
      let angDiff = Math.abs(a - preferAngle) % (Math.PI * 2);
      if (angDiff > Math.PI) angDiff = Math.PI * 2 - angDiff;
      const goalBias = (1 - angDiff / Math.PI) * STEER_GOAL_WEIGHT;

      const score = clearDist + goalBias;
      if (score > bestScore) { bestScore = score; bestAngle = a; }
    }

    return bestAngle;
  }

  /** Reset movement and wander state (called on every FSM state transition). */
  _resetStuck() {
    this._stuckTimer       = 0;
    this._prevPos          = null;
    this._wallBounceCount  = 0;
    this._steerLockedAngle = null;
    this._steerLockTimer   = 0;
    // Clear nav path so the new state starts with a fresh route
    this._navPath          = [];
    this._navGoal          = null;
    this._navWpIdx         = 0;
    this._wanderTarget     = null;
    this._wanderIdleT      = 0;
    this._returnTarget     = null;
  }

  // ── Rendering ─────────────────────────────────────────────────
  draw(ctx) {
    const state = this.fsm.state;
    const col   = C.guard[state] || '#ffffff';

    // ── Long-range wall vision rays ───────────────────────────────
    // Three rays (centre + ±12°) of VISION_RAY_LEN px so guards
    // "see" walls across entire corridors.
    {
      const FLANK = Math.PI / 15; // 12°
      for (const offset of [0, -FLANK, FLANK]) {
        const a  = this.angle + offset;
        const ex = this.x + Math.cos(a) * VISION_RAY_LEN;
        const ey = this.y + Math.sin(a) * VISION_RAY_LEN;

        let minT = 1.0;
        for (const w of WALLS) {
          const t = rayHitT({ x: this.x, y: this.y }, { x: ex, y: ey }, w);
          if (t !== null && t < minT) minT = t;
        }
        const hit  = minT < 1.0;
        const hitX = this.x + Math.cos(a) * minT * VISION_RAY_LEN;
        const hitY = this.y + Math.sin(a) * minT * VISION_RAY_LEN;

        ctx.save();
        ctx.globalAlpha = hit ? 0.40 : 0.10;
        ctx.strokeStyle = hit ? '#ff6633' : 'rgba(180,210,255,0.5)';
        ctx.lineWidth   = hit ? 1.0 : 0.5;
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(hitX, hitY);
        if (hit) {
          ctx.moveTo(hitX - 3, hitY); ctx.lineTo(hitX + 3, hitY);
          ctx.moveTo(hitX, hitY - 3); ctx.lineTo(hitX, hitY + 3);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    // ── A* nav path ───────────────────────────────────────────────
    if (this._navPath.length > 1) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = col;
      ctx.lineWidth   = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      for (let i = this._navWpIdx; i < this._navPath.length; i++) {
        ctx.lineTo(this._navPath[i].x, this._navPath[i].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // Small dots at each remaining waypoint
      for (let i = this._navWpIdx; i < this._navPath.length; i++) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle   = col;
        ctx.beginPath();
        ctx.arc(this._navPath[i].x, this._navPath[i].y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // ── Committed detour direction (from close-range steer) ───────
    if (this._steerLockedAngle !== null && this._steerLockTimer > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this._steerLockTimer / STEER_LOCK_DURATION) * 0.45;
      ctx.strokeStyle = '#00eeff';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(
        this.x + Math.cos(this._steerLockedAngle) * STEER_PROBE_DIST * 1.2,
        this.y + Math.sin(this._steerLockedAngle) * STEER_PROBE_DIST * 1.2
      );
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── Heatmap overlay (PATROL only) ────────────────────────────
    if (state === 'PATROL') {
      const topCells = this.brain.heatmap.topCells(6);
      const maxHeat  = topCells.length ? topCells[0].heat : 1;
      topCells.forEach(cell => {
        const intensity = Math.min(1, cell.heat / maxHeat);
        ctx.save();
        ctx.globalAlpha = intensity * 0.18;
        ctx.fillStyle   = '#ff4444';
        ctx.fillRect(cell.x - HEAT_CELL/2, cell.y - HEAT_CELL/2, HEAT_CELL, HEAT_CELL);
        ctx.restore();
      });
    }

    // ── NN intercept dot (shown during PATROL heat-targeting) ────
    const pred = this.brain.prediction;
    const conf = this.brain.confidence;
    if (pred && conf > 0.05 && state === 'PATROL') {
      ctx.save();
      ctx.globalAlpha = conf * 0.8;
      ctx.strokeStyle = '#ff88ff';
      ctx.lineWidth   = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(pred.x, pred.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur  = 8;
      ctx.shadowColor = '#ff88ff';
      ctx.strokeStyle = '#ff88ff';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(pred.x,     pred.y - 5);
      ctx.lineTo(pred.x + 5, pred.y    );
      ctx.lineTo(pred.x,     pred.y + 5);
      ctx.lineTo(pred.x - 5, pred.y    );
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // ── FOV / awareness zone ─────────────────────────────────────
    ctx.save();
    if (state === 'HUNT') {
      // Full circle: guards are omniscient in hunt mode
      ctx.beginPath();
      ctx.arc(this.x, this.y, SIGHT_RANGE, 0, Math.PI * 2);
      ctx.fillStyle = C.fov.HUNT;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.arc(this.x, this.y, SIGHT_RANGE,
              this.angle - FOV_ANGLE / 2,
              this.angle + FOV_ANGLE / 2);
      ctx.closePath();
      ctx.fillStyle = C.fov[state] || 'rgba(255,255,255,0.04)';
      ctx.fill();
    }
    ctx.restore();

    // ── NN confidence ring ────────────────────────────────────────
    if (conf > 0.05) {
      ctx.save();
      ctx.strokeStyle = '#cc44cc';
      ctx.lineWidth   = 1.5;
      ctx.globalAlpha = conf * 0.55;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ── Hunt mode outer aura ──────────────────────────────────────
    if (state === 'HUNT') {
      const pulse = Math.sin(Date.now() * 0.007) * 0.5 + 0.5;
      ctx.save();
      ctx.strokeStyle = C.guard.HUNT;
      ctx.lineWidth   = 2.5;
      ctx.globalAlpha = 0.35 + pulse * 0.45;
      ctx.shadowBlur  = 18;
      ctx.shadowColor = C.guard.HUNT;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 10 + pulse * 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ── Alert pulse ring ───────────────────────────────────────────
    if (state === 'ALERT' || this.flashT > 0) {
      ctx.save();
      ctx.strokeStyle = '#f0f000';
      ctx.lineWidth   = 2;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ── Attack range ring ──────────────────────────────────────────
    if (state === 'ATTACK') {
      ctx.save();
      ctx.strokeStyle = '#ff1111';
      ctx.lineWidth   = 3;
      ctx.globalAlpha = 0.5 + Math.sin(Date.now() * 0.01) * 0.3;
      ctx.beginPath();
      ctx.arc(this.x, this.y, ATTACK_DIST, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ── Guard body ─────────────────────────────────────────────────
    ctx.save();
    ctx.shadowBlur  = state === 'HUNT' ? 28 : 16;
    ctx.shadowColor = col;

    // Outer ring (thicker in hunt mode)
    ctx.strokeStyle = col;
    ctx.lineWidth   = state === 'HUNT' ? 3 : 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.stroke();

    // Transparent fill
    ctx.fillStyle = col + '33';
    ctx.fill();

    // Inner dot
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
    ctx.fill();

    // Direction indicator line
    ctx.strokeStyle = col;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(
      this.x + Math.cos(this.angle) * (this.r + 6),
      this.y + Math.sin(this.angle) * (this.r + 6)
    );
    ctx.stroke();
    ctx.restore();

    // ── State label above head ─────────────────────────────────────
    ctx.save();
    ctx.font      = `bold ${state === 'HUNT' ? 9 : 8}px Share Tech Mono`;
    ctx.fillStyle = col;
    ctx.textAlign = 'center';
    ctx.shadowBlur  = state === 'HUNT' ? 10 : 0;
    ctx.shadowColor = col;
    ctx.fillText(state, this.x, this.y - this.r - 5);
    ctx.restore();

    // ── NN training level micro-bar ───────────────────────────────
    if (this.brain.nn.trainCount > 0) {
      const barW  = 28, barH = 2;
      const barX  = this.x - barW / 2;
      const barY  = this.y - this.r - 3;
      const level = Math.min(1, this.brain.nn.trainCount / 80);
      ctx.fillStyle = 'rgba(200,100,220,0.3)';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = `rgba(220,120,255,${0.5 + level * 0.5})`;
      ctx.fillRect(barX, barY, barW * level, barH);
    }

    // ── "!" detection exclamation ──────────────────────────────────
    if (this.exclT > 0) {
      const alpha = Math.min(1, this.exclT);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font        = `bold ${Math.round(14 + (1 - alpha) * 6)}px Orbitron`;
      ctx.fillStyle   = '#f0f000';
      ctx.textAlign   = 'center';
      ctx.shadowBlur  = 12;
      ctx.shadowColor = '#f0f000';
      ctx.fillText('!', this.x + 18, this.y - this.r - 10);
      ctx.restore();
    }

    // ── Guard ID number ────────────────────────────────────────────
    ctx.save();
    ctx.font      = '8px Share Tech Mono';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'center';
    ctx.fillText(this.id, this.x, this.y + 3);
    ctx.restore();
  }
}
