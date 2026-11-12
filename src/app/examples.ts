// Original example subjects (pitch, start, duration in 16ths).
import { Note } from '../engine/model';

export interface Example {
  id: string;
  name: string;
  bars: number;
  notes: Note[];
}

const n = (rows: [number, number, number][]): Note[] => rows.map(([pitch, start, dur]) => ({ pitch, start, dur }));

export const EXAMPLES: Example[] = [
  {
    id: 'c-major',
    name: 'C major, leaps 1–5 (tonal)',
    bars: 2,
    notes: n([[72, 0, 4], [67, 4, 4], [69, 8, 2], [71, 10, 2], [72, 12, 2], [74, 14, 2], [76, 16, 4], [74, 20, 2], [72, 22, 2], [71, 24, 4], [72, 28, 4]]),
  },
  {
    id: 'd-minor',
    name: 'D minor, chromatic turn',
    bars: 2,
    notes: n([[62, 0, 4], [69, 4, 4], [70, 8, 2], [69, 10, 2], [67, 12, 2], [65, 14, 2], [64, 16, 2], [62, 18, 2], [61, 20, 2], [64, 22, 2], [62, 24, 8]]),
  },
  {
    id: 'g-major',
    name: 'G major, running 16ths (real)',
    bars: 2,
    notes: n([[67, 0, 2], [71, 2, 2], [74, 4, 4], [72, 8, 1], [71, 9, 1], [69, 10, 1], [67, 11, 1], [66, 12, 2], [67, 14, 2], [69, 16, 4], [71, 20, 2], [69, 22, 2], [67, 24, 8]]),
  },
  {
    id: 'a-minor',
    name: 'A minor, starts on 5 (tonal)',
    bars: 2,
    notes: n([[64, 0, 4], [69, 4, 4], [71, 8, 2], [72, 10, 2], [71, 12, 2], [69, 14, 2], [68, 16, 4], [64, 20, 2], [69, 22, 2], [71, 24, 2], [68, 26, 2], [69, 28, 4]]),
  },
];
