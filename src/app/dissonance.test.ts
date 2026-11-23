import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, FugueSettings, generateFugue } from '../engine/fugue';
import { EXAMPLES } from './examples';
import {
  DissonanceUi, PRESET_LABEL, dissonanceAvailability, dissonanceStatus, dissonanceValue, freshDissonance, loadDissonance, presetValue, requestSettings, snapDissonance,
} from './dissonance';

const settings = (over: Partial<FugueSettings> = {}): FugueSettings => ({ ...DEFAULT_SETTINGS, ...over });

test('dissonance control off: the request is the settings, unchanged', () => {
  for (const voices of [2, 3, 4] as const) {
    const s = settings({ voices });
    const req = requestSettings(s, freshDissonance(voices));
    assert.equal(req, s);
    assert.equal('targetDissonance' in req, false);
  }
  // And so the generation is today's.
  const s = settings({ voices: 3 });
  const notes = EXAMPLES[0].notes;
  assert.deepEqual(generateFugue(notes, requestSettings(s, freshDissonance(3))), generateFugue(notes, s));
});

test('dissonance control on: the request carries the slider value', () => {
  const s = settings({ voices: 4 });
  const on: DissonanceUi = { on: true, preset: null, value: 1.25 };
  assert.equal(requestSettings(s, on).targetDissonance, 1.25);
  assert.equal(s.targetDissonance, undefined, 'the stored settings are not modified');
  const r = generateFugue(EXAMPLES[0].notes, requestSettings(settings({ voices: 3 }), { on: true, preset: 'bach', value: 0 }));
  assert.equal(r.dissonance?.target, 0.55);
});

test('defaults and presets follow the voice count until the slider moves', () => {
  assert.deepEqual([2, 3, 4].map((v) => presetValue('bach', v as 2 | 3 | 4)), [0.25, 0.55, 0.9]);
  assert.deepEqual([2, 3, 4].map((v) => presetValue('sparse', v as 2 | 3 | 4)), [0.15, 0.3, 0.45]);
  assert.deepEqual([2, 3, 4].map((v) => presetValue('dense', v as 2 | 3 | 4)), [0.4, 0.85, 1.35]);
  assert.equal(snapDissonance(3.04), 3, 'the slider tops out at 3 (BWV 869, 4 voices: 3.04)');
  assert.equal(snapDissonance(2.5), 2.5);
  assert.equal(PRESET_LABEL.bach, 'Bach average');
  const d = { ...freshDissonance(3), on: true };
  assert.equal(dissonanceValue(d, 4), 0.9);
  const moved: DissonanceUi = { on: true, preset: null, value: 0.7 };
  assert.equal(dissonanceValue(moved, 4), 0.7);
  assert.equal(dissonanceValue(moved, 2), 0.7);
});

test('saved control state is repaired on load', () => {
  assert.deepEqual(loadDissonance(undefined, 4), { on: false, preset: 'bach', value: 0.9 });
  assert.deepEqual(loadDissonance({ on: true, preset: null, value: 0.73 }, 3), { on: true, preset: null, value: 0.75 });
  assert.deepEqual(loadDissonance({ on: true, preset: 'dense', value: 9 }, 4), { on: true, preset: 'dense', value: 1.35 });
  assert.deepEqual(loadDissonance({ on: true, preset: null, value: 9 }, 4), { on: true, preset: null, value: 3 });
  assert.deepEqual(loadDissonance({ on: 'yes', preset: 'loud', value: 'x' }, 2), { on: false, preset: 'bach', value: 0.25 });
});

test('status text: target and achieved, and the out-of-reach message', () => {
  const base = { target: 0.9, achieved: 0.87, reachable: [0.42, 1.1] as [number, number], hit: true, tries: 3 };
  assert.deepEqual(dissonanceStatus(base), { text: 'Target 0.90 / achieved 0.87 per bar', reached: true });
  assert.deepEqual(dissonanceStatus({ ...base, achieved: 0.75, reachable: [0.42, 0.75], hit: false, tries: 8 }), {
    text: 'Target 0.90 / achieved 0.75 per bar. Closest possible for this subject: 0.42–0.75.',
    reached: false,
  });
  assert.equal(dissonanceStatus({ ...base, target: 0, achieved: 0.2, reachable: [0.2, 0.2], hit: false }).text,
    'Target 0.00 / achieved 0.20 per bar. Closest possible for this subject: 0.20.');
  assert.deepEqual(dissonanceStatus({ ...base, achieved: 0.7, hit: false, tries: 8 }), {
    text: 'Target 0.90 / achieved 0.70 per bar (nearest in 8 tries).',
    reached: true,
  });
});

test('hard mode disables the dissonance control and sends no target', () => {
  const hard = settings({ voices: 3, constraints: 'hard' });
  const a = dissonanceAvailability(hard);
  assert.equal(a.enabled, false);
  assert.match(a.reason, /no dissonance rewards/);
  const req = requestSettings(hard, { on: true, preset: 'bach', value: 0.55 });
  assert.equal(req.targetDissonance, undefined);
  assert.doesNotThrow(() => generateFugue(EXAMPLES[0].notes, req));
  assert.equal(dissonanceAvailability(settings()).enabled, true);
});
