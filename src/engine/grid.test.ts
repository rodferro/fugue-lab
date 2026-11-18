// Grid resolution (ticks per quarter) and meter (x/4, compound x/8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../app/examples';
import { generateFugue } from './fugue';
import { complementaryRhythm } from './counterpoint';
import { analyzeSubject } from './analyze';
import { writeMidi } from './midi';
import { Meter, Note, VNote, coarsestTicksPerQuarter, noteEnd, parseMeter, rescaleNotes, timeGrid } from './model';
import { DISSONANCE_KINDS, IssueKind, meterTicks, summarizeReport, voiceLeadingReport } from './report';
import { makeRng } from './rng';

const n = (rows: [number, number, number][]): Note[] => rows.map(([pitch, start, dur]) => ({ pitch, start, dur }));
const M = (s: string): Meter => parseMeter(s);

// Original subjects. Compound ones on the 16th grid (eighth = 2 ticks), the
// fine one at 24 per quarter with 32nds (3), 16th triplets (4) and 8th triplets (8).
const D_68 = n([[74, 0, 4], [69, 4, 2], [71, 6, 2], [73, 8, 2], [74, 10, 2], [76, 12, 4], [78, 16, 2], [79, 18, 2], [78, 20, 2], [76, 22, 2], [74, 24, 2], [73, 26, 2], [74, 28, 2], [69, 30, 6]]);
const G_128 = n([[67, 0, 4], [74, 4, 2], [75, 6, 2], [74, 8, 2], [72, 10, 2], [70, 12, 4], [69, 16, 2], [67, 18, 2], [66, 20, 2], [67, 22, 2], [72, 24, 2], [70, 26, 2], [69, 28, 2], [70, 30, 2], [69, 32, 2], [67, 34, 2], [66, 36, 4], [67, 40, 2], [62, 42, 6]]);
const F_38 = n([[65, 0, 4], [72, 4, 2], [70, 6, 2], [69, 8, 2], [67, 10, 2], [69, 12, 2], [65, 14, 2], [70, 16, 2], [69, 18, 4], [67, 22, 2], [65, 24, 6], [64, 30, 6], [65, 36, 6]]);
const C_FINE = n([[72, 0, 24], [67, 24, 12], [68, 36, 4], [67, 40, 4], [65, 44, 4], [67, 48, 3], [68, 51, 3], [70, 54, 3], [72, 57, 3], [74, 60, 12], [75, 72, 8], [74, 80, 8], [72, 88, 8], [71, 96, 12], [72, 108, 12], [74, 120, 6], [71, 126, 6], [72, 132, 12]]);

test('timeGrid: beats and bars per meter and resolution', () => {
  const g = (q: number, m: string) => { const t = timeGrid(q, M(m)); return [t.beat, t.beatsPerBar, t.bar, t.eighth, t.sixteenth]; };
  assert.deepEqual(g(4, '4/4'), [4, 4, 16, 2, 1]);
  assert.deepEqual(g(24, '3/4'), [24, 3, 72, 12, 6]);
  assert.deepEqual(g(4, '6/8'), [6, 2, 12, 2, 1], '6/8: two dotted-quarter beats');
  assert.deepEqual(g(12, '9/8'), [18, 3, 54, 6, 3]);
  assert.deepEqual(g(24, '12/8'), [36, 4, 144, 12, 6]);
  assert.deepEqual(g(4, '3/8'), [6, 1, 6, 2, 1], '3/8 is felt in one');
  assert.equal(timeGrid().bar, 16, 'default: 4/4 on the 16th grid');
  for (const bad of [6, 0, 2, 4.5]) assert.throws(() => timeGrid(bad, M('4/4')), /multiple of 4/);
  assert.throws(() => parseMeter('5/8'), /compound/);
  assert.throws(() => parseMeter('3/2'), /denominator/);
  assert.throws(() => parseMeter('six-eight'), /look like/);
});

test('coarsest grid and rescaling', () => {
  assert.equal(coarsestTicksPerQuarter(rescaleNotes(EXAMPLES[0].notes, 4, 24), 24), 4);
  assert.equal(coarsestTicksPerQuarter(n([[60, 0, 3], [62, 3, 3], [64, 6, 18]]), 24), 8, '32nds');
  assert.equal(coarsestTicksPerQuarter(n([[60, 0, 4], [62, 4, 4], [64, 8, 4], [65, 12, 12]]), 24), 12, '16th triplets');
  assert.equal(coarsestTicksPerQuarter(C_FINE, 24), 24, 'both');
  assert.deepEqual(rescaleNotes(rescaleNotes(C_FINE, 24, 48), 48, 24), C_FINE);
  assert.throws(() => rescaleNotes(C_FINE, 24, 4), /not on a grid/);
});

const strip = (v: VNote[][]) => v.map((line) => line.map(({ pitch, start, dur, role }) => ({ pitch, start, dur, role })));

test('a finer grid gives the same fugue, scaled: no tick size is hard-coded', () => {
  // Every time in the engine is derived from the grid, so a 16th-grid subject
  // written at k× the resolution must give exactly the k×-scaled result.
  for (const ex of EXAMPLES) {
    for (const voices of [2, 3, 4] as const) {
      for (const [meter, k] of [['4/4', 6], ['3/4', 3], ['6/8', 2]] as const) {
        const a = generateFugue(ex.notes, { voices, seed: 3, meter: M(meter), codettaBars: 1 });
        const b = generateFugue(rescaleNotes(ex.notes, 4, 4 * k), { voices, seed: 3, meter: M(meter), codettaBars: 1, ticksPerQuarter: 4 * k });
        const what = `${ex.id}, ${voices} voices, ${meter}, ×${k}`;
        assert.deepEqual(strip(b.notes), strip(a.notes.map((v) => rescaleNotes(v, 4, 4 * k))), what);
        assert.equal(b.length, a.length * k, what);
        assert.deepEqual(b.harmony.map((h) => [h.start, h.chord.label]), a.harmony.map((h) => [h.start * k, h.chord.label]), what);
        assert.deepEqual(b.keys, a.keys.map((s) => ({ ...s, start: s.start * k })), what);
        const ra = voiceLeadingReport(a.notes, { meter: a.meter, keys: a.keys }).map((i) => ({ ...i, tick: i.tick * k }));
        assert.deepEqual(voiceLeadingReport(b.notes, { meter: b.meter, ticksPerBeat: b.ticksPerQuarter, keys: b.keys }), ra, `${what}: report`);
      }
    }
  }
});

test('key detection weighs durations in 16ths at any resolution', () => {
  for (const ex of EXAMPLES) {
    const a = analyzeSubject(ex.notes);
    const b = analyzeSubject(rescaleNotes(ex.notes, 4, 24), undefined, 24);
    assert.deepEqual(b.candidates, a.candidates, ex.id);
    assert.deepEqual(b.warnings, a.warnings, ex.id);
  }
});

const errorsPerBar = (f: ReturnType<typeof generateFugue>) =>
  summarizeReport(voiceLeadingReport(f.notes, { meter: f.meter, ticksPerBeat: f.ticksPerQuarter, keys: f.keys }), f.length, f.grid.bar);

test('subjects with 32nds and 16th triplets are generated at 24 ticks per quarter', () => {
  const settings = { meter: M('4/4'), ticksPerQuarter: 24 };
  for (const voices of [2, 3, 4] as const) {
    for (let seed = 1; seed <= 4; seed++) {
      const f = generateFugue(C_FINE, { ...settings, voices, seed });
      assert.deepEqual(f.notes, generateFugue(C_FINE, { ...settings, voices, seed }).notes, 'deterministic');
      assert.equal(f.ticksPerQuarter, 24);
      for (const e of f.entries) {
        const got = f.notes[e.voice].filter((x) => x.role === e.role && x.start >= e.start && x.start < e.end);
        const want = e.role === 'subject' ? C_FINE : f.answer.notes;
        const shift = got[0].pitch - want[0].pitch;
        assert.deepEqual(got.map(({ pitch, start, dur }) => ({ pitch: pitch - shift, start: start - e.start, dur })), want, `entry ${e.index} keeps the subject's rhythm`);
      }
      for (const line of f.notes) {
        for (let i = 0; i < line.length; i++) {
          const x = line[i];
          assert.ok(Number.isInteger(x.start) && Number.isInteger(x.dur) && x.dur > 0);
          if (i > 0) assert.ok(noteEnd(line[i - 1]) <= x.start, 'monophonic');
          // The free voices still move in 16ths (6 ticks) or longer.
          if (x.role !== 'subject' && x.role !== 'answer') assert.equal(x.start % 6, 0, `${x.role} at ${x.start} is on the 16th grid`);
        }
      }
      const r = errorsPerBar(f);
      assert.equal(r.counts.parallel5 + r.counts.parallel8, 0, `${voices} voices, seed ${seed}: parallels`);
      assert.ok(r.dissonanceErrorsPerBar <= 0.045, `${voices} voices, seed ${seed}: ${r.dissonanceErrorsPerBar} dissonance errors per bar`);
    }
  }
});

test('compound meters: beats on dotted quarters, rhythms in eighths, no bar line crossed', () => {
  for (const [subject, meter] of [[D_68, '6/8'], [G_128, '12/8'], [F_38, '3/8']] as const) {
    const grid = timeGrid(4, M(meter));
    let errors = 0;
    let bars = 0;
    for (const voices of [3, 4] as const) {
      for (let seed = 1; seed <= 4; seed++) {
        const f = generateFugue(subject, { voices, seed, meter: M(meter) });
        const what = `${meter}, ${voices} voices, seed ${seed}`;
        assert.deepEqual(f.grid, grid);
        assert.equal(f.length % grid.bar, 0, `${what}: whole bars`);
        assert.equal(f.beatsPerBar, grid.bar / 4, 'beatsPerBar counts quarters, for the report option');
        const cadence = f.sections.find((s) => s.label === 'Cadence')!;
        assert.equal(cadence.end - cadence.start, grid.bar);
        if (voices === 4) {
          const expEnd = f.sections[0].end;
          assert.equal(f.harmony.length, expEnd / grid.beat, `${what}: one chord per dotted quarter`);
          assert.ok(f.harmony.every((h) => h.start % grid.beat === 0 && h.dur === grid.beat));
        }
        for (const line of f.notes) {
          for (const x of line) {
            if (x.role === 'subject' || x.role === 'answer') continue;
            assert.equal(Math.floor(x.start / grid.bar), Math.floor((noteEnd(x) - 1) / grid.bar), `${what}: ${x.role} at ${x.start}+${x.dur} crosses a bar line`);
          }
        }
        const r = errorsPerBar(f);
        errors += r.dissonanceErrors;
        bars += r.bars;
      }
    }
    assert.ok(errors / bars <= 0.045, `${meter}: ${(errors / bars).toFixed(3)} dissonance errors per bar`);
  }
});

test('complementaryRhythm fills compound beats in eighths and 16ths', () => {
  const grid = timeGrid(4, M('6/8'));
  const rng = makeRng(7);
  for (let rep = 0; rep < 20; rep++) {
    const slots = complementaryRhythm([], 0, 48, grid, rng);
    let t = 0;
    for (const s of slots) {
      assert.equal(s.start, t, 'contiguous');
      t += s.dur;
      const inBeat = Math.floor(s.start / grid.beat) === Math.floor((noteEnd(s) - 1) / grid.beat);
      const joined = s.start % grid.bar === 0 && s.dur === 2 * grid.beat;
      assert.ok(inBeat || joined, `slot ${s.start}+${s.dur} crosses a beat`);
    }
    assert.equal(t, 48);
  }
  // Where the other voice moves in eighths, the line holds: a dotted quarter
  // per beat, or the two joined into a dotted half.
  const busy = [n([[60, 0, 2], [62, 2, 2], [64, 4, 2], [65, 6, 2], [67, 8, 2], [69, 10, 2]])];
  const seen = new Set<string>();
  for (let seed = 1; seed <= 12; seed++) seen.add(complementaryRhythm(busy, 0, 12, grid, makeRng(seed)).map((s) => s.dur).join(','));
  assert.deepEqual([...seen].sort(), ['12', '6,6']);
});

test('report: the meter sets the strong beats and the bar', () => {
  // Over a held C: D struck on the third eighth, B on the fourth (the report
  // looks at ticks where some voice strikes a note).
  const upper = n([[72, 0, 4], [74, 4, 2], [71, 6, 6]]);
  const lower = n([[60, 0, 12]]);
  const ticks = (opts: Parameters<typeof voiceLeadingReport>[1]) =>
    voiceLeadingReport([upper, lower], opts).filter((i) => (DISSONANCE_KINDS as IssueKind[]).includes(i.kind)).map((i) => i.tick);
  assert.deepEqual(ticks({ meter: M('6/8') }), [6], '6/8: only the dotted quarters are strong');
  assert.deepEqual(ticks({ meter: M('3/4') }), [4], '3/4: every quarter');
  assert.deepEqual(ticks({}), [4], 'no meter: every quarter, as before');
  assert.deepEqual(ticks({ meter: M('6/8'), strongEvery: 2 }), [4, 6], 'strongEvery still wins');
  assert.deepEqual(meterTicks(4, { meter: M('6/8') }), { beat: 6, bar: 12 });
  assert.deepEqual(meterTicks(12, { meter: M('9/8') }), { beat: 18, bar: 54 });
  assert.deepEqual(meterTicks(4, { meter: { num: 5, den: 8 } }), { beat: 2, bar: 10 }, 'imported 5/8 beats in eighths');
  assert.deepEqual(meterTicks(4, { beatsPerBar: 3 }), { beat: 4, bar: 12 });
  assert.throws(() => meterTicks(3, { meter: M('6/8') }), /even/);
});

test('MIDI export: time signature and resolution', () => {
  const tracks = [{ name: 'A', notes: n([[60, 0, 6], [62, 6, 18]]) }];
  const bytes = (m: Meter | number, q?: number) => [...writeMidi(tracks, 90, m, q)];
  const timeSig = (b: number[]) => { const i = b.findIndex((x, k) => x === 0xff && b[k + 1] === 0x58); return b.slice(i + 3, i + 7); };
  assert.deepEqual(bytes(4), bytes(M('4/4')), 'the old beatsPerBar argument still works');
  assert.deepEqual(timeSig(bytes(M('4/4'))), [4, 2, 24, 8]);
  assert.deepEqual(timeSig(bytes(M('6/8'))), [6, 3, 36, 8], '6/8: clicks on the dotted quarter');
  assert.deepEqual(timeSig(bytes(M('3/4'))), [3, 2, 24, 8]);
  // A 16th at 24 per quarter is 120 MIDI ticks (480 per quarter): same file as the 16th grid.
  const fine = [...writeMidi([{ name: 'A', notes: rescaleNotes(tracks[0].notes, 24, 24) }], 90, 4, 24)];
  const coarse = [...writeMidi([{ name: 'A', notes: rescaleNotes(tracks[0].notes, 24, 4) }], 90, 4, 4)];
  assert.deepEqual(fine, coarse);
  assert.throws(() => writeMidi(tracks, 90, 4, 7), /divide 480/);
});

test('legacy beatsPerBar setting means an x/4 meter', () => {
  const s = EXAMPLES[1].notes;
  const a = generateFugue(s, { voices: 3, seed: 2, beatsPerBar: 3 });
  const b = generateFugue(s, { voices: 3, seed: 2, meter: M('3/4') });
  assert.deepEqual(a.notes, b.notes);
  assert.deepEqual(a.meter, M('3/4'));
  assert.equal(a.beatsPerBar, 3);
  assert.deepEqual(generateFugue(s, { seed: 2, beatsPerBar: 3, meter: M('6/8') }).meter, M('6/8'), 'meter wins');
});
