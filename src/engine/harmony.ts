// Harmonic skeleton: one chord per beat, chosen from the voices that are
// already fixed (entries, countersubject) before any free voice is written.
// Free voices then aim at the same chord instead of each guessing its own.
import { Note, TimeGrid, noteEnd, toTimeGrid } from './model';
import { Key, chromaticClash, mod12, sameKey, scaleOf } from './theory';

export interface Chord {
  /** Pitch classes (absolute), ordered root, third, fifth and optionally seventh. */
  pcs: number[];
  /** Roman numeral within `key`, e.g. "V7". */
  label: string;
  key: Key;
}

export interface SkeletonBeat {
  start: number;
  dur: number;
  chord: Chord;
}

interface ChordCandidate extends Chord {
  /** Scale degree of the root, 0-6. */
  deg: number;
  /** How unusual the chord is in this key (0 = tonic/dominant). */
  prior: number;
}

const NUMERALS_MAJOR = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
const NUMERALS_MINOR = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
const PRIOR_MAJOR = [0, 0.6, 1.6, 0.3, 0, 0.7, 1.4];
const PRIOR_MINOR = [0, 1.2, 1.1, 0.3, 2.4, 0.7, 1.6];

function candidatesOf(key: Key): ChordCandidate[] {
  const pcs = scaleOf(key.mode).map((p) => mod12(p + key.tonic));
  const minor = key.mode === 'minor';
  const out: ChordCandidate[] = [];
  for (let d = 0; d < 7; d++) {
    out.push({
      pcs: [pcs[d], pcs[(d + 2) % 7], pcs[(d + 4) % 7]],
      label: (minor ? NUMERALS_MINOR : NUMERALS_MAJOR)[d],
      key,
      deg: d,
      prior: (minor ? PRIOR_MINOR : PRIOR_MAJOR)[d],
    });
  }
  const lt = mod12(key.tonic + 11);
  if (minor) {
    out.push({ pcs: [pcs[4], lt, pcs[1]], label: 'V', key, deg: 4, prior: 0 });
    out.push({ pcs: [lt, pcs[1], pcs[3]], label: 'vii°', key, deg: 6, prior: 1.2 });
  }
  out.push({ pcs: [pcs[4], lt, pcs[1], pcs[3]], label: 'V7', key, deg: 4, prior: 0.4 });
  return out;
}

/**
 * A chord holding another form of a degree a fixed voice sounds (G♯ in the
 * chord while the answer has G♮) would pull the free voices into a chromatic
 * clash, which `generateLine` charges 30 for but chord pull can outweigh.
 */
const CHORD_CLASH = 20;

// Cost of moving the root up by this many scale steps (0 = same root).
const ROOT_MOTION = [0, 0.5, 1.0, -0.9, 0.3, 0.2, 0.9];

function progressionCost(a: ChordCandidate, b: ChordCandidate, crossesBar: boolean): number {
  if (!sameKey(a.key, b.key)) {
    // Pivot between keys: favour chords that share notes.
    const common = b.pcs.filter((p) => a.pcs.includes(p)).length;
    return 1.5 - 0.5 * common;
  }
  if (a.label === b.label) return crossesBar ? 1.2 : 0;
  // Changing chord costs a little, so the harmony does not flicker beat by beat.
  let cost = 0.7 + ROOT_MOTION[(b.deg - a.deg + 7) % 7];
  if (a.deg === 4 && b.deg === 3) cost += 1.5; // V → IV
  if (a.label === 'V7' && b.deg !== 0 && b.deg !== 5) cost += 2; // the seventh wants to resolve
  return cost;
}

/** How badly the notes already fixed in [t, t + dur) fit a chord. */
function fitCost(fixed: Note[][], t: number, dur: number, c: ChordCandidate, grid: TimeGrid): number {
  // Lengths are counted in 16ths, so the costs don't depend on the grid resolution.
  const six = grid.sixteenth;
  let cost = 0;
  const present = new Set<number>();
  for (const v of fixed) {
    for (const n of v) {
      const a = Math.max(n.start, t);
      const b = Math.min(noteEnd(n), t + dur);
      if (a >= b) continue;
      const pc = mod12(n.pitch);
      const inChord = c.pcs.includes(pc);
      if (!inChord && c.pcs.some((q) => chromaticClash(n.pitch, q, c.key))) cost += CHORD_CLASH;
      if (a === t) {
        // Sounding on the beat: this is what the chord has to explain.
        if (inChord) present.add(pc);
        else cost += n.start === t ? 9 : 5; // a held note may turn into a suspension
        if (b - a > six) cost += inChord ? 0 : 0.5 * ((b - a) / six - 1);
      } else if (!inChord) {
        // Off the beat: passing notes are cheap, longer ones less so.
        cost += ((a - t) % grid.eighth === 0 ? 1.2 : 0.5) + 0.4 * ((b - a) / six - 1);
      }
    }
  }
  // A seventh chord only makes sense when the texture actually has the seventh.
  if (c.pcs.length === 4 && !present.has(c.pcs[3])) cost += 3;
  if (present.size && !present.has(c.pcs[0]) && !present.has(c.pcs[1])) cost += 0.8;
  return cost;
}

/**
 * Chord per metric beat (a dotted quarter in x/8) over [start, end), by dynamic programming: each beat's chord
 * must explain the fixed notes and connect well to its neighbours. Beats with
 * nothing fixed are filled in by the progression alone. Deterministic.
 */
export function planHarmony(
  fixed: Note[][],
  start: number,
  end: number,
  keyAt: (tick: number) => Key,
  meter: TimeGrid | number,
  opts: { before?: Chord; closeOn?: Key } = {},
): SkeletonBeat[] {
  const grid = toTimeGrid(meter);
  const { bar, beat } = grid;
  const beats: { start: number; dur: number; cands: ChordCandidate[] }[] = [];
  for (let t = start; t < end; ) {
    const next = Math.min(end, (Math.floor(t / beat) + 1) * beat);
    beats.push({ start: t, dur: next - t, cands: candidatesOf(keyAt(t)) });
    t = next;
  }
  if (!beats.length) return [];

  const cost: number[][] = [];
  const back: number[][] = [];
  beats.forEach((b, i) => {
    cost.push([]);
    back.push([]);
    const downbeat = b.start % bar === 0;
    b.cands.forEach((c, ci) => {
      let own = fitCost(fixed, b.start, b.dur, c, grid) + c.prior * (downbeat ? 1 : 0.6);
      if (i === beats.length - 1 && opts.closeOn) {
        // Lead into what follows: end on its dominant, or failing that its tonic.
        const dom = mod12(opts.closeOn.tonic + 7);
        if (c.pcs[0] === dom && c.pcs[1] === mod12(dom + 4)) own -= 1.5;
        else if (c.pcs[0] !== opts.closeOn.tonic) own += 1;
      }
      let best = 0;
      let bestCost = Infinity;
      if (i === 0) {
        bestCost = opts.before ? progressionCost(asCandidate(opts.before), c, downbeat) : 0;
      } else {
        const prev = beats[i - 1].cands;
        for (let pi = 0; pi < prev.length; pi++) {
          const x = cost[i - 1][pi] + progressionCost(prev[pi], c, downbeat);
          if (x < bestCost) { bestCost = x; best = pi; }
        }
      }
      cost[i].push(own + bestCost);
      back[i].push(best);
    });
  });

  let ci = 0;
  const last = cost[beats.length - 1];
  for (let k = 1; k < last.length; k++) if (last[k] < last[ci]) ci = k;
  const out: SkeletonBeat[] = new Array(beats.length);
  for (let i = beats.length - 1; i >= 0; i--) {
    const { pcs, label, key } = beats[i].cands[ci];
    out[i] = { start: beats[i].start, dur: beats[i].dur, chord: { pcs, label, key } };
    ci = back[i][ci];
  }
  return out;
}

function asCandidate(c: Chord): ChordCandidate {
  return candidatesOf(c.key).find((x) => x.label === c.label) ?? { ...c, deg: 0, prior: 0 };
}

/** Lookup function over a skeleton planned with beats of `beat` ticks; undefined outside it. */
export function chordLookup(skeleton: SkeletonBeat[], beat: number = toTimeGrid(4).beat): (tick: number) => Chord | undefined {
  const byBeat = new Map<number, Chord>();
  for (const b of skeleton) byBeat.set(Math.floor(b.start / beat), b.chord);
  return (tick) => byBeat.get(Math.floor(tick / beat));
}
