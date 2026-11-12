// Web Audio playback with three small synthesized instruments.
// No samples or libraries; swap in a SoundFont player later if wanted.
import { Note, TPB } from '../engine/model';

export type Instrument = 'harpsichord' | 'organ' | 'soft';

export interface PlayVoice {
  notes: Note[];
  pan: number; // -1..1
}

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Player {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private t0 = 0;
  private secPerTick = 0.125;
  private endTick = 0;
  private timer = 0;
  playing = false;

  private ensure(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Short preview tone while editing. */
  preview(pitch: number, instrument: Instrument): void {
    const ctx = this.ensure();
    const out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(ctx.destination);
    this.voiceNote(ctx, out, pitch, ctx.currentTime + 0.01, 0.25, instrument, 0.22);
  }

  play(voices: PlayVoice[], bpm: number, instrument: Instrument, fromTick = 0, onEnd?: () => void): void {
    this.stop();
    const ctx = this.ensure();
    this.secPerTick = 60 / bpm / TPB;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.t0 = ctx.currentTime + 0.08 - fromTick * this.secPerTick;
    const level = 0.2 / Math.sqrt(Math.max(1, voices.length));
    this.endTick = 0;
    for (const v of voices) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = v.pan;
      pan.connect(this.master);
      for (const n of v.notes) {
        this.endTick = Math.max(this.endTick, n.start + n.dur);
        if (n.start + n.dur <= fromTick) continue;
        const start = this.t0 + Math.max(n.start, fromTick) * this.secPerTick;
        const dur = (n.start + n.dur - Math.max(n.start, fromTick)) * this.secPerTick;
        this.voiceNote(ctx, pan, n.pitch, start, dur, instrument, level);
      }
    }
    this.playing = true;
    const totalMs = ((this.endTick - fromTick) * this.secPerTick + 0.6) * 1000;
    this.timer = window.setTimeout(() => {
      this.stop();
      onEnd?.();
    }, totalMs);
  }

  stop(): void {
    window.clearTimeout(this.timer);
    if (this.master && this.ctx) {
      const g = this.master;
      g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
      window.setTimeout(() => g.disconnect(), 200);
    }
    this.master = null;
    this.playing = false;
  }

  /** Current playback position in ticks, or null when stopped. */
  tick(): number | null {
    if (!this.playing || !this.ctx) return null;
    return Math.max(0, (this.ctx.currentTime - this.t0) / this.secPerTick);
  }

  private voiceNote(ctx: AudioContext, out: AudioNode, pitch: number, start: number, dur: number, inst: Instrument, level: number): void {
    const f = midiToHz(pitch);
    const amp = ctx.createGain();
    amp.gain.value = 0;
    amp.connect(out);
    const end = start + dur;
    const oscs: OscillatorNode[] = [];
    const mk = (type: OscillatorType, mult: number, gain: number, detune = 0, dest: AudioNode = amp) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mult;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(dest);
      oscs.push(o);
    };
    let stopAt = end + 0.1;
    if (inst === 'harpsichord') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 1.5;
      lp.frequency.setValueAtTime(Math.min(9000, f * 14), start);
      lp.frequency.exponentialRampToValueAtTime(Math.max(600, f * 3), start + 0.35);
      lp.connect(amp);
      mk('sawtooth', 1, 0.6, 0, lp);
      mk('square', 2, 0.18, 4, lp);
      amp.gain.setValueAtTime(0, start);
      amp.gain.linearRampToValueAtTime(level * 1.2, start + 0.004);
      amp.gain.exponentialRampToValueAtTime(level * 0.35, start + Math.min(0.5, dur + 0.05));
      amp.gain.setTargetAtTime(0.0001, Math.max(start + 0.01, end), 0.05);
      stopAt = end + 0.4;
    } else if (inst === 'organ') {
      mk('sine', 1, 0.6);
      mk('sine', 2, 0.35);
      mk('sine', 4, 0.12);
      mk('triangle', 0.5, 0.15);
      amp.gain.setValueAtTime(0, start);
      amp.gain.linearRampToValueAtTime(level, start + 0.025);
      amp.gain.setValueAtTime(level, Math.max(start + 0.03, end - 0.02));
      amp.gain.linearRampToValueAtTime(0, end + 0.05);
    } else {
      mk('triangle', 1, 0.9);
      mk('sine', 2, 0.15);
      amp.gain.setValueAtTime(0, start);
      amp.gain.linearRampToValueAtTime(level * 1.1, start + 0.015);
      amp.gain.exponentialRampToValueAtTime(level * 0.6, start + 0.2);
      amp.gain.setTargetAtTime(0.0001, Math.max(start + 0.02, end - 0.01), 0.04);
      stopAt = end + 0.3;
    }
    for (const o of oscs) {
      o.start(start);
      o.stop(stopAt);
    }
  }
}
