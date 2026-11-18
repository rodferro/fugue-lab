import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Note } from './model';
import { DISSONANCE_KINDS, summarizeReport, voiceLeadingReport } from './report';

const line = (rows: [number, number, number][]): Note[] => rows.map(([pitch, start, dur]) => ({ pitch, start, dur }));
const kinds = (voices: Note[][], opts = {}) => voiceLeadingReport(voices, opts).map((i) => `${i.kind}@${i.tick}`);
// The unclassified report, as before classification: everything is
// strongDissonance unless `suspensions` is set.
const OLD = { classify: false };

// 7–6 suspension: the upper C is consonant with E below, the bass moves to D
// under it (a 7th) and the C resolves down a step to B (a 6th).
const upper76 = line([[72, 0, 8], [71, 8, 8]]);
const lower76 = line([[64, 0, 4], [62, 4, 12]]);

test('unclassified: a prepared 7–6 is a suspension only when asked', () => {
  assert.deepEqual(kinds([upper76, lower76], OLD), ['strongDissonance@4']);
  assert.deepEqual(kinds([upper76, lower76], { ...OLD, suspensions: true }), ['suspension@4']);
  // Classification is the default, and always tells suspensions apart.
  assert.deepEqual(kinds([upper76, lower76]), ['suspension@4']);
});

test('unclassified: unprepared, upward-resolving or interrupted dissonances stay errors', () => {
  const leapt = line([[67, 0, 4], [72, 4, 4], [71, 8, 8]]); // arrives on the beat
  assert.deepEqual(kinds([leapt, lower76], { ...OLD, suspensions: true }), ['strongDissonance@4']);
  const up = line([[72, 0, 8], [74, 8, 8]]); // resolves up a step
  assert.deepEqual(kinds([up, lower76], { ...OLD, suspensions: true }), ['strongDissonance@4']);
  const rest = line([[72, 0, 8], [71, 10, 6]]); // rest before the resolution
  assert.deepEqual(kinds([rest, lower76], { ...OLD, suspensions: true }), ['strongDissonance@4']);
  // Classified, the leapt-to C is an appoggiatura; the other two explain nothing.
  assert.deepEqual(kinds([leapt, lower76]), ['appoggiatura@4']);
  assert.deepEqual(kinds([up, lower76]), ['unexplainedDissonance@4']);
  assert.deepEqual(kinds([rest, lower76]), ['unexplainedDissonance@4']);
});

test('a suspension in the lower voice is recognized too (2–3)', () => {
  // The bass C is held while the upper voice moves from E (a 3rd) to D (a 2nd);
  // the bass resolves down to B (a 3rd under D).
  const upper = line([[64, 0, 4], [62, 4, 12]]);
  const lower = line([[60, 0, 8], [59, 8, 8]]);
  assert.deepEqual(kinds([upper, lower]), ['suspension@4']);
  assert.deepEqual(kinds([upper, lower], { ...OLD, suspensions: true }), ['suspension@4']);
});

test('grid resolution and strong-beat spacing are options', () => {
  const x2 = (ns: Note[]) => ns.map((n) => ({ pitch: n.pitch, start: n.start * 2, dur: n.dur * 2 }));
  assert.deepEqual(kinds([x2(upper76), x2(lower76)], { ticksPerBeat: 8, suspensions: true }), ['suspension@8']);
  assert.deepEqual(kinds([x2(upper76), x2(lower76)], { ticksPerBeat: 8 }), ['suspension@8']);
  // Only bar downbeats count as strong: the dissonance on beat 2 is not reported.
  assert.deepEqual(kinds([upper76, lower76], { strongEvery: 16 }), []);
  // Off-beat dissonances are never reported.
  const passing = line([[72, 0, 2], [74, 2, 2], [76, 4, 4]]);
  const held = line([[60, 0, 8]]);
  assert.deepEqual(kinds([passing, held]), []);
});

test('summary counts per bar', () => {
  const issues = voiceLeadingReport([upper76, lower76], { suspensions: true });
  const s = summarizeReport(issues, 32, 16);
  assert.equal(s.bars, 2);
  assert.equal(s.counts.suspension, 1);
  assert.equal(s.perBar.suspension, 0.5);
  assert.equal(s.counts.parallel5, 0);
});

// Accented non-chord tones over a held C (60), struck on beat 2 (tick 4).
const heldC = line([[60, 0, 12]]);

test('accented passing tone: by step in, by step on in the same direction', () => {
  assert.deepEqual(kinds([line([[72, 0, 4], [74, 4, 4], [76, 8, 4]]), heldC]), ['passingTone@4']);
  assert.deepEqual(kinds([line([[76, 0, 4], [74, 4, 4], [72, 8, 4]]), heldC]), ['passingTone@4']);
  // Unclassified it is still a plain strong-beat dissonance.
  assert.deepEqual(kinds([line([[72, 0, 4], [74, 4, 4], [76, 8, 4]]), heldC], OLD), ['strongDissonance@4']);
});

test('accented neighbour tone: by step out and back to the same pitch', () => {
  assert.deepEqual(kinds([line([[72, 0, 4], [74, 4, 4], [72, 8, 4]]), heldC]), ['neighbourTone@4']);
  // Turning back without returning (C#, D, C) is not a neighbour.
  assert.deepEqual(kinds([line([[73, 0, 4], [74, 4, 4], [72, 8, 4]]), heldC]), ['unexplainedDissonance@4']);
});

test('appoggiatura: by leap in, resolved by step', () => {
  assert.deepEqual(kinds([line([[67, 0, 4], [74, 4, 4], [72, 8, 4]]), heldC]), ['appoggiatura@4']);
  // Left by leap: unexplained.
  assert.deepEqual(kinds([line([[67, 0, 4], [74, 4, 4], [67, 8, 4]]), heldC]), ['unexplainedDissonance@4']);
});

test('melodic shapes need the note struck on the beat and joined to its neighbours', () => {
  // D arrives before the beat; the dissonance on the beat comes from the bass
  // moving to C, and D was already dissonant with the E before: unexplained.
  const upper = line([[72, 0, 2], [74, 2, 4], [76, 6, 2]]);
  const lower = line([[64, 0, 4], [60, 4, 8]]);
  assert.deepEqual(kinds([upper, lower]), ['unexplainedDissonance@4']);
  // A rest before the passing note breaks it.
  assert.deepEqual(kinds([line([[72, 0, 3], [74, 4, 4], [76, 8, 4]]), heldC]), ['unexplainedDissonance@4']);
});

test('chordal seventh: the sounding notes fit one seventh chord', () => {
  // F leapt to (and not resolved by step) over B and G: G7 without its fifth.
  const top = line([[74, 0, 4], [77, 4, 8]]);
  const mid = line([[71, 0, 12]]);
  const bass = line([[55, 0, 12]]);
  assert.deepEqual(kinds([top, mid, bass]), ['chordalSeventh@4', 'chordalSeventh@4']);
  // Two notes alone always fit some seventh chord, so they explain nothing.
  assert.deepEqual(kinds([line([[72, 0, 4], [82, 4, 4], [72, 8, 4]]), heldC]), ['unexplainedDissonance@4']);
  // Three notes that fit no seventh chord (C, D, E).
  const c = line([[72, 0, 4], [76, 4, 8]]);
  assert.deepEqual(kinds([c, line([[67, 0, 4], [62, 4, 8]]), line([[48, 0, 12]])]), [
    'unexplainedDissonance@4', 'unexplainedDissonance@4',
  ]);
});

test('melodic explanations take precedence over the chord', () => {
  // A passing F over B and G fits G7 too, but is reported as a passing tone.
  const top = line([[79, 0, 4], [77, 4, 4], [76, 8, 4]]);
  assert.deepEqual(kinds([top, line([[71, 0, 12]]), line([[55, 0, 12]])]), ['passingTone@4', 'passingTone@4']);
});

test('summary counts every dissonance kind', () => {
  const issues = voiceLeadingReport([line([[72, 0, 4], [74, 4, 4], [76, 8, 4]]), heldC]);
  const s = summarizeReport(issues, 16, 16);
  for (const k of DISSONANCE_KINDS) assert.equal(s.counts[k], k === 'passingTone' ? 1 : 0, k);
  assert.equal(s.counts.strongDissonance, 0);
  assert.equal(s.perBar.passingTone, 1);
});
