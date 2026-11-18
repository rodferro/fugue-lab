import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../app/examples';
import { generateFugue } from '../engine/fugue';
import { makeAnswer } from '../engine/answer';
import { ISSUE_KINDS, voiceLeadingReport } from '../engine/report';
import { RequestError, answerCommand, generateCommand, reportCommand } from './commands';

const subject = EXAMPLES.find((e) => e.id === 'd-minor')!.notes;
// Round-trip through JSON, as the command line does.
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

test('generate matches the engine and is deterministic', () => {
  const req = { subject, settings: { voices: 3, seed: 5 } };
  const a = json(generateCommand(json(req)).json);
  const b = json(generateCommand(json(req)).json);
  assert.deepEqual(a, b);
  assert.deepEqual(a.notes, json(generateFugue(subject, { voices: 3, seed: 5 }).notes));
  assert.equal(a.keyName, 'D minor');
  assert.equal(a.ticksPerBeat, 4);
  for (const k of ISSUE_KINDS) assert.equal(a.report.counts[k], a.issues.filter((i: { kind: string }) => i.kind === k).length, k);
});

test('generate can write a MIDI file', () => {
  const res = generateCommand({ subject, settings: { voices: 2 }, midi: 'out.mid' });
  assert.equal(res.files.length, 1);
  assert.equal(res.files[0].path, 'out.mid');
  assert.deepEqual([...res.files[0].data.slice(0, 4)], [...'MThd'].map((c) => c.charCodeAt(0)));
});

test('report on generated voices equals the engine report', () => {
  const f = generateFugue(subject, { voices: 4, seed: 2 });
  const voices = json(f.notes).map((v: { pitch: number; start: number; dur: number }[]) => v.map(({ pitch, start, dur }) => ({ pitch, start, dur })));
  const r = json(reportCommand({ voices }).json);
  assert.deepEqual(r.issues, json(voiceLeadingReport(f.notes)));
  assert.equal(r.overlapsTrimmed, 0);
});

test('report trims overlapping notes and counts them', () => {
  const r = json(reportCommand({ voices: [[{ pitch: 72, start: 0, dur: 8 }, { pitch: 74, start: 4, dur: 4 }], [{ pitch: 60, start: 0, dur: 8 }]] }).json);
  assert.equal(r.overlapsTrimmed, 1);
});

test('answer matches makeAnswer', () => {
  const r = json(answerCommand({ subject, type: 'tonal', key: { tonic: 2, mode: 'minor' }, mutation: 2 }).json);
  assert.deepEqual(r.notes, json(makeAnswer(subject, { tonic: 2, mode: 'minor' }, 'tonal', 2).notes));
  assert.equal(r.keyName, 'D minor');
});

test('bad requests are rejected with a message', () => {
  assert.throws(() => generateCommand({ subject: [] }), RequestError);
  assert.throws(() => generateCommand({ subject, settings: { voices: 5 } }), /voices/);
  assert.throws(() => reportCommand({ voices: [[{ pitch: 60, start: 0.5, dur: 4 }], []] }), /integer/);
  assert.throws(() => answerCommand({ subject, key: { tonic: 14, mode: 'minor' } }), /pitch class/);
});

test('report spells with key or keys, and generate passes its key plan', () => {
  const voices = [[{ pitch: 64, start: 0, dur: 4 }, { pitch: 61, start: 4, dur: 4 }, { pitch: 69, start: 8, dur: 4 }], [{ pitch: 53, start: 0, dur: 12 }]];
  const dm = json(reportCommand({ voices, key: { tonic: 2, mode: 'minor' } }).json);
  assert.equal(dm.summary.counts.unexplainedDissonance, 1);
  const fM = json(reportCommand({ voices, keys: [{ start: 0, key: { tonic: 5, mode: 'major' } }] }).json);
  assert.equal(fM.issues.length, 0);
  assert.throws(() => reportCommand({ voices, keys: [{ start: 0 }] }), /key/);
  const g = json(generateCommand({ subject, settings: { voices: 3 } }).json);
  assert.ok(g.keys.length >= 2);
  assert.equal(g.report.counts.chromaticClash, 0);
});

test('generate takes a meter and a grid resolution', () => {
  const fine = subject.map((x) => ({ ...x, start: x.start * 6, dur: x.dur * 6 }));
  const a = json(generateCommand({ subject, settings: { voices: 3, seed: 4, meter: '6/8' } }).json);
  const b = json(generateCommand({ subject: fine, settings: { voices: 3, seed: 4, meter: { num: 6, den: 8 }, ticksPerQuarter: 24 } }).json);
  assert.equal(b.ticksPerBeat, 24);
  assert.deepEqual(b.meter, { num: 6, den: 8 });
  assert.equal(b.grid.bar, 72);
  assert.deepEqual(b.notes, a.notes.map((v: { start: number; dur: number }[]) => v.map((x) => ({ ...x, start: x.start * 6, dur: x.dur * 6 }))));
  assert.deepEqual(b.report, { ...a.report, length: a.report.length * 6 });
  assert.equal(a.report.bars, a.length / 12, '6/8 bars of 12 ticks');
  const midi = generateCommand({ subject: fine, settings: { voices: 2, meter: '6/8', ticksPerQuarter: 24 }, midi: 'x.mid' }).files[0].data;
  assert.ok(midi.length > 100);
  assert.throws(() => generateCommand({ subject, settings: { meter: '5/8' } }), RequestError);
  assert.throws(() => generateCommand({ subject, settings: { meter: { num: 6 } } }), RequestError);
  assert.throws(() => generateCommand({ subject, settings: { ticksPerQuarter: 6 } }), /multiple of 4/);
  assert.throws(() => generateCommand({ subject, settings: { beatsPerBar: 0 } }), RequestError);
});

test('report takes a meter for strong beats and bars', () => {
  const voices = [[{ pitch: 72, start: 0, dur: 4 }, { pitch: 74, start: 4, dur: 2 }, { pitch: 71, start: 6, dur: 6 }], [{ pitch: 60, start: 0, dur: 12 }]];
  const r68 = json(reportCommand({ voices, meter: '6/8' }).json);
  const r34 = json(reportCommand({ voices, beatsPerBar: 3 }).json);
  assert.equal(r68.summary.bars, 1);
  assert.equal(r34.summary.bars, 1);
  assert.deepEqual(r68.issues.map((i: { tick: number }) => i.tick), [6]);
  assert.deepEqual(r34.issues.map((i: { tick: number }) => i.tick), [4]);
  assert.throws(() => reportCommand({ voices, meter: '6/8', ticksPerBeat: 3 }), /even/);
  assert.throws(() => reportCommand({ voices, meter: 'x' }), RequestError);
});

test('settings.clashPenalty overrides the chromatic-clash penalty; 60 is the default', () => {
  const out = (settings: object) => json(generateCommand(json({ subject, settings: { voices: 4, seed: 3, ...settings } })).json).notes;
  assert.deepEqual(out({ clashPenalty: 60 }), out({}));
  assert.throws(() => generateCommand({ subject, settings: { clashPenalty: -1 } }), /clashPenalty/);
  assert.throws(() => generateCommand({ subject, settings: { clashPenalty: 'high' } }), /clashPenalty/);
});
