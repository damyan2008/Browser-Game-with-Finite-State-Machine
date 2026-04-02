// ╔══════════════════════════════════════════════════════════════╗
// ║  main.js  –  Entry point                                    ║
// ║  Handles: constants, map, utilities, canvas scaling,        ║
// ║           game state, drawing, input events, game loop      ║
// ╚══════════════════════════════════════════════════════════════╝
'use strict';


// ════════════════════════════════════════════════════════════════
//  CONSTANTS
// ════════════════════════════════════════════════════════════════

// Logical game-world dimensions (canvas is scaled to fit the window)
const GW = 900, GH = 600;

// Movement speeds (pixels per second)
const PLAYER_SPD  = 155;
const SPD_PATROL  = 52;
const SPD_CHASE   = 108;
const SPD_SEARCH  = 68;
const SPD_HUNT    = 165; // max speed used during global hunt mode

// Guard AI parameters
const SIGHT_RANGE              = 160;         // detection radius in pixels
const FOV_ANGLE                = Math.PI * 0.62; // field-of-view width (~112°)
const ATTACK_DIST              = 26;          // melee strike distance
const ATK_DMG                  = 14;          // damage per strike
const ATK_CD                   = 0.9;         // seconds between strikes
const BOUNCE_REPATH_LIMIT      = 4;
const NN_PATROL_CONF_THRESHOLD = 0.22;
// Wall-avoidance steering (close-range corner polish only)
const STEER_PROBE_DIST         = 32;
const STEER_CANDIDATES         = 24;
const STEER_GOAL_WEIGHT        = 28;
const STEER_LOCK_DURATION      = 0.50;
// Visual wall-vision rays
const VISION_RAY_LEN           = 700;
// Guard turn speeds (radians / second)
const TURN_SPEED_FAST          = Math.PI * 4.5;  // CHASE / HUNT / ATTACK
const TURN_SPEED_SLOW          = Math.PI * 2.2;  // PATROL / SEARCH / RETURN



// ════════════════════════════════════════════════════════════════
//  COLOUR PALETTE
// ════════════════════════════════════════════════════════════════
const C = {
  bg:           '#06060f',
  gridMinor:    '#0a0a1e',
  gridMajor:    '#0e0e28',
  wall:         '#131835',
  wallEdge:     '#1d2550',
  player:       '#00e5ff',
  playerShadow: '#0077aa',
  exit:         '#00ff7f',
  chipFill:     '#ffd700',
  chipGlow:     '#ffaa00',
  guard: {
    PATROL: '#00cc66',
    ALERT:  '#f0f000',
    CHASE:  '#ff7700',
    ATTACK: '#ff1111',
    SEARCH: '#cc00ee',
    RETURN: '#5577ff',
    HUNT:   '#ff0055',   // hunt mode – magenta-red
  },
  fov: {
    PATROL: 'rgba(0,200,100,0.06)',
    ALERT:  'rgba(240,240,0,0.13)',
    CHASE:  'rgba(255,120,0,0.16)',
    ATTACK: 'rgba(255,20,20,0.20)',
    SEARCH: 'rgba(180,0,220,0.10)',
    RETURN: 'rgba(80,100,255,0.07)',
    HUNT:   'rgba(255,0,60,0.22)',  // full-circle omniscient cone
  },
};


// ════════════════════════════════════════════════════════════════
//  LEVELS
// ════════════════════════════════════════════════════════════════

const LEVELS = [
  // ── Level 1 ─────────────────────────────────────────────────
  {
    walls: [
      {x:0,    y:0,    w:GW,  h:12},
      {x:0,    y:GH-12,w:GW,  h:12},
      {x:0,    y:0,    w:12,  h:GH},
      {x:GW-12,y:0,    w:12,  h:GH},
      {x:200,  y:12,   w:12,  h:190},
      {x:12,   y:200,  w:200, h:12},
      {x:380,  y:12,   w:12,  h:252},
      {x:380,  y:250,  w:170, h:12},
      {x:550,  y:12,   w:12,  h:182},
      {x:680,  y:12,   w:12,  h:252},
      {x:12,   y:380,  w:170, h:12},
      {x:170,  y:380,  w:12,  h:122},
      {x:320,  y:350,  w:12,  h:202},
      {x:320,  y:350,  w:202, h:12},
      {x:500,  y:430,  w:12,  h:162},
      {x:650,  y:380,  w:12,  h:212},
    ],
    chips:  [{x:255,y:285},{x:615,y:310},{x:415,y:400}],
    exit:   {x:840, y:545, r:20},
    player: {x:60,  y:500},
    guards: [
      {id:1, x:80,  y:80 },
      {id:2, x:290, y:50 },
      {id:3, x:610, y:60 },
      {id:4, x:50,  y:430},
      {id:5, x:750, y:60 },
    ],
    hiding: [
      {x:220, y:215, w:36, h:36},
      {x:570, y:270, w:36, h:36},
      {x:340, y:430, w:36, h:36},
    ],
  },

  // ── Level 2 ─────────────────────────────────────────────────
  {
    walls: [
      // Border
      {x:0,    y:0,    w:GW,  h:12},
      {x:0,    y:GH-12,w:GW,  h:12},
      {x:0,    y:0,    w:12,  h:GH},
      {x:GW-12,y:0,    w:12,  h:GH},
      // Horizontal bands
      {x:12,   y:150,  w:260, h:12},
      {x:12,   y:320,  w:160, h:12},
      {x:12,   y:460,  w:260, h:12},
      // Central box
      {x:340,  y:180,  w:12,  h:230},
      {x:340,  y:180,  w:230, h:12},
      {x:340,  y:410,  w:150, h:12},
      {x:570,  y:180,  w:12,  h:230},
      // Right corridors
      {x:630,  y:80,   w:12,  h:220},
      {x:630,  y:300,  w:258, h:12},
      {x:730,  y:370,  w:12,  h:222},
      {x:460,  y:460,  w:218, h:12},
      // Pillars
      {x:160,  y:220,  w:40,  h:40},
      {x:470,  y:80,   w:40,  h:40},
      {x:200,  y:400,  w:40,  h:40},
    ],
    chips:  [
      {x:75,  y:75  },
      {x:230, y:250 },
      {x:450, y:290 },
      {x:680, y:180 },
      {x:800, y:500 },
    ],
    exit:   {x:50, y:545, r:20},
    player: {x:855, y:50},
    guards: [
      {id:1, x:180, y:75 },
      {id:2, x:75,  y:390},
      {id:3, x:450, y:75 },
      {id:4, x:440, y:490},
      {id:5, x:680, y:80 },
      {id:6, x:800, y:380},
    ],
    hiding: [
      {x:95,  y:175, w:36, h:36},
      {x:480, y:300, w:36, h:36},
      {x:650, y:430, w:36, h:36},
    ],
  },
];

// ── Active level state (populated by loadLevel) ──────────────────
let WALLS        = [];
let EXIT         = { x: 0, y: 0, r: 20 };
let HIDING_SPOTS = [];
let GUARD_DEFS   = [];
let chips        = [];
let currentLevel = 1;
let caughtLevel  = 1;  // level the player was on when caught – restart point

function loadLevel(n) {
  const lvl    = LEVELS[n - 1];
  WALLS        = lvl.walls;
  EXIT         = { ...lvl.exit };
  HIDING_SPOTS = lvl.hiding;
  GUARD_DEFS   = lvl.guards;
  rebuildNavGrid(); // force A* grid to rebuild with new walls
  // Clear any cached nav paths from the previous level
  if (guards) guards.forEach(g => { g._navPath = []; g._navGoal = null; g._navWpIdx = 0; });
}

// Nav grid singleton is reset by loadLevel; see pathfinding.js
function rebuildNavGrid() { _sharedGrid = null; }


// ════════════════════════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ════════════════════════════════════════════════════════════════

/** Euclidean distance between two {x,y} objects. */
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Liang-Barsky line-segment vs axis-aligned rectangle intersection test.
 * Returns true if the segment p1→p2 intersects rectangle r.
 */
function segHitsRect(p1, p2, r) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const P = [-dx,  dx,  -dy,  dy];
  const Q = [p1.x - r.x, r.x + r.w - p1.x, p1.y - r.y, r.y + r.h - p1.y];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (P[i] === 0) { if (Q[i] < 0) return false; }
    else {
      const t = Q[i] / P[i];
      if (P[i] < 0) t0 = Math.max(t0, t);
      else           t1 = Math.min(t1, t);
    }
  }
  return t0 <= t1;
}

/**
 * Liang-Barsky ray vs axis-aligned rect.
 * Returns the parametric t ∈ (0,1] of the first intersection,
 * or null if the segment p1→p2 does not hit rect r.
 * t=0 means at p1, t=1 means at p2.
 */
function rayHitT(p1, p2, r) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const P = [-dx,  dx,  -dy,  dy];
  const Q = [p1.x - r.x, r.x + r.w - p1.x, p1.y - r.y, r.y + r.h - p1.y];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (P[i] === 0) { if (Q[i] < 0) return null; }
    else {
      const t = Q[i] / P[i];
      if (P[i] < 0) t0 = Math.max(t0, t);
      else           t1 = Math.min(t1, t);
    }
  }
  if (t0 > t1) return null;
  // Return the entry t if positive (approaching), else the exit t
  return t0 > 0 ? t0 : (t1 > 0 ? t1 : null);
}

/** Returns true when there is no wall between point a and point b. */
function hasLOS(a, b) {
  return !WALLS.some(w => segHitsRect(a, b, w));
}

/** Returns true when a circle (cx, cy, r) overlaps an AABB wall w. */
function circleRect(cx, cy, r, w) {
  const nx = Math.max(w.x, Math.min(cx, w.x + w.w));
  const ny = Math.max(w.y, Math.min(cy, w.y + w.h));
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
}

/**
 * Move entity by (dx * spd * dt, dy * spd * dt) with wall collision.
 * Axes are resolved independently so sliding along walls works correctly.
 */
function moveWithCollision(entity, dx, dy, spd, dt) {
  const nx = entity.x + dx * spd * dt;
  const ny = entity.y + dy * spd * dt;
  if (!WALLS.some(w => circleRect(nx, entity.y, entity.r, w))) entity.x = nx;
  if (!WALLS.some(w => circleRect(entity.x, ny, entity.r, w))) entity.y = ny;
}


// ════════════════════════════════════════════════════════════════
//  CANVAS & SCALING
// ════════════════════════════════════════════════════════════════

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
let scale = 1, offX = 0, offY = 0;

/** Resize the canvas to fill the window while preserving game aspect ratio. */
function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  scale = Math.min(window.innerWidth / GW, window.innerHeight / GH);
  offX  = (window.innerWidth  - GW * scale) / 2;
  offY  = (window.innerHeight - GH * scale) / 2;
}

/** Convert a screen-space coordinate to game-world space. */
function screenToGame(sx, sy) {
  return { x: (sx - offX) / scale, y: (sy - offY) / scale };
}


// ════════════════════════════════════════════════════════════════
//  GAME STATE
//  States: MENU | PLAYING | PAUSED | WIN | GAMEOVER
// ════════════════════════════════════════════════════════════════

let gameState = 'MENU';
let player, guards;
let score    = 0;
let chipsGot = 0;
let alertPct = 0;    // global alarm level 0–100
let gameTime = 0;
let huntMode  = false; // true while all guards are in coordinated hunt
let huntTimer = 0;     // seconds elapsed since hunt mode started
const HUNT_DURATION = 15; // seconds hunt lasts before guards stand down

/** Transition to a new game state and fire relevant custom events. */
function setGameState(s) {
  gameState = s;
  if (s === 'GAMEOVER') {
    caughtLevel = currentLevel;
    window.dispatchEvent(new CustomEvent('gameOver', { detail: { score } }));
  }
  if (s === 'LEVEL_CLEAR') window.dispatchEvent(new CustomEvent('levelClear',   { detail: { score, level: currentLevel } }));
  if (s === 'WIN')         window.dispatchEvent(new CustomEvent('gameWin',      { detail: { score } }));
}

/** Start or restart the game, optionally at a specific level. */
function initGame(level = 1) {
  currentLevel = level;
  loadLevel(currentLevel);

  const lvl = LEVELS[currentLevel - 1];
  chips  = lvl.chips.map(c => ({ ...c, collected: false }));
  player = new Player(lvl.player.x, lvl.player.y);

  // Preserve NN brain weights when restarting the same level
  if (guards && guards.length && currentLevel === (guards[0]._levelId || 1)) {
    const oldBrains = guards.map(g => g.brain);
    guards = GUARD_DEFS.map((def, i) => {
      const g = new Guard(def);
      g._levelId = currentLevel;
      if (oldBrains[i]) { g.brain = oldBrains[i]; g.brain.softReset(); }
      return g;
    });
  } else {
    guards = GUARD_DEFS.map(def => {
      const g = new Guard(def);
      g._levelId = currentLevel;
      return g;
    });
  }

  particles = [];
  score     = 0;
  chipsGot  = 0;
  alertPct  = 0;
  huntMode  = false;
  huntTimer = 0;
  gameTime  = 0;
  gameState = 'PLAYING';
  window.dispatchEvent(new CustomEvent('gameStart'));
}

/** Advance to the next level, or show WIN if on the last. */
function nextLevel() {
  if (currentLevel < LEVELS.length) {
    initGame(currentLevel + 1);
  } else {
    score += 500;
    setGameState('WIN');
  }
}


// ════════════════════════════════════════════════════════════════
//  DRAWING – World
// ════════════════════════════════════════════════════════════════

function drawBG() {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, GW, GH);

  // Minor grid lines (every 30 px)
  ctx.strokeStyle = C.gridMinor;
  ctx.lineWidth   = 0.4;
  for (let x = 0; x < GW; x += 30) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, GH); ctx.stroke();
  }
  for (let y = 0; y < GH; y += 30) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(GW, y); ctx.stroke();
  }

  // Major grid lines (every 90 px)
  ctx.strokeStyle = C.gridMajor;
  ctx.lineWidth   = 0.8;
  for (let x = 0; x < GW; x += 90) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, GH); ctx.stroke();
  }
  for (let y = 0; y < GH; y += 90) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(GW, y); ctx.stroke();
  }
}

function drawWalls() {
  WALLS.forEach(w => {
    ctx.fillStyle   = C.wall;
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.strokeStyle = C.wallEdge;
    ctx.lineWidth   = 1;
    ctx.strokeRect(w.x, w.y, w.w, w.h);
  });
}

/** Draw uncollected data chips with a pulsing glow. */
function drawChips(t) {
  chips.forEach(chip => {
    if (chip.collected) return;
    const pulse = Math.sin(t * 3) * 0.3 + 0.7;

    ctx.save();
    ctx.shadowBlur  = 14 * pulse;
    ctx.shadowColor = C.chipGlow;

    // Hexagon shape
    ctx.fillStyle = C.chipFill;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
      if (i === 0) ctx.moveTo(chip.x + Math.cos(a) * 8, chip.y + Math.sin(a) * 8);
      else         ctx.lineTo(chip.x + Math.cos(a) * 8, chip.y + Math.sin(a) * 8);
    }
    ctx.closePath();
    ctx.fill();

    // Highlight dot
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(chip.x, chip.y, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  });
}

/** Draw the exit zone (dim until all chips collected, then glowing). */
function drawExit(t) {
  const ready = chipsGot >= chips.length;
  const pulse = Math.sin(t * 2) * 0.4 + 0.6;
  const col   = ready ? C.exit : '#1a4433';

  ctx.save();
  if (ready) { ctx.shadowBlur = 28 * pulse; ctx.shadowColor = col; }
  ctx.strokeStyle = col;
  ctx.lineWidth   = 2.5;
  ctx.beginPath(); ctx.arc(EXIT.x, EXIT.y, EXIT.r,      0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(EXIT.x, EXIT.y, EXIT.r - 9,  0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle   = ready ? col : '#1a4433';
  ctx.font        = 'bold 9px Orbitron';
  ctx.textAlign   = 'center';
  ctx.fillText('EXIT', EXIT.x, EXIT.y + 4);
  ctx.restore();
}

/** Draw the three hiding spots (crate-like teal boxes). */
function drawHidingSpots(t) {
  HIDING_SPOTS.forEach(s => {
    const occupied = player.alive &&
      player.x >= s.x && player.x <= s.x + s.w &&
      player.y >= s.y && player.y <= s.y + s.h;

    // A chasing guard still sees you — warn the player
    const exposed = occupied && guards.some(
      g => g.fsm.state === 'CHASE' || g.fsm.state === 'ATTACK'
    );

    const pulse = Math.sin(t * 2.2) * 0.3 + 0.7;
    const col   = exposed ? '#ff6644' : occupied ? '#00ffcc' : '#007766';
    const glow  = occupied ? 22 * pulse : 6;

    ctx.save();
    ctx.shadowBlur  = glow;
    ctx.shadowColor = col;

    // Fill
    ctx.fillStyle = exposed
      ? 'rgba(255,80,40,0.15)'
      : occupied ? 'rgba(0,255,200,0.12)' : 'rgba(0,80,70,0.35)';
    ctx.fillRect(s.x, s.y, s.w, s.h);

    // Border
    ctx.strokeStyle = col;
    ctx.lineWidth   = occupied ? 2 : 1.5;
    ctx.strokeRect(s.x, s.y, s.w, s.h);

    // Cross-hatch
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = col;
    ctx.lineWidth   = 0.8;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);      ctx.lineTo(s.x + s.w, s.y + s.h);
    ctx.moveTo(s.x + s.w, s.y); ctx.lineTo(s.x, s.y + s.h);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Label
    ctx.fillStyle = col;
    ctx.font      = `bold ${occupied ? 8 : 7}px Share Tech Mono`;
    ctx.textAlign = 'center';
    const label   = exposed ? 'EXPOSED!' : occupied ? 'HIDDEN' : 'HIDE';
    ctx.fillText(label, s.x + s.w / 2, s.y + s.h + 10);

    ctx.restore();
  });
}


// ════════════════════════════════════════════════════════════════
//  DRAWING – HUD
// ════════════════════════════════════════════════════════════════

function drawHUD() {
  const bw = 160, bh = 10, bx = 20, by = 20;

  // HP bar
  ctx.fillStyle = '#0a0a1e';
  ctx.fillRect(bx, by, bw, bh);
  const hFrac = player.hp / player.maxHp;
  const hCol  = hFrac > 0.5 ? '#00cc66' : hFrac > 0.25 ? '#ffcc00' : '#ff2200';
  ctx.fillStyle = hCol;
  ctx.fillRect(bx, by, bw * hFrac, bh);
  ctx.strokeStyle = '#1e2550';
  ctx.lineWidth   = 1;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle   = '#99aacc';
  ctx.font        = '9px Share Tech Mono';
  ctx.textAlign   = 'left';
  ctx.fillText(`HP  ${Math.ceil(player.hp)}`, bx, by + bh + 12);

  // Alert bar
  const alertCol = alertPct > 60 ? '#ff2200' : alertPct > 30 ? '#ffcc00' : '#00cc66';
  ctx.fillStyle   = '#0a0a1e';
  ctx.fillRect(bx, by + 24, bw, bh);
  ctx.fillStyle   = alertCol;
  ctx.fillRect(bx, by + 24, bw * alertPct / 100, bh);
  ctx.strokeStyle = '#1e2550';
  ctx.strokeRect(bx, by + 24, bw, bh);
  ctx.fillStyle   = '#99aacc';
  ctx.fillText(`ALERT  ${Math.round(alertPct)}%`, bx, by + 24 + bh + 12);

  // Score
  ctx.fillStyle = C.chipFill;
  ctx.font      = 'bold 14px Orbitron';
  ctx.textAlign = 'right';
  ctx.fillText(`${score} PTS`, GW - 20, 30);

  // Chips collected counter
  ctx.fillStyle = '#99aacc';
  ctx.font      = '9px Share Tech Mono';
  ctx.fillText(`CHIPS  ${chipsGot}/${chips.length}`, GW - 20, 50);

  // Timer
  const mm = Math.floor(gameTime / 60).toString().padStart(2, '0');
  const ss = Math.floor(gameTime % 60).toString().padStart(2, '0');
  ctx.fillText(`TIME  ${mm}:${ss}`, GW - 20, 66);

  // Level indicator
  ctx.fillStyle = 'rgba(100,180,255,0.6)';
  ctx.fillText(`LVL  ${currentLevel}`, GW - 20, 82);

  // ── Neural Network panel (bottom-left corner) ────────────────
  const nx = 20, ny = GH - 80;
  ctx.fillStyle = 'rgba(30,10,40,0.7)';
  ctx.fillRect(nx - 4, ny - 12, 200, 68);
  ctx.strokeStyle = 'rgba(180,80,220,0.35)';
  ctx.lineWidth   = 1;
  ctx.strokeRect(nx - 4, ny - 12, 200, 68);

  ctx.fillStyle = 'rgba(200,100,255,0.8)';
  ctx.font      = 'bold 8px Orbitron';
  ctx.textAlign = 'left';
  ctx.fillText('Randomization', nx, ny);

  guards.forEach((g, i) => {
    const gy   = ny + 10 + i * 10;
    const tc   = g.brain.nn.trainCount;
    const conf = g.brain.confidence;
    const loss = g.brain.nn.lossAvg;
    const src  = g._wanderTarget?.source;

    ctx.fillStyle = C.guard[g.fsm.state] || '#aaa';
    ctx.font      = '7px Share Tech Mono';
    ctx.fillText(`G${g.id}`, nx, gy);

    const bx2 = nx + 18, bw2 = 60, bh2 = 4;
    ctx.fillStyle = 'rgba(80,0,80,0.7)';
    ctx.fillRect(bx2, gy - 5, bw2, bh2);
    const barCol = conf > 0.6 ? '#cc44ff' : conf > 0.3 ? '#8833cc' : '#441166';
    ctx.fillStyle = barCol;
    ctx.fillRect(bx2, gy - 5, bw2 * conf, bh2);

    ctx.fillStyle = 'rgba(180,120,220,0.75)';
    ctx.fillText(`${Math.round(conf * 100)}%`, bx2 + bw2 + 4, gy);
    ctx.fillText(`n=${tc}`, bx2 + bw2 + 30, gy);
    if (tc > 0) {
      ctx.fillStyle = loss < 0.05 ? '#44ff88' : loss < 0.2 ? '#ffcc44' : '#ff6644';
      ctx.fillText(`L=${loss.toFixed(3)}`, bx2 + bw2 + 58, gy);
    }
    if (src === 'heat') {
      ctx.fillStyle = '#ff6655';
      ctx.fillText('🔥', bx2 + bw2 + 96, gy);
    } else if (src === 'nn') {
      ctx.fillStyle = '#dd66ff';
      ctx.fillText('◈NN', bx2 + bw2 + 96, gy);
    } else if (src === 'random') {
      ctx.fillStyle = '#445566';
      ctx.fillText('rnd', bx2 + bw2 + 96, gy);
    }
  });

  // Bottom hint bar
  ctx.fillStyle = 'rgba(80,100,200,0.4)';
  ctx.font      = '9px Share Tech Mono';
  ctx.textAlign = 'center';
  ctx.fillText('WASD: Move  |  ESC: Pause  |  R: Restart  |  Collect chips → reach EXIT', GW / 2, GH - 10);
}


// ════════════════════════════════════════════════════════════════
//  DRAWING – Screen overlays
// ════════════════════════════════════════════════════════════════

let menuT = 0; // incremented each frame for menu animations

function drawMenu() {
  ctx.fillStyle = 'rgba(6,6,20,0.88)';
  ctx.fillRect(0, 0, GW, GH);

  // Animated title
  const pulse = Math.sin(menuT * 1.5) * 0.15 + 0.85;
  ctx.save();
  ctx.shadowBlur  = 40 * pulse;
  ctx.shadowColor = C.player;
  ctx.fillStyle   = C.player;
  ctx.font        = 'bold 54px Orbitron';
  ctx.textAlign   = 'center';
  ctx.fillText('GHOST PROTOCOL', GW / 2, 150);
  ctx.restore();

  ctx.fillStyle = 'rgba(0,229,255,0.55)';
  ctx.font      = '12px Share Tech Mono';
  ctx.textAlign = 'center';
  ctx.fillText('STEALTH GAME  ·  FSM AI DEMO', GW / 2, 182);

  // Divider
  ctx.strokeStyle = 'rgba(0,229,255,0.2)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(GW / 2 - 200, 198); ctx.lineTo(GW / 2 + 200, 198); ctx.stroke();

  ctx.fillStyle = '#667799';
  ctx.font      = '11px Share Tech Mono';
  ctx.fillText('Collect 3 data chips  ·  Avoid 5 FSM-controlled guards  ·  Reach EXIT', GW / 2, 220);
  ctx.fillText('WASD to move  |  Mouse to aim  |  ESC to pause', GW / 2, 240);

  // FSM state colour legend
  const states = [
    ['PATROL', C.guard.PATROL],
    ['ALERT',  C.guard.ALERT],
    ['CHASE',  C.guard.CHASE],
    ['ATTACK', C.guard.ATTACK],
    ['SEARCH', C.guard.SEARCH],
    ['RETURN', C.guard.RETURN],
    ['HUNT',   C.guard.HUNT],
  ];
  ctx.fillStyle = '#445566';
  ctx.font      = '9px Share Tech Mono';
  ctx.fillText('GUARD FSM STATES:', GW / 2, 278);
  states.forEach((s, i) => {
    const x = GW / 2 - 150 + i * 50;
    ctx.save();
    ctx.shadowBlur  = 8;
    ctx.shadowColor = s[1];
    ctx.fillStyle   = s[1];
    ctx.font        = 'bold 9px Share Tech Mono';
    ctx.textAlign   = 'center';
    ctx.fillText(s[0], x, 296);
    ctx.restore();
  });

  // Events list (assignment requirement)
  ctx.fillStyle = '#2a3a5a';
  ctx.font      = '9px Share Tech Mono';
  ctx.fillText(
    'EVENTS: keydown · keyup · mousemove · click · contextmenu · resize · focus · blur · visibilitychange · rAF + custom',
    GW / 2, 328
  );

  // Animated Play button
  const bp = Math.sin(menuT * 2.5) * 0.3 + 0.7;
  ctx.save();
  ctx.shadowBlur  = 18 * bp;
  ctx.shadowColor = C.exit;
  ctx.strokeStyle = C.exit;
  ctx.lineWidth   = 2;
  ctx.strokeRect(GW / 2 - 80, 358, 160, 46);
  ctx.fillStyle   = 'rgba(0,255,127,0.08)';
  ctx.fillRect(GW / 2 - 80, 358, 160, 46);
  ctx.fillStyle   = C.exit;
  ctx.font        = 'bold 16px Orbitron';
  ctx.textAlign   = 'center';
  ctx.fillText('▶  PLAY', GW / 2, 388);
  ctx.restore();

  ctx.fillStyle = '#223';
  ctx.font      = '8px Share Tech Mono';
  ctx.fillText('v1.0 · For: Math for Devs & IT · Game Project Assignment', GW / 2, GH - 14);
}

/**
 * Full-screen overlay drawn when huntMode is active.
 * Red vignette edges + pulsing "⚠ HUNT MODE" banner at top.
 * Drawn inside the world transform so it scales with the canvas.
 */
function drawHuntOverlay() {
  const t     = huntTimer;
  const pulse = Math.sin(t * 6) * 0.5 + 0.5;          // 0–1 fast flicker
  const dim   = Math.min(1, t * 4);                    // fade-in over ~0.25 s
  const timeLeft = Math.max(0, HUNT_DURATION - huntTimer);
  const barFrac  = timeLeft / HUNT_DURATION;           // 1 → 0 as hunt counts down

  // ── Red vignette ──────────────────────────────────────────────
  const vig = ctx.createRadialGradient(GW/2, GH/2, GH*0.28, GW/2, GH/2, GH*0.82);
  vig.addColorStop(0, 'rgba(180,0,0,0)');
  vig.addColorStop(1, `rgba(180,0,0,${0.28 * dim})`);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, GW, GH);

  // ── Top banner background ─────────────────────────────────────
  const bannerAlpha = (0.75 + pulse * 0.15) * dim;
  ctx.fillStyle = `rgba(60,0,0,${bannerAlpha})`;
  ctx.fillRect(0, 0, GW, 46);

  // Animated left border accent
  ctx.fillStyle = `rgba(255,0,60,${0.9 * dim})`;
  ctx.fillRect(0, 0, 4, 46);
  ctx.fillRect(GW - 4, 0, 4, 46);

  // ── "⚠ HUNT MODE" label ───────────────────────────────────────
  ctx.save();
  ctx.shadowBlur  = (20 + pulse * 20) * dim;
  ctx.shadowColor = '#ff0055';
  ctx.fillStyle   = `rgba(255,${Math.round(40 + pulse*80)},80,${dim})`;
  ctx.font        = 'bold 18px Orbitron';
  ctx.textAlign   = 'center';
  ctx.fillText('⚠  HUNT MODE  ⚠', GW / 2, 28);
  ctx.restore();

  // ── Hunt timer bar (counts down from full to empty) ───────────
  const bx = GW/2 - 120, by = 36, bw = 240, bh = 4;
  ctx.fillStyle = 'rgba(100,0,0,0.6)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = `rgba(255,${Math.round(40+pulse*60)},60,${0.9*dim})`;
  ctx.fillRect(bx, by, bw * barFrac, bh);

  // ── "STAND DOWN IN Xs" sub-label ──────────────────────────────
  ctx.fillStyle = `rgba(200,80,80,${0.7 * dim})`;
  ctx.font      = '8px Share Tech Mono';
  ctx.textAlign = 'right';
  ctx.fillText(`STAND DOWN IN  ${Math.ceil(timeLeft)}s`, GW - 12, 44);
}

function drawLevelClear() {
  ctx.fillStyle = 'rgba(4,4,16,0.90)';
  ctx.fillRect(0, 0, GW, GH);

  ctx.save();
  ctx.shadowBlur  = 30;
  ctx.shadowColor = C.exit;
  ctx.fillStyle   = C.exit;
  ctx.font        = 'bold 44px Orbitron';
  ctx.textAlign   = 'center';
  ctx.fillText(`LEVEL ${currentLevel} CLEAR`, GW / 2, 200);
  ctx.restore();

  ctx.fillStyle = '#889aaa';
  ctx.font      = '12px Share Tech Mono';
  ctx.textAlign = 'center';
  ctx.fillText('All chips secured.  Proceeding to next sector.', GW / 2, 248);

  ctx.save();
  ctx.shadowBlur  = 12;
  ctx.shadowColor = C.chipFill;
  ctx.fillStyle   = C.chipFill;
  ctx.font        = 'bold 20px Orbitron';
  ctx.fillText(`SCORE  ${score}`, GW / 2, 290);
  ctx.restore();

  // Next level button
  const bp = Math.sin(Date.now() * 0.004) * 0.3 + 0.7;
  ctx.save();
  ctx.shadowBlur  = 18 * bp;
  ctx.shadowColor = C.exit;
  ctx.strokeStyle = C.exit;
  ctx.lineWidth   = 2;
  ctx.strokeRect(GW / 2 - 100, 330, 200, 46);
  ctx.fillStyle   = 'rgba(0,255,127,0.08)';
  ctx.fillRect(GW / 2 - 100, 330, 200, 46);
  ctx.fillStyle   = C.exit;
  ctx.font        = 'bold 15px Orbitron';
  ctx.textAlign   = 'center';
  ctx.fillText(`▶  LEVEL ${currentLevel + 1}`, GW / 2, 360);
  ctx.restore();

  const blink = Math.sin(Date.now() * 0.003) * 0.4 + 0.6;
  ctx.fillStyle = `rgba(100,200,100,${blink})`;
  ctx.font      = '10px Share Tech Mono';
  ctx.fillText('Click  or  press Space / Enter', GW / 2, 398);
}

function drawPause() {
  ctx.fillStyle = 'rgba(4,4,16,0.82)';
  ctx.fillRect(0, 0, GW, GH);

  ctx.save();
  ctx.shadowBlur  = 25;
  ctx.shadowColor = C.player;
  ctx.fillStyle   = C.player;
  ctx.font        = 'bold 42px Orbitron';
  ctx.textAlign   = 'center';
  ctx.fillText('PAUSED', GW / 2, 260);
  ctx.restore();

  ctx.fillStyle = '#556688';
  ctx.font      = '12px Share Tech Mono';
  ctx.textAlign = 'center';
  ctx.fillText('Press ESC or click to resume', GW / 2, 302);
  ctx.fillText('Press R to restart', GW / 2, 322);
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(4,4,16,0.90)';
  ctx.fillRect(0, 0, GW, GH);

  ctx.save();
  ctx.shadowBlur  = 30;
  ctx.shadowColor = '#ff2200';
  ctx.fillStyle   = '#ff2200';
  ctx.font        = 'bold 48px Orbitron';
  ctx.textAlign   = 'center';
  ctx.fillText('CAUGHT!', GW / 2, 220);
  ctx.restore();

  ctx.fillStyle = '#889aaa';
  ctx.font      = '13px Share Tech Mono';
  ctx.textAlign = 'center';
  ctx.fillText('A guard detected you.  Mission failed.', GW / 2, 265);

  ctx.fillStyle = 'rgba(100,160,220,0.55)';
  ctx.font      = '10px Share Tech Mono';
  ctx.fillText(`Restarting from Level ${caughtLevel}`, GW / 2, 287);

  ctx.save();
  ctx.shadowBlur  = 12;
  ctx.shadowColor = C.chipFill;
  ctx.fillStyle   = C.chipFill;
  ctx.font        = 'bold 20px Orbitron';
  ctx.fillText(`SCORE  ${score}`, GW / 2, 308);
  ctx.restore();

  const blink = Math.sin(Date.now() * 0.003) * 0.4 + 0.6;
  ctx.fillStyle = `rgba(100,150,200,${blink})`;
  ctx.font      = '11px Share Tech Mono';
  ctx.fillText('Click  or  press R  to try again', GW / 2, 355);
}

function drawWin() {
  ctx.fillStyle = 'rgba(4,4,16,0.90)';
  ctx.fillRect(0, 0, GW, GH);

  ctx.save();
  ctx.shadowBlur  = 30;
  ctx.shadowColor = C.exit;
  ctx.fillStyle   = C.exit;
  ctx.font        = 'bold 40px Orbitron';
  ctx.textAlign   = 'center';
  ctx.fillText('MISSION COMPLETE', GW / 2, 210);
  ctx.restore();

  ctx.fillStyle = '#889aaa';
  ctx.font      = '12px Share Tech Mono';
  ctx.textAlign = 'center';
  ctx.fillText('All data chips secured.  You escaped.', GW / 2, 255);

  ctx.save();
  ctx.shadowBlur  = 14;
  ctx.shadowColor = C.chipFill;
  ctx.fillStyle   = C.chipFill;
  ctx.font        = 'bold 22px Orbitron';
  ctx.fillText(`FINAL SCORE  ${score}`, GW / 2, 302);
  ctx.restore();

  const blink = Math.sin(Date.now() * 0.003) * 0.4 + 0.6;
  ctx.fillStyle = `rgba(100,200,100,${blink})`;
  ctx.font      = '11px Share Tech Mono';
  ctx.fillText('Click  or  press R  to play again', GW / 2, 350);
}


// ════════════════════════════════════════════════════════════════
//  INPUT STATE
// ════════════════════════════════════════════════════════════════

const keys     = {};          // map of KeyboardEvent.code → boolean
const mousePos = { x: 0, y: 0 }; // game-space mouse position


// ════════════════════════════════════════════════════════════════
//  EVENTS  (fulfils the 10+ required event types)
// ════════════════════════════════════════════════════════════════

// 1. keydown – movement, ESC pause, R restart, Space/Enter confirm
window.addEventListener('keydown', e => {
  keys[e.code] = true;

  if (e.code === 'Escape') {
    if      (gameState === 'PLAYING') setGameState('PAUSED');
    else if (gameState === 'PAUSED')  setGameState('PLAYING');
  }
  if (e.code === 'KeyR' && gameState !== 'MENU') initGame(gameState === 'GAMEOVER' ? caughtLevel : 1);
  if (e.code === 'Enter' || e.code === 'Space') {
    if      (gameState === 'MENU')        initGame(1);
    else if (gameState === 'PAUSED')      setGameState('PLAYING');
    else if (gameState === 'LEVEL_CLEAR') nextLevel();
    else if (gameState === 'GAMEOVER')    initGame(caughtLevel);
    else if (gameState === 'WIN')         initGame(1);
  }
});

// 2. keyup – release movement key
window.addEventListener('keyup', e => { keys[e.code] = false; });

// 3. mousemove – update aim direction
window.addEventListener('mousemove', e => {
  const gp   = screenToGame(e.clientX, e.clientY);
  mousePos.x = gp.x;
  mousePos.y = gp.y;
});

// 4. click – menu button, resume pause, restart screens
window.addEventListener('click', e => {
  const gp = screenToGame(e.clientX, e.clientY);
  if (gameState === 'MENU') {
    if (gp.x > GW / 2 - 80 && gp.x < GW / 2 + 80 && gp.y > 358 && gp.y < 404)
      initGame(1);
  } else if (gameState === 'PAUSED') {
    setGameState('PLAYING');
  } else if (gameState === 'LEVEL_CLEAR') {
    nextLevel();
  } else if (gameState === 'GAMEOVER') {
    initGame(caughtLevel);
  } else if (gameState === 'WIN') {
    initGame(1);
  }
});

// 5. contextmenu – suppress browser right-click menu
window.addEventListener('contextmenu', e => e.preventDefault());

// 6. resize – refit canvas to new window size
window.addEventListener('resize', () => {
  resizeCanvas();
  window.dispatchEvent(new CustomEvent('canvasResized'));
});

// 7. focus – (reserved for future manual-resume UI)
window.addEventListener('focus', () => {
  // Intentionally left to manual resume via ESC or click
});

// 8. blur – auto-pause when window loses focus
window.addEventListener('blur', () => {
  if (gameState === 'PLAYING') setGameState('PAUSED');
});

// 9. visibilitychange – pause on tab switch
document.addEventListener('visibilitychange', () => {
  if (document.hidden && gameState === 'PLAYING') setGameState('PAUSED');
});

// 10. Custom events – semantic game lifecycle events
window.addEventListener('gameStart',     ()  => console.log('[GAME] Session started'));
window.addEventListener('gameOver',      e   => console.log('[GAME] Game over – score:', e.detail.score));
window.addEventListener('gameWin',       e   => console.log('[GAME] Mission complete – score:', e.detail.score));
window.addEventListener('chipCollected', e   => console.log('[GAME] Chip collected at', e.detail));
window.addEventListener('canvasResized', ()  => console.log('[GAME] Canvas resized'));
window.addEventListener('huntModeStart', ()  => console.log('[GAME] ⚠ HUNT MODE – all guards converging!'));
window.addEventListener('huntModeEnd',   ()  => console.log('[GAME] Hunt mode ended'));


// ════════════════════════════════════════════════════════════════
//  ALERT LEVEL  (global tension meter driven by guard AI states)
// ════════════════════════════════════════════════════════════════

function updateAlert(dt) {
  if (huntMode) {
    // While hunting: timer counts up; alert stays pinned at 100
    huntTimer += dt;
    alertPct   = 100;
    if (huntTimer >= HUNT_DURATION) {
      // Guards stand down after HUNT_DURATION seconds
      huntMode  = false;
      huntTimer = 0;
      alertPct  = 72; // drop below re-trigger threshold so guards de-escalate
      window.dispatchEvent(new CustomEvent('huntModeEnd'));
      console.log('[GAME] Hunt mode ended – guards standing down');
    }
    return;
  }

  // Normal escalation driven by individual guard states
  const chasing = guards.some(g => ['CHASE', 'ATTACK'].includes(g.fsm.state));
  const alerted = guards.some(g => g.fsm.state === 'ALERT');

  if (chasing)      alertPct = Math.min(100, alertPct + dt * 38);
  else if (alerted) alertPct = Math.min(100, alertPct + dt * 14);
  else              alertPct = Math.max(0,   alertPct - dt *  9);

  // Cross the 100 % threshold → trigger global hunt mode
  if (alertPct >= 100 && !huntMode) {
    huntMode  = true;
    huntTimer = 0;
    window.dispatchEvent(new CustomEvent('huntModeStart'));
    console.log('[GAME] Hunt mode activated – all guards converging!');
  }
}


// ════════════════════════════════════════════════════════════════
//  GAME LOOP  (requestAnimationFrame – event type #10)
// ════════════════════════════════════════════════════════════════

let lastTS = 0;

function loop(ts) {
  const dt = Math.min((ts - lastTS) / 1000, 0.05); // cap at 50 ms / frame
  lastTS   = ts;
  menuT   += dt;

  // ── Update ────────────────────────────────────────────────────
  if (gameState === 'PLAYING') {
    gameTime += dt;
    player.update(dt);
    guards.forEach(g => g.update(dt, player));
    particles = particles.filter(p => { p.update(dt); return !p.dead; });
    updateAlert(dt);
  }

  // ── Draw ──────────────────────────────────────────────────────
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(offX, offY);
  ctx.scale(scale, scale);

  if (gameState === 'MENU') {
    drawBG();
    drawWalls();
    drawHidingSpots(menuT);
    drawExit(menuT);
    drawChips(menuT);
    drawMenu();
  } else {
    drawBG();
    drawWalls();
    drawHidingSpots(gameTime);
    drawExit(gameTime);
    drawChips(gameTime);
    particles.forEach(p => p.draw(ctx));
    guards.forEach(g => g.draw(ctx));
    if (player.alive) player.draw(ctx);
    drawHUD();
    if (huntMode) drawHuntOverlay();

    if (gameState === 'PAUSED')      drawPause();
    if (gameState === 'LEVEL_CLEAR') drawLevelClear();
    if (gameState === 'GAMEOVER')    drawGameOver();
    if (gameState === 'WIN')         drawWin();
  }

  ctx.restore();

  requestAnimationFrame(loop);
}


// ════════════════════════════════════════════════════════════════
//  BOOT  (window load event – event type #11)
// ════════════════════════════════════════════════════════════════

window.addEventListener('load', () => {
  resizeCanvas();
  loadLevel(1);

  // Pre-populate world objects so the menu background is live
  const lvl = LEVELS[0];
  chips     = lvl.chips.map(c => ({ ...c, collected: false }));
  player    = new Player(lvl.player.x, lvl.player.y);
  guards    = GUARD_DEFS.map(def => { const g = new Guard(def); g._levelId = 1; return g; });
  particles = [];
  gameState = 'MENU';

  requestAnimationFrame(loop);
});
