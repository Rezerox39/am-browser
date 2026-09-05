'use strict';

/**
 * AM Spring Physics — lightweight damped harmonic oscillator.
 *
 * Provides fluid, natural motion for UI elements. The spring is configured
 * with stiffness (how fast it converges), damping (how quickly oscillation
 * decays), and mass (inertia weight).
 *
 * Usage:
 *   const spring = new Spring({ stiffness: 180, damping: 12, mass: 1 });
 *   spring.setTarget(400);       // animate to x=400
 *   spring.setPosition(100);     // start from x=100
 *   // In rAF loop:
 *   spring.step(dt);
 *   console.log(spring.position); // current animated value
 *   if (spring.isSettled()) { ... }
 */

class Spring {
  /**
   * @param {object} opts
   * @param {number} opts.stiffness   - Spring constant (higher = snappier). Default 180
   * @param {number} opts.damping     - Friction (higher = less bouncy). Default 12
   * @param {number} opts.mass        - Inertia weight. Default 1
   * @param {number} opts.precision   - Threshold to consider settled. Default 0.5
   */
  constructor(opts = {}) {
    this.stiffness = opts.stiffness ?? 180;
    this.damping = opts.damping ?? 12;
    this.mass = opts.mass ?? 1;
    this.precision = opts.precision ?? 0.5;
    this.position = opts.position ?? 0;
    this.velocity = opts.velocity ?? 0;
    this.target = opts.target ?? opts.position ?? 0;
    this._settled = true;
  }

  setPosition(v) {
    this.position = v;
    this._settled = false;
  }

  setTarget(v) {
    if (Math.abs(this.target - v) > 0.01) {
      this.target = v;
      this._settled = false;
    }
  }

  /** Apply an impulse (instantaneous velocity change). */
  applyImpulse(v) {
    this.velocity += v;
    this._settled = false;
  }

  /** Step the simulation forward by dt seconds. */
  step(dt) {
    if (this._settled) return;

    // Clamp dt to avoid spiral of death
    dt = Math.min(dt, 0.064);

    // Forces
    const displacement = this.position - this.target;
    const springForce = -this.stiffness * displacement;
    const dampingForce = -this.damping * this.velocity;
    const acceleration = (springForce + dampingForce) / this.mass;

    // Verlet-style integration (more stable than Euler)
    this.velocity += acceleration * dt;
    this.position += this.velocity * dt;

    // Check settled
    if (
      Math.abs(this.velocity) < this.precision &&
      Math.abs(this.position - this.target) < this.precision
    ) {
      this.position = this.target;
      this.velocity = 0;
      this._settled = true;
    }
  }

  isSettled() {
    return this._settled;
  }

  reset() {
    this.velocity = 0;
    this._settled = true;
  }
}

/**
 * 2D spring — combines two independent Spring instances for x and y.
 */
class Spring2D {
  constructor(opts = {}) {
    const s = {
      stiffness: opts.stiffness ?? 180,
      damping: opts.damping ?? 12,
      mass: opts.mass ?? 1,
      precision: opts.precision ?? 0.5,
    };
    this.x = new Spring({ ...s, position: opts.x ?? 0, target: opts.targetX ?? opts.x ?? 0 });
    this.y = new Spring({ ...s, position: opts.y ?? 0, target: opts.targetY ?? opts.y ?? 0 });
  }

  setPosition(x, y) {
    this.x.setPosition(x);
    this.y.setPosition(y);
  }

  setTarget(x, y) {
    this.x.setTarget(x);
    this.y.setTarget(y);
  }

  applyImpulse(vx, vy) {
    this.x.applyImpulse(vx);
    this.y.applyImpulse(vy);
  }

  step(dt) {
    this.x.step(dt);
    this.y.step(dt);
  }

  isSettled() {
    return this.x.isSettled() && this.y.isSettled();
  }

  reset() {
    this.x.reset();
    this.y.reset();
  }
}

module.exports = { Spring, Spring2D };
