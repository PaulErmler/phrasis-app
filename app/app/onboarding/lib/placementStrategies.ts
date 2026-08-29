/**
 * Adaptive placement-test strategies.
 *
 * Seven strategy classes implement the same `PlacementStrategy` interface,
 * so the runtime test runner can swap them with a single identifier change.
 * The active strategy is named by the `DEFAULT_STRATEGY` string constant at
 * the bottom of this file and instantiated via `createStrategy(name)`.
 * Change that one assignment to change what the live onboarding uses.
 */

import { OGTE_MIN_LEVEL, OGTE_MAX_LEVEL } from '@/lib/constants/onboarding';
import type { CurrentLevel } from '../types';

// Re-exported under the strategy-local names; the canonical bounds live in
// lib/constants/onboarding.ts so the server's starting-collection resolution
// and this client-side placement logic can't drift apart.
export const MIN_LEVEL = OGTE_MIN_LEVEL;
export const MAX_LEVEL = OGTE_MAX_LEVEL;

/**
 * Schema-version of placement-state rows. Stamped on every
 * `onboardingProgress.placementTest` write and verified on read. Bump
 * whenever the shape of `history`, the `strategy` identifier set, or the
 * semantics of `finalLevel` changes. Readers will discard rows whose
 * `strategyVersion` doesn't match and restart the placement test from
 * scratch (kill-switch for resuming incompatible state). Strategy classes
 * themselves are not versioned individually; the single version covers the
 * whole envelope written to the DB.
 */
export const CURRENT_PLACEMENT_STRATEGY_VERSION = 1;

export type StrategyName =
  | 'binary'
  | 'staircase'
  | 'staircase-from-bottom'
  | 'bayesian'
  | 'transformed-staircase'
  | 'anchor-verify'
  | 'ramp-bisect';

export interface PlacementAnswer {
  level: number;
  knew: boolean;
}

export interface PlacementStrategy {
  readonly name: StrategyName;
  /** Reset internal state. `userGuess` is the level the user self-reported (1..20). */
  init(opts?: { userGuess?: number }): void;
  /** Return the level (1..20) to ask next, or `null` if the test has converged. */
  nextQuestionLevel(): number | null;
  recordAnswer(level: number, knew: boolean): void;
  /** Final placed level after the test ends. Valid only when `nextQuestionLevel()` is `null`. */
  finalLevel(): number;
  /** History of (level, knew) pairs in question order. */
  history(): readonly PlacementAnswer[];
  /** Opaque snapshot of internal state, used by the prototype debug panel. */
  state(): unknown;
}

function clampLevel(n: number): number {
  if (n < MIN_LEVEL) return MIN_LEVEL;
  if (n > MAX_LEVEL) return MAX_LEVEL;
  return Math.round(n);
}

/** Shared base: every strategy records its (level, knew) answers the same
 *  way and exposes them verbatim via `history()`. Each subclass still
 *  resets `this.answers = []` in its own `init()`. */
abstract class BaseStrategy implements PlacementStrategy {
  abstract readonly name: StrategyName;
  protected answers: PlacementAnswer[] = [];

  abstract init(opts?: { userGuess?: number }): void;
  abstract nextQuestionLevel(): number | null;
  abstract recordAnswer(level: number, knew: boolean): void;
  abstract finalLevel(): number;
  abstract state(): unknown;

  history(): readonly PlacementAnswer[] {
    return this.answers;
  }
}

/** Shared `finalLevel()` rule for the two reversal-terminated staircases:
 *  mean of the last `reversalsNeeded` reversal levels when the test
 *  terminated on reversals; otherwise fall back below. */
function reversalMeanFinalLevel(
  reversalLevels: readonly number[],
  answers: readonly PlacementAnswer[],
  reversalsNeeded: number,
): number {
  if (reversalLevels.length >= reversalsNeeded) {
    const lastThree = reversalLevels.slice(-reversalsNeeded);
    const mean = lastThree.reduce((a, b) => a + b, 0) / lastThree.length;
    return clampLevel(mean);
  }
  // Fallback: average of all asked levels weighted toward yes answers.
  const yesLevels = answers.filter((a) => a.knew).map((a) => a.level);
  if (yesLevels.length > 0) {
    return clampLevel(yesLevels.reduce((a, b) => a + b, 0) / yesLevels.length);
  }
  return MIN_LEVEL;
}

// ─── Binary search ──────────────────────────────────────────────────────────
// Maintain [lo, hi]. Ask at mid. Yes → lo = mid + 1, No → hi = mid - 1.
// Final level: highest mid where the user said "yes", or `lo - 1` if no yes yet.

export class BinaryStrategy extends BaseStrategy {
  readonly name = 'binary' as const;
  private lo = MIN_LEVEL;
  private hi = MAX_LEVEL;
  private lastYesLevel: number | null = null;

  init(): void {
    this.lo = MIN_LEVEL;
    this.hi = MAX_LEVEL;
    this.lastYesLevel = null;
    this.answers = [];
  }

  nextQuestionLevel(): number | null {
    if (this.lo > this.hi) return null;
    return Math.floor((this.lo + this.hi) / 2);
  }

  recordAnswer(level: number, knew: boolean): void {
    this.answers.push({ level, knew });
    if (knew) {
      this.lastYesLevel = Math.max(this.lastYesLevel ?? 0, level);
      this.lo = level + 1;
    } else {
      this.hi = level - 1;
    }
  }

  finalLevel(): number {
    if (this.lastYesLevel !== null) return clampLevel(this.lastYesLevel);
    // No yes ever. They didn't know even the easiest level we asked.
    return MIN_LEVEL;
  }

  state(): unknown {
    return {
      lo: this.lo,
      hi: this.hi,
      lastYesLevel: this.lastYesLevel,
      answers: this.answers,
    };
  }
}

// ─── Staircase ──────────────────────────────────────────────────────────────
// Start near the user's guess. +1 on Yes, −1 on No. Track reversals (direction
// changes). Stop after 3 reversals or 12 questions. Final = mean of last 3
// reversal levels.

const STAIRCASE_REVERSALS = 3;
const STAIRCASE_MAX_QUESTIONS = 12;
const STAIRCASE_DEFAULT_START = 8;

export class StaircaseStrategy extends BaseStrategy {
  readonly name = 'staircase' as const;
  private current = STAIRCASE_DEFAULT_START;
  private lastDirection: 'up' | 'down' | null = null;
  private reversalLevels: number[] = [];
  private done = false;

  init(opts?: { userGuess?: number }): void {
    this.current = clampLevel(opts?.userGuess ?? STAIRCASE_DEFAULT_START);
    this.lastDirection = null;
    this.reversalLevels = [];
    this.answers = [];
    this.done = false;
  }

  nextQuestionLevel(): number | null {
    if (this.done) return null;
    return this.current;
  }

  recordAnswer(level: number, knew: boolean): void {
    this.answers.push({ level, knew });
    const direction: 'up' | 'down' = knew ? 'up' : 'down';

    if (this.lastDirection !== null && direction !== this.lastDirection) {
      this.reversalLevels.push(level);
    }
    this.lastDirection = direction;

    const next = knew ? level + 1 : level - 1;
    this.current = clampLevel(next);

    if (
      this.reversalLevels.length >= STAIRCASE_REVERSALS ||
      this.answers.length >= STAIRCASE_MAX_QUESTIONS
    ) {
      this.done = true;
    }

    // Edge case: clamped at boundary in a single direction long enough. Stop.
    if (this.answers.length >= 6 && this.reversalLevels.length === 0) {
      this.done = true;
    }
  }

  finalLevel(): number {
    return reversalMeanFinalLevel(
      this.reversalLevels,
      this.answers,
      STAIRCASE_REVERSALS,
    );
  }

  state(): unknown {
    return {
      current: this.current,
      lastDirection: this.lastDirection,
      reversalLevels: this.reversalLevels,
      answers: this.answers,
      done: this.done,
    };
  }
}

// ─── Bayesian / IRT-lite ────────────────────────────────────────────────────
// Maintain a posterior over levels 1..20. Per question at level L, model
//   P(knew | trueLevel = T) = sigmoid(α · (T − L))
// with α = 0.9. After each answer, posterior[i] *= likelihood; renormalize.
// Ask at the posterior mode (good heuristic, cheap to compute).
// Stop when peak posterior ≥ 0.55 OR after `BAYESIAN_MAX_QUESTIONS`.

const BAYESIAN_ALPHA = 0.9;
const BAYESIAN_STOP_POSTERIOR = 0.55;
const BAYESIAN_MIN_QUESTIONS = 4;
const BAYESIAN_MAX_QUESTIONS = 10;

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export class BayesianStrategy extends BaseStrategy {
  readonly name = 'bayesian' as const;
  private posterior: number[] = [];

  init(): void {
    // Uniform prior. Could be peaked at userGuess later if helpful.
    const n = MAX_LEVEL - MIN_LEVEL + 1;
    this.posterior = new Array(n).fill(1 / n);
    this.answers = [];
  }

  private peak(): { level: number; probability: number } {
    let bestIdx = 0;
    let best = -Infinity;
    for (let i = 0; i < this.posterior.length; i++) {
      if (this.posterior[i] > best) {
        best = this.posterior[i];
        bestIdx = i;
      }
    }
    return { level: bestIdx + MIN_LEVEL, probability: best };
  }

  nextQuestionLevel(): number | null {
    if (this.answers.length >= BAYESIAN_MAX_QUESTIONS) return null;
    const { probability } = this.peak();
    if (
      this.answers.length >= BAYESIAN_MIN_QUESTIONS &&
      probability >= BAYESIAN_STOP_POSTERIOR
    ) {
      return null;
    }
    // Heuristic: ask at the posterior mode. Cheap and effective.
    return this.peak().level;
  }

  recordAnswer(level: number, knew: boolean): void {
    this.answers.push({ level, knew });
    const updated = this.posterior.map((prior, idx) => {
      const trueLevel = idx + MIN_LEVEL;
      const pKnew = sigmoid(BAYESIAN_ALPHA * (trueLevel - level));
      const likelihood = knew ? pKnew : 1 - pKnew;
      return prior * likelihood;
    });
    const total = updated.reduce((a, b) => a + b, 0);
    this.posterior = total > 0 ? updated.map((p) => p / total) : this.posterior;
  }

  finalLevel(): number {
    return this.peak().level;
  }

  state(): unknown {
    return {
      posterior: this.posterior.map((p, i) => ({ level: i + MIN_LEVEL, p })),
      peak: this.peak(),
      answers: this.answers,
    };
  }
}

// ─── Transformed staircase (2-down / 1-up) ──────────────────────────────────
// Classical adapted staircase from psychophysics. To step UP you need TWO
// correct answers in a row at the current level; a single wrong answer steps
// DOWN. Converges to the ~70.7% threshold (where the user "mostly knows it"),
// not the 50% boundary the basic staircase converges to. In practice this
// returns a level the user reliably handles. Fixes the standard staircase's
// tendency to overshoot by 1 level at the boundary.
//
// Trades more questions (typically 10–14) for tighter placement.

const TRANSFORMED_REVERSALS = 3;
const TRANSFORMED_MAX_QUESTIONS = 14;
const TRANSFORMED_DEFAULT_START = 8;

export class TransformedStaircaseStrategy extends BaseStrategy {
  readonly name = 'transformed-staircase' as const;
  private current = TRANSFORMED_DEFAULT_START;
  private lastDirection: 'up' | 'down' | null = null;
  private reversalLevels: number[] = [];
  private done = false;
  private consecutiveYes = 0;

  init(opts?: { userGuess?: number }): void {
    this.current = clampLevel(opts?.userGuess ?? TRANSFORMED_DEFAULT_START);
    this.lastDirection = null;
    this.reversalLevels = [];
    this.answers = [];
    this.done = false;
    this.consecutiveYes = 0;
  }

  nextQuestionLevel(): number | null {
    if (this.done) return null;
    return this.current;
  }

  recordAnswer(level: number, knew: boolean): void {
    this.answers.push({ level, knew });

    let direction: 'up' | 'down' | null = null;
    if (knew) {
      this.consecutiveYes++;
      if (this.consecutiveYes >= 2) {
        direction = 'up';
        this.consecutiveYes = 0;
        this.current = clampLevel(level + 1);
      }
      // else: stay at this level, ask again
    } else {
      direction = 'down';
      this.consecutiveYes = 0;
      this.current = clampLevel(level - 1);
    }

    if (direction !== null) {
      if (this.lastDirection !== null && direction !== this.lastDirection) {
        this.reversalLevels.push(level);
      }
      this.lastDirection = direction;
    }

    if (
      this.reversalLevels.length >= TRANSFORMED_REVERSALS ||
      this.answers.length >= TRANSFORMED_MAX_QUESTIONS
    ) {
      this.done = true;
    }

    if (
      this.answers.length >= 6 &&
      this.reversalLevels.length === 0 &&
      (this.current === MIN_LEVEL || this.current === MAX_LEVEL)
    ) {
      this.done = true;
    }
  }

  finalLevel(): number {
    return reversalMeanFinalLevel(
      this.reversalLevels,
      this.answers,
      TRANSFORMED_REVERSALS,
    );
  }

  state(): unknown {
    return {
      current: this.current,
      lastDirection: this.lastDirection,
      reversalLevels: this.reversalLevels,
      answers: this.answers,
      consecutiveYes: this.consecutiveYes,
      done: this.done,
    };
  }
}

// ─── Anchor + verify (with fine-tune phase) ─────────────────────────────────
// Two phases:
//
//   COARSE: Ask 3 questions at the anchor (default 8).
//     3/3 right  → jump +3 (up to ANCHOR_MAX_JUMPS times)
//     0/3 right  → jump −3
//     mixed      → settle, enter FINE
//
//   FINE: After coarse settles or runs out of jumps, refine within ±2 levels
//   of the current anchor by walking the boundary with single-level steps.
//   Stops after one reversal or `ANCHOR_FINE_BUDGET` questions, whichever
//   first. Eliminates the ±3 error band the coarse-only version had.

const ANCHOR_BATCH = 3;
const ANCHOR_MAX_JUMPS = 2;
const ANCHOR_DEFAULT = 8;
const ANCHOR_JUMP = 3;
const ANCHOR_FINE_BUDGET = 3; // max extra questions in the fine phase
const ANCHOR_HARD_QUESTION_CAP = 12; // safety ceiling across both phases

type AnchorPhase = 'coarse' | 'fine' | 'done';

export class AnchorVerifyStrategy extends BaseStrategy {
  readonly name = 'anchor-verify' as const;
  private current = ANCHOR_DEFAULT;
  private batchYes = 0;
  private batchCount = 0;
  private jumps = 0;
  private phase: AnchorPhase = 'coarse';
  // Fine-phase state
  private fineAsked = 0;
  private fineDirection: 'up' | 'down' | null = null;
  private fineLastKnew: boolean | null = null;

  init(opts?: { userGuess?: number }): void {
    this.current = clampLevel(opts?.userGuess ?? ANCHOR_DEFAULT);
    this.batchYes = 0;
    this.batchCount = 0;
    this.jumps = 0;
    this.answers = [];
    this.phase = 'coarse';
    this.fineAsked = 0;
    this.fineDirection = null;
    this.fineLastKnew = null;
  }

  nextQuestionLevel(): number | null {
    if (this.phase === 'done') return null;
    if (this.answers.length >= ANCHOR_HARD_QUESTION_CAP) return null;
    return this.current;
  }

  /** Enter the fine-tune phase, deciding which direction to probe based on
   *  the coarse phase's outcome at the current level. */
  private enterFinePhase(coarseRatio: number): void {
    if (coarseRatio >= 1 - 1e-9) {
      // Unanimous yes. User likely sits above current level. Probe up.
      this.fineDirection = 'up';
      this.current = clampLevel(this.current + 1);
    } else if (coarseRatio <= 1e-9) {
      // Unanimous no. User sits below. Probe down.
      this.fineDirection = 'down';
      this.current = clampLevel(this.current - 1);
    } else {
      // Mixed. The answer is roughly here. Probe whichever side had fewer
      // hits to confirm direction.
      if (coarseRatio >= 0.5) {
        this.fineDirection = 'up';
        this.current = clampLevel(this.current + 1);
      } else {
        this.fineDirection = 'down';
        this.current = clampLevel(this.current - 1);
      }
    }
    this.phase = 'fine';
  }

  recordAnswer(level: number, knew: boolean): void {
    this.answers.push({ level, knew });

    if (this.phase === 'coarse') {
      this.batchCount++;
      if (knew) this.batchYes++;

      if (this.batchCount >= ANCHOR_BATCH) {
        const ratio = this.batchYes / this.batchCount;
        const allYes = ratio >= 1 - 1e-9;
        const allNo = ratio <= 1e-9;

        if (
          allYes &&
          this.jumps < ANCHOR_MAX_JUMPS &&
          this.current < MAX_LEVEL
        ) {
          // Coarse jump up, still room.
          this.current = clampLevel(this.current + ANCHOR_JUMP);
          this.jumps++;
          this.batchYes = 0;
          this.batchCount = 0;
        } else if (
          allNo &&
          this.jumps < ANCHOR_MAX_JUMPS &&
          this.current > MIN_LEVEL
        ) {
          // Coarse jump down, still room.
          this.current = clampLevel(this.current - ANCHOR_JUMP);
          this.jumps++;
          this.batchYes = 0;
          this.batchCount = 0;
        } else {
          // Coarse phase exhausted (mixed, max jumps, or hit boundary).
          // Enter the fine-tune phase to refine within ±2 of current.
          this.enterFinePhase(ratio);
        }
      }
      return;
    }

    if (this.phase === 'fine') {
      this.fineAsked++;

      // Reversal. Direction flipped. We found the boundary. Done.
      if (this.fineLastKnew !== null && this.fineLastKnew !== knew) {
        this.phase = 'done';
        return;
      }
      this.fineLastKnew = knew;

      if (this.fineAsked >= ANCHOR_FINE_BUDGET) {
        this.phase = 'done';
        return;
      }

      // Walk in the same direction one more step.
      if (this.fineDirection === 'up' && knew && this.current < MAX_LEVEL) {
        this.current = clampLevel(this.current + 1);
      } else if (this.fineDirection === 'up' && !knew) {
        // Stop. We just found a level the user doesn't know.
        this.phase = 'done';
      } else if (
        this.fineDirection === 'down' &&
        !knew &&
        this.current > MIN_LEVEL
      ) {
        this.current = clampLevel(this.current - 1);
      } else if (this.fineDirection === 'down' && knew) {
        // Stop. Found a level they DO know while probing downward.
        this.phase = 'done';
      } else {
        this.phase = 'done';
      }
    }
  }

  finalLevel(): number {
    // Highest level where the user answered "knew it". If they answered
    // nothing right, place at MIN_LEVEL.
    const yes = this.answers.filter((a) => a.knew).map((a) => a.level);
    if (yes.length === 0) return MIN_LEVEL;
    return clampLevel(Math.max(...yes));
  }

  state(): unknown {
    return {
      phase: this.phase,
      current: this.current,
      batchYes: this.batchYes,
      batchCount: this.batchCount,
      jumps: this.jumps,
      fineAsked: this.fineAsked,
      fineDirection: this.fineDirection,
      fineLastKnew: this.fineLastKnew,
      answers: this.answers,
    };
  }
}

// ─── Staircase from bottom (1↑/1↓, starts at level 1) ──────────────────────
// Walks up from MIN_LEVEL one step at a time: +1 on a correct answer, −1 on
// a wrong one. Terminates as soon as any single level has been reached
// (asked at) **three times**. That's the level the user oscillates around,
// so we lock it in as the placement.
//
// Boundary semantics: at MAX_LEVEL, "knew" stays at MAX_LEVEL and counts
// as another visit there. At MIN_LEVEL, "didn't know" stays at MIN_LEVEL
// and counts as another visit there. So a user who confidently answers
// "knew" all the way to L20 terminates at L20 after three correct answers
// at the ceiling; a user who can't even handle L01 terminates at L01
// after three wrong answers at the floor.
//
// Distinct from `RampBisectStrategy`: this one keeps walking up and down
// 1 level at a time after the first wrong, instead of switching to bisect.
// Distinct from `StaircaseStrategy`: this one is hard-pinned to start at
// level 1, ignoring any userGuess seed, and uses visit-count termination
// instead of reversal-count termination.

const SFB_VISITS_TO_LOCK = 3;
const SFB_HARD_CAP = 30; // safety ceiling — never reachable in practice (a perfect ascent from L01 to L20 + 3 visits at L20 is only 22 asks)

export class StaircaseFromBottomStrategy extends BaseStrategy {
  readonly name = 'staircase-from-bottom' as const;
  private current = MIN_LEVEL;
  private visits: Map<number, number> = new Map();
  private lockedLevel: number | null = null;

  init(): void {
    this.current = MIN_LEVEL;
    this.visits = new Map();
    this.answers = [];
    this.lockedLevel = null;
  }

  nextQuestionLevel(): number | null {
    if (this.lockedLevel !== null) return null;
    if (this.answers.length >= SFB_HARD_CAP) return null;
    return this.current;
  }

  recordAnswer(level: number, knew: boolean): void {
    this.answers.push({ level, knew });
    const nextVisitCount = (this.visits.get(level) ?? 0) + 1;
    this.visits.set(level, nextVisitCount);

    if (nextVisitCount >= SFB_VISITS_TO_LOCK) {
      this.lockedLevel = level;
      return;
    }

    // Move for the next ask. clampLevel handles the boundary cases, at
    // MAX_LEVEL "knew" stays put, at MIN_LEVEL "didn't know" stays put.
    const target = knew ? level + 1 : level - 1;
    this.current = clampLevel(target);
  }

  finalLevel(): number {
    if (this.lockedLevel !== null) return this.lockedLevel;
    // Safety-net (hit the hard cap without locking), pick the most-visited
    // level, or MIN_LEVEL if nothing was visited yet.
    let best = MIN_LEVEL;
    let bestCount = 0;
    for (const [lvl, count] of this.visits) {
      if (count > bestCount || (count === bestCount && lvl > best)) {
        best = lvl;
        bestCount = count;
      }
    }
    return best;
  }

  state(): unknown {
    return {
      current: this.current,
      visits: Object.fromEntries(this.visits),
      answers: this.answers,
      lockedLevel: this.lockedLevel,
    };
  }
}

// ─── Ramp + bisect (bottom-up, accelerating jumps) ──────────────────────────
// Two phases:
//
//   RAMP: Walk up the curriculum starting at level 1 with progressively
//   larger jumps so the test never opens with a hard sentence. The jumps
//   accelerate (+1, +1, +2, +3, +4, +5, +3) so an absolute-beginner only
//   sees a couple of questions before the test ends, while an advanced
//   user reaches the top in ~7 asks. Sequence: 1 → 2 → 3 → 5 → 8 → 12 →
//   17 → 20. As soon as the user gets one wrong, exit ramp and bisect.
//
//   BISECT: Standard binary search between the last "knew" level (lo)
//   and the first "didn't know" level - 1 (hi). Converges within
//   ⌈log2(span)⌉ further questions: typically 2-3.
//
// Final placement: highest level the user answered "knew it" on. If they
// missed every question (including level 1), place at MIN_LEVEL.
//
// Designed for the onboarding-flow review: easy first question, smooth
// ramp for confident users, surgical refinement after the first stumble.

const RAMP_SEQUENCE = [1, 2, 3, 5, 8, 12, 17, 20] as const;

export class RampBisectStrategy extends BaseStrategy {
  readonly name = 'ramp-bisect' as const;
  private phase: 'ramp' | 'bisect' | 'done' = 'ramp';
  private rampIdx = 0;
  private lo = MIN_LEVEL; // last "knew" + 1 (or MIN_LEVEL if no yes yet)
  private hi = MAX_LEVEL; // last "didn't know" - 1 (or MAX_LEVEL if no no yet)
  private lastYesLevel: number | null = null;

  init(): void {
    this.phase = 'ramp';
    this.rampIdx = 0;
    this.lo = MIN_LEVEL;
    this.hi = MAX_LEVEL;
    this.lastYesLevel = null;
    this.answers = [];
  }

  nextQuestionLevel(): number | null {
    if (this.phase === 'done') return null;
    if (this.phase === 'ramp') {
      if (this.rampIdx >= RAMP_SEQUENCE.length) return null;
      return RAMP_SEQUENCE[this.rampIdx];
    }
    // bisect
    if (this.lo > this.hi) return null;
    return Math.floor((this.lo + this.hi) / 2);
  }

  recordAnswer(level: number, knew: boolean): void {
    this.answers.push({ level, knew });

    if (this.phase === 'ramp') {
      if (knew) {
        this.lastYesLevel = level;
        this.lo = level + 1;
        this.rampIdx++;
        // Finished the ramp without a single miss. They're at the ceiling.
        if (this.rampIdx >= RAMP_SEQUENCE.length) {
          this.phase = 'done';
        }
      } else {
        // First wrong → exit ramp, narrow to [lo, level-1] and bisect.
        this.hi = level - 1;
        if (this.lo > this.hi) {
          // Wrong on the very first question (level 1), they don't even
          // know L01. Place at MIN_LEVEL.
          this.phase = 'done';
        } else {
          this.phase = 'bisect';
        }
      }
      return;
    }

    if (this.phase === 'bisect') {
      if (knew) {
        this.lastYesLevel = Math.max(this.lastYesLevel ?? 0, level);
        this.lo = level + 1;
      } else {
        this.hi = level - 1;
      }
      if (this.lo > this.hi) {
        this.phase = 'done';
      }
    }
  }

  finalLevel(): number {
    if (this.lastYesLevel !== null) return clampLevel(this.lastYesLevel);
    return MIN_LEVEL;
  }

  state(): unknown {
    return {
      phase: this.phase,
      rampIdx: this.rampIdx,
      lo: this.lo,
      hi: this.hi,
      lastYesLevel: this.lastYesLevel,
      answers: this.answers,
    };
  }
}

// ─── Factory + default ──────────────────────────────────────────────────────

export function createStrategy(name: StrategyName): PlacementStrategy {
  switch (name) {
    case 'binary':
      return new BinaryStrategy();
    case 'staircase':
      return new StaircaseStrategy();
    case 'bayesian':
      return new BayesianStrategy();
    case 'transformed-staircase':
      return new TransformedStaircaseStrategy();
    case 'anchor-verify':
      return new AnchorVerifyStrategy();
    case 'ramp-bisect':
      return new RampBisectStrategy();
    case 'staircase-from-bottom':
      return new StaircaseFromBottomStrategy();
  }
}

// Swap this single line to change the strategy the live onboarding uses.
// `staircase-from-bottom` gives users a fair chance to climb back up after
// a single miss (terminates on the 3rd visit to any single level), instead
// of stopping the moment the bisect interval empties.
export const DEFAULT_STRATEGY: StrategyName = 'staircase-from-bottom';

// Maps the precise 1..20 OGTE level the placement test produces back onto the
// 6-bucket currentLevel enum the existing `createCourse` flow expects (see
// convex/lib/collections.ts:79). Used at completeOnboarding time so we can
// keep the existing downstream pipeline unchanged.
export function ogteToCurrentLevel(level: number): CurrentLevel {
  if (level <= 2) return 'beginner';
  if (level <= 5) return 'elementary';
  if (level <= 8) return 'intermediate';
  if (level <= 11) return 'upper_intermediate';
  if (level <= 14) return 'advanced';
  return 'proficient';
}

// Maps the 6-bucket currentLevel back to a representative OGTE level. Used
// when the user self-picks a level so the placement-test corpus can show them
// sample sentences at the right level.
export function currentLevelToOgte(level: CurrentLevel): number {
  switch (level) {
    case 'beginner':
      return 1;
    case 'elementary':
      return 5;
    case 'intermediate':
      return 8;
    case 'upper_intermediate':
      return 11;
    case 'advanced':
      return 14;
    case 'proficient':
      return 17;
  }
}
