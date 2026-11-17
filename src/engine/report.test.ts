import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Note } from './model';
import { summarizeReport, voiceLeadingReport } from './report';

const line = (rows: [number, number, number][]): Note[] => rows.map(([pitch, start, dur]) => ({ pitch, start, dur }));
const kinds = (voices: Note[][], opts = {}) => voiceLeadingReport(voices, opts).map((i) => `${i.kind}@${i.tick}`);

// 7–6 suspension: the upper C is consonant with E below, the bass moves to D
// under it (a 7th) and the C resolves down a step to B (a 6th).
const upper76 = line([[72, 0, 8], [71, 8, 8]]);
const lower76 = line([[64, 0, 4], [62, 4, 12]]);

test('a prepared 7–6 is a suspension only when asked', () => {
  assert.deepEqual(kinds([upper76, lower76]), ['strongDissonance@4']);
  assert.deepEqual(kinds([upper76, lower76], { suspensions: true }), ['suspension@4']);
});

test('unprepared, upward-resolving or interrupted dissonances stay errors', () => {
  const leapt = line([[67, 0, 4], [72, 4, 4], [71, 8, 8]]); // arrives on the beat
  assert.deepEqual(kinds([leapt, lower76], { suspensions: true }), ['strongDissonance@4']);
  const up = line([[72, 0, 8], [74, 8, 8]]); // resolves up a step
  assert.deepEqual(kinds([up, lower76], { suspensions: true }), ['strongDissonance@4']);
  const rest = line([[72, 0, 8], [71, 10, 6]]); // rest before the resolution
  assert.deepEqual(kinds([rest, lower76], { suspensions: true }), ['strongDissonance@4']);
});

test('a suspension in the lower voice is recognized too (2–3)', () => {
  // The bass C is held while the upper voice moves from E (a 3rd) to D (a 2nd);
  // the bass resolves down to B (a 3rd under D).
  const upper = line([[64, 0, 4], [62, 4, 12]]);
  const lower = line([[60, 0, 8], [59, 8, 8]]);
  assert.deepEqual(kinds([upper, lower], { suspensions: true }), ['suspension@4']);
});

test('grid resolution and strong-beat spacing are options', () => {
  const x2 = (ns: Note[]) => ns.map((n) => ({ pitch: n.pitch, start: n.start * 2, dur: n.dur * 2 }));
  assert.deepEqual(kinds([x2(upper76), x2(lower76)], { ticksPerBeat: 8, suspensions: true }), ['suspension@8']);
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
