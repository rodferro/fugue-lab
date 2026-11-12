// Keys, scales and scale-degree arithmetic.
// A ScalePitch is (degree 0-6, octave, accidental) relative to a key; the
// engine uses it for diatonic transposition and tonal-answer mapping.

export type Mode = 'major' | 'minor';

export interface Key {
  tonic: number; // pitch class 0-11
  mode: Mode;
}

export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const NAT_MINOR = [0, 2, 3, 5, 7, 8, 10];

export const PC_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;

export function scaleOf(mode: Mode): number[] {
  return mode === 'major' ? MAJOR : NAT_MINOR;
}

export function keyName(k: Key): string {
  const name = k.mode === 'minor' && [1, 3, 8, 10].includes(k.tonic) ? SHARP_NAMES[k.tonic] : PC_NAMES[k.tonic];
  return `${name} ${k.mode}`;
}

export function pitchName(midi: number): string {
  return `${SHARP_NAMES[mod12(midi)]}${Math.floor(midi / 12) - 1}`;
}

export const sameKey = (a: Key, b: Key): boolean => a.tonic === b.tonic && a.mode === b.mode;

export function dominantOf(k: Key): Key {
  return { tonic: mod12(k.tonic + 7), mode: k.mode };
}

/**
 * Pitch classes (relative to the tonic) that a line may use in this key.
 * Minor adds the raised 6th and 7th (melodic/harmonic minor).
 */
export function usablePcs(k: Key): number[] {
  const base = scaleOf(k.mode).map((p) => mod12(p + k.tonic));
  if (k.mode === 'minor') base.push(mod12(k.tonic + 9), mod12(k.tonic + 11));
  return base;
}

export interface ScalePitch {
  deg: number; // 0..6 (0 = tonic)
  oct: number;
  acc: number; // chromatic alteration in semitones
}

// For each pitch class relative to the tonic: [degree, accidental].
const SPELL_MAJOR: [number, number][] = [
  [0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [3, 1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0],
];
const SPELL_MINOR: [number, number][] = [
  [0, 0], [1, -1], [1, 0], [2, 0], [2, 1], [3, 0], [3, 1], [4, 0], [5, 0], [5, 1], [6, 0], [6, 1],
];

export function toScalePitch(midi: number, k: Key): ScalePitch {
  const rel = mod12(midi - k.tonic);
  const [deg, acc] = (k.mode === 'major' ? SPELL_MAJOR : SPELL_MINOR)[rel];
  const scale = scaleOf(k.mode);
  const oct = Math.floor((midi - k.tonic - scale[deg] - acc) / 12);
  return { deg, oct, acc };
}

export function fromScalePitch(sp: ScalePitch, k: Key): number {
  const scale = scaleOf(k.mode);
  const d = ((sp.deg % 7) + 7) % 7;
  const extraOct = Math.floor(sp.deg / 7);
  return 12 * (sp.oct + extraOct) + k.tonic + scale[d] + sp.acc;
}

/** Move a pitch by a number of scale steps within a key (accidental kept). */
export function diatonicShift(midi: number, steps: number, k: Key): number {
  const sp = toScalePitch(midi, k);
  const total = sp.deg + steps;
  const deg = ((total % 7) + 7) % 7;
  const oct = sp.oct + Math.floor(total / 7);
  return fromScalePitch({ deg, oct, acc: sp.acc }, k);
}

export function degreeLabel(midi: number, k: Key): string {
  const sp = toScalePitch(midi, k);
  const acc = sp.acc > 0 ? '♯' : sp.acc < 0 ? '♭' : '';
  return `${acc}${sp.deg + 1}`;
}

/** Diatonic triads (plus V7) of a key as absolute pitch-class sets. */
export function chordsOf(k: Key): number[][] {
  const pcs = scaleOf(k.mode).map((p) => mod12(p + k.tonic));
  const chords: number[][] = [];
  for (let d = 0; d < 7; d++) chords.push([pcs[d], pcs[(d + 2) % 7], pcs[(d + 4) % 7]]);
  const lt = mod12(k.tonic + 11);
  const dom = mod12(k.tonic + 7);
  const sup = mod12(k.tonic + 2);
  const sub = mod12(k.tonic + 5);
  if (k.mode === 'minor') {
    chords.push([dom, lt, sup]); // V
    chords.push([lt, sup, sub]); // vii°
  }
  chords.push([dom, lt, sup, sub]); // V7
  return chords;
}

export function tonicTriad(k: Key, picardy = false): number[] {
  const third = k.mode === 'major' || picardy ? 4 : 3;
  return [k.tonic, mod12(k.tonic + third), mod12(k.tonic + 7)];
}
