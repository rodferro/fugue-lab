// Core data model. Time is measured in ticks on a 16th-note grid.
// Pitches are MIDI numbers at the edges (UI, playback, export); the engine
// converts to scale degrees (see theory.ts) whenever it reasons about harmony.

export const TPB = 4; // ticks per beat (quarter note = 4 sixteenths)

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
