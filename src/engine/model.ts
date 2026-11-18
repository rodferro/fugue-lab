// Core data model. Time is measured in integer ticks; how many ticks make a
// quarter note is a parameter (TimeGrid.ticksPerQuarter), 4 by default (the
// 16th grid). Pitches are MIDI numbers at the edges (UI, playback, export); the
// engine converts to scale degrees (see theory.ts) whenever it reasons about harmony.

/** Default ticks per quarter note: the 16th grid. */
export const TPB = 4;

/**
 * A time signature. x/4 meters beat in quarters; x/8 meters (3/8, 6/8, 9/8,
 * 12/8) are compound and beat in dotted quarters, so 6/8 has two strong beats
 * per bar and 3/8 one.
 */
export interface Meter {
  num: number;
  den: 4 | 8;
}

export const METERS: Meter[] = [
  { num: 2, den: 4 }, { num: 3, den: 4 }, { num: 4, den: 4 },
  { num: 3, den: 8 }, { num: 6, den: 8 }, { num: 9, den: 8 }, { num: 12, den: 8 },
];

export const COMMON_TIME: Meter = { num: 4, den: 4 };

export const meterName = (m: Meter): string => `${m.num}/${m.den}`;

/** "6/8" → {num: 6, den: 8}; throws on anything the engine can't write in. */
export function parseMeter(s: string): Meter {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(s);
  if (!m) throw new Error(`meter must look like "6/8", got "${s}"`);
  const meter = { num: Number(m[1]), den: Number(m[2]) } as Meter;
  validateMeter(meter);
  return meter;
}

function validateMeter(m: Meter): void {
  if (m.den !== 4 && m.den !== 8) throw new Error(`meter ${m.num}/${m.den}: the denominator must be 4 or 8`);
  if (!Number.isInteger(m.num) || m.num < 1 || m.num > 12) throw new Error(`meter ${m.num}/${m.den}: the numerator must be 1-12`);
  if (m.den === 8 && m.num % 3 !== 0) throw new Error(`meter ${m.num}/8: only compound x/8 meters (3/8, 6/8, 9/8, 12/8) are supported`);
}

/** Tick sizes derived from a grid resolution and a meter. */
export interface TimeGrid {
  ticksPerQuarter: number;
  meter: Meter;
  /** Ticks per metric beat: a quarter, or a dotted quarter in x/8. Strong beats fall on multiples of it. */
  beat: number;
  /** Metric beats per bar (2 in 6/8). */
  beatsPerBar: number;
  bar: number;
  eighth: number;
  sixteenth: number;
  /** x/8: the beat divides into three eighths. */
  compound: boolean;
}

/**
 * The grid for a resolution and meter. ticksPerQuarter must be a positive
 * multiple of 4, so that 16ths (the generator's own rhythms) and eighths exist:
 * 8 adds 32nds, 12 adds 16th triplets, 24 both.
 */
export function timeGrid(ticksPerQuarter: number = TPB, meter: Meter = COMMON_TIME): TimeGrid {
  if (!Number.isInteger(ticksPerQuarter) || ticksPerQuarter < 4 || ticksPerQuarter % 4 !== 0) {
    throw new Error(`ticksPerQuarter must be a positive multiple of 4, got ${ticksPerQuarter}`);
  }
  validateMeter(meter);
  const compound = meter.den === 8;
  const eighth = ticksPerQuarter / 2;
  const beat = compound ? 3 * eighth : ticksPerQuarter;
  const beatsPerBar = compound ? meter.num / 3 : meter.num;
  return { ticksPerQuarter, meter: { ...meter }, beat, beatsPerBar, bar: beat * beatsPerBar, eighth, sixteenth: ticksPerQuarter / 4, compound };
}

/** A TimeGrid, or the old `beatsPerBar` number (x/4 at the 16th grid). */
export const toTimeGrid = (g: TimeGrid | number): TimeGrid => (typeof g === 'number' ? timeGrid(TPB, { num: g, den: 4 }) : g);

/** Move notes from one grid resolution to another; throws if a time doesn't land on the new grid. */
export function rescaleNotes<T extends Note>(notes: T[], from: number, to: number): T[] {
  if (from === to) return notes.map((n) => ({ ...n }));
  return notes.map((n) => {
    const start = (n.start * to) / from;
    const dur = (n.dur * to) / from;
    if (!Number.isInteger(start) || !Number.isInteger(dur)) throw new Error(`note at ${n.start}+${n.dur} (of ${from} per quarter) is not on a grid of ${to} per quarter`);
    return { ...n, start, dur };
  });
}

/**
 * The coarsest resolution (a multiple of 4 dividing `ticksPerQuarter`) that
 * still holds every note: 4 for a subject on the 16th grid, 8 with 32nds,
 * 12 with 16th triplets. Generating there gives the same notes as at the fine
 * grid, only faster, and keeps 16th-grid subjects bit-identical to before.
 */
export function coarsestTicksPerQuarter(notes: Note[], ticksPerQuarter: number): number {
  for (let q = 4; q < ticksPerQuarter; q += 4) {
    if (ticksPerQuarter % q) continue;
    const f = ticksPerQuarter / q;
    if (notes.every((n) => n.start % f === 0 && n.dur % f === 0)) return q;
  }
  return ticksPerQuarter;
}

export interface Note {
  pitch: number; // MIDI note number
  start: number; // ticks
  dur: number; // ticks
}

export type Role = 'subject' | 'answer' | 'countersubject' | 'free' | 'link' | 'cadence';

export interface VNote extends Note {
  role: Role;
  voice: number;
}

export interface VoiceDef {
  name: string;
  short: string;
  range: [number, number];
}

/** Voice sets by voice count, ordered top to bottom (index 0 = highest). */
export const VOICE_SETS: Record<number, VoiceDef[]> = {
  2: [
    { name: 'Upper', short: 'U', range: [57, 79] },
    { name: 'Lower', short: 'L', range: [45, 67] },
  ],
  3: [
    { name: 'Soprano', short: 'S', range: [60, 81] },
    { name: 'Alto', short: 'A', range: [53, 74] },
    { name: 'Bass', short: 'B', range: [41, 62] },
  ],
  4: [
    { name: 'Soprano', short: 'S', range: [60, 81] },
    { name: 'Alto', short: 'A', range: [55, 74] },
    { name: 'Tenor', short: 'T', range: [48, 69] },
    { name: 'Bass', short: 'B', range: [40, 62] },
  ],
};

export const noteEnd = (n: { start: number; dur: number }): number => n.start + n.dur;

export function sortNotes<T extends Note>(notes: T[]): T[] {
  return [...notes].sort((a, b) => a.start - b.start || b.pitch - a.pitch);
}

/** Make a line monophonic: later notes win, earlier overlapping notes are trimmed or dropped. */
export function makeMonophonic(notes: Note[]): Note[] {
  const sorted = sortNotes(notes).filter((n) => n.dur > 0);
  const out: Note[] = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    if (prev && noteEnd(prev) > n.start) {
      if (prev.start >= n.start) out.pop();
      else prev.dur = n.start - prev.start;
    }
    out.push({ ...n });
  }
  return out;
}

export function lengthOf(notes: Note[]): number {
  return notes.reduce((m, n) => Math.max(m, noteEnd(n)), 0);
}

export function transpose<T extends Note>(notes: T[], semis: number): T[] {
  return notes.map((n) => ({ ...n, pitch: n.pitch + semis }));
}

export function shiftTime<T extends Note>(notes: T[], ticks: number): T[] {
  return notes.map((n) => ({ ...n, start: n.start + ticks }));
}
