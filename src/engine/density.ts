// Dissonance density: the measure the engine is scored on, and a search on the
// reward scale that aims a generation at a target level.
import { Meter, Note, TimeGrid } from './model';
import { KeySpan } from './theory';
import { DISSONANCE_KINDS, IssueKind, voiceLeadingReport } from './report';
// Type-only: fugue.ts calls searchDissonance with its own generator, so there is no runtime cycle.
import type { FugueResult } from './fugue';

/** The parts of a generated fugue the measure reads. */
export interface MeasuredFugue {
  notes: Note[][];
  entries: { end: number }[];
  keys: KeySpan[];
  ticksPerQuarter: number;
  meter: Meter;
  grid: TimeGrid;
}

export interface DensityMeasure {
  /** Strong-beat dissonances of every kind in DISSONANCE_KINDS (treated ones plus the two errors). */
  count: number;
  /** Bars from the start to the end of the last entry (fractional). */
  bars: number;
  perBar: number;
  /** End tick of the span measured. */
  end: number;
}

const COUNTED = new Set<IssueKind>(DISSONANCE_KINDS);

/**
 * Strong-beat dissonance per bar over the exposition, as the held-out test
 * scores it: the voices cropped at the end of the last entry, reported with
 * the piece's own key plan, every classified strong-beat dissonance counted
 * (suspension, ornamented suspension, retardation, passing and neighbour tones,
 * chordal seventh, appoggiatura, escape tone, anticipation, pedal point,
 * chromatic clash, unexplained), divided by the bars of that span.
 */
export function expositionDissonance(f: MeasuredFugue): DensityMeasure {
  const end = Math.max(0, ...f.entries.map((e) => e.end));
  const voices = f.notes.map((v) =>
    v.filter((n) => n.start < end).map((n) => ({ pitch: n.pitch, start: n.start, dur: Math.min(n.dur, end - n.start) })),
  );
  const issues = voiceLeadingReport(voices, { keys: f.keys, ticksPerBeat: f.ticksPerQuarter, meter: f.meter });
  let count = 0;
  for (const i of issues) if (COUNTED.has(i.kind)) count++;
  const bars = end / f.grid.bar;
  return { count, bars, perBar: bars > 0 ? count / bars : 0, end };
}

/**
 * What the search moves. 'scale' multiplies every reward (their ratios stay;
 * negative ones, net costs, grow too); 'offset' adds the same amount to every
 * reward (their differences stay). See docs/decisions.md 2026-11-21.
 */
export type DissonanceControlKind = 'scale' | 'offset';

export interface DissonanceAttempt {
  /** rewardScale for the 'scale' control, rewardOffset for 'offset'. */
  value: number;
  achieved: number;
}

/** FugueResult.dissonance: how a targetDissonance search went. */
export interface DissonanceControl {
  target: number;
  /** The returned attempt's dissonances per bar (expositionDissonance). */
  achieved: number;
  control: DissonanceControlKind;
  /** Its reward scale (1 with the 'offset' control). */
  scale: number;
  /** Its reward offset (0 with the 'scale' control). */
  offset: number;
  /** Generations run. */
  tries: number;
  /**
   * The lowest and highest measure among the attempts. Not simply the measure
   * at the lowest and highest value tried: each try is a whole generation, so
   * the measure is not monotone in the control, and the closest attempt can
   * lie outside those two.
   */
  reachable: [number, number];
  /** The tolerance used, in dissonances per bar. */
  tolerance: number;
  /** Within tolerance of the target. False: the closest attempt, flagged. */
  hit: boolean;
  /** Every attempt, in the order run. */
  attempts: DissonanceAttempt[];
}

/**
 * The default tolerance is half a dissonance over the exposition, but at least
 * this much per bar: the measure moves in whole dissonances (one is 0.067/bar
 * in a 15-bar exposition), so a fixed 0.05 often asked for a count between two
 * integers. Half a dissonance means "as close as the count allows".
 */
export const TARGET_TOLERANCE = 0.05;
export const toleranceFor = (bars: number): number => Math.max(TARGET_TOLERANCE, bars > 0 ? 0.5 / bars : 0);
export const TARGET_TRIES = 8;
/**
 * Where each control searches, in its own coordinate x: log2(scale) for
 * 'scale' (1/8 to 8, ×4 a step while bracketing), the offset itself for
 * 'offset' (−12 to +12, 4 a step). x = 0 is the default engine.
 */
export const CONTROL_SPACE: Record<DissonanceControlKind, { bounds: [number, number]; step: number; value: (x: number) => number }> = {
  scale: { bounds: [-3, 3], step: 2, value: (x) => 2 ** x },
  offset: { bounds: [-12, 12], step: 4, value: (x) => x },
};

/**
 * Searches a reward control for a generation within `tolerance` of `target`
 * strong-beat dissonances per bar. Starts at the default (x = 0), steps
 * outwards until the target is bracketed or the bound is reached, then
 * narrows the bracket by regula falsi in x, safeguarded towards bisection. The measure is a step function of the scale (each try is a whole
 * generation), so it keeps the closest attempt rather than trusting the last.
 * Deterministic: `run` is called with the same seed every time.
 */
export function searchDissonance(
  run: (value: number) => FugueResult,
  target: number,
  opts: { tolerance?: number; tries?: number; control?: DissonanceControlKind } = {},
): FugueResult {
  // Known after the first try: the exposition's length does not depend on the rewards.
  let tolerance = opts.tolerance ?? TARGET_TOLERANCE;
  const maxTries = Math.max(1, Math.floor(opts.tries ?? TARGET_TRIES));
  const control = opts.control ?? 'offset';
  const space = CONTROL_SPACE[control];
  const [xMin, xMax] = space.bounds;
  const BRACKET_STEP = space.step;
  const tried = new Map<number, { d: number; f: FugueResult }>();
  const attempts: DissonanceAttempt[] = [];
  let best: { x: number; d: number; f: FugueResult } | null = null;

  const attempt = (x: number): number => {
    const seen = tried.get(x);
    if (seen) return seen.d;
    const value = space.value(x);
    const f = run(value);
    const m = expositionDissonance(f);
    const d = m.perBar;
    if (!attempts.length && opts.tolerance === undefined) tolerance = toleranceFor(m.bars);
    tried.set(x, { d, f });
    attempts.push({ value, achieved: d });
    if (!best || Math.abs(d - target) < Math.abs(best.d - target)) best = { x, d, f };
    return d;
  };
  // A hair of slack against rounding, so 1.15 against 1.2 counts as within 0.05.
  const within = (d: number) => Math.abs(d - target) <= tolerance + 1e-9;
  const done = () => attempts.length >= maxTries || (best !== null && within(best.d));

  // Bracket: [lo, hi] in x with d(lo) < target <= d(hi), assuming more reward gives more dissonance.
  let lo = 0;
  let dLo = attempt(0);
  let hi = 0;
  let dHi = dLo;
  let bracketed = false;
  if (!done()) {
    if (dLo < target) {
      while (!done() && hi < xMax) {
        lo = hi;
        dLo = dHi;
        hi = Math.min(xMax, hi + BRACKET_STEP);
        dHi = attempt(hi);
        if (dHi >= target) { bracketed = true; break; }
      }
    } else {
      while (!done() && lo > xMin) {
        hi = lo;
        dHi = dLo;
        lo = Math.max(xMin, lo - BRACKET_STEP);
        dLo = attempt(lo);
        if (dLo < target) { bracketed = true; break; }
      }
    }
  }
  // Narrow it.
  while (bracketed && !done() && hi - lo > (xMax - xMin) / 384) {
    const w = hi - lo;
    let x = dHi > dLo ? lo + ((target - dLo) / (dHi - dLo)) * w : lo + w / 2;
    // Keep away from the ends, so a flat stretch of the step function still shrinks the bracket.
    x = Math.min(hi - 0.2 * w, Math.max(lo + 0.2 * w, x));
    const d = attempt(x);
    if (d < target) { lo = x; dLo = d; } else { hi = x; dHi = d; }
  }

  const ds = attempts.map((a) => a.achieved);
  const b = best!;
  const out: DissonanceControl = {
    target,
    achieved: b.d,
    control,
    scale: control === 'scale' ? space.value(b.x) : 1,
    offset: control === 'offset' ? space.value(b.x) : 0,
    tries: attempts.length,
    tolerance,
    reachable: [Math.min(...ds), Math.max(...ds)],
    hit: within(b.d),
    attempts,
  };
  return { ...b.f, dissonance: out };
}
