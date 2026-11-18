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
