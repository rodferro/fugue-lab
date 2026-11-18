// Voice-leading report over a finished texture: counts the classic errors so
// the UI, the tests and the research CLI can show how clean a result is.
// Works on any set of monophonic lines, generated or imported (e.g. a Bach
// fugue split into voices). Grid resolution and strong-beat spacing are
// options, so imported music with 32nds or triplets can be measured too.
// Strong-beat dissonances are classified by how they are treated (suspension,
// passing, neighbour, appoggiatura, chordal seventh, unexplained), so that
// only the unexplained ones need to count as errors.
import { Note, TPB, noteEnd, sortNotes } from './model';

/**
 * Strong-beat dissonances, classified. In order of precedence (the first
 * rule that explains the dissonance wins, trying either voice of the pair):
 * suspension, passing tone, neighbour tone, appoggiatura, chordal seventh;
 * anything else is 'unexplainedDissonance'. With `classify: false` they are
 * all 'strongDissonance' (or 'suspension' with `suspensions: true`) instead.
 */
export type DissonanceKind =
  | 'suspension'
  | 'passingTone'
  | 'neighbourTone'
  | 'appoggiatura'
  | 'chordalSeventh'
  | 'unexplainedDissonance';

export type IssueKind = 'parallel5' | 'parallel8' | 'strongDissonance' | DissonanceKind | 'crossing';

export const DISSONANCE_KINDS: DissonanceKind[] = [
  'suspension', 'passingTone', 'neighbourTone', 'appoggiatura', 'chordalSeventh', 'unexplainedDissonance',
];

export const ISSUE_KINDS: IssueKind[] = ['parallel5', 'parallel8', 'strongDissonance', ...DISSONANCE_KINDS, 'crossing'];

export interface Issue {
  kind: IssueKind;
  tick: number;
  voices: [number, number];
}

export interface ReportOptions {
  /** Grid ticks per quarter note. Default TPB (16th grid). */
  ticksPerBeat?: number;
  /** Ticks between the metrically strong points checked for dissonance. Default: every beat. */
  strongEvery?: number;
  /**
   * Classify every strong-beat dissonance (see DissonanceKind). Default true.
   * false gives the old report: every strong-beat dissonance is
   * 'strongDissonance', except suspensions when `suspensions` is set.
   */
  classify?: boolean;
  /**
   * Only with `classify: false`: report a prepared dissonance that resolves
   * down by step as 'suspension' instead of 'strongDissonance'.
   */
  suspensions?: boolean;
}

const DISS = new Set([1, 2, 6, 10, 11]);
const dissonant = (a: number, b: number): boolean => DISS.has(Math.abs(a - b) % 12);

interface LineGrid {
  notes: Note[];
  /** Index into `notes` of the note sounding at each tick, or -1. */
  at: Int32Array;
  on: Uint8Array;
}

function lineGrid(line: Note[], end: number): LineGrid {
  const notes = sortNotes(line);
  const at = new Int32Array(end + 1).fill(-1);
  const on = new Uint8Array(end + 1);
  notes.forEach((n, k) => {
    for (let t = n.start; t < noteEnd(n); t++) at[t] = k;
    on[n.start] = 1;
  });
  return { notes, at, on };
}

const pitchAt = (g: LineGrid, t: number): number => (t >= 0 && g.at[t] >= 0 ? g.notes[g.at[t]].pitch : -1);

/**
 * Is the note voice `x` sounds at strong tick `t` a suspension against voice `y`?
 * Prepared: the same pitch already sounded in `x` just before `t` (held over or
 * re-struck) and was consonant with `y` there, so the dissonance comes from `y`
 * moving. Resolved: the next note of `x` follows directly, a step (1-2
 * semitones) lower, within `window` ticks of `t`. Upward resolutions
 * (retardations) and ornamented resolutions are not recognized.
 */
function isSuspension(x: LineGrid, y: LineGrid, t: number, window: number): boolean {
  const k = x.at[t];
  if (k < 0 || t < 1) return false;
  const n = x.notes[k];
  if (pitchAt(x, t - 1) !== n.pitch) return false;
  const yBefore = pitchAt(y, t - 1);
  if (yBefore < 0 || dissonant(n.pitch, yBefore)) return false;
  const r = x.notes[k + 1];
  if (!r || r.start !== noteEnd(n) || r.start > t + window) return false;
  const step = n.pitch - r.pitch;
  return step === 1 || step === 2;
}

const isStep = (d: number): boolean => d !== 0 && Math.abs(d) <= 2;

/**
 * The melodic shape around the note voice `x` strikes at strong tick `t`, if
 * it is an accented non-chord tone: the note starts at `t`, the previous note
 * leads directly into it, and the next note follows directly within `window`
 * ticks. Passing: step in, step on in the same direction. Neighbour: step in,
 * step back to the previous pitch. Appoggiatura: leap in (3+ semitones), step
 * out. Whether the note it moves to is consonant is not checked (as for
 * suspensions).
 */
function accentedNonChordTone(x: LineGrid, t: number, window: number): 'passingTone' | 'neighbourTone' | 'appoggiatura' | null {
  const k = x.at[t];
  if (k < 1) return null;
  const n = x.notes[k];
  const prev = x.notes[k - 1];
  const next = x.notes[k + 1];
  if (n.start !== t || noteEnd(prev) !== t || !next || next.start !== noteEnd(n) || next.start > t + window) return null;
  const into = n.pitch - prev.pitch;
  const out = next.pitch - n.pitch;
  if (!isStep(out)) return null;
  if (isStep(into)) {
    if (Math.sign(into) === Math.sign(out)) return 'passingTone';
    if (next.pitch === prev.pitch) return 'neighbourTone';
    return null;
  }
  return Math.abs(into) >= 3 ? 'appoggiatura' : null;
}

/** Root-position pitch-class shapes of the seventh chords: maj7, dom7, min7, half-diminished, diminished. */
const SEVENTH_CHORDS = [[0, 4, 7, 11], [0, 4, 7, 10], [0, 3, 7, 10], [0, 3, 6, 10], [0, 3, 6, 9]];

/**
 * Do the pitch classes sounding at `t` (all voices) fit one seventh chord?
 * Needs at least three distinct pitch classes: two notes alone fit some
 * seventh chord whatever they are, so they explain nothing. A diminished
 * triad counts (a seventh chord without its root).
 */
function fitsSeventhChord(grid: LineGrid[], t: number): boolean {
  const pcs = new Set<number>();
  for (const g of grid) {
    const p = pitchAt(g, t);
    if (p >= 0) pcs.add(p % 12);
  }
  if (pcs.size < 3) return false;
  for (let root = 0; root < 12; root++) {
    for (const shape of SEVENTH_CHORDS) {
      const chord = shape.map((i) => (root + i) % 12);
      if ([...pcs].every((pc) => chord.includes(pc))) return true;
    }
  }
  return false;
}

function classifyDissonance(grid: LineGrid[], a: LineGrid, b: LineGrid, t: number, window: number): DissonanceKind {
  if (isSuspension(a, b, t, window) || isSuspension(b, a, t, window)) return 'suspension';
  const shapes = [accentedNonChordTone(a, t, window), accentedNonChordTone(b, t, window)];
  for (const kind of ['passingTone', 'neighbourTone', 'appoggiatura'] as const) if (shapes.includes(kind)) return kind;
  if (fitsSeventhChord(grid, t)) return 'chordalSeventh';
  return 'unexplainedDissonance';
}

export function voiceLeadingReport(voices: Note[][], opts: ReportOptions = {}): Issue[] {
  const tpb = opts.ticksPerBeat ?? TPB;
  const strong = opts.strongEvery ?? tpb;
  const window = 2 * Math.max(strong, tpb);
  const end = Math.max(0, ...voices.flat().map(noteEnd));
  const grid = voices.map((v) => lineGrid(v, end));
  const issues: Issue[] = [];
  for (let i = 0; i < voices.length; i++) {
    for (let j = i + 1; j < voices.length; j++) {
      const a = grid[i];
      const b = grid[j];
      for (let t = 1; t < end; t++) {
        const pa = pitchAt(a, t), pb = pitchAt(b, t);
        if (pa < 0 || pb < 0) continue;
        if (!(a.on[t] || b.on[t])) continue;
        const qa = pitchAt(a, t - 1), qb = pitchAt(b, t - 1);
        if (qa >= 0 && qb >= 0 && qa !== pa && qb !== pb) {
          const now = Math.abs(pa - pb) % 12;
          const before = Math.abs(qa - qb) % 12;
          if (now === 7 && before === 7) issues.push({ kind: 'parallel5', tick: t, voices: [i, j] });
          if (now === 0 && before === 0) issues.push({ kind: 'parallel8', tick: t, voices: [i, j] });
        }
        if (t % strong === 0 && dissonant(pa, pb)) {
          let kind: IssueKind;
          if (opts.classify ?? true) kind = classifyDissonance(grid, a, b, t, window);
          else kind = opts.suspensions && (isSuspension(a, b, t, window) || isSuspension(b, a, t, window)) ? 'suspension' : 'strongDissonance';
          issues.push({ kind, tick: t, voices: [i, j] });
        }
        if (pa < pb) issues.push({ kind: 'crossing', tick: t, voices: [i, j] });
      }
    }
  }
  return issues;
}

export interface ReportSummary {
  /** Length of the texture in ticks. */
  length: number;
  bars: number;
  /** Every kind, 0 when absent (with classification on, 'strongDissonance' is always 0). */
  counts: Record<IssueKind, number>;
  /** Counts divided by bars, rounded to 3 decimals; the comparable number across pieces. */
  perBar: Record<IssueKind, number>;
}

export function summarizeReport(issues: Issue[], length: number, ticksPerBar: number): ReportSummary {
  const bars = length > 0 ? length / ticksPerBar : 0;
  const counts = Object.fromEntries(ISSUE_KINDS.map((k) => [k, 0])) as Record<IssueKind, number>;
  for (const i of issues) counts[i.kind]++;
  const perBar = Object.fromEntries(
    ISSUE_KINDS.map((k) => [k, bars > 0 ? Math.round((counts[k] / bars) * 1000) / 1000 : 0]),
  ) as Record<IssueKind, number>;
  return { length, bars: Math.round(bars * 1000) / 1000, counts, perBar };
}
