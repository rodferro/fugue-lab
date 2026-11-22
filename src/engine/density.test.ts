// Dissonance density: the measure and the targetDissonance search.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../app/examples';
import { DEFAULT_SETTINGS, FugueSettings, generateFugue } from './fugue';
import { MeasuredFugue, expositionDissonance, toleranceFor } from './density';
import { COMMON_TIME, Note, timeGrid } from './model';
import { DISSONANCE_KINDS, voiceLeadingReport } from './report';

const ex = (id: string) => EXAMPLES.find((e) => e.id === id)!.notes;
const n = (rows: number[][]): Note[] => rows.map(([pitch, start, dur]) => ({ pitch, start, dur }));
const C_MAJOR = { tonic: 0, mode: 'major' as const };

// Two bars of 4/4 at 4 ticks per quarter in C major, counted by hand:
//   tick  4  D4 over C3, stepped into from C4 and on to E4      passing tone
//   tick 16  E4 held from bar 1 over D3, then D4 a step down    suspension
//   tick 24  F4 over G2, leapt into from D4, left by leap to B4  unexplained
// Consonant strong beats: 0 (8ve), 8 and 12 (10th), 20 (8ve), 28 (10th).
// After the exposition (tick 32) B4 over C3 is a dissonance too, but it is outside the span.
const FIXTURE: MeasuredFugue = {
  notes: [
    n([[60, 0, 4], [62, 4, 4], [64, 8, 4], [64, 12, 8], [62, 20, 4], [65, 24, 4], [71, 28, 4], [71, 32, 4]]),
    n([[48, 0, 16], [50, 16, 8], [43, 24, 8], [48, 32, 4]]),
  ],
  entries: [{ end: 16 }, { end: 32 }],
  keys: [{ start: 0, key: C_MAJOR }],
  ticksPerQuarter: 4,
  meter: COMMON_TIME,
  grid: timeGrid(4, COMMON_TIME),
};

test('expositionDissonance equals a hand count, over the exposition only', () => {
  const m = expositionDissonance(FIXTURE);
  assert.deepEqual(m, { count: 3, bars: 2, perBar: 1.5, end: 32 });
  // The same three, by kind, from the report on the cropped span.
  const cropped = FIXTURE.notes.map((v) => v.filter((x) => x.start < 32));
  const kinds = voiceLeadingReport(cropped, { keys: FIXTURE.keys }).filter((i) => (DISSONANCE_KINDS as string[]).includes(i.kind));
  assert.deepEqual(kinds.map((i) => [i.kind, i.tick]), [['passingTone', 4], ['suspension', 16], ['unexplainedDissonance', 24]]);
  // Extending the exposition by a beat brings in the B4 over C3 (re-struck, never resolved: unexplained).
  const longer = expositionDissonance({ ...FIXTURE, entries: [{ end: 36 }] });
  assert.deepEqual(longer, { count: 4, bars: 2.25, perBar: 4 / 2.25, end: 36 });
});

test('rewardScale 1 and rewardOffset 0 give the default engine', () => {
  for (const voices of [3, 4] as const) {
    const base = { ...DEFAULT_SETTINGS, voices, seed: 3 };
    const a = generateFugue(ex('d-minor'), base);
    assert.deepEqual(generateFugue(ex('d-minor'), { ...base, rewardScale: 1 }).notes, a.notes);
    assert.deepEqual(generateFugue(ex('d-minor'), { ...base, rewardOffset: 0 }).notes, a.notes);
    assert.equal(a.dissonance, undefined);
  }
});

test('targetDissonance: 0.5x, 1x and 1.5x the default level are hit, or flagged with the reachable range', () => {
  // The default control is the reward offset.
  let hits = 0;
  let total = 0;
  for (const id of ['d-minor', 'g-major', 'a-minor']) {
    for (const voices of [3, 4] as const) {
      const base: Partial<FugueSettings> = { ...DEFAULT_SETTINGS, voices, seed: 1 };
      const level = expositionDissonance(generateFugue(ex(id), base)).perBar;
      for (const k of [0.5, 1, 1.5]) {
        const f = generateFugue(ex(id), { ...base, targetDissonance: level * k });
        const d = f.dissonance!;
        const label = `${id} ${voices}v ${k}x`;
        total++;
        // What is reported is what the measure says about the returned fugue.
        assert.equal(d.achieved, expositionDissonance(f).perBar, label);
        assert.ok(d.tries >= 1 && d.tries <= 8 && d.attempts.length === d.tries, label);
        // Default tolerance: half a dissonance over the exposition, at least 0.05 per bar.
        assert.equal(d.tolerance, toleranceFor(expositionDissonance(f).bars), label);
        assert.ok(d.tolerance >= 0.05, label);
        assert.equal(d.hit, Math.abs(d.achieved - d.target) <= d.tolerance + 1e-9, label);
        // The closest attempt is returned.
        for (const a of d.attempts) assert.ok(Math.abs(d.achieved - d.target) <= Math.abs(a.achieved - d.target), label);
        // The range is the lowest and highest measure among the attempts, and contains what was achieved.
        const ds = d.attempts.map((a) => a.achieved);
        assert.deepEqual(d.reachable, [Math.min(...ds), Math.max(...ds)], label);
        assert.ok(d.reachable[0] <= d.achieved && d.achieved <= d.reachable[1], label);
        assert.equal(d.control, 'offset', label);
        if (k === 1) assert.ok(d.hit && d.tries === 1 && d.offset === 0 && d.scale === 1, `${label}: the default level is the first try`);
        if (d.hit) hits++;
      }
    }
  }
  assert.ok(hits >= total / 3, `${hits} of ${total} hit`);
});

test('targetDissonance is deterministic for a fixed seed and target', () => {
  for (const targetControl of ['scale', 'offset'] as const) {
    const s = { ...DEFAULT_SETTINGS, voices: 4 as const, seed: 7, targetDissonance: 0.6, targetControl };
    const a = generateFugue(ex('g-major'), s);
    const b = generateFugue(ex('g-major'), s);
    assert.deepEqual(b, a);
    assert.equal(a.dissonance!.control, targetControl);
  }
});

test('an explicit targetTolerance replaces the default', () => {
  const f = generateFugue(ex('d-minor'), { ...DEFAULT_SETTINGS, voices: 3, seed: 1, targetDissonance: 0.4, targetTolerance: 0.2 });
  assert.equal(f.dissonance!.tolerance, 0.2);
});

test('targetDissonance is rejected in hard mode', () => {
  assert.throws(() => generateFugue(ex('c-major'), { ...DEFAULT_SETTINGS, constraints: 'hard', targetDissonance: 0.5 }), /hard mode/);
});
