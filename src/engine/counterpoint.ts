// Line generation by beam search over a fixed rhythm.
// Every candidate pitch is scored against the voices already written
// (harmonic rules) and against the line itself (melodic rules).
import { Note, TPB, noteEnd } from './model';
import { Key, chordsOf, mod12, usablePcs } from './theory';
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
  beatsPerBar: number;
  /** Overrides for DEFAULT_REWARDS. */
  rewards?: Partial<DissonanceRewards>;
  beam?: number;
  noise?: number;
}

const DISSONANT = [false, true, true, false, false, false, true, false, false, false, true, true];
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
 */
const SUSP_WINDOW = 2 * TPB;
const ORN_WINDOW = 3 * TPB;
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
}

interface FixedSusp {
  tick: number;
  pitch: number;
  debt: number;
}

const INTERVAL_COST = [3, 0, 0, 1, 1.2, 2, 18, 3, 5, 5.5, 18, 20, 4];

function melodicCost(prev: number, p: number, node: BeamNode, key: Key): number {
  const d = p - prev;
  const a = Math.abs(d);
  let cost = a <= 12 ? INTERVAL_COST[a] : 30;
  const rp = mod12(prev - key.tonic);
  const rc = mod12(p - key.tonic);
  if (key.mode === 'minor') {
    if (rp === 11 && rc !== 0 && d !== 0) cost += 5;
    if (rp === 9 && rc !== 11 && d !== 0) cost += 4;
    if (rc === 9 && rp !== 7) cost += 3;
    if ((rp === 8 && rc === 11) || (rp === 11 && rc === 8)) cost += 10;
    if (rp === 10 && rc === 0 && d > 0) cost += 3;
  } else if (rp === 11 && rc !== 0 && a > 2) {
    cost += 2;
  }
  const li = node.lastInt;
  if (Math.abs(li) >= 5 && !(a <= 2 && a > 0 && Math.sign(d) === -Math.sign(li))) cost += 3.5;
  if (Math.abs(li) >= 3 && a >= 3 && Math.sign(d) === Math.sign(li)) {
    cost += 3;
    if (Math.abs(li) + a > 12) cost += 6;
  }
  if (node.runLen >= 5 && Math.sign(d) === node.runDir) cost += 2;
  let seen = 0;
  let n: BeamNode | null = node;
  for (let i = 0; i < 6 && n; i++, n = n.prev) if (n.p === p) seen++;
  if (seen >= 2) cost += 1.5;
  return cost;
}

export function generateLine(spec: LineSpec, rng: Rng): Note[] {
  const { slots, range, keyAt, contexts, beatsPerBar } = spec;
  if (!slots.length) return [];
  const beam = spec.beam ?? 120;
  const noise = spec.noise ?? 1.2;
  const bar = TPB * beatsPerBar;
  const t0 = slots[0].start - 1;
  const t1 = noteEnd(slots[slots.length - 1]);
  const grids = contexts.map((voices, i) => buildGrid(voices, spec.relations?.[i], t0, t1));
  const center = (range[0] + range[1]) / 2;
  const R: DissonanceRewards = { ...DEFAULT_REWARDS, ...spec.rewards };

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
        const strong = t % TPB === 0;
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
            if (!doubled) cost -= idx === 1 ? 2.2 : idx === 3 ? 0.4 : 1.4;
            else if (idx === 3 || pc === mod12(chord.key.tonic + 11)) cost += 4; // doubled seventh / leading note
            else if (idx === 1) cost += 1;
            if (idx === 2 && count > 1 && p === lowest) cost += 2.5; // six-four
          }
        }
        if (count === 1) {
          cost += outOfChord;
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
          const diss = DISSONANT[ic] || (ic === 5 && Math.min(p, o) === lowest) || (!!spec.invertible && (ic === 5 || ic === 7));
          // Our note suspended against this voice: same pitch at t-1, consonant
          // with the voice there, resolvable by the next slot within the window.
          // Fourths only as 4–3 (line above); fifths are never suspensions.
          const oPrev = ti > 0 ? g.pitch[vi][ti - 1] : -1;
          const suspendable = resolvable && diss && ic !== 7 && (ic !== 5 || p > o) && oPrev >= 0 && !dissAt(p, oPrev);
          if (t === s.start) {
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
                  const res: { tick: number; pitch: number } | null = heldIn && !fixedSusp ? fixedResolution(g, vi, ti, prevP!) : null;
                  if (res) {
                    cost -= R.againstSuspension;
                    fixedSusp = { ...res, debt: base + R.againstSuspension };
                  } else cost += base;
                }
              } else weakDiss = true;
            } else if (p === o) cost += 5;
            else if (IMPERFECT[ic]) cost -= 0.6;
            else cost += 0.8;
            if (prevP !== null && ti > 0) {
              const oPrev = g.pitch[vi][ti - 1];
              if (oPrev >= 0 && oPrev !== o && prevP !== p) {
                const icPrev = Math.abs(prevP - oPrev) % 12;
                const perfect = ic === 0 || ic === 7;
                if (perfect && icPrev === ic) cost += 45;
                else if (perfect && Math.sign(p - prevP) === Math.sign(o - oPrev) && Math.abs(p - prevP) > 2) cost += 4;
                if (Math.sign(p - prevP) === -Math.sign(o - oPrev)) cost -= 0.4;
              }
            }
          } else if (diss) {
            // held over the beat while this voice moves
            if (!(strong && ((suspendable && treat('suspension', 16)) || (seventh && treat('seventh', 16))))) {
              cost += strong ? 16 : 2.5;
            }
          }
          // A fixed voice resolving a held-over note down by step here: stay consonant with it.
          if (diss && g.onset[vi][ti] && fixedResolvesHere(g, vi, ti)) cost += RESOLVE_INTO_DISSONANCE;
          const r = g.rel[vi];
          if (r === 'above' && p <= o) cost += 24;
          if (r === 'below' && p >= o) cost += 24;
          if (r && Math.abs(p - o) > (spec.invertible ? 16 : 19)) cost += 2;
        }
        if (!explained) cost += outOfChord;
        if (strong && count >= 3 && !chord && !explained) {
          const pcs = new Set<number>([mod12(p)]);
          for (const v of g.pitch) if (v[ti] >= 0) pcs.add(mod12(v[ti]));
          const fits = chords.some((c) => [...pcs].every((x) => c.includes(x)));
          if (!fits) cost += downbeat ? 5 : 3;
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
  function fixedResolution(g: Grid, vi: number, ti: number, prevP: number): { tick: number; pitch: number } | null {
    const v = g.pitch[vi];
    const on = g.onset[vi];
    const o = v[ti];
    if (ti < 1 || v[ti - 1] !== o || dissAt(prevP, o)) return null;
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
    const beat = Math.floor((ti + g.t0 - 1) / TPB) * TPB - g.t0; // last strong tick before ti
    // Sounding just before the beat and through it (held or re-struck), with no new note since.
    if (beat < 1 || v[beat - 1] !== v[ti - 1] || v[beat] !== v[ti - 1]) return false;
    for (let u = beat + 1; u < ti; u++) if (g.onset[vi][u]) return false;
    return true;
  }

  function dissAt(a: number, b: number): boolean {
    const ic = Math.abs(a - b) % 12;
    return DISSONANT[ic] || (!!spec.invertible && (ic === 5 || ic === 7));
  }

  const root: BeamNode = { p: spec.startPitch ?? -1, prev: null, cost: 0, lastInt: 0, runDir: 0, runLen: 0, pending: null, ob: null, fixedSusp: null };
  let states: BeamNode[] = [root];

  for (let si = 0; si < slots.length; si++) {
    const key = keyAt(slots[si].start);
    const slotEnd = noteEnd(slots[si]);
    const allowed = spec.allowedPcs ?? usablePcs(key);
    const next = new Map<string, BeamNode>();
    for (const st of states) {
      const prevP = st.p >= 0 ? st.p : null;
      for (let p = range[0] - 3; p <= range[1] + 3; p++) {
        if (!allowed.includes(mod12(p))) continue;
        if (prevP !== null && Math.abs(p - prevP) > 12) continue;
        let cost = st.cost + rng() * noise;
        if (p < range[0]) cost += (range[0] - p) * 5;
        if (p > range[1]) cost += (p - range[1]) * 5;
        if (prevP === null) cost += Math.abs(p - center) * 0.15;
        else cost += melodicCost(prevP, p, st, key);
        const step = prevP !== null && p !== prevP && Math.abs(p - prevP) <= 2;
        if (st.pending !== null && prevP !== null) {
          const dir = Math.sign(p - prevP);
          if (!step) cost += 15;
          else if (st.pending !== 0 && dir !== st.pending) cost += 2; // neighbour note
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
          if (h.startDiss) cost += RESOLVE_INTO_DISSONANCE;
          const down = ok && (move === -1 || move === -2);
          if (o.kind === 'suspension') {
            if (down) {
              // suspension
            } else if (ok && (move === 1 || move === 2)) {
              cost += o.n * (R.suspension - R.retardation); // retardation
            } else if (si + 1 < slots.length && slots[si + 1].start === slotEnd && slotEnd <= o.tick + ORN_WINDOW) {
              cost += o.n * (R.suspension - R.ornamentedSuspension);
              carried = { ...o, kind: 'ornament', debt: o.debt + o.n * (R.ornamentedSuspension - R.suspension) };
            } else cost += o.debt;
          } else if (o.kind === 'ornament') {
            const fall = o.from - p;
            if (!(ok && (fall === 1 || fall === 2))) cost += o.debt;
          } else if (o.kind === 'passing') {
            if (!(ok && Math.sign(move) === o.dir && Math.abs(move) <= 2)) cost += o.debt;
          } else if (!down) cost += o.debt; // seventh
        }
        // One obligation at a time: a dissonance on the decorating note itself is not treated.
        let ob = h.ob;
        if (carried) {
          if (ob) cost += ob.debt;
          ob = carried;
        }
        // Fixed voices' suspensions: charge the waived penalty if this note is
        // dissonant with the resolution; carry it on if it resolves later.
        let fixedSusp: FixedSusp | null = null;
        for (const fs of [st.fixedSusp, h.fixedSusp]) {
          if (!fs) continue;
          if (fs.tick >= slotEnd) {
            if (fixedSusp) cost += fs.debt; // only one is tracked; don't let the other go unchecked
            else fixedSusp = fs;
          }
          else if (fs.tick >= slots[si].start && dissAt(p, fs.pitch)) cost += fs.debt + RESOLVE_INTO_DISSONANCE;
        }
        let pending: number | null = null;
        if (h.weakDiss) {
          if (step) pending = Math.sign(p - prevP!);
          else {
            cost += prevP === null ? 6 : 18;
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
        const old = next.get(sig);
        if (!old || old.cost > cost) next.set(sig, node);
      }
    }
    states = [...next.values()].sort((a, b) => a.cost - b.cost).slice(0, beam);
  }

  let best: BeamNode | null = null;
  let bestCost = Infinity;
  for (const st of states) {
    let c = st.cost;
    if (st.pending !== null) c += 16;
    if (st.ob) c += st.ob.debt;
    if (spec.targetPitch !== undefined) {
      const a = Math.abs(spec.targetPitch - st.p);
      c += a > 12 ? 8 : a === 6 || a === 10 || a === 11 ? 6 : a > 7 ? 4 : a > 4 ? 1.5 : 0;
    }
    if (c < bestCost) { bestCost = c; best = st; }
  }
  const pitches: number[] = [];
  for (let n = best; n && n.prev; n = n.prev) pitches.push(n.p);
  pitches.reverse();
  return slots.map((s, i) => ({ pitch: pitches[i], start: s.start, dur: s.dur }));
}

/**
 * A rhythm that moves where the other voices hold and holds where they move.
 * Works beat by beat over [start, end).
 */
export function complementaryRhythm(
  voices: Note[][],
  start: number,
  end: number,
  beatsPerBar: number,
  rng: Rng,
  opts: { leadRest?: number; endLong?: boolean } = {},
): Slot[] {
  if (end <= start) return [];
  const onsets = new Set<number>();
  for (const v of voices) for (const n of v) if (n.start >= start && n.start < end) onsets.add(n.start);
  const slots: Slot[] = [];
  let t = start + (opts.leadRest ?? 0);
  const bar = TPB * beatsPerBar;
  while (t < end) {
    const beatEnd = Math.min(end, (Math.floor(t / TPB) + 1) * TPB);
    const len = beatEnd - t;
    if (len < TPB) {
      // partial beat: one note to the beat line
      slots.push({ start: t, dur: len });
      t = beatEnd;
      continue;
    }
    let busy = 0;
    for (let x = t; x < beatEnd; x++) if (onsets.has(x)) busy++;
    let pattern: number[];
    if (busy >= 3) pattern = [4];
    else if (busy === 2) pattern = pickWeighted(rng, [[4], [2, 2]], [0.6, 0.4]);
    else if (busy === 1) pattern = pickWeighted(rng, [[2, 2], [1, 1, 2], [2, 1, 1], [1, 1, 1, 1], [3, 1]], [0.45, 0.18, 0.14, 0.13, 0.1]);
    else pattern = pickWeighted(rng, [[2, 2], [1, 1, 1, 1], [1, 1, 2], [3, 1]], [0.4, 0.32, 0.18, 0.1]);
    for (const d of pattern) {
      slots.push({ start: t, dur: d });
      t += d;
    }
  }
  // Join some pairs of quarters into half notes when they start on a strong beat.
  const merged: Slot[] = [];
  for (const s of slots) {
    const prev = merged[merged.length - 1];
    if (
      prev && prev.dur === TPB && s.dur === TPB && prev.start + prev.dur === s.start &&
      (prev.start % bar) % (TPB * 2) === 0 && rng() < 0.35
    ) {
      prev.dur = TPB * 2;
    } else merged.push({ ...s });
  }
  if (opts.endLong && merged.length > 1) {
    const lastBeat = Math.floor((end - 1) / TPB) * TPB;
    while (merged.length > 1 && merged[merged.length - 1].start > lastBeat && merged[merged.length - 2].start >= lastBeat) merged.pop();
    const last = merged[merged.length - 1];
    last.dur = end - last.start;
  }
  return merged;
}
