// Line generation by beam search over a fixed rhythm.
// Every candidate pitch is scored against the voices already written
// (harmonic rules) and against the line itself (melodic rules).
import { Note, TimeGrid, noteEnd, toTimeGrid } from './model';
import { Key, chordsOf, chromaticClash, mod12, spelledDissonant, usablePcs } from './theory';
import { Rng, pickWeighted } from './rng';
import { Chord } from './harmony';

export interface Slot {
  start: number;
  dur: number;
}

export type Relation = 'above' | 'below';

export interface LineSpec {
  slots: Slot[];
  range: [number, number];
  keyAt: (tick: number) => Key;
  /**
   * Alternative contexts the line must satisfy at the same time. Each
   * alternative is a list of voices. A countersubject uses two: the subject
   * and the answer (moved back to the tonic), so it works against both.
   */
  contexts: Note[][][];
  /** Per alternative, per voice: where this line must sit relative to that voice. */
  relations?: (Relation | undefined)[][];
  /** Treat 4ths and 5ths as dissonant (invertible counterpoint at the octave). */
  invertible?: boolean;
  /** The note this voice sang just before the line starts. */
  startPitch?: number;
  /** The note this voice sings right after the line ends. */
  targetPitch?: number;
  /** Restrict pitch classes (absolute), e.g. a final tonic chord. */
  allowedPcs?: number[];
  /**
   * Harmonic skeleton: the chord the whole texture is aiming at on each beat.
   * On the beat the line is pulled towards chord tones, and towards the ones
   * the other voices have not supplied yet.
   */
  chordAt?: (tick: number) => Chord | undefined;
  /** Resolution and meter: strong beats are the metric beats (dotted quarters in x/8). A number is the old beatsPerBar (x/4, 16th grid). */
  grid: TimeGrid | number;
  /** Overrides for DEFAULT_REWARDS. */
  rewards?: Partial<DissonanceRewards>;
  /** Overrides CHROMATIC_CLASH, the cost of a chromatic clash at any tick; for experiments. */
  clashPenalty?: number;
  /**
   * 'soft' (default): every rule is a cost. 'hard': the rules marked hard in
   * LINE_RULES prune the beam instead, and the dissonance rewards are 0.
   */
  constraints?: Constraints;
  /** Hard mode: steps where no candidate kept every hard rule, so the least-bad ones were allowed. Appended to. */
  relaxations?: Relaxation[];
  beam?: number;
  noise?: number;
}

export type Constraints = 'soft' | 'hard';

/**
 * Every cost generateLine charges, and how hard mode treats it. hard = a
 * textbook prohibition: a candidate breaking it is dropped from the beam (in
 * soft mode it is a cost, as listed). soft = a preference: a cost in both
 * modes. Bonuses (negative costs) are preferences and stay soft. The
 * dissonance rewards (DissonanceRewards) are not here: hard mode sets them to 0.
 * This is the only place the classification lives; flip a flag to move a rule.
 */
export const LINE_RULES = {
  // Hard: textbook prohibitions.
  range: { hard: true, cost: '5 per semitone outside the voice range' },
  parallel: { hard: true, cost: '45: parallel 5ths/8ves (same perfect interval, both voices moving)' },
  hidden: { hard: true, cost: '4: similar motion into a 5th/8ve with a leap in this line' },
  strongDissonance: { hard: true, cost: '30 downbeat, 22 other beats: struck on a strong beat, not a treated form' },
  heldDissonance: { hard: true, cost: '16: held into a strong beat that another voice makes dissonant, not a suspension or seventh' },
  unresolved: { hard: true, cost: 'the waived penalty: a treated dissonance (suspension, passing tone, seventh, against a fixed suspension) not resolved' },
  resolveIntoDissonance: { hard: true, cost: '12: this line\'s treated dissonance resolving onto another dissonance' },
  chromaticClash: { hard: true, cost: 'clashPenalty (60): two forms of one degree at any tick' },
  crossing: { hard: true, cost: '24: on the wrong side of a voice with a set relation' },
  overlap: { hard: true, cost: '0 (hard mode only): moving past the note the neighbouring voice just left' },
  // Soft: preferences.
  melodic: { hard: false, cost: 'interval sizes (tritone and 7ths 18-20), leap recovery, runs, repetition' },
  tendencyTone: { hard: false, cost: '3-10: minor-key leading note / raised 6th not resolving, augmented 2nd' },
  startCentre: { hard: false, cost: '0.15 per semitone from the range centre for a first note' },
  weakDissonance: { hard: false, cost: '15-18: a weak-beat dissonance not moving on by step; 2.5 held over a weak beat' },
  neighbourNote: { hard: false, cost: '2: a weak-beat dissonance turning back (neighbour note)' },
  chordPull: { hard: false, cost: '5-9 off the skeleton chord on a strong beat; bonuses for its missing tones' },
  doubling: { hard: false, cost: '4 doubled seventh or leading note, 1 doubled third' },
  sixFour: { hard: false, cost: '2.5: the fifth of the chord in the bass' },
  nonTriad: { hard: false, cost: '3-5: 3+ voices on a strong beat that fit no triad (no skeleton)' },
  againstResolutionShape: { hard: false, cost: '12: dissonant with a fixed voice stepping down from a note held over the beat (shape only; the held note need not be dissonant)' },
  consonance: { hard: false, cost: 'unison 5, perfect 0.8, imperfect bonus 0.6, contrary-motion bonus 0.4' },
  spacing: { hard: false, cost: '2: more than a 12th (10th invertible) from a related voice' },
  target: { hard: false, cost: '0-8: the last note far from the voice\'s next fixed note' },
} as const satisfies Record<string, { hard: boolean; cost: string }>;
export type LineRule = keyof typeof LINE_RULES;

/** A hard-mode step with no candidate keeping every hard rule. */
export interface Relaxation {
  /** Start tick of the slot. */
  tick: number;
  /** The hard rules the chosen candidates break there. */
  rules: LineRule[];
}

/** Charges a cost under a rule: a cost, or in hard mode for a hard rule, a recorded violation. */
type Pay = (rule: LineRule, cost: number) => number;
const SOFT_PAY: Pay = (_r, c) => c;

const ZERO_REWARDS: DissonanceRewards = { suspension: 0, ornamentedSuspension: 0, retardation: 0, passingTone: 0, chordalSeventh: 0, againstSuspension: 0 };

const IMPERFECT = [false, false, false, true, true, false, false, false, true, true, false, false];

/**
 * Treated strong-beat dissonances, using the report's definitions
 * (voiceLeadingReport). Instead of the strong-beat penalty they earn a
 * reward, and the waived penalty rides on the beam node as an Obligation,
 * charged if the following note(s) do not resolve it to a consonance:
 * - suspension: the note was already sounding and consonant just before
 *   (held over or re-struck). Resolved by a step down (suspension), a step up
 *   (retardation), or one decorating note and then the step down from the
 *   suspended pitch within three beats (ornamented suspension).
 * - passing: struck on the beat by step from the previous note; resolved by
 *   a step on in the same direction.
 * - seventh: the sounding notes form a seventh chord (3+ pitch classes) with
 *   the line's note as its seventh, on the skeleton's root when there is one;
 *   resolved by a step down.
 * When a fixed voice is the suspended one, its resolution is known: the line
 * moving into the dissonance is not penalized, but the waived penalty is
 * charged if the line is dissonant with the resolution note when it arrives.
 * Windows are in metric beats: a resolution within two beats, an ornamented one within three.
 */
const SUSP_BEATS = 2;
const ORN_BEATS = 3;
/**
 * Two forms of one scale degree sounding together (C against C♯ in D minor),
 * at any tick: never treated or rewarded, and dearer than any other single
 * fault (downbeat dissonance 30, parallel perfect 45), so the search accepts
 * one only when every alternative is worse. At 30, chord pull and voice-leading
 * costs outweighed it with chromatic subjects (BWV 869).
 */
export const CHROMATIC_CLASH = 60;
/** Extra cost when a treated dissonance resolves into another dissonance (ours, or against a fixed voice's resolution). */
const RESOLVE_INTO_DISSONANCE = 12;

/** Rewards (cost subtracted) for each treated dissonance; see the comment above. */
export interface DissonanceRewards {
  suspension: number;
  ornamentedSuspension: number;
  retardation: number;
  passingTone: number;
  chordalSeventh: number;
  /** The line moving against a fixed voice's suspension. */
  againstSuspension: number;
}

/**
 * The 4-voice values (fugue.ts TEXTURE_REWARDS overrides them per texture).
 * Negative values are net costs, still far below the 16–30 penalty they replace.
 */
export const DEFAULT_REWARDS: DissonanceRewards = {
  suspension: 2.1,
  ornamentedSuspension: 3.3,
  retardation: -4.2,
  passingTone: -3.7,
  chordalSeventh: 1,
  againstSuspension: 0.5,
};

/** Root-position shapes of the seventh chords, as in the report: maj7, dom7, min7, half-diminished, diminished. */
const SEVENTH_SHAPES = [[0, 4, 7, 11], [0, 4, 7, 10], [0, 3, 7, 10], [0, 3, 6, 10], [0, 3, 6, 9]];

type ObligationKind = 'suspension' | 'ornament' | 'passing' | 'seventh';

/** What the next note owes a treated dissonance in the last one. */
interface Obligation {
  kind: ObligationKind;
  /** The dissonant pitch; for 'ornament', the suspended pitch the resolution steps down from. */
  from: number;
  /** 'passing': the direction to keep moving in. */
  dir: number;
  /** Tick of the dissonance. */
  tick: number;
  /** Voices whose dissonance it explains (each was rewarded once). */
  n: number;
  /** Penalty waived plus rewards given: charged if the obligation is not met. */
  debt: number;
}

interface Grid {
  t0: number;
  pitch: Int16Array[];
  onset: Uint8Array[];
  rel: (Relation | undefined)[];
}

function buildGrid(voices: Note[][], rel: (Relation | undefined)[] | undefined, t0: number, t1: number): Grid {
  const len = Math.max(1, t1 - t0);
  const pitch: Int16Array[] = [];
  const onset: Uint8Array[] = [];
  for (const v of voices) {
    const p = new Int16Array(len).fill(-1);
    const o = new Uint8Array(len);
    for (const n of v) {
      const a = Math.max(n.start, t0);
      const b = Math.min(noteEnd(n), t1);
      for (let t = a; t < b; t++) p[t - t0] = n.pitch;
      if (n.start >= t0 && n.start < t1) o[n.start - t0] = 1;
    }
    pitch.push(p);
    onset.push(o);
  }
  return { t0, pitch, onset, rel: rel ?? voices.map(() => undefined) };
}

interface BeamNode {
  p: number;
  prev: BeamNode | null;
  cost: number;
  lastInt: number;
  runDir: number;
  runLen: number;
  /** Direction a dissonant passing note must keep moving in (0 = any step), or null. */
  pending: number | null;
  /** A treated dissonance in the last note that the next one must resolve. */
  ob: Obligation | null;
  /** A fixed voice's suspension the line moved against: where it resolves, and the waived penalty. */
  fixedSusp: FixedSusp | null;
  /** Hard mode: the hard rules this step broke (only on candidates kept by a relaxation). */
  viol?: LineRule[];
}

interface FixedSusp {
  tick: number;
  pitch: number;
  debt: number;
}

const INTERVAL_COST = [3, 0, 0, 1, 1.2, 2, 18, 3, 5, 5.5, 18, 20, 4];

function melodicCost(prev: number, p: number, node: BeamNode, key: Key, pay: Pay = SOFT_PAY): number {
  const d = p - prev;
  const a = Math.abs(d);
  let cost = pay('melodic', a <= 12 ? INTERVAL_COST[a] : 30);
  const rp = mod12(prev - key.tonic);
  const rc = mod12(p - key.tonic);
  if (key.mode === 'minor') {
    if (rp === 11 && rc !== 0 && d !== 0) cost += pay('tendencyTone', 5);
    if (rp === 9 && rc !== 11 && d !== 0) cost += pay('tendencyTone', 4);
    if (rc === 9 && rp !== 7) cost += pay('tendencyTone', 3);
    if ((rp === 8 && rc === 11) || (rp === 11 && rc === 8)) cost += pay('tendencyTone', 10);
    if (rp === 10 && rc === 0 && d > 0) cost += pay('tendencyTone', 3);
  } else if (rp === 11 && rc !== 0 && a > 2) {
    cost += pay('tendencyTone', 2);
  }
  const li = node.lastInt;
  if (Math.abs(li) >= 5 && !(a <= 2 && a > 0 && Math.sign(d) === -Math.sign(li))) cost += pay('melodic', 3.5);
  if (Math.abs(li) >= 3 && a >= 3 && Math.sign(d) === Math.sign(li)) {
    cost += pay('melodic', 3);
    if (Math.abs(li) + a > 12) cost += pay('melodic', 6);
  }
  if (node.runLen >= 5 && Math.sign(d) === node.runDir) cost += pay('melodic', 2);
  let seen = 0;
  let n: BeamNode | null = node;
  for (let i = 0; i < 6 && n; i++, n = n.prev) if (n.p === p) seen++;
  if (seen >= 2) cost += pay('melodic', 1.5);
  return cost;
}

export function generateLine(spec: LineSpec, rng: Rng): Note[] {
  const { slots, range, keyAt, contexts } = spec;
  if (!slots.length) return [];
  const beam = spec.beam ?? 120;
  const noise = spec.noise ?? 1.2;
  const grid = toTimeGrid(spec.grid);
  const { bar, beat } = grid;
  const SUSP_WINDOW = SUSP_BEATS * beat;
  const ORN_WINDOW = ORN_BEATS * beat;
  const t0 = slots[0].start - 1;
  const t1 = noteEnd(slots[slots.length - 1]);
  const grids = contexts.map((voices, i) => buildGrid(voices, spec.relations?.[i], t0, t1));
  const center = (range[0] + range[1]) / 2;
  const hard = spec.constraints === 'hard';
  const R: DissonanceRewards = hard ? ZERO_REWARDS : { ...DEFAULT_REWARDS, ...spec.rewards };
  const CLASH = spec.clashPenalty ?? CHROMATIC_CLASH;
  // Hard rules broken by the candidate being scored, and what they would have cost (to rank a relaxation).
  let viol: LineRule[] = [];
  let violCost = 0;
  const pay: Pay = hard
    ? (r, c) => {
        if (!LINE_RULES[r].hard) return c;
        viol.push(r);
        violCost += c;
        return 0;
      }
    : SOFT_PAY;

  // Precompute slice ticks per slot and alternative.
  const slices = slots.map((s) =>
    grids.map((g) => {
      const ts = [s.start];
      for (let t = s.start + 1; t < s.start + s.dur; t++) if (g.onset.some((o) => o[t - t0])) ts.push(t);
      return ts;
    }),
  );

  function harmonic(p: number, prevP: number | null, si: number, key: Key): { cost: number; weakDiss: boolean; startDiss: boolean; ob: Obligation | null; fixedSusp: FixedSusp | null } {
    const s = slots[si];
    let cost = 0;
    let weakDiss = false;
    let startDiss = false;
    let ob: Obligation | null = null;
    let fixedSusp: FixedSusp | null = null;
    const chords = chordsOf(key);
    const end = s.start + s.dur;
    const heldIn = si > 0 && noteEnd(slots[si - 1]) === s.start && prevP !== null;
    const canResolve = si + 1 < slots.length && slots[si + 1].start === end;
    // Struck by step from a directly preceding note: can be an accented passing tone.
    const steppedIn = heldIn && p !== prevP && Math.abs(p - prevP!) <= 2;
    for (let gi = 0; gi < grids.length; gi++) {
      const g = grids[gi];
      for (const t of slices[si][gi]) {
        const ti = t - t0;
        let lowest = p;
        let count = 1;
        for (const v of g.pitch) if (v[ti] >= 0) { lowest = Math.min(lowest, v[ti]); count++; }
        const strong = t % beat === 0;
        const downbeat = t % bar === 0;
        const chord = strong ? spec.chordAt?.(t) : undefined;
        const resolvable = strong && canResolve && end <= t + SUSP_WINDOW;
        const seventh = resolvable && isChordSeventh(g, ti, p, chord);
        let outOfChord = 0;
        let explained = false;
        if (chord) {
          const pc = mod12(p);
          const idx = chord.pcs.indexOf(pc);
          if (idx < 0) outOfChord = t === s.start ? (downbeat ? 9 : 7) : 5;
          else {
            let doubled = false;
            for (const v of g.pitch) if (v[ti] >= 0 && mod12(v[ti]) === pc) doubled = true;
            if (!doubled) cost -= pay('chordPull', idx === 1 ? 2.2 : idx === 3 ? 0.4 : 1.4);
            else if (idx === 3 || pc === mod12(chord.key.tonic + 11)) cost += pay('doubling', 4); // doubled seventh / leading note
            else if (idx === 1) cost += pay('doubling', 1);
            if (idx === 2 && count > 1 && p === lowest) cost += pay('sixFour', 2.5); // six-four
          }
        }
        if (count === 1) {
          cost += pay('chordPull', outOfChord);
          continue;
        }
        /** Treat this voice's strong-beat dissonance as `kind` if it fits the slot's obligation. */
        const treat = (kind: ObligationKind, base: number): boolean => {
          if (ob && ob.kind !== kind) return false;
          const r = kind === 'suspension' ? R.suspension : kind === 'passing' ? R.passingTone : R.chordalSeventh;
          cost -= r;
          if (!ob) ob = { kind, from: p, dir: kind === 'passing' ? Math.sign(p - prevP!) : -1, tick: t, n: 0, debt: 0 };
          ob.n++;
          ob.debt += base + r;
          explained = true;
          return true;
        };
        for (let vi = 0; vi < g.pitch.length; vi++) {
          const o = g.pitch[vi][ti];
          if (o < 0) continue;
          const ic = Math.abs(p - o) % 12;
          // Intervals are spelled in the key, so C♯–F (a diminished 4th) is dissonant though it spans a major 3rd.
          const clash = chromaticClash(p, o, key);
          const diss = clash || spelledDissonant(p, o, key) || (ic === 5 && Math.min(p, o) === lowest) || (!!spec.invertible && (ic === 5 || ic === 7));
          // Our note suspended against this voice: same pitch at t-1, consonant
          // with the voice there, resolvable by the next slot within the window.
          // Fourths only as 4–3 (line above); fifths are never suspensions.
          const oPrev = ti > 0 ? g.pitch[vi][ti - 1] : -1;
          const suspendable = resolvable && diss && !clash && ic !== 7 && (ic !== 5 || p > o) && oPrev >= 0 && !dissAt(p, oPrev, key);
          if (clash) {
            if (t === s.start) startDiss = true;
            cost += pay('chromaticClash', CLASH);
          } else if (t === s.start) {
            if (diss) {
              startDiss = true;
              if (strong) {
                const base = downbeat ? 30 : 22;
                if (suspendable && heldIn && prevP === p && treat('suspension', base)) {
                  // re-struck suspension
                } else if (resolvable && steppedIn && ic !== 7 && treat('passing', base)) {
                  // accented passing tone
                } else if (seventh && treat('seventh', base)) {
                  // chordal seventh
                } else {
                  const res: { tick: number; pitch: number } | null = heldIn && !fixedSusp ? fixedResolution(g, vi, ti, prevP!, key) : null;
                  if (res) {
                    cost -= R.againstSuspension;
                    fixedSusp = { ...res, debt: base + R.againstSuspension };
                  } else cost += pay('strongDissonance', base);
                }
              } else weakDiss = true;
            } else if (p === o) cost += pay('consonance', 5);
            else if (IMPERFECT[ic]) cost -= pay('consonance', 0.6);
            else cost += pay('consonance', 0.8);
            if (prevP !== null && ti > 0) {
              const oPrev = g.pitch[vi][ti - 1];
              if (oPrev >= 0 && oPrev !== o && prevP !== p) {
                const icPrev = Math.abs(prevP - oPrev) % 12;
                const perfect = ic === 0 || ic === 7;
                if (perfect && icPrev === ic) cost += pay('parallel', 45);
                else if (perfect && Math.sign(p - prevP) === Math.sign(o - oPrev) && Math.abs(p - prevP) > 2) cost += pay('hidden', 4);
                if (Math.sign(p - prevP) === -Math.sign(o - oPrev)) cost -= pay('consonance', 0.4);
              }
              // Overlap: past the pitch the neighbouring voice just left. Hard mode only (no soft cost).
              const rr = g.rel[vi];
              if (hard && oPrev >= 0 && ((rr === 'below' && p > oPrev) || (rr === 'above' && p < oPrev))) cost += pay('overlap', 0);
            }
          } else if (diss) {
            // held over the beat while this voice moves
            if (!(strong && ((suspendable && treat('suspension', 16)) || (seventh && treat('seventh', 16))))) {
              cost += strong ? pay('heldDissonance', 16) : pay('weakDissonance', 2.5);
            }
          }
          // A fixed voice resolving a held-over note down by step here: stay consonant with it.
          if (diss && g.onset[vi][ti] && fixedResolvesHere(g, vi, ti)) cost += pay('againstResolutionShape', RESOLVE_INTO_DISSONANCE);
          const r = g.rel[vi];
          if (r === 'above' && p <= o) cost += pay('crossing', 24);
          if (r === 'below' && p >= o) cost += pay('crossing', 24);
          if (r && Math.abs(p - o) > (spec.invertible ? 16 : 19)) cost += pay('spacing', 2);
        }
        if (!explained) cost += pay('chordPull', outOfChord);
        if (strong && count >= 3 && !chord && !explained) {
          const pcs = new Set<number>([mod12(p)]);
          for (const v of g.pitch) if (v[ti] >= 0) pcs.add(mod12(v[ti]));
          const fits = chords.some((c) => [...pcs].every((x) => c.includes(x)));
          if (!fits) cost += pay('nonTriad', downbeat ? 5 : 3);
        }
      }
    }
    return { cost, weakDiss, startDiss, ob, fixedSusp };
  }

  /**
   * Is `p` the seventh of a seventh chord formed with the notes sounding at
   * slice `ti`? Needs 3+ pitch classes; on the skeleton chord's root if given.
   */
  function isChordSeventh(g: Grid, ti: number, p: number, chord: Chord | undefined): boolean {
    const pcs = new Set<number>([mod12(p)]);
    for (const v of g.pitch) if (v[ti] >= 0) pcs.add(mod12(v[ti]));
    if (pcs.size < 3) return false;
    const roots = chord ? [chord.pcs[0]] : [...Array(12).keys()];
    for (const root of roots) {
      for (const shape of SEVENTH_SHAPES) {
        if (mod12(p - root) !== shape[3]) continue;
        const tones = shape.map((i) => mod12(root + i));
        if ([...pcs].every((pc) => tones.includes(pc))) return true;
      }
    }
    return false;
  }

  /**
   * Is fixed voice `vi` suspended against the line at slice `ti`? It holds its
   * pitch from ti-1, the line's previous note was consonant with it, and it
   * moves directly a step down within the window. Returns the resolution.
   */
  function fixedResolution(g: Grid, vi: number, ti: number, prevP: number, key: Key): { tick: number; pitch: number } | null {
    const v = g.pitch[vi];
    const on = g.onset[vi];
    const o = v[ti];
    if (ti < 1 || v[ti - 1] !== o || dissAt(prevP, o, key)) return null;
    let u = ti + 1;
    while (u < v.length && v[u] === o && !on[u]) u++;
    if (u >= v.length || u - ti > SUSP_WINDOW) return null;
    const fall = o - v[u];
    return fall === 1 || fall === 2 ? { tick: u + g.t0, pitch: v[u] } : null;
  }

  /**
   * Does fixed voice `vi` arrive at slice `ti` by a step down from a note it
   * held across the previous strong beat (the shape of a suspension's
   * resolution)?
   */
  function fixedResolvesHere(g: Grid, vi: number, ti: number): boolean {
    const v = g.pitch[vi];
    if (ti < 1 || v[ti - 1] < 0) return false;
    const fall = v[ti - 1] - v[ti];
    if (fall !== 1 && fall !== 2) return false;
    const b = Math.floor((ti + g.t0 - 1) / beat) * beat - g.t0; // last strong tick before ti
    // Sounding just before the beat and through it (held or re-struck), with no new note since.
    if (b < 1 || v[b - 1] !== v[ti - 1] || v[b] !== v[ti - 1]) return false;
    for (let u = b + 1; u < ti; u++) if (g.onset[vi][u]) return false;
    return true;
  }

  /** Dissonant as spelled in `key` (and 4ths/5ths too for invertible counterpoint). */
  function dissAt(a: number, b: number, key: Key): boolean {
    const ic = Math.abs(a - b) % 12;
    return spelledDissonant(a, b, key) || chromaticClash(a, b, key) || (!!spec.invertible && (ic === 5 || ic === 7));
  }

  const root: BeamNode = { p: spec.startPitch ?? -1, prev: null, cost: 0, lastInt: 0, runDir: 0, runLen: 0, pending: null, ob: null, fixedSusp: null };
  let states: BeamNode[] = [root];

  for (let si = 0; si < slots.length; si++) {
    const key = keyAt(slots[si].start);
    const slotEnd = noteEnd(slots[si]);
    const allowed = spec.allowedPcs ?? usablePcs(key);
    const next = new Map<string, BeamNode>();
    // Hard mode: candidates that broke a hard rule, kept in case none kept them all.
    const rejected = new Map<string, BeamNode>();
    for (const st of states) {
      const prevP = st.p >= 0 ? st.p : null;
      for (let p = range[0] - 3; p <= range[1] + 3; p++) {
        if (!allowed.includes(mod12(p))) continue;
        if (prevP !== null && Math.abs(p - prevP) > 12) continue;
        viol = [];
        violCost = 0;
        let cost = st.cost + rng() * noise;
        if (p < range[0]) cost += pay('range', (range[0] - p) * 5);
        if (p > range[1]) cost += pay('range', (p - range[1]) * 5);
        if (prevP === null) cost += pay('startCentre', Math.abs(p - center) * 0.15);
        else cost += melodicCost(prevP, p, st, key, pay);
        const step = prevP !== null && p !== prevP && Math.abs(p - prevP) <= 2;
        if (st.pending !== null && prevP !== null) {
          const dir = Math.sign(p - prevP);
          if (!step) cost += pay('weakDissonance', 15);
          else if (st.pending !== 0 && dir !== st.pending) cost += pay('neighbourNote', 2); // neighbour note
        }
        const h = harmonic(p, prevP, si, key);
        cost += h.cost;
        // The last note's treated dissonance: resolved here, or (a suspension)
        // decorated once and resolved by the next note, or charged.
        let carried: Obligation | null = null;
        const o = st.ob;
        if (o && prevP !== null) {
          const move = p - prevP;
          const ok = !h.startDiss;
          // Landing the resolution on another dissonance is worse than not resolving.
          if (h.startDiss) cost += pay('resolveIntoDissonance', RESOLVE_INTO_DISSONANCE);
          const down = ok && (move === -1 || move === -2);
          if (o.kind === 'suspension') {
            if (down) {
              // suspension
            } else if (ok && (move === 1 || move === 2)) {
              cost += o.n * (R.suspension - R.retardation); // retardation
            } else if (si + 1 < slots.length && slots[si + 1].start === slotEnd && slotEnd <= o.tick + ORN_WINDOW) {
              cost += o.n * (R.suspension - R.ornamentedSuspension);
              carried = { ...o, kind: 'ornament', debt: o.debt + o.n * (R.ornamentedSuspension - R.suspension) };
            } else cost += pay('unresolved', o.debt);
          } else if (o.kind === 'ornament') {
            const fall = o.from - p;
            if (!(ok && (fall === 1 || fall === 2))) cost += pay('unresolved', o.debt);
          } else if (o.kind === 'passing') {
            if (!(ok && Math.sign(move) === o.dir && Math.abs(move) <= 2)) cost += pay('unresolved', o.debt);
          } else if (!down) cost += pay('unresolved', o.debt); // seventh
        }
        // One obligation at a time: a dissonance on the decorating note itself is not treated.
        let ob = h.ob;
        if (carried) {
          if (ob) cost += pay('unresolved', ob.debt);
          ob = carried;
        }
        // Fixed voices' suspensions: charge the waived penalty if this note is
        // dissonant with the resolution; carry it on if it resolves later.
        let fixedSusp: FixedSusp | null = null;
        for (const fs of [st.fixedSusp, h.fixedSusp]) {
          if (!fs) continue;
          if (fs.tick >= slotEnd) {
            if (fixedSusp) cost += pay('unresolved', fs.debt); // only one is tracked; don't let the other go unchecked
            else fixedSusp = fs;
          }
          else if (fs.tick >= slots[si].start && dissAt(p, fs.pitch, key)) cost += pay('unresolved', fs.debt + RESOLVE_INTO_DISSONANCE);
        }
        let pending: number | null = null;
        if (h.weakDiss) {
          if (step) pending = Math.sign(p - prevP!);
          else {
            cost += pay('weakDissonance', prevP === null ? 6 : 18);
            pending = 0;
          }
        }
        const d = prevP === null ? 0 : p - prevP;
        const dir = Math.sign(d);
        const node: BeamNode = {
          p,
          prev: st,
          cost,
          lastInt: d,
          runDir: dir,
          runLen: dir !== 0 && dir === st.runDir ? st.runLen + 1 : 1,
          pending,
          ob,
          fixedSusp,
        };
        const sig = `${p}|${pending}|${Math.sign(d)}|${Math.abs(d) >= 5 ? 1 : 0}|${ob ? `${ob.kind}${ob.from}` : ''}|${fixedSusp ? fixedSusp.tick : ''}`;
        if (viol.length) {
          // Ranked by how many hard rules it breaks, then by what they would have cost.
          node.cost = cost + violCost;
          node.viol = viol;
          const old = rejected.get(sig);
          if (!old || old.viol!.length > viol.length || (old.viol!.length === viol.length && old.cost > node.cost)) rejected.set(sig, node);
          continue;
        }
        const old = next.get(sig);
        if (!old || old.cost > cost) next.set(sig, node);
      }
    }
    if (next.size || !rejected.size) states = [...next.values()].sort((a, b) => a.cost - b.cost).slice(0, beam);
    else {
      // Dead end: relax this step only, keeping the candidates that break the fewest hard rules.
      const all = [...rejected.values()];
      const fewest = Math.min(...all.map((x) => x.viol!.length));
      states = all.filter((x) => x.viol!.length === fewest).sort((a, b) => a.cost - b.cost).slice(0, beam);
      spec.relaxations?.push({ tick: slots[si].start, rules: [...new Set(states[0].viol)] });
    }
  }

  let best: BeamNode | null = null;
  let bestCost = Infinity;
  let bestViol: LineRule[] = [];
  for (const st of states) {
    viol = [];
    violCost = 0;
    let c = st.cost;
    if (st.pending !== null) c += pay('weakDissonance', 16);
    if (st.ob) c += pay('unresolved', st.ob.debt);
    if (spec.targetPitch !== undefined) {
      const a = Math.abs(spec.targetPitch - st.p);
      c += pay('target', a > 12 ? 8 : a === 6 || a === 10 || a === 11 ? 6 : a > 7 ? 4 : a > 4 ? 1.5 : 0);
    }
    // Hard mode: an ending that breaks a hard rule loses to any that doesn't.
    if (best && viol.length > bestViol.length) continue;
    c += violCost;
    if (viol.length < bestViol.length || c < bestCost) { bestCost = c; best = st; bestViol = viol; }
  }
  if (bestViol.length) spec.relaxations?.push({ tick: slots[slots.length - 1].start, rules: [...new Set(bestViol)] });
  const pitches: number[] = [];
  for (let n = best; n && n.prev; n = n.prev) pitches.push(n.p);
  pitches.reverse();
  return slots.map((s, i) => ({ pitch: pitches[i], start: s.start, dur: s.dur }));
}

/**
 * Rhythm patterns per beat, in 16ths, by how busy the other voices are
 * (onsets in the beat: 0, 1, 2, 3+), with weights. Simple beats are a quarter;
 * compound beats a dotted quarter, divided in eighths.
 */
type Patterns = [number[][], number[]][];
const SIMPLE_PATTERNS: Patterns = [
  [[[2, 2], [1, 1, 1, 1], [1, 1, 2], [3, 1]], [0.4, 0.32, 0.18, 0.1]],
  [[[2, 2], [1, 1, 2], [2, 1, 1], [1, 1, 1, 1], [3, 1]], [0.45, 0.18, 0.14, 0.13, 0.1]],
  [[[4], [2, 2]], [0.6, 0.4]],
  [[[4]], [1]],
];
const COMPOUND_PATTERNS: Patterns = [
  [[[2, 2, 2], [1, 1, 1, 1, 2], [4, 2], [2, 1, 1, 2], [3, 1, 2]], [0.4, 0.22, 0.16, 0.14, 0.08]],
  [[[2, 2, 2], [4, 2], [2, 1, 1, 2], [1, 1, 2, 2], [3, 1, 2]], [0.4, 0.24, 0.14, 0.12, 0.1]],
  [[[6], [4, 2]], [0.6, 0.4]],
  [[[6]], [1]],
];

/**
 * A rhythm that moves where the other voices hold and holds where they move.
 * Works beat by beat over [start, end). `leadRest` is in ticks.
 */
export function complementaryRhythm(
  voices: Note[][],
  start: number,
  end: number,
  meter: TimeGrid | number,
  rng: Rng,
  opts: { leadRest?: number; endLong?: boolean } = {},
): Slot[] {
  if (end <= start) return [];
  const grid = toTimeGrid(meter);
  const { bar, beat, sixteenth } = grid;
  const patterns = grid.compound ? COMPOUND_PATTERNS : SIMPLE_PATTERNS;
  const onsets = new Set<number>();
  for (const v of voices) for (const n of v) if (n.start >= start && n.start < end) onsets.add(n.start);
  const slots: Slot[] = [];
  let t = start + (opts.leadRest ?? 0);
  while (t < end) {
    const beatEnd = Math.min(end, (Math.floor(t / beat) + 1) * beat);
    const len = beatEnd - t;
    if (len < beat) {
      // partial beat: one note to the beat line
      slots.push({ start: t, dur: len });
      t = beatEnd;
      continue;
    }
    let busy = 0;
    for (let x = t; x < beatEnd; x++) if (onsets.has(x)) busy++;
    const [options, weights] = patterns[Math.min(busy, 3)];
    // A single option takes no random draw, as before.
    const pattern = options.length === 1 ? options[0] : pickWeighted(rng, options, weights);
    for (const d of pattern) {
      slots.push({ start: t, dur: d * sixteenth });
      t += d * sixteenth;
    }
  }
  // Join some pairs of whole beats into one note when they start on an odd-numbered
  // beat, 1, 3, ... (half notes in 4/4, dotted halves in 6/8). Compound meters never join
  // across the bar line; simple ones keep their old rule (3/4 may syncopate
  // over it), so their results stay as they were.
  const merged: Slot[] = [];
  for (const s of slots) {
    const prev = merged[merged.length - 1];
    if (
      prev && prev.dur === beat && s.dur === beat && prev.start + prev.dur === s.start &&
      (prev.start % bar) % (beat * 2) === 0 && !(grid.compound && (prev.start % bar) + 2 * beat > bar) && rng() < 0.35
    ) {
      prev.dur = beat * 2;
    } else merged.push({ ...s });
  }
  if (opts.endLong && merged.length > 1) {
    const lastBeat = Math.floor((end - 1) / beat) * beat;
    while (merged.length > 1 && merged[merged.length - 1].start > lastBeat && merged[merged.length - 2].start >= lastBeat) merged.pop();
    const last = merged[merged.length - 1];
    last.dur = end - last.start;
  }
  return merged;
}
