import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../app/examples';
import { autoMutation, detectKey } from './analyze';
import { makeAnswer } from './answer';
import { DEFAULT_SETTINGS, generateFugue } from './fugue';
import { planHarmony } from './harmony';
import { writeMidi } from './midi';
import { voiceLeadingReport } from './report';
import { TPB, noteEnd } from './model';
import { chromaticClash, keyAtTick, keyName, mod12, spelledDissonant, spelledInterval } from './theory';

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

// Strong-beat dissonances generateLine writes on purpose (rewarded in harmonic()).
const TREATED = new Set(['suspension', 'ornamentedSuspension', 'retardation', 'passingTone', 'neighbourTone', 'appoggiatura', 'chordalSeventh']);

test('4-voice free parts follow the skeleton and stay clean', () => {
  let onBeat = 0, inChord = 0, unexplained = 0, cross = 0, runs = 0, bars = 0;
  for (const e of EXAMPLES) {
    for (let seed = 1; seed <= 6; seed++) {
      const f = generateFugue(e.notes, { voices: 4, seed });
      const expEnd = f.sections[0].end;
      assert.equal(f.harmony.length, expEnd / TPB, 'one chord per beat of the exposition');
      const issues = voiceLeadingReport(f.notes, { beatsPerBar: f.beatsPerBar });
      // A free note that is a treated dissonance is a non-chord tone on purpose.
      const treated = new Set(issues.filter((i) => TREATED.has(i.kind)).flatMap((i) => i.voices.map((v) => `${v}@${i.tick}`)));
      for (const b of f.harmony) {
        f.notes.forEach((line, v) => {
          const n = line.find((x) => x.start <= b.start && noteEnd(x) > b.start);
          if (!n || (n.role !== 'free' && n.role !== 'link') || treated.has(`${v}@${b.start}`)) return;
          onBeat++;
          if (b.chord.pcs.includes(mod12(n.pitch))) inChord++;
        });
      }
      unexplained += issues.filter((i) => i.kind === 'unexplainedDissonance').length;
      cross += issues.filter((i) => i.kind === 'crossing').length;
      bars += f.length / (TPB * f.beatsPerBar);
      runs++;
    }
  }
  assert.ok(inChord / onBeat > 0.75, `only ${inChord}/${onBeat} free on-beat notes (not treated dissonances) are chord tones`);
  // Bach's 4-voice 4/4 openings: 0.018 unexplained per bar.
  assert.ok(unexplained / bars <= 0.02, `${(unexplained / bars).toFixed(3)} unexplained strong-beat dissonances per bar`);
  assert.ok(cross / runs < 0.5, `${(cross / runs).toFixed(2)} crossings per fugue`);
});

test('3-voice expositions stay at or below Bach\'s unexplained rate', () => {
  let unexplained = 0, bars = 0;
  for (const e of EXAMPLES) {
    for (let seed = 1; seed <= 6; seed++) {
      const f = generateFugue(e.notes, { voices: 3, seed });
      unexplained += voiceLeadingReport(f.notes, { beatsPerBar: f.beatsPerBar }).filter((i) => i.kind === 'unexplainedDissonance').length;
      bars += f.length / (TPB * f.beatsPerBar);
    }
  }
  // Bach's 3-voice 4/4 openings: 0.045 per bar.
  assert.ok(unexplained / bars <= 0.045, `${(unexplained / bars).toFixed(3)} unexplained strong-beat dissonances per bar`);
});

test('generated suspensions, ornamented suspensions and retardations resolve to a consonance', () => {
  const DISS = new Set([1, 2, 6, 10, 11]);
  const at = (line: { pitch: number; start: number; dur: number }[], t: number) => line.find((n) => n.start <= t && noteEnd(n) > t);
  let count = 0, bars = 0;
  const seen: Record<string, number> = {};
  for (const e of EXAMPLES) {
    for (const voices of [3, 4] as const) {
      for (let seed = 1; seed <= 4; seed++) {
        const f = generateFugue(e.notes, { voices, seed });
        bars += f.length / (TPB * f.beatsPerBar);
        for (const i of voiceLeadingReport(f.notes, { beatsPerBar: f.beatsPerBar })) {
          if (i.kind !== 'suspension' && i.kind !== 'ornamentedSuspension' && i.kind !== 'retardation') continue;
          seen[i.kind] = (seen[i.kind] ?? 0) + 1;
          if (i.kind === 'suspension') count++;
          // The suspended voice is the one that holds its pitch into the beat.
          const [a, b] = i.voices.map((v) => f.notes[v]);
          const held = at(a, i.tick - 1)?.pitch === at(a, i.tick)!.pitch && at(b, i.tick - 1)?.pitch !== at(b, i.tick)!.pitch;
          const [sus, other] = held ? [a, b] : [b, a];
          const n = at(sus, i.tick)!;
          let r = sus.find((x) => x.start === noteEnd(n))!;
          if (i.kind === 'ornamentedSuspension') r = sus.find((x) => x.start === noteEnd(r))!; // past the decoration
          const o = at(other, r.start);
          assert.ok(!o || !DISS.has(Math.abs(r.pitch - o.pitch) % 12), `${e.id} ${voices}v seed ${seed}: ${i.kind} at ${i.tick} resolves to a dissonance`);
        }
      }
    }
  }
  // They are written on purpose now, but should not be everywhere.
  assert.ok(count / bars > 0.1 && count / bars < 0.8, `${(count / bars).toFixed(2)} suspensions per bar`);
  assert.ok(seen.ornamentedSuspension > 0 && seen.retardation > 0, `ornamented ${seen.ornamentedSuspension ?? 0}, retardations ${seen.retardation ?? 0}`);
});

test('MIDI header: format 1, one track per voice plus the conductor, 480 ticks per quarter', () => {
  const f = generateFugue(ex('d-minor'), { voices: 3, seed: 1 });
  const bytes = writeMidi(f.voices.map((v, i) => ({ name: v.name, notes: f.notes[i], channel: i })), 80, 4);
  // "MThd", length 6, format 1, 4 tracks, division 480
  assert.deepEqual([...bytes.slice(0, 14)], [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 4, 0x01, 0xe0]);
  let tracks = 0;
  for (let pos = 14; pos + 8 <= bytes.length; ) {
    assert.equal(String.fromCharCode(...bytes.slice(pos, pos + 4)), 'MTrk');
    pos += 8 + ((bytes[pos + 4] << 24) | (bytes[pos + 5] << 16) | (bytes[pos + 6] << 8) | bytes[pos + 7]);
    tracks++;
  }
  assert.equal(tracks, 4);
});

const Dm = { tonic: 2, mode: 'minor' as const };

test('intervals are spelled in the key', () => {
  // C♯ is the raised 7th of D minor, F its 3rd: C♯–F is a diminished 4th (4 semitones).
  assert.deepEqual(spelledInterval(61, 65, Dm), { steps: 3, semis: 4 });
  assert.equal(spelledDissonant(61, 65, Dm), true);
  // F3 under C♯4: an augmented 5th, though 8 semitones like a minor 6th.
  assert.equal(spelledDissonant(53, 61, Dm), true);
  // B♭–C♯ (augmented 2nd, 3 semitones) and C♯–B♭ (diminished 7th, 9).
  assert.equal(spelledDissonant(58, 61, Dm), true);
  assert.equal(spelledDissonant(61, 70, Dm), true);
  // Real 3rds, 6ths and perfect intervals stay consonant.
  for (const [a, b] of [[62, 65], [62, 69], [57, 65], [61, 64], [62, 74], [55, 60]]) assert.equal(spelledDissonant(a, b, Dm), false, `${a}-${b}`);
  // The same semitones can be consonant in another key: D♭–F in F major is a major 3rd.
  assert.equal(spelledDissonant(61, 65, { tonic: 5, mode: 'major' }), false);
});

test('a chromatic clash is two forms of the same degree, in any octave', () => {
  assert.equal(chromaticClash(60, 61, Dm), true); // C against C♯
  assert.equal(chromaticClash(60, 49, Dm), true); // C4 against C♯3
  assert.equal(chromaticClash(70, 59, Dm), true); // B♭ against B
  assert.equal(chromaticClash(60, 72, Dm), false); // octave
  assert.equal(chromaticClash(61, 62, Dm), false); // C♯–D: a real minor 2nd
});

test('the key plan covers the fugue', () => {
  const f = generateFugue(ex('d-minor'), {});
  assert.deepEqual(f.keys.map((k) => [k.start, keyName(k.key)]), [[0, 'D minor'], [32, 'A minor'], [64, 'D minor']]);
  assert.equal(keyName(keyAtTick(f.keys, 40)), 'A minor');
});

test('regression: no chromatic clash or augmented/diminished interval in the D minor default (3 voices)', () => {
  // Bar 5 beat 3 had alto C4 held against bass C♯3, bar 6 beat 2 soprano C♯4 against alto F3.
  const f = generateFugue(ex('d-minor'), {});
  assert.equal(f.voices.length, 3);
  const at = (v: number, t: number) => f.notes[v].find((n) => n.start <= t && noteEnd(n) > t)?.pitch;
  const pc = (p: number | undefined) => (p === undefined ? -1 : mod12(p));
  assert.ok(!(pc(at(1, 72)) === 0 && pc(at(2, 72)) === 1), 'alto C against bass C♯ at bar 5 beat 3');
  assert.ok(!(pc(at(0, 84)) === 1 && pc(at(1, 84)) === 5), 'soprano C♯ against alto F at bar 6 beat 2');
  for (const t of [72, 84]) {
    const ps = [0, 1, 2].map((v) => at(v, t)).filter((p): p is number => p !== undefined);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      assert.equal(chromaticClash(ps[i], ps[j], Dm), false, `clash at ${t}`);
      const semitoneConsonant = ![1, 2, 6, 10, 11].includes(Math.abs(ps[i] - ps[j]) % 12);
      assert.ok(!(semitoneConsonant && spelledDissonant(ps[i], ps[j], Dm)), `augmented/diminished interval at ${t}: ${ps[i]}-${ps[j]}`);
    }
  }
  const issues = voiceLeadingReport(f.notes, { keys: f.keys });
  assert.equal(issues.filter((i) => i.kind === 'chromaticClash' || i.kind === 'unexplainedDissonance').length, 0);
});

test('generated parts never sound a chromatic clash, on any tick', () => {
  for (const e of EXAMPLES) {
    for (const voices of [3, 4] as const) {
      for (let seed = 1; seed <= 4; seed++) {
        const f = generateFugue(e.notes, { voices, seed });
        for (let t = 0; t < f.length; t++) {
          const ps = f.notes.map((l) => l.find((n) => n.start <= t && noteEnd(n) > t)?.pitch).filter((p): p is number => p !== undefined);
          const k = keyAtTick(f.keys, t);
          for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
            assert.equal(chromaticClash(ps[i], ps[j], k), false, `${e.id} ${voices}v seed ${seed} at ${t}: ${ps[i]} against ${ps[j]}`);
          }
        }
      }
    }
  }
});

test('an early ^5 reached by a leap gets the tonal answer; one reached by step does not', () => {
  const n = (rows: [number, number, number][]) => rows.map(([pitch, start, dur]) => ({ pitch, start, dur }));
  const cMinor = { tonic: 0, mode: 'minor' as const };
  // BWV 847: C B C G Ab ... answered G F# G C Eb (Bach).
  const s847 = n([[72, 0, 1], [71, 1, 1], [72, 2, 2], [67, 4, 2], [68, 6, 2], [72, 8, 1]]);
  assert.equal(autoMutation(s847, cMinor), 4);
  assert.deepEqual(makeAnswer(s847, cMinor, 'tonal', 4).notes.slice(0, 5).map((x) => mod12(x.pitch)), [7, 6, 7, 0, 3]);
  // BWV 846: C D E F G ... is answered really.
  const s846 = n([[60, 2, 2], [62, 4, 2], [64, 6, 2], [65, 8, 2], [67, 10, 1], [65, 11, 1]]);
  assert.equal(autoMutation(s846, { tonic: 0, mode: 'major' }), 0);
  // BWV 887 leaps to ^5 from ^2; BWV 882 starts on ^7: both answered really.
  const s887 = n([[68, 0, 1], [70, 1, 1], [71, 2, 1], [70, 3, 1], [75, 4, 2], [75, 6, 2]]);
  assert.equal(autoMutation(s887, { tonic: 8, mode: 'minor' }), 0);
  const s882 = n([[65, 0, 1], [63, 1, 1], [65, 2, 1], [66, 3, 2], [61, 5, 2], [63, 7, 1]]);
  assert.equal(autoMutation(s882, { tonic: 6, mode: 'major' }), 0);
});

// Bach, WTC I, Fugue in B minor BWV 869: chromatic sighing pairs (A♯–B, E–D♯, C♮, F♮…).
// Its answer sounds G♮ in F♯ minor, and the skeleton used to put G♯ in the chord
// there, pulling a free voice into a chromatic clash (4 of 5 seeds in the held-out run).
const BWV869 = [
  [66, 2, 2], [62, 4, 2], [59, 6, 2], [67, 8, 2], [66, 10, 2], [71, 12, 2], [70, 14, 2], [64, 16, 2], [63, 18, 2], [72, 20, 2],
  [71, 22, 2], [66, 24, 2], [65, 26, 2], [74, 28, 2], [73, 30, 2], [72, 32, 2], [73, 34, 2], [69, 36, 2], [66, 38, 2], [68, 40, 8],
].map(([pitch, start, dur]) => ({ pitch, start, dur }));

test('chromatic subject (BWV 869): no chromatic clashes, and the skeleton never contradicts a fixed voice', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const f = generateFugue(BWV869, {
      ...DEFAULT_SETTINGS, voices: 4, seed, entryOrder: [1, 2, 3, 0], key: { tonic: 11, mode: 'minor' }, cadence: false, codettaBars: 0,
    });
    const clashes = voiceLeadingReport(f.notes, { keys: f.keys }).filter((i) => i.kind === 'chromaticClash');
    assert.deepEqual(clashes, [], `seed ${seed}`);
    for (const b of f.harmony) {
      for (const v of f.notes) {
        for (const x of v) {
          if (x.role !== 'subject' && x.role !== 'answer' && x.role !== 'countersubject') continue;
          if (x.start !== b.start) continue;
          const bad = b.chord.pcs.find((q) => chromaticClash(x.pitch, q, b.chord.key));
          assert.equal(bad, undefined, `seed ${seed}: ${b.chord.label} at ${b.start} against fixed pitch ${x.pitch}`);
        }
      }
    }
  }
});
