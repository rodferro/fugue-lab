// The hard-constraint arm (settings.constraints = 'hard'): a baseline for the
// held-out comparison, where the textbook rules prune instead of cost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../app/examples';
import { DEFAULT_SETTINGS, FugueSettings, generateFugue } from './fugue';
import { LINE_RULES } from './counterpoint';
import { IssueKind, voiceLeadingReport } from './report';

const ex = (id: string) => EXAMPLES.find((e) => e.id === id)!.notes;
/** The report's counterparts of the hard rules (hidden 5ths and overlaps are not reported). */
const HARD_KINDS: IssueKind[] = ['parallel5', 'parallel8', 'chromaticClash', 'unexplainedDissonance', 'crossing'];

test('hard mode: no hard violation in the report except at the listed relaxations', () => {
  let relaxed = 0;
  for (const [id, voices, seeds] of [['g-major', 3, [1, 2, 3]], ['g-major', 4, [2]], ['a-minor', 4, [1]], ['d-minor', 4, [1, 2, 3]], ['c-major', 4, [1, 2]]] as const) {
    for (const seed of seeds) {
      const f = generateFugue(ex(id), { ...DEFAULT_SETTINGS, voices, seed, constraints: 'hard' });
      relaxed += f.relaxations.length;
      const issues = voiceLeadingReport(f.notes, { keys: f.keys, ticksPerBeat: f.ticksPerQuarter, meter: f.meter }).filter((i) => HARD_KINDS.includes(i.kind));
      for (const i of issues) {
        // At a relaxation of one of the two voices: up to a bar before the issue (a long note relaxed
        // where it starts), or up to 3 beats after it (an unresolved dissonance relaxes at its resolution step).
        const at = f.relaxations.some((r) => i.voices.includes(r.voice) && r.tick - i.tick <= 3 * f.grid.beat && i.tick - r.tick < f.grid.bar);
        assert.ok(at, `${id} ${voices}v s${seed}: ${i.kind} at ${i.tick} (voices ${i.voices}) without a relaxation`);
      }
      for (const r of f.relaxations) {
        assert.ok(r.rules.length > 0 && r.rules.every((x) => LINE_RULES[x].hard));
        assert.equal(r.bar, Math.floor(r.tick / f.grid.bar) + 1);
        assert.equal(r.beat, Math.floor((r.tick % f.grid.bar) / f.grid.beat) + 1);
      }
      if (id === 'g-major' && voices === 3) assert.equal(f.relaxations.length, 0, `g-major 3v s${seed} needs no relaxation`);
    }
  }
  assert.ok(relaxed > 0, 'the cases include some relaxations, so that path is exercised');
});

test('hard mode ignores the dissonance rewards', () => {
  const big: FugueSettings['rewards'] = { suspension: 20, ornamentedSuspension: -9, retardation: 15, passingTone: 12, chordalSeventh: 8, againstSuspension: 5 };
  for (const voices of [3, 4] as const) {
    const base = { ...DEFAULT_SETTINGS, voices, seed: 5, constraints: 'hard' as const };
    const a = generateFugue(ex('d-minor'), base);
    const b = generateFugue(ex('d-minor'), { ...base, rewards: big });
    assert.deepEqual(b.notes, a.notes);
    assert.deepEqual(b.relaxations, a.relaxations);
    // ...while in soft mode the same override does change the music.
    const s = generateFugue(ex('d-minor'), { ...base, constraints: 'soft' });
    const t = generateFugue(ex('d-minor'), { ...base, constraints: 'soft', rewards: big });
    assert.notDeepEqual(t.notes, s.notes);
  }
});

test("constraints 'soft' is the default, and soft mode never relaxes", () => {
  for (const voices of [2, 3, 4] as const) {
    const a = generateFugue(ex('c-major'), { ...DEFAULT_SETTINGS, voices, seed: 2 });
    const b = generateFugue(ex('c-major'), { ...DEFAULT_SETTINGS, voices, seed: 2, constraints: 'soft' });
    assert.deepEqual(b, a);
    assert.deepEqual(a.relaxations, []);
  }
});

test('hard mode is deterministic', () => {
  const s = { ...DEFAULT_SETTINGS, voices: 4 as const, seed: 9, constraints: 'hard' as const };
  assert.deepEqual(generateFugue(ex('a-minor'), s), generateFugue(ex('a-minor'), s));
});
