// ╔══════════════════════════════════════════════════════════════╗
// ║  neural.js  –  Online-learning Neural Network system        ║
// ║                                                             ║
// ║  Each guard has a GuardBrain that:                          ║
// ║    1. Observes the player each frame (inputs + position)    ║
// ║    2. Waits PREDICT_AHEAD seconds                           ║
// ║    3. Measures where the player actually moved              ║
// ║    4. Trains the NeuralNetwork on that labelled sample      ║
// ║    5. During CHASE/HUNT, uses the NN to predict where the   ║
// ║       player will be and intercepts rather than chasing     ║
// ║                                                             ║
// ║  Architecture:  8 inputs → 14 hidden (ReLU) → 2 outputs    ║
// ║  Optimiser:     Adam  (β1=0.9, β2=0.999, ε=1e-8, lr=0.02)  ║
// ║  Loss:          Mean Squared Error                          ║
// ╚══════════════════════════════════════════════════════════════╝
'use strict';

// ── Hyper-parameters ────────────────────────────────────────────
const NN_INPUT_SIZE    = 8;
const NN_HIDDEN_SIZE   = 14;
const NN_OUTPUT_SIZE   = 2;
const NN_LR            = 0.020;
const NN_BETA1         = 0.90;
const NN_BETA2         = 0.999;
const NN_EPS           = 1e-8;

const PREDICT_AHEAD    = 0.30;
const INTERCEPT_SCALE  = 85;
const EXP_BUFFER_SIZE  = 300;
const BATCH_SIZE       = 10;
const TRAIN_INTERVAL   = 20;
const MIN_SAMPLES      = 12;
const MAX_CONFIDENCE   = 0.82;

// Heatmap constants
const HEAT_CELL           = 40;
const HEAT_COLS           = Math.ceil(900 / HEAT_CELL);
const HEAT_ROWS           = Math.ceil(600 / HEAT_CELL);
const HEAT_DECAY_RATE     = 0.992;
const HEAT_DECAY_INTERVAL = 3.0;
const HEAT_MIN_DRAW       = 3;
const HEAT_SAMPLE_RADIUS  = 60;


// ╔══════════════════════════════════════════════════════════════╗
// ║  NeuralNetwork                                              ║
// ╚══════════════════════════════════════════════════════════════╝
class NeuralNetwork {
  constructor(inputSize, hiddenSize, outputSize) {
    this.iSz = inputSize;
    this.hSz = hiddenSize;
    this.oSz = outputSize;

    const he = n => Math.sqrt(2 / n);
    this.W1 = this._mat(hiddenSize, inputSize,  he(inputSize));
    this.b1 = new Float64Array(hiddenSize);
    this.W2 = this._mat(outputSize, hiddenSize, he(hiddenSize));
    this.b2 = new Float64Array(outputSize);

    this.mW1 = this._zeroMat(hiddenSize, inputSize);
    this.vW1 = this._zeroMat(hiddenSize, inputSize);
    this.mb1 = new Float64Array(hiddenSize);
    this.vb1 = new Float64Array(hiddenSize);
    this.mW2 = this._zeroMat(outputSize, hiddenSize);
    this.vW2 = this._zeroMat(outputSize, hiddenSize);
    this.mb2 = new Float64Array(outputSize);
    this.vb2 = new Float64Array(outputSize);

    this._z1 = new Float64Array(hiddenSize);
    this._a1 = new Float64Array(hiddenSize);
    this._z2 = new Float64Array(outputSize);
    this._a2 = new Float64Array(outputSize);

    this.step       = 0;
    this.lossAvg    = 0;
    this.trainCount = 0;
  }

  _mat(rows, cols, scale) {
    return Array.from({ length: rows }, () =>
      Float64Array.from({ length: cols }, () => (Math.random() * 2 - 1) * scale)
    );
  }
  _zeroMat(rows, cols) {
    return Array.from({ length: rows }, () => new Float64Array(cols));
  }

  _relu (x) { return x > 0 ? x : 0; }
  _drelu(x) { return x > 0 ? 1 : 0; }
  _tanh (x) { return Math.tanh(x); }
  _dtanh(x) { const t = Math.tanh(x); return 1 - t * t; }

  forward(inputs) {
    for (let i = 0; i < this.hSz; i++) {
      let sum = this.b1[i];
      const row = this.W1[i];
      for (let j = 0; j < this.iSz; j++) sum += row[j] * inputs[j];
      this._z1[i] = sum;
      this._a1[i] = this._relu(sum);
    }
    for (let i = 0; i < this.oSz; i++) {
      let sum = this.b2[i];
      const row = this.W2[i];
      for (let j = 0; j < this.hSz; j++) sum += row[j] * this._a1[j];
      this._z2[i] = sum;
      this._a2[i] = this._tanh(sum);
    }
    return this._a2;
  }

  train(inputs, targets) {
    const out = this.forward(inputs);
    this.step++;
    this.trainCount++;

    const dL_dz2 = new Float64Array(this.oSz);
    let loss = 0;
    for (let i = 0; i < this.oSz; i++) {
      const err  = out[i] - targets[i];
      loss      += err * err;
      dL_dz2[i]  = err * this._dtanh(this._z2[i]);
    }
    loss /= this.oSz;

    const dL_dz1 = new Float64Array(this.hSz);
    for (let j = 0; j < this.hSz; j++) {
      let sum = 0;
      for (let i = 0; i < this.oSz; i++) sum += this.W2[i][j] * dL_dz2[i];
      dL_dz1[j] = sum * this._drelu(this._z1[j]);
    }

    const t   = this.step;
    const lr  = NN_LR * Math.sqrt(1 - Math.pow(NN_BETA2, t)) / (1 - Math.pow(NN_BETA1, t));
    const adamUpdate = (w, m, v, grad) => {
      m = NN_BETA1 * m + (1 - NN_BETA1) * grad;
      v = NN_BETA2 * v + (1 - NN_BETA2) * grad * grad;
      return { w: w - lr * m / (Math.sqrt(v) + NN_EPS), m, v };
    };

    for (let i = 0; i < this.oSz; i++) {
      for (let j = 0; j < this.hSz; j++) {
        const g = dL_dz2[i] * this._a1[j];
        const r = adamUpdate(this.W2[i][j], this.mW2[i][j], this.vW2[i][j], g);
        this.W2[i][j] = r.w; this.mW2[i][j] = r.m; this.vW2[i][j] = r.v;
      }
      const rb = adamUpdate(this.b2[i], this.mb2[i], this.vb2[i], dL_dz2[i]);
      this.b2[i] = rb.w; this.mb2[i] = rb.m; this.vb2[i] = rb.v;
    }
    for (let i = 0; i < this.hSz; i++) {
      for (let j = 0; j < this.iSz; j++) {
        const g = dL_dz1[i] * inputs[j];
        const r = adamUpdate(this.W1[i][j], this.mW1[i][j], this.vW1[i][j], g);
        this.W1[i][j] = r.w; this.mW1[i][j] = r.m; this.vW1[i][j] = r.v;
      }
      const rb = adamUpdate(this.b1[i], this.mb1[i], this.vb1[i], dL_dz1[i]);
      this.b1[i] = rb.w; this.mb1[i] = rb.m; this.vb1[i] = rb.v;
    }

    this.lossAvg = this.lossAvg === 0
      ? loss : 0.9 * this.lossAvg + 0.1 * loss;
    return loss;
  }

  trainBatch(batch) {
    let total = 0;
    for (const s of batch) total += this.train(s.inputs, s.targets);
    return total / batch.length;
  }
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  ExperienceBuffer                                           ║
// ╚══════════════════════════════════════════════════════════════╝
class ExperienceBuffer {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this._buf    = [];
    this._head   = 0;
  }
  push(inputs, targets) {
    const s = { inputs: Float64Array.from(inputs), targets: Float64Array.from(targets) };
    if (this._buf.length < this.maxSize) this._buf.push(s);
    else { this._buf[this._head] = s; this._head = (this._head + 1) % this.maxSize; }
  }
  sample(n) {
    const out = [], len = this._buf.length;
    if (!len) return out;
    for (let i = 0; i < n; i++) out.push(this._buf[Math.floor(Math.random() * len)]);
    return out;
  }
  get size() { return this._buf.length; }
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  SightingHeatmap                                            ║
// ╚══════════════════════════════════════════════════════════════╝
class SightingHeatmap {
  constructor() {
    this._grid     = new Float32Array(HEAT_COLS * HEAT_ROWS);
    this._decayT   = 0;
    this.totalHeat = 0;
  }
  record(wx, wy) {
    const col = Math.min(HEAT_COLS-1, Math.max(0, Math.floor(wx / HEAT_CELL)));
    const row = Math.min(HEAT_ROWS-1, Math.max(0, Math.floor(wy / HEAT_CELL)));
    const idx = row * HEAT_COLS + col;
    this._grid[idx] += 1;
    this.totalHeat  += 1;
  }
  update(dt) {
    this._decayT += dt;
    if (this._decayT < HEAT_DECAY_INTERVAL) return;
    this._decayT = 0;
    let sum = 0;
    for (let i = 0; i < this._grid.length; i++) { this._grid[i] *= HEAT_DECAY_RATE; sum += this._grid[i]; }
    this.totalHeat = sum;
  }
  sampleWeighted() {
    if (this.totalHeat < HEAT_MIN_DRAW) return null;
    let cumulative = 0;
    const threshold = Math.random() * this.totalHeat;
    for (let i = 0; i < this._grid.length; i++) {
      cumulative += this._grid[i];
      if (cumulative >= threshold) {
        const col = i % HEAT_COLS, row = Math.floor(i / HEAT_COLS);
        const cx = (col + 0.5) * HEAT_CELL + (Math.random() * 2 - 1) * HEAT_SAMPLE_RADIUS;
        const cy = (row + 0.5) * HEAT_CELL + (Math.random() * 2 - 1) * HEAT_SAMPLE_RADIUS;
        return { x: cx, y: cy };
      }
    }
    return null;
  }
  topCells(n) {
    const indexed = [];
    for (let i = 0; i < this._grid.length; i++) {
      if (this._grid[i] > 0.5) {
        indexed.push({ x: (i%HEAT_COLS+0.5)*HEAT_CELL, y: (Math.floor(i/HEAT_COLS)+0.5)*HEAT_CELL, heat: this._grid[i] });
      }
    }
    indexed.sort((a,b) => b.heat - a.heat);
    return indexed.slice(0, n);
  }
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  GuardBrain                                                 ║
// ╚══════════════════════════════════════════════════════════════╝
class GuardBrain {
  constructor(guardId) {
    this.guardId    = guardId;
    this.nn         = new NeuralNetwork(NN_INPUT_SIZE, NN_HIDDEN_SIZE, NN_OUTPUT_SIZE);
    this.buffer     = new ExperienceBuffer(EXP_BUFFER_SIZE);
    this.heatmap    = new SightingHeatmap();
    this._pending   = [];
    this._frameCount = 0;
    this.samples    = 0;
    this.confidence = 0;
    this.prediction = null;
    this.loss       = 0;
  }

  observe(guard, player, pVel) {
    if (!player.alive) return;
    const now = performance.now() / 1000;
    this.heatmap.record(player.x, player.y);

    const dx = player.x - guard.x, dy = player.y - guard.y;
    const d  = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx);
    const inputs = [
      dx / 300, dy / 300,
      pVel.x / PLAYER_SPD, pVel.y / PLAYER_SPD,
      Math.sin(angle), Math.cos(angle),
      d / 350,
      huntMode ? 1 : 0,
    ];
    this._pending.push({ inputs: Float64Array.from(inputs), px: player.x, py: player.y, t: now });

    const cutoff = now - PREDICT_AHEAD;
    let i = 0;
    while (i < this._pending.length && this._pending[i].t <= cutoff) {
      const obs = this._pending[i];
      const tdx = (player.x - obs.px) / INTERCEPT_SCALE;
      const tdy = (player.y - obs.py) / INTERCEPT_SCALE;
      const targets = [Math.max(-1, Math.min(1, tdx)), Math.max(-1, Math.min(1, tdy))];
      this.buffer.push(obs.inputs, targets);
      this.samples++;
      i++;
    }
    this._pending.splice(0, i);
  }

  maybeTrain(dt) {
    this.heatmap.update(dt);
    this._frameCount++;
    if (this._frameCount % TRAIN_INTERVAL !== 0) return;
    if (this.buffer.size < BATCH_SIZE) return;
    const batch = this.buffer.sample(BATCH_SIZE);
    this.loss = this.nn.trainBatch(batch);
    const trained = this.nn.trainCount;
    this.confidence = Math.min(MAX_CONFIDENCE,
      Math.max(0, (trained - MIN_SAMPLES) / 60) * MAX_CONFIDENCE);
  }

  predict(guard, player, pVel) {
    if (!player.alive) return { x: player.x, y: player.y };
    const dx = player.x - guard.x, dy = player.y - guard.y;
    const d  = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx);
    const inputs = [
      dx/300, dy/300, pVel.x/PLAYER_SPD, pVel.y/PLAYER_SPD,
      Math.sin(angle), Math.cos(angle), d/350, huntMode ? 1 : 0,
    ];
    const out = this.nn.forward(inputs);
    const predX = player.x + out[0] * INTERCEPT_SCALE;
    const predY = player.y + out[1] * INTERCEPT_SCALE;
    const c = this.confidence;
    this.prediction = {
      x: player.x * (1-c) + predX * c,
      y: player.y * (1-c) + predY * c,
    };
    return this.prediction;
  }

  pickHeatTarget(guard, lastKnown, pVel, jitterR = 35) {
    const MARGIN = guard.r + 14;
    const heat = this.heatmap.sampleWeighted();
    if (heat) {
      const spread = (guard.id - 1) * (Math.PI * 2 / 5) + Math.random() * 0.8;
      const r = 10 + Math.random() * jitterR;
      const tx = Math.max(MARGIN, Math.min(900 - MARGIN, heat.x + Math.cos(spread) * r));
      const ty = Math.max(MARGIN, Math.min(600 - MARGIN, heat.y + Math.sin(spread) * r));
      if (!WALLS.some(w => circleRect(tx, ty, MARGIN, w)))
        return { x: tx, y: ty, source: 'heat' };
      const tx2 = Math.max(MARGIN, Math.min(900 - MARGIN, heat.x));
      const ty2 = Math.max(MARGIN, Math.min(600 - MARGIN, heat.y));
      if (!WALLS.some(w => circleRect(tx2, ty2, MARGIN, w)))
        return { x: tx2, y: ty2, source: 'heat' };
    }
    if (this.confidence >= NN_PATROL_CONF_THRESHOLD && lastKnown) {
      const raw = this.predictFrom(guard, lastKnown, pVel);
      const spread = (guard.id - 1) * (Math.PI * 2 / 5) + Math.random() * 0.6;
      const r = 20 + Math.random() * 50;
      const tx = Math.max(MARGIN, Math.min(900 - MARGIN, raw.x + Math.cos(spread) * r));
      const ty = Math.max(MARGIN, Math.min(600 - MARGIN, raw.y + Math.sin(spread) * r));
      if (!WALLS.some(w => circleRect(tx, ty, MARGIN, w)))
        return { x: tx, y: ty, source: 'nn' };
    }
    return null;
  }

  predictFrom(guard, pos, vel) {
    const dx = pos.x - guard.x, dy = pos.y - guard.y;
    const d  = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx);
    const inputs = [
      dx/300, dy/300, vel.x/PLAYER_SPD, vel.y/PLAYER_SPD,
      Math.sin(angle), Math.cos(angle), d/350, huntMode ? 1 : 0,
    ];
    const out = this.nn.forward(inputs);
    return { x: pos.x + out[0] * INTERCEPT_SCALE, y: pos.y + out[1] * INTERCEPT_SCALE };
  }

  softReset() {
    this._pending    = [];
    this._frameCount = 0;
  }
}
