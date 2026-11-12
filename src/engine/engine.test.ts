import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../app/examples';
import { detectKey } from './analyze';
import { makeAnswer } from './answer';
import { generateFugue } from './fugue';
import { voiceLeadingReport } from './report';
import { noteEnd } from './model';
import { keyName } from './theory';

const ex = (id: string) => EXAMPLES.find((e) => e.id === id)!.notes;

test('detects the key of each example', () => {
  assert.equal(keyName(detectKey(ex('c-major'))[0].key), 'C major');
  assert.equal(keyName(detectKey(ex('d-minor'))[0].key), 'D minor');
  assert.equal(keyName(detectKey(ex('g-major'))[0].key), 'G major');
  assert.equal(keyName(detectKey(ex('a-minor'))[0].key), 'A minor');
});

test('real answer is an exact fifth up', () => {
  const s = ex('c-major');
  const a = makeAnswer(s, { tonic: 0, mode: 'major' }, 'real', 0);
  assert.deepEqual(a.notes.map((n) => n.pitch), s.map((n) => n.pitch + 7));
});

test('tonal answer swaps 1 and 5 in the head', () => {
  const s = ex('c-major'); // C G ...
  const a = makeAnswer(s, { tonic: 0, mode: 'major' }, 'tonal', 2);
  assert.deepEqual(a.notes.slice(0, 3).map((n) => n.pitch), [79, 72, 76]); // G C | E (real from here)
  const m = ex('a-minor'); // E A ...
  const b = makeAnswer(m, { tonic: 9, mode: 'minor' }, 'tonal', 2);
  assert.deepEqual(b.notes.slice(0, 2).map((n) => n.pitch), [69, 76]); // A E
});

test('fugue has one monophonic line per voice and is deterministic', () => {
  for (const voices of [2, 3, 4] as const) {
    const a = generateFugue(ex('d-minor'), { voices, seed: 7 });
    const b = generateFugue(ex('d-minor'), { voices, seed: 7 });
    assert.equal(a.notes.length, voices);
    assert.deepEqual(a.notes, b.notes);
    for (const line of a.notes) {
      for (let i = 1; i < line.length; i++) assert.ok(noteEnd(line[i - 1]) <= line[i].start, 'overlap in a voice');
    }
  }
});

test('generated parts avoid parallel fifths and octaves', () => {
  for (const e of EXAMPLES) {
    for (const voices of [2, 3, 4] as const) {
      const f = generateFugue(e.notes, { voices, seed: 3 });
      const issues = voiceLeadingReport(f.notes).filter((i) => i.kind === 'parallel5' || i.kind === 'parallel8');
      assert.ok(issues.length <= 1, `${e.id} ${voices}v: ${issues.length} parallels`);
    }
  }
});
