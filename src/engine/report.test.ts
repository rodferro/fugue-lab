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
  // Classified, the leapt-to C is an appoggiatura, the upward resolution a
  // retardation; the interrupted one explains nothing.
  assert.deepEqual(kinds([leapt, lower76]), ['appoggiatura@4']);
  assert.deepEqual(kinds([up, lower76]), ['retardation@4']);
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
  // A rest longer than an eighth before the passing note breaks it.
  assert.deepEqual(kinds([line([[72, 0, 1], [74, 4, 4], [76, 8, 4]]), heldC]), ['unexplainedDissonance@4']);
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

test('ornamented suspension: one decorating note, then the step down, within three beats', () => {
  // 7–6 over the D, with a lower (A) or upper (D) decoration before the B.
  assert.deepEqual(kinds([line([[72, 0, 8], [69, 8, 2], [71, 10, 6]]), lower76]), ['ornamentedSuspension@4']);
  // C–D–B: the step up decorates, so this is not a retardation.
  assert.deepEqual(kinds([line([[72, 0, 8], [74, 8, 2], [71, 10, 6]]), lower76]), ['ornamentedSuspension@4']);
  // Resolution later than three beats after the dissonance.
  assert.deepEqual(kinds([line([[72, 0, 8], [69, 8, 10], [71, 18, 2]]), lower76]), ['unexplainedDissonance@4']);
  // Two decorating notes.
  assert.deepEqual(kinds([line([[72, 0, 8], [69, 8, 2], [67, 10, 2], [71, 12, 4]]), lower76]), ['unexplainedDissonance@4']);
  // Unclassified with suspensions: still not a (plain) suspension.
  assert.deepEqual(kinds([line([[72, 0, 8], [69, 8, 2], [71, 10, 6]]), lower76], { ...OLD, suspensions: true }), ['strongDissonance@4']);
});

test('retardation: prepared, resolves up by step', () => {
  // C held over the bass moving E to D (a 7th), then up to D (an octave).
  assert.deepEqual(kinds([line([[72, 0, 8], [74, 8, 8]]), lower76]), ['retardation@4']);
  // Rising but not prepared (struck on the beat after a rest): not a retardation.
  assert.deepEqual(kinds([line([[67, 0, 2], [72, 4, 4], [74, 8, 8]]), lower76]), ['unexplainedDissonance@4']);
});

test('escape tone: step in, leap out the other way', () => {
  assert.deepEqual(kinds([line([[72, 0, 4], [74, 4, 4], [69, 8, 4]]), heldC]), ['escapeTone@4']);
  // Leaping on in the same direction is not an escape tone.
  assert.deepEqual(kinds([line([[72, 0, 4], [74, 4, 4], [79, 8, 4]]), heldC]), ['unexplainedDissonance@4']);
});

test('anticipation: left by repeating the same pitch', () => {
  // D over C, repeated over the B that arrives under it (a 3rd).
  const lower = line([[60, 0, 8], [59, 8, 4]]);
  assert.deepEqual(kinds([line([[71, 0, 4], [74, 4, 4], [74, 8, 4]]), lower]), ['anticipation@4']);
  // A rest before the repetition breaks it.
  assert.deepEqual(kinds([line([[71, 0, 4], [74, 4, 3], [74, 8, 4]]), lower]), ['unexplainedDissonance@4']);
});

test('pedal point: the other voice holds its note for at least a bar', () => {
  const fSharp = line([[72, 0, 4], [78, 4, 4], [72, 8, 4]]); // leapt to and from: no melodic explanation
  assert.deepEqual(kinds([fSharp, line([[48, 0, 32]])]), ['pedalPoint@4']);
  // Re-struck at the same pitch, joined: still one held pedal of a bar.
  assert.deepEqual(kinds([fSharp, line([[48, 0, 8], [48, 8, 8]])]), ['pedalPoint@4']);
  // Shorter than a bar.
  assert.deepEqual(kinds([fSharp, line([[48, 0, 12]])]), ['unexplainedDissonance@4']);
  // The bar length comes from beatsPerBar.
  assert.deepEqual(kinds([fSharp, line([[48, 0, 16]])], { beatsPerBar: 8 }), ['unexplainedDissonance@4']);
  // A melodic explanation wins over the pedal.
  assert.deepEqual(kinds([line([[72, 0, 4], [74, 4, 4], [76, 8, 4]]), line([[48, 0, 32]])]), ['passingTone@4']);
});

test('passing and neighbour tones allow a rest of up to an eighth next to them', () => {
  // 16th and eighth rests before, an eighth rest after.
  assert.deepEqual(kinds([line([[72, 0, 3], [74, 4, 4], [76, 8, 4]]), heldC]), ['passingTone@4']);
  assert.deepEqual(kinds([line([[72, 0, 2], [74, 4, 4], [76, 8, 4]]), heldC]), ['passingTone@4']);
  assert.deepEqual(kinds([line([[72, 0, 4], [74, 4, 2], [76, 8, 4]]), heldC]), ['passingTone@4']);
  assert.deepEqual(kinds([line([[72, 0, 4], [74, 4, 3], [72, 8, 4]]), heldC]), ['neighbourTone@4']);
  // More than an eighth after.
  assert.deepEqual(kinds([line([[72, 0, 4], [74, 4, 1], [76, 8, 4]]), heldC]), ['unexplainedDissonance@4']);
  // Appoggiaturas get no such allowance.
  assert.deepEqual(kinds([line([[67, 0, 2], [74, 4, 4], [72, 8, 4]]), heldC]), ['unexplainedDissonance@4']);
  // The eighth scales with the grid (8 ticks per beat: up to 4 ticks).
  const x2 = (ns: Note[]) => ns.map((n) => ({ pitch: n.pitch, start: n.start * 2, dur: n.dur * 2 }));
  assert.deepEqual(kinds([x2(line([[72, 0, 2], [74, 4, 4], [76, 8, 4]])), x2(heldC)], { ticksPerBeat: 8 }), ['passingTone@8']);
});

const DmKey = [{ start: 0, key: { tonic: 2, mode: 'minor' as const } }];

test('chromatic clash: same degree, two forms, checked before every other rule', () => {
  // A prepared C held over a C♯ arriving in the bass, resolving down by step:
  // shaped like a suspension, but C against C♯ is a clash in D minor.
  // (The bass stops before the resolution, so only the clash is reported.)
  const upper = line([[72, 0, 8], [70, 8, 8]]);
  const lower = line([[57, 0, 4], [61, 4, 4]]);
  assert.deepEqual(kinds([upper, lower], { keys: DmKey }), ['chromaticClash@4']);
  // Unclassified it is a plain strong-beat dissonance (11 semitones).
  assert.deepEqual(kinds([upper, lower], { keys: DmKey, classify: false }), ['strongDissonance@4']);
});

test('augmented and diminished intervals are dissonant even when their semitones are not', () => {
  // Soprano C♯ leapt to over alto F (an augmented 5th, 8 semitones), left by leap to A.
  const sop = line([[64, 0, 4], [61, 4, 4], [69, 8, 4]]);
  const alto = line([[53, 0, 12]]);
  assert.deepEqual(kinds([sop, alto], { keys: DmKey }), ['unexplainedDissonance@4']);
  assert.deepEqual(kinds([sop, alto], { keys: DmKey, classify: false }), ['strongDissonance@4']);
  // In F major the same pitches are D♭ over F, a minor 6th: consonant.
  assert.deepEqual(kinds([sop, alto], { keys: [{ start: 0, key: { tonic: 5, mode: 'major' } }] }), []);
});

test('key spans switch the spelling; without keys one key is detected', () => {
  const sop = line([[64, 0, 4], [61, 4, 4], [69, 8, 4]]);
  const alto = line([[53, 0, 12]]);
  // D minor from tick 4 on: dissonant; F major until tick 8: consonant.
  assert.deepEqual(kinds([sop, alto], { keys: [{ start: 0, key: { tonic: 5, mode: 'major' } }, { start: 4, key: { tonic: 2, mode: 'minor' } }] }), ['unexplainedDissonance@4']);
  assert.deepEqual(kinds([sop, alto], { keys: [{ start: 0, key: { tonic: 2, mode: 'minor' } }, { start: 4, key: { tonic: 5, mode: 'major' } }] }), []);
  // No keys: detected from the notes. C major material spells plain intervals as before.
  assert.deepEqual(kinds([line([[72, 0, 4], [74, 4, 4], [76, 8, 4]]), heldC]), ['passingTone@4']);
});

test('summary counts chromatic clashes and unexplained dissonances as errors', () => {
  const upper = line([[72, 0, 8], [70, 8, 8]]);
  const lower = line([[57, 0, 4], [61, 4, 4]]);
  const s = summarizeReport(voiceLeadingReport([upper, lower], { keys: DmKey }), 16, 16);
  assert.equal(s.counts.chromaticClash, 1);
  assert.equal(s.dissonanceErrors, 1);
  assert.equal(s.dissonanceErrorsPerBar, 1);
});
