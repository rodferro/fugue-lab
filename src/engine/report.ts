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
 * prepared notes (suspension, ornamented suspension, retardation), then the
 * shape of a note struck on the beat (passing, neighbour, appoggiatura,
 * escape tone, anticipation), then the texture (pedal point, chordal
 * seventh); anything else is 'unexplainedDissonance'. With `classify: false`
 * they are all 'strongDissonance' (or 'suspension' with `suspensions: true`).
 */
export type DissonanceKind =
  | 'suspension'
  | 'ornamentedSuspension'
  | 'retardation'
  | 'passingTone'
  | 'neighbourTone'
  | 'appoggiatura'
  | 'escapeTone'
  | 'anticipation'
  | 'pedalPoint'
  | 'chordalSeventh'
  | 'unexplainedDissonance';

export type IssueKind = 'parallel5' | 'parallel8' | 'strongDissonance' | DissonanceKind | 'crossing';

export const DISSONANCE_KINDS: DissonanceKind[] = [
  'suspension', 'ornamentedSuspension', 'retardation',
  'passingTone', 'neighbourTone', 'appoggiatura', 'escapeTone', 'anticipation',
  'pedalPoint', 'chordalSeventh', 'unexplainedDissonance',
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
  /** Beats (of `ticksPerBeat`) per bar; sets how long a pedal point must last. Default 4. */
  beatsPerBar?: number;
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
 * Index of the note voice `x` sounds at strong tick `t` if it is prepared
 * against voice `y`: the same pitch already sounded in `x` just before `t`
 * (held over or re-struck) and was consonant with `y` there, so the
 * dissonance comes from `y` moving. Otherwise -1.
 */
function preparedNote(x: LineGrid, y: LineGrid, t: number): number {
  const k = x.at[t];
  if (k < 0 || t < 1) return -1;
  const n = x.notes[k];
  if (pitchAt(x, t - 1) !== n.pitch) return -1;
  const yBefore = pitchAt(y, t - 1);
  return yBefore < 0 || dissonant(n.pitch, yBefore) ? -1 : k;
}

/**
 * A prepared note's resolution, checked in this order. Suspension: the next
 * note follows directly, a step (1-2 semitones) lower, within `window` ticks
 * of `t`. Ornamented suspension: one decorating note (any pitch) comes first,
 * and the step-down resolution follows it directly within `ornWindow` ticks.
 * Retardation: the next note follows directly a step higher, within `window`.
 */
function preparedKind(
  x: LineGrid, y: LineGrid, t: number, window: number, ornWindow: number,
): 'suspension' | 'ornamentedSuspension' | 'retardation' | null {
  const k = preparedNote(x, y, t);
  if (k < 0) return null;
  const n = x.notes[k];
  const r = x.notes[k + 1];
  if (!r || r.start !== noteEnd(n)) return null;
  const fall = n.pitch - r.pitch;
  if (r.start <= t + window && (fall === 1 || fall === 2)) return 'suspension';
  // Checked before retardation: in C–D–B the D decorates a 7–6, it is not
  // an upward resolution.
  const r2 = x.notes[k + 2];
  if (r2 && r2.start === noteEnd(r) && r2.start <= t + ornWindow) {
    const fall2 = n.pitch - r2.pitch;
    if (fall2 === 1 || fall2 === 2) return 'ornamentedSuspension';
  }
  if (r.start <= t + window && (fall === -1 || fall === -2)) return 'retardation';
  return null;
}

/** The old rule, kept for `classify: false` with `suspensions: true`. */
function isSuspension(x: LineGrid, y: LineGrid, t: number, window: number): boolean {
  return preparedKind(x, y, t, window, 0) === 'suspension';
}

const isStep = (d: number): boolean => d !== 0 && Math.abs(d) <= 2;

type Shape = 'passingTone' | 'neighbourTone' | 'appoggiatura' | 'escapeTone' | 'anticipation';
const SHAPES: Shape[] = ['passingTone', 'neighbourTone', 'appoggiatura', 'escapeTone', 'anticipation'];

/**
 * The melodic shape around the note voice `x` strikes at strong tick `t`, if
 * it is an accented non-chord tone. The note starts at `t`, and the next
 * note starts within `window` ticks of `t`.
 * - Passing: step in, step on in the same direction.
 * - Neighbour: step in, step back to the previous pitch.
 *   Both allow a rest of up to `maxRest` ticks before and after the note.
 * - Appoggiatura: leap in (3+ semitones), step out.
 * - Escape tone: step in, leap out (3+) the other way.
 * - Anticipation: left by repeating the same pitch; approached any way.
 * The last three need the neighbouring notes joined directly. Whether the
 * note it moves to is consonant is not checked (as for suspensions).
 */
function accentedShape(x: LineGrid, t: number, window: number, maxRest: number): Shape | null {
  const k = x.at[t];
  if (k < 1) return null;
  const n = x.notes[k];
  const prev = x.notes[k - 1];
  const next = x.notes[k + 1];
  if (n.start !== t || !next || next.start > t + window) return null;
  const gapIn = t - noteEnd(prev);
  const gapOut = next.start - noteEnd(n);
  const into = n.pitch - prev.pitch;
  const out = next.pitch - n.pitch;
  if (isStep(into) && isStep(out) && gapIn <= maxRest && gapOut <= maxRest) {
    if (Math.sign(into) === Math.sign(out)) return 'passingTone';
    if (next.pitch === prev.pitch) return 'neighbourTone';
  }
  if (gapIn !== 0 || gapOut !== 0) return null;
  if (Math.abs(into) >= 3 && isStep(out)) return 'appoggiatura';
  if (isStep(into) && Math.abs(out) >= 3 && Math.sign(out) === -Math.sign(into)) return 'escapeTone';
  if (out === 0) return 'anticipation';
  return null;
}

/**
 * Does voice `y` hold the note it sounds at `t` for at least `bar` ticks?
 * Re-strikes of the same pitch that join directly count as one held note
 * (ties often arrive split from MusicXML).
 */
function holdsPedal(y: LineGrid, t: number, bar: number): boolean {
  const k = y.at[t];
  if (k < 0) return false;
  const p = y.notes[k].pitch;
  let first = k;
  let last = k;
  while (first > 0 && y.notes[first - 1].pitch === p && noteEnd(y.notes[first - 1]) === y.notes[first].start) first--;
  while (last + 1 < y.notes.length && y.notes[last + 1].pitch === p && y.notes[last + 1].start === noteEnd(y.notes[last])) last++;
  return noteEnd(y.notes[last]) - y.notes[first].start >= bar;
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

interface Windows {
  /** Resolution of a suspension or retardation, and the next note after an accented shape. */
  window: number;
  /** Resolution of an ornamented suspension. */
  ornWindow: number;
  /** Longest rest allowed next to a passing or neighbour tone (an eighth). */
  maxRest: number;
  /** Shortest pedal point (a bar). */
  bar: number;
}

function classifyDissonance(grid: LineGrid[], a: LineGrid, b: LineGrid, t: number, w: Windows): DissonanceKind {
  const prepared = [preparedKind(a, b, t, w.window, w.ornWindow), preparedKind(b, a, t, w.window, w.ornWindow)];
  for (const kind of ['suspension', 'ornamentedSuspension', 'retardation'] as const) if (prepared.includes(kind)) return kind;
  const shapes = [accentedShape(a, t, w.window, w.maxRest), accentedShape(b, t, w.window, w.maxRest)];
  for (const kind of SHAPES) if (shapes.includes(kind)) return kind;
  if (holdsPedal(a, t, w.bar) || holdsPedal(b, t, w.bar)) return 'pedalPoint';
  if (fitsSeventhChord(grid, t)) return 'chordalSeventh';
  return 'unexplainedDissonance';
}

export function voiceLeadingReport(voices: Note[][], opts: ReportOptions = {}): Issue[] {
  const tpb = opts.ticksPerBeat ?? TPB;
  const strong = opts.strongEvery ?? tpb;
  const beat = Math.max(strong, tpb);
  const window = 2 * beat;
  const w: Windows = { window, ornWindow: 3 * beat, maxRest: Math.floor(tpb / 2), bar: tpb * (opts.beatsPerBar ?? 4) };
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
          if (opts.classify ?? true) kind = classifyDissonance(grid, a, b, t, w);
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
