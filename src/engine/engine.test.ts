import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../app/examples';
import { detectKey } from './analyze';
import { makeAnswer } from './answer';
import { generateFugue } from './fugue';
import { planHarmony } from './harmony';
import { voiceLeadingReport } from './report';
import { TPB, noteEnd } from './model';
import { keyName, mod12 } from './theory';

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

test('harmonic skeleton explains the fixed notes', () => {
  const C = { tonic: 0, mode: 'major' as const };
  // Bar of C–E–G against a held C, then B–D against G: I for a bar, then V.
  const upper = [[64, 0, 8], [67, 8, 8], [62, 16, 16]].map(([pitch, start, dur]) => ({ pitch, start, dur }));
  const lower = [[48, 0, 16], [43, 16, 16]].map(([pitch, start, dur]) => ({ pitch, start, dur }));
  const sk = planHarmony([upper, lower], 0, 32, () => C, 4);
  assert.equal(sk.length, 8);
  assert.deepEqual(sk.map((b) => b.chord.label), ['I', 'I', 'I', 'I', 'V', 'V', 'V', 'V']);
});

test('4-voice free parts follow the skeleton and stay clean', () => {
  let onBeat = 0, inChord = 0, diss = 0, cross = 0, runs = 0;
  for (const e of EXAMPLES) {
    for (let seed = 1; seed <= 6; seed++) {
      const f = generateFugue(e.notes, { voices: 4, seed });
      const expEnd = f.sections[0].end;
      assert.equal(f.harmony.length, expEnd / TPB, 'one chord per beat of the exposition');
      for (const b of f.harmony) {
        for (const line of f.notes) {
          const n = line.find((x) => x.start <= b.start && noteEnd(x) > b.start);
          if (!n || (n.role !== 'free' && n.role !== 'link')) continue;
          onBeat++;
          if (b.chord.pcs.includes(mod12(n.pitch))) inChord++;
        }
      }
      const issues = voiceLeadingReport(f.notes);
      diss += issues.filter((i) => i.kind === 'strongDissonance').length;
      cross += issues.filter((i) => i.kind === 'crossing').length;
      runs++;
    }
  }
  assert.ok(inChord / onBeat > 0.75, `only ${inChord}/${onBeat} free on-beat notes are chord tones`);
  // Before the skeleton these averaged about 2.7 and 0.7 per fugue.
  assert.ok(diss / runs < 2, `${(diss / runs).toFixed(2)} strong-beat dissonances per fugue`);
  assert.ok(cross / runs < 0.5, `${(cross / runs).toFixed(2)} crossings per fugue`);
});
