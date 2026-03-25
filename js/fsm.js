// ╔══════════════════════════════════════════════════════════════╗
// ║  fsm.js  –  Finite State Machine (reusable module)          ║
// ║  Assignment: Browser Game with Finite State Machine         ║
// ╚══════════════════════════════════════════════════════════════╝
'use strict';

/**
 * FSM – Generic Finite State Machine
 *
 * Usage:
 *   const machine = new FSM('IDLE');
 *   machine.addTransition('IDLE', 'WALK', ctx => ctx.moving);
 *   machine.update(dt, context);  // evaluates transitions each tick
 *   console.log(machine.state);   // current state string
 */
class FSM {
  /**
   * @param {string} initialState  Starting state label
   */
  constructor(initialState) {
    this.state  = initialState; // current state
    this.prev   = null;         // previous state (set on transition)
    this.timer  = 0;            // seconds spent in current state
    this._rules = [];           // registered transition rules
  }

  /**
   * Register a transition rule.
   *
   * @param {string|string[]} from   Source state(s), or '*' for any state
   * @param {string}          to     Target state
   * @param {Function}        condition  (context, stateTimer) => boolean
   * @param {Function}        [onEnter]  Optional callback fired on transition
   */
  addTransition(from, to, condition, onEnter) {
    this._rules.push({ from, to, condition, onEnter });
  }

  /**
   * Evaluate all transitions and advance state if a condition is met.
   * Only one transition fires per tick (first matching rule wins).
   *
   * @param {number} dt       Delta time in seconds
   * @param {object} context  Arbitrary data passed to condition functions
   */
  update(dt, context) {
    this.timer += dt;

    for (const rule of this._rules) {
      const fromMatch =
        rule.from === '*' ||
        rule.from === this.state ||
        (Array.isArray(rule.from) && rule.from.includes(this.state));

      if (fromMatch && rule.condition(context, this.timer)) {
        this.prev  = this.state;
        this.state = rule.to;
        this.timer = 0;
        if (rule.onEnter) rule.onEnter(context);
        break; // one transition per tick
      }
    }
  }
}
