// Soft-mode snapshot: hashes of fixed-seed generations, recorded on main before
// the hard-constraint arm was added. Any change to soft-mode output (notes,
// harmony, keys, entries, report) breaks it. Re-record only for an intended change,
// and say so in docs/decisions.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../app/examples';
import { DEFAULT_SETTINGS, FugueSettings, generateFugue } from './fugue';
import { Note, parseMeter } from './model';
import { voiceLeadingReport } from './report';

const n = (rows: number[][]): Note[] => rows.map(([pitch, start, dur]) => ({ pitch, start, dur }));
const BWV869 = n([
  [66, 2, 2], [62, 4, 2], [59, 6, 2], [67, 8, 2], [66, 10, 2], [71, 12, 2], [70, 14, 2], [64, 16, 2], [63, 18, 2], [72, 20, 2],
  [71, 22, 2], [66, 24, 2], [65, 26, 2], [74, 28, 2], [73, 30, 2], [72, 32, 2], [73, 34, 2], [69, 36, 2], [66, 38, 2], [68, 40, 8],
]);
const D_68 = n([[74, 0, 4], [69, 4, 2], [71, 6, 2], [73, 8, 2], [74, 10, 2], [76, 12, 4], [78, 16, 2], [79, 18, 2], [78, 20, 2], [76, 22, 2], [74, 24, 2], [73, 26, 2], [74, 28, 2], [69, 30, 6]]);

/** FNV-1a, 32 bit, as 8 hex digits. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const SNAPSHOT_CASES: [string, Note[], Partial<FugueSettings>][] = [];
for (const e of EXAMPLES) {
  for (const voices of [2, 3, 4] as const) {
    for (const seed of [1, 7]) SNAPSHOT_CASES.push([`${e.id} ${voices}v s${seed}`, e.notes, { voices, seed }]);
  }
}
SNAPSHOT_CASES.push(['d-minor 4v 3/4 s2', EXAMPLES.find((e) => e.id === 'd-minor')!.notes, { voices: 4, seed: 2, beatsPerBar: 3 }]);
SNAPSHOT_CASES.push(['bwv869 4v s1', BWV869, { voices: 4, seed: 1, entryOrder: [1, 2, 3, 0], key: { tonic: 11, mode: 'minor' }, cadence: false, codettaBars: 0 }]);
SNAPSHOT_CASES.push(['d 6/8 3v s3', D_68, { voices: 3, seed: 3, meter: parseMeter('6/8') }]);
SNAPSHOT_CASES.push(['d 6/8 4v tpq8 s4', D_68.map((x) => ({ ...x, start: x.start * 2, dur: x.dur * 2 })), { voices: 4, seed: 4, meter: parseMeter('6/8'), ticksPerQuarter: 8 }]);

export function snapshotOf(subject: Note[], settings: Partial<FugueSettings>): string {
  const f = generateFugue(subject, { ...DEFAULT_SETTINGS, ...settings });
  const report = voiceLeadingReport(f.notes, { keys: f.keys, ticksPerBeat: f.ticksPerQuarter, meter: f.meter });
  return fnv(JSON.stringify({ notes: f.notes, harmony: f.harmony, keys: f.keys, entries: f.entries, report }));
}

const EXPECTED: Record<string, string> = {
  'c-major 2v s1': 'c2d87839',
  'c-major 2v s7': '9d8a1b77',
  'c-major 3v s1': '3859f51f',
  'c-major 3v s7': '005e9c37',
  'c-major 4v s1': '555ab1fd',
  'c-major 4v s7': 'c62fdcd8',
  'd-minor 2v s1': 'b4da9446',
  'd-minor 2v s7': 'b34be6e5',
  'd-minor 3v s1': '38a399a1',
  'd-minor 3v s7': '2d55fc89',
  'd-minor 4v s1': 'a1e8b115',
  'd-minor 4v s7': '29e71d25',
  'g-major 2v s1': 'af8cab61',
  'g-major 2v s7': '02e068c2',
  'g-major 3v s1': 'b49407d5',
  'g-major 3v s7': 'ad52b748',
  'g-major 4v s1': 'b86921ae',
  'g-major 4v s7': 'b7f7e527',
  'a-minor 2v s1': '4af10252',
  'a-minor 2v s7': 'e6fec9a8',
  'a-minor 3v s1': '6f83400b',
  'a-minor 3v s7': '3d1910ed',
  'a-minor 4v s1': '790f1e4d',
  'a-minor 4v s7': '4cbc8b1f',
  'd-minor 4v 3/4 s2': '7ba9d7d3',
  'bwv869 4v s1': 'e1fdf1d0',
  'd 6/8 3v s3': '671f384e',
  'd 6/8 4v tpq8 s4': '92c943f8',
};

test('soft mode is unchanged: fixed-seed snapshot', () => {
  const got: Record<string, string> = {};
  for (const [name, subject, settings] of SNAPSHOT_CASES) got[name] = snapshotOf(subject, settings);
  assert.deepEqual(got, EXPECTED);
});
