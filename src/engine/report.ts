// Voice-leading report over a finished texture: counts the classic errors so
// the UI, the tests and the research CLI can show how clean a result is.
// Works on any set of monophonic lines, generated or imported (e.g. a Bach
// fugue split into voices). Grid resolution and strong-beat spacing are
// options, so imported music with 32nds or triplets can be measured too.
import { Note, TPB, noteEnd, sortNotes } from './model';

export type IssueKind = 'parallel5' | 'parallel8' | 'strongDissonance' | 'suspension' | 'crossing';

export const ISSUE_KINDS: IssueKind[] = ['parallel5', 'parallel8', 'strongDissonance', 'suspension', 'crossing'];

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
   * Report a prepared dissonance that resolves down by step as 'suspension'
   * instead of 'strongDissonance'. Off by default, so the generator's own
   * quality tests keep counting every strong-beat dissonance.
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
          const susp = opts.suspensions && (isSuspension(a, b, t, window) || isSuspension(b, a, t, window));
          issues.push({ kind: susp ? 'suspension' : 'strongDissonance', tick: t, voices: [i, j] });
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
