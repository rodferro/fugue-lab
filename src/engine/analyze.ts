// Subject analysis: key detection, tonal-answer mutation point, warnings.
import { Note, lengthOf, sortNotes } from './model';
import { Key, Mode, keyName, mod12, toScalePitch } from './theory';

// Krumhansl–Kessler key profiles.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(a: number[], b: number[]): number {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export interface KeyCandidate {
  key: Key;
  score: number;
}

/** Duration-weighted Krumhansl–Schmuckler, nudged toward keys whose tonic frames the subject. */
export function detectKey(notes: Note[]): KeyCandidate[] {
  if (!notes.length) return [{ key: { tonic: 0, mode: 'major' }, score: 0 }];
  const sorted = sortNotes(notes);
  const hist = new Array(12).fill(0);
  for (const n of sorted) hist[mod12(n.pitch)] += Math.sqrt(n.dur);
  const first = mod12(sorted[0].pitch);
  const last = mod12(sorted[sorted.length - 1].pitch);
  const out: KeyCandidate[] = [];
  for (const mode of ['major', 'minor'] as Mode[]) {
    for (let t = 0; t < 12; t++) {
      const prof = (mode === 'major' ? KK_MAJOR : KK_MINOR).map((_, i, arr) => arr[mod12(i - t)]);
      let score = correlate(hist, prof);
      if (first === t) score += 0.12;
      else if (first === mod12(t + 7)) score += 0.06;
      if (last === t) score += 0.15;
      out.push({ key: { tonic: t, mode }, score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Number of opening notes that belong to the tonal "head" of the subject:
 * the maximal prefix made only of ^1 and ^5, provided it contains a ^5.
 * Notes in the head get the tonal mapping (^1→^5, ^5→^1); the rest is
 * transposed exactly. Returns 0 when no tonal adjustment is needed.
 */
export function autoMutation(notes: Note[], key: Key): number {
  const sorted = sortNotes(notes);
  let i = 0;
  let sawFifth = false;
  while (i < sorted.length) {
    const sp = toScalePitch(sorted[i].pitch, key);
    if (sp.acc !== 0 || (sp.deg !== 0 && sp.deg !== 4)) break;
    if (sp.deg === 4) sawFifth = true;
    i++;
  }
  if (!sawFifth) return 0;
  // A head that swallows the whole subject is just a tonic–dominant figure.
  return Math.min(i, Math.max(sorted.length - 1, 0));
}

export interface SubjectAnalysis {
  key: Key;
  candidates: KeyCandidate[];
  autoMutation: number;
  length: number;
  lowest: number;
  highest: number;
  warnings: string[];
}

export function analyzeSubject(notes: Note[], keyOverride?: Key): SubjectAnalysis {
  const sorted = sortNotes(notes);
  const candidates = detectKey(sorted);
  const key = keyOverride ?? candidates[0].key;
  const warnings: string[] = [];
  const pitches = sorted.map((n) => n.pitch);
  const lowest = pitches.length ? Math.min(...pitches) : 60;
  const highest = pitches.length ? Math.max(...pitches) : 60;

  if (sorted.length < 3) warnings.push('Write at least three notes to give the fugue something to work with.');
  if (highest - lowest > 19) warnings.push('The subject spans more than a 12th, so it will not fit comfortably in every voice range.');
  if (!keyOverride && candidates.length > 1 && candidates[0].score - candidates[1].score < 0.04) {
    warnings.push(`Key is ambiguous (${keyName(candidates[0].key)} or ${keyName(candidates[1].key)}). Set it manually if the guess is wrong.`);
  }
  if (sorted.length) {
    const lastSp = toScalePitch(sorted[sorted.length - 1].pitch, key);
    if (lastSp.deg === 6) warnings.push('The subject ends on the leading tone, so each entry will sound unfinished.');
    if (sorted[0].start > 0) warnings.push('The subject starts with a rest; the rest is kept in every entry.');
  }
  return { key, candidates, autoMutation: autoMutation(sorted, key), length: lengthOf(sorted), lowest, highest, warnings };
}
