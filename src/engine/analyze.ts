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
/** How far into the subject an early, leapt-to ^5 still counts as part of the head. */
export const AUTO_MUTATION_WINDOW = 5;

export function autoMutation(notes: Note[], key: Key): number {
  const sorted = sortNotes(notes);
  const sps = sorted.map((n) => toScalePitch(n.pitch, key));
  const isTonicOrFifth = (k: number) => sps[k].acc === 0 && (sps[k].deg === 0 || sps[k].deg === 4);
  let i = 0;
  let sawFifth = false;
  while (i < sorted.length && isTonicOrFifth(i)) {
    if (sps[i].deg === 4) sawFifth = true;
    i++;
  }
  if (!sawFifth) {
    // A subject that starts on ^1 and leaps from ^1 to an early ^5 outlines the
    // tonic-dominant frame too, so it also gets the tonal answer (C B C G, BWV 847;
    // F E F C, BWV 880): the head runs through that ^5 and any ^1/^5 directly
    // after it. A ^5 reached by step (C D E F G, BWV 846), from another degree
    // (BWV 887), or in a subject that doesn't start on ^1 (BWV 882) keeps the
    // real answer, as Bach's do.
    i = 0;
    const startsOnTonic = sps.length > 0 && sps[0].acc === 0 && sps[0].deg === 0;
    for (let k = 1; startsOnTonic && k < Math.min(sorted.length, AUTO_MUTATION_WINDOW); k++) {
      const fromTonic = sps[k - 1].acc === 0 && sps[k - 1].deg === 0;
      if (sps[k].acc === 0 && sps[k].deg === 4 && fromTonic && Math.abs(sorted[k].pitch - sorted[k - 1].pitch) >= 3) {
        i = k + 1;
        while (i < sorted.length && isTonicOrFifth(i)) i++;
        sawFifth = true;
        break;
      }
    }
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
