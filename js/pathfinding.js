// ╔══════════════════════════════════════════════════════════════╗
// ║  pathfinding.js  –  A* grid navigation                     ║
// ║                                                             ║
// ║  Shared by all guards.  Built once from WALLS data,         ║
// ║  queried per movement tick.                                 ║
// ║                                                             ║
// ║  Grid resolution : NAV_CELL px per cell                     ║
// ║  Movement        : 8-directional (cardinal + diagonal)      ║
// ║  Post-process    : string-pull LOS to reduce waypoints      ║
// ╚══════════════════════════════════════════════════════════════╝
'use strict';

// ── Grid constants ───────────────────────────────────────────────
const NAV_CELL   = 20;                         // world px per grid cell
const NAV_COLS   = Math.ceil(900 / NAV_CELL);  // 45 columns
const NAV_ROWS   = Math.ceil(600 / NAV_CELL);  // 30 rows
const NAV_MARGIN = 22;  // collision margin when flagging blocked cells
                        // (guard r=12; 22-12 = 10 px clearance from any wall)

// Lazy singleton – built the first time getNavGrid() is called,
// after WALLS and circleRect are defined in main.js.
let _sharedGrid = null;
function getNavGrid() {
  if (!_sharedGrid) _sharedGrid = new NavGrid();
  return _sharedGrid;
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  MinHeap  –  O(log n) priority queue for A*                 ║
// ╚══════════════════════════════════════════════════════════════╝
class MinHeap {
  constructor() { this._d = []; }

  push(nodeIdx, f) {
    this._d.push({ i: nodeIdx, f });
    this._bubbleUp(this._d.length - 1);
  }

  pop() {
    const top  = this._d[0];
    const last = this._d.pop();
    if (this._d.length > 0) { this._d[0] = last; this._siftDown(0); }
    return top;
  }

  get size() { return this._d.length; }

  _bubbleUp(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._d[p].f <= this._d[i].f) break;
      const tmp = this._d[p]; this._d[p] = this._d[i]; this._d[i] = tmp;
      i = p;
    }
  }

  _siftDown(i) {
    const n = this._d.length;
    for (;;) {
      let s = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this._d[l].f < this._d[s].f) s = l;
      if (r < n && this._d[r].f < this._d[s].f) s = r;
      if (s === i) break;
      const tmp = this._d[s]; this._d[s] = this._d[i]; this._d[i] = tmp;
      i = s;
    }
  }
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  NavGrid                                                    ║
// ╚══════════════════════════════════════════════════════════════╝
class NavGrid {
  constructor() {
    // Flat Uint8Array: 1 = blocked, 0 = open
    this._blocked = new Uint8Array(NAV_COLS * NAV_ROWS);
    this._build();
  }

  // ── Build ─────────────────────────────────────────────────────
  _build() {
    this._openCells = []; // flat list of {c, r, x, y} for all walkable cells
    for (let r = 0; r < NAV_ROWS; r++) {
      for (let c = 0; c < NAV_COLS; c++) {
        const cx = c * NAV_CELL + NAV_CELL / 2;
        const cy = r * NAV_CELL + NAV_CELL / 2;
        if (WALLS.some(w => circleRect(cx, cy, NAV_MARGIN, w))) {
          this._blocked[r * NAV_COLS + c] = 1;
        } else {
          this._openCells.push({ c, r, x: cx, y: cy });
        }
      }
    }
  }

  /**
   * Return a random walkable world-space point that is at least
   * minDist pixels from (nearX, nearY).  Tries up to 40 random
   * open cells before falling back to the farthest cell found.
   *
   * @param {number} nearX
   * @param {number} nearY
   * @param {number} [minDist=80]
   * @returns {{ x, y }}
   */
  randomOpenCell(nearX, nearY, minDist = 80) {
    const cells = this._openCells;
    if (cells.length === 0) return { x: nearX, y: nearY };

    let best = null;
    let bestDist = -1;
    const tries = Math.min(40, cells.length);

    for (let i = 0; i < tries; i++) {
      const cell = cells[Math.floor(Math.random() * cells.length)];
      const d    = Math.hypot(cell.x - nearX, cell.y - nearY);
      if (d >= minDist) return { x: cell.x, y: cell.y }; // good enough
      if (d > bestDist) { bestDist = d; best = cell; }
    }
    // All sampled cells were too close – return farthest found
    return best ? { x: best.x, y: best.y } : { x: nearX, y: nearY };
  }

  // ── Helpers ───────────────────────────────────────────────────
  isBlocked(c, r) {
    if (c < 0 || c >= NAV_COLS || r < 0 || r >= NAV_ROWS) return true;
    return this._blocked[r * NAV_COLS + c] !== 0;
  }

  worldToCell(x, y) {
    return {
      c: Math.max(0, Math.min(NAV_COLS - 1, Math.floor(x / NAV_CELL))),
      r: Math.max(0, Math.min(NAV_ROWS - 1, Math.floor(y / NAV_CELL))),
    };
  }

  cellCenter(c, r) {
    return { x: c * NAV_CELL + NAV_CELL / 2, y: r * NAV_CELL + NAV_CELL / 2 };
  }

  /** Octile heuristic (admissible for 8-directional grid). */
  _h(c, r, gc, gr) {
    const dx = Math.abs(c - gc), dy = Math.abs(r - gr);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  }

  /**
   * Snap a blocked cell to the nearest open cell (ring search up to radius 5).
   * Returns {c, r} or null if nothing found.
   */
  _snapOpen(c, r) {
    if (!this.isBlocked(c, r)) return { c, r };
    for (let ring = 1; ring <= 5; ring++) {
      for (let dc = -ring; dc <= ring; dc++) {
        for (let dr = -ring; dr <= ring; dr++) {
          if (Math.abs(dc) !== ring && Math.abs(dr) !== ring) continue;
          const nc = c + dc, nr = r + dr;
          if (!this.isBlocked(nc, nr)) return { c: nc, r: nr };
        }
      }
    }
    return null;
  }

  // ── A* search ─────────────────────────────────────────────────
  /**
   * Find a path from world position (sx,sy) to (tx,ty).
   * Returns an array of world-space {x,y} waypoints (string-pulled),
   * or an empty array if no path exists.
   *
   * @param {number} sx  Start X (world)
   * @param {number} sy  Start Y (world)
   * @param {number} tx  Goal X (world)
   * @param {number} ty  Goal Y (world)
   * @returns {{ x:number, y:number }[]}
   */
  findPath(sx, sy, tx, ty) {
    const sc = this._snapOpen(...Object.values(this.worldToCell(sx, sy)));
    const gc = this._snapOpen(...Object.values(this.worldToCell(tx, ty)));
    if (!sc || !gc) return [];

    const startIdx = sc.r * NAV_COLS + sc.c;
    const goalIdx  = gc.r * NAV_COLS + gc.c;
    if (startIdx === goalIdx) return [];

    const N      = NAV_COLS * NAV_ROWS;
    const gCost  = new Float32Array(N).fill(Infinity);
    const parent = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);

    // 8-directional movement costs
    const DIRS = [
      [ 1,  0, 1], [-1,  0, 1], [ 0,  1, 1], [ 0, -1, 1],
      [ 1,  1, Math.SQRT2], [-1,  1, Math.SQRT2],
      [ 1, -1, Math.SQRT2], [-1, -1, Math.SQRT2],
    ];

    const heap = new MinHeap();
    gCost[startIdx] = 0;
    heap.push(startIdx, this._h(sc.c, sc.r, gc.c, gc.r));

    let found = false;

    while (heap.size > 0) {
      const { i: curIdx } = heap.pop();
      if (closed[curIdx]) continue;
      closed[curIdx] = 1;
      if (curIdx === goalIdx) { found = true; break; }

      const curC = curIdx % NAV_COLS;
      const curR = Math.floor(curIdx / NAV_COLS);

      for (const [dc, dr, cost] of DIRS) {
        const nc = curC + dc, nr = curR + dr;
        if (this.isBlocked(nc, nr)) continue;
        // Diagonal: both cardinal neighbours must be open (prevents corner-cutting)
        if (cost > 1) {
          if (this.isBlocked(curC + dc, curR) || this.isBlocked(curC, curR + dr)) continue;
        }
        const ni  = nr * NAV_COLS + nc;
        if (closed[ni]) continue;
        const ng = gCost[curIdx] + cost;
        if (ng < gCost[ni]) {
          gCost[ni]  = ng;
          parent[ni] = curIdx;
          heap.push(ni, ng + this._h(nc, nr, gc.c, gc.r));
        }
      }
    }

    if (!found) return [];

    // ── Reconstruct raw path ───────────────────────────────────────
    const raw = [];
    let ci = goalIdx;
    while (ci !== -1) {
      raw.unshift(this.cellCenter(ci % NAV_COLS, Math.floor(ci / NAV_COLS)));
      ci = parent[ci];
    }

    // ── String-pull to remove collinear waypoints ─────────────────
    return this._stringPull(raw, sx, sy, tx, ty);
  }

  /**
   * String-pull (greedy LOS pruning).
   * Replaces first/last cells with the exact start/goal positions,
   * then removes intermediate waypoints that can be skipped via LOS.
   */
  _stringPull(raw, sx, sy, tx, ty) {
    if (raw.length === 0) return [];

    // Use exact world start and goal instead of cell centres
    const pts = [{ x: sx, y: sy }, ...raw.slice(1, -1), { x: tx, y: ty }];

    const pruned = [pts[0]];
    let from = 0;
    while (from < pts.length - 1) {
      // Walk forward as far as we have line-of-sight from pts[from]
      let reach = from + 1;
      while (reach + 1 < pts.length && hasLOS(pts[from], pts[reach + 1])) {
        reach++;
      }
      pruned.push(pts[reach]);
      from = reach;
    }
    return pruned;
  }
}
