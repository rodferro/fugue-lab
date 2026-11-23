// The Dissonance control: UI state, the request it adds to the settings, and
// the status text for a result. Pure (no DOM), so it is tested in node.
import type { FugueSettings } from '../engine/fugue';
import type { DissonanceControl } from '../engine/density';

export type DissonancePreset = 'sparse' | 'bach' | 'dense';

export interface DissonanceUi {
  /** Off: the request carries no targetDissonance and output is as before. */
  on: boolean;
  /**
   * A preset follows the voice count (a multiple of its Bach average); null
   * once the user moves the slider, after which `value` stays put.
   */
  preset: DissonancePreset | null;
  /** Strong-beat dissonances per bar over the exposition. */
  value: number;
}

export const DISSONANCE_MIN = 0;
/** 3 covers every held-out Bach fugue, up to BWV 869 in 4 voices (3.04). */
export const DISSONANCE_MAX = 3;
export const DISSONANCE_STEP = 0.05;
/**
 * Bach's mean per bar by voice count on the development split (WTC II + Art of
 * Fugue). Single pieces vary widely: 0.34 to 3.04 across the held-out 4-voice fugues.
 */
export const BACH_DISSONANCE: Record<2 | 3 | 4, number> = { 2: 0.25, 3: 0.55, 4: 0.9 };
export const PRESET_FACTOR: Record<DissonancePreset, number> = { sparse: 0.5, bach: 1, dense: 1.5 };
export const PRESET_LABEL: Record<DissonancePreset, string> = { sparse: 'Sparse', bach: 'Bach average', dense: 'Dense' };

/** Round to the slider's step (half steps round up) and clamp to its range. */
export function snapDissonance(x: number): number {
  const v = Math.round(x / DISSONANCE_STEP + 1e-9) * DISSONANCE_STEP;
  return Math.min(DISSONANCE_MAX, Math.max(DISSONANCE_MIN, Number(v.toFixed(2))));
}

export const presetValue = (preset: DissonancePreset, voices: 2 | 3 | 4): number =>
  snapDissonance(BACH_DISSONANCE[voices] * PRESET_FACTOR[preset]);

export const freshDissonance = (voices: 2 | 3 | 4): DissonanceUi => ({ on: false, preset: 'bach', value: presetValue('bach', voices) });

/** The slider's value: a preset's for this voice count, else the user's own. */
export const dissonanceValue = (d: DissonanceUi, voices: 2 | 3 | 4): number =>
  d.preset ? presetValue(d.preset, voices) : snapDissonance(d.value);

/** Repairs a saved (or missing) control state. */
export function loadDissonance(raw: unknown, voices: 2 | 3 | 4): DissonanceUi {
  const d = freshDissonance(voices);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<DissonanceUi>;
  const preset = r.preset === null || (typeof r.preset === 'string' && r.preset in PRESET_FACTOR) ? r.preset : d.preset;
  const value = typeof r.value === 'number' && Number.isFinite(r.value) ? snapDissonance(r.value) : d.value;
  const out: DissonanceUi = { on: r.on === true, preset, value };
  return { ...out, value: dissonanceValue(out, voices) };
}

/** Whether the control can be used with these settings, and if not, why. */
export function dissonanceAvailability(s: Pick<FugueSettings, 'constraints'>): { enabled: boolean; reason: string } {
  return s.constraints === 'hard'
    ? { enabled: false, reason: 'Strict rules have no dissonance rewards to steer.' }
    : { enabled: true, reason: '' };
}

/**
 * The settings sent to generateFugue. Off (or in hard mode) they are the
 * settings unchanged; on, they add targetDissonance.
 */
export function requestSettings(s: FugueSettings, d: DissonanceUi): FugueSettings {
  if (!d.on || !dissonanceAvailability(s).enabled) return s;
  return { ...s, targetDissonance: dissonanceValue(d, s.voices) };
}

const fmt = (x: number) => x.toFixed(2);

/**
 * The line shown after a targeted generation. `reached: false` means the
 * target lay outside every attempt's measure: the subject can't get there.
 */
export function dissonanceStatus(c: Pick<DissonanceControl, 'target' | 'achieved' | 'reachable' | 'hit' | 'tries'>): { text: string; reached: boolean } {
  const [lo, hi] = c.reachable;
  const head = `Target ${fmt(c.target)} / achieved ${fmt(c.achieved)} per bar`;
  if (c.hit) return { text: head, reached: true };
  if (c.target < lo || c.target > hi) {
    const range = lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
    return { text: `${head}. Closest possible for this subject: ${range}.`, reached: false };
  }
  // Inside the range but missed: the measure moves in whole dissonances and is
  // not monotone in the control, so this is the nearest of the tries.
  return { text: `${head} (nearest in ${c.tries} tries).`, reached: true };
}
