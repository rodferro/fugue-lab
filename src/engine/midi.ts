// Minimal Standard MIDI File (format 1) writer: one track per voice.
import { Note, TPB } from './model';

const PPQ = 480;
const TICK = PPQ / TPB; // MIDI ticks per grid tick

function vlq(n: number): number[] {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes;
}

function str(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0) & 0x7f);
}

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function chunk(type: string, data: number[]): number[] {
  return [...str(type), ...u32(data.length), ...data];
}

export interface MidiTrack {
  name: string;
  notes: Note[];
  channel?: number;
  program?: number; // General MIDI program (0-based)
}

export function writeMidi(tracks: MidiTrack[], bpm: number, beatsPerBar = 4): Uint8Array {
  const tempo = Math.round(60_000_000 / bpm);
  const conductor = [
    0, 0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255,
    0, 0xff, 0x58, 4, beatsPerBar, 2, 24, 8,
    0, 0xff, 0x2f, 0,
  ];
  const out = [...chunk('MThd', [0, 1, (tracks.length + 1) >> 8, (tracks.length + 1) & 255, (PPQ >> 8) & 255, PPQ & 255]), ...chunk('MTrk', conductor)];
  tracks.forEach((tr, i) => {
    const ch = (tr.channel ?? i) & 15;
    const events: { t: number; bytes: number[]; order: number }[] = [];
    for (const n of tr.notes) {
      events.push({ t: n.start * TICK, bytes: [0x90 | ch, n.pitch, 80], order: 1 });
      events.push({ t: (n.start + n.dur) * TICK, bytes: [0x80 | ch, n.pitch, 0], order: 0 });
    }
    events.sort((a, b) => a.t - b.t || a.order - b.order);
    const data: number[] = [0, 0xff, 0x03, ...vlq(tr.name.length), ...str(tr.name)];
    data.push(0, 0xc0 | ch, tr.program ?? 6);
    let last = 0;
    for (const e of events) {
      data.push(...vlq(e.t - last), ...e.bytes);
      last = e.t;
    }
    data.push(0, 0xff, 0x2f, 0);
    out.push(...chunk('MTrk', data));
  });
  return new Uint8Array(out);
}
