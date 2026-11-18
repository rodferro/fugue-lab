// App wiring: settings form, editor, generation, playback and export.
import { Note, TPB, VOICE_SETS } from '../engine/model';
import { Key, Mode, keyName } from '../engine/theory';
import { analyzeSubject } from '../engine/analyze';
import { DEFAULT_SETTINGS, FugueResult, FugueSettings, generateFugue } from '../engine/fugue';
import { voiceLeadingReport } from '../engine/report';
import { writeMidi } from '../engine/midi';
import { EXAMPLES } from './examples';
import { Instrument, Player } from './audio';
import { PianoRoll } from './pianoRoll';
import { FugueView } from './fugueView';
import { zipFiles } from './zip';

interface AppState {
  subject: Note[];
  bars: number;
  len: number;
  bpm: number;
  instrument: Instrument;
  ghost: boolean;
  settings: FugueSettings;
}

const STORE = 'fugue-lab-v1';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function load(): AppState | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as AppState) : null;
  } catch {
    return null;
  }
}
function save(s: AppState): void {
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

const fresh = (): AppState => ({
  subject: EXAMPLES[0].notes.map((n) => ({ ...n })),
  bars: EXAMPLES[0].bars,
  len: 2,
  bpm: 76,
  instrument: 'harpsichord',
  ghost: true,
  settings: { ...DEFAULT_SETTINGS },
});

const state: AppState = { ...fresh(), ...(load() ?? {}) };
state.settings = { ...DEFAULT_SETTINGS, ...state.settings };

const player = new Player();
let result: FugueResult | null = null;
let raf = 0;
let playingWhat: 'subject' | 'fugue' | null = null;

const roll = new PianoRoll($('roll'), {
  onChange(notes) { state.subject = notes; schedule(); },
  onPreview(p) { player.preview(p, state.instrument); },
});
const view = new FugueView($('fugue'), $('tip'), (tick) => {
  if (playingWhat === 'fugue') playFugue(tick);
  else { view.playhead = tick; view.draw(); }
});

// ---------- form setup ----------
function fillSelect(sel: HTMLSelectElement, options: [string, string][], value: string): void {
  sel.replaceChildren(...options.map(([v, label]) => new Option(label, v, false, v === value)));
}

const keyValue = (k: Key | null) => (k ? `${k.tonic}-${k.mode}` : 'auto');
function buildKeySelect(detected: Key): void {
  const opts: [string, string][] = [['auto', `Detect (${keyName(detected)})`]];
  for (const mode of ['major', 'minor'] as Mode[]) for (let t = 0; t < 12; t++) opts.push([`${t}-${mode}`, keyName({ tonic: t, mode })]);
  fillSelect($('key'), opts, keyValue(state.settings.key));
}

function buildMutationSelect(auto: number): void {
  const n = state.subject.length;
  const opts: [string, string][] = [['auto', auto ? `Automatic (first ${auto} note${auto > 1 ? 's' : ''})` : 'Automatic (none needed)']];
  for (let i = 1; i < Math.min(n, 9); i++) opts.push([String(i), `First ${i} note${i > 1 ? 's' : ''}`]);
  fillSelect($('mutation'), opts, state.settings.mutation === null ? 'auto' : String(state.settings.mutation));
  ($('mutation') as HTMLSelectElement).disabled = state.settings.answerType === 'real';
}

function permutations(xs: number[]): number[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}
function buildOrderSelect(auto: number[] | null): void {
  const voices = VOICE_SETS[state.settings.voices];
  const label = (o: number[]) => o.map((v) => voices[v].short).join(' → ');
  const opts: [string, string][] = [['auto', auto ? `Automatic (${label(auto)})` : 'Automatic']];
  for (const p of permutations(voices.map((_, i) => i))) opts.push([p.join(','), label(p)]);
  fillSelect($('order'), opts, state.settings.entryOrder ? state.settings.entryOrder.join(',') : 'auto');
}

function setSegment(name: string, value: string): void {
  document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((r) => { r.checked = r.value === value; });
}

function syncForm(): void {
  const s = state.settings;
  setSegment('voices', String(s.voices));
  setSegment('answerType', s.answerType);
  setSegment('len', String(state.len));
  ($('bars') as HTMLSelectElement).value = String(state.bars);
  ($('meter') as HTMLSelectElement).value = String(s.beatsPerBar);
  ($('answerInterval') as HTMLSelectElement).value = s.answerInterval;
  ($('cs') as HTMLInputElement).checked = s.countersubject;
  ($('cadence') as HTMLInputElement).checked = s.cadence;
  ($('picardy') as HTMLInputElement).checked = s.picardy;
  ($('codetta') as HTMLSelectElement).value = String(s.codettaBars);
  ($('codetta') as HTMLSelectElement).disabled = s.voices < 3;
  ($('seed') as HTMLInputElement).value = String(s.seed);
  ($('bpm') as HTMLInputElement).value = String(state.bpm);
  $('bpmOut').textContent = String(state.bpm);
  ($('instrument') as HTMLSelectElement).value = state.instrument;
  ($('ghost') as HTMLInputElement).checked = state.ghost;
}

fillSelect($('example'), [['', 'Load an example…'], ...EXAMPLES.map((e) => [e.id, e.name] as [string, string])], '');

// ---------- generation ----------
let timer = 0;
function schedule(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(regenerate, 90);
}

function chip(label: string, value: string, tone = ''): HTMLElement {
  const el = document.createElement('span');
  el.className = `chip ${tone}`;
  const l = document.createElement('span');
  l.className = 'chip-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.textContent = value;
  el.append(l, v);
  return el;
}

function regenerate(): void {
  save(state);
  const s = state.settings;
  roll.bars = state.bars;
  roll.beatsPerBar = s.beatsPerBar;
  roll.defaultLen = state.len;
  roll.notes = state.subject.map((n) => ({ ...n }));
  const analysis = analyzeSubject(state.subject, s.key ?? undefined);
  const autoKey = analyzeSubject(state.subject).key;
  buildKeySelect(autoKey);
  buildMutationSelect(analysis.autoMutation);
  const mutation = s.answerType === 'tonal' ? (s.mutation ?? analysis.autoMutation) : 0;
  roll.key = { key: analysis.key, mutation };

  const chips = $('analysis');
  const warn = $('warnings');
  warn.replaceChildren(...analysis.warnings.map((w) => Object.assign(document.createElement('li'), { textContent: w })));
  warn.hidden = !analysis.warnings.length;

  if (state.subject.length < 2) {
    result = null;
    roll.ghost = [];
    roll.resize();
    chips.replaceChildren(chip('Key', keyName(analysis.key)));
    $('fugueEmpty').hidden = false;
    $('fugueBody').hidden = true;
    buildOrderSelect(null);
    return;
  }
  const t0 = performance.now();
  result = generateFugue(state.subject, s);
  const ms = performance.now() - t0;
  buildOrderSelect(s.entryOrder ? null : result.order);
  roll.ghost = state.ghost ? result.answer.notes : [];
  roll.resize();

  const dom = result.entries.find((e) => e.role === 'answer');
  chips.replaceChildren(
    chip('Key', keyName(result.key)),
    chip('Answer', `${s.answerType === 'tonal' ? 'Tonal' : 'Real'}${dom ? `, in ${keyName(dom.key)}` : ''}`),
    chip('Tonal head', s.answerType === 'tonal' ? (mutation ? `${mutation} note${mutation > 1 ? 's' : ''}` : 'none needed') : 'off', mutation && s.answerType === 'tonal' ? 'head' : ''),
    chip('Length', `${(analysis.length / (TPB * s.beatsPerBar)).toFixed(analysis.length % (TPB * s.beatsPerBar) ? 2 : 0)} bars`),
  );

  // Unclassified: the chip counts every strong-beat dissonance, as before.
  const issues = voiceLeadingReport(result.notes, { classify: false, keys: result.keys });
  const count = (k: string) => issues.filter((i) => i.kind === k).length;
  const par = count('parallel5') + count('parallel8');
  const diss = count('strongDissonance');
  const cross = count('crossing');
  const rep = $('report');
  rep.replaceChildren(
    chip('Parallels', String(par), par ? 'bad' : 'good'),
    chip('Strong-beat dissonances', String(diss), diss > 2 ? 'warn' : diss ? 'soft' : 'good'),
    chip('Crossings', String(cross), cross ? 'soft' : 'good'),
    chip('Solved in', `${Math.round(ms)} ms`),
  );

  const legend = $('voices');
  legend.replaceChildren(
    ...result.voices.map((v, i) => {
      const lab = document.createElement('label');
      lab.className = 'voice';
      lab.style.setProperty('--vc', `var(--v${i})`);
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !view.muted[i];
      cb.id = `voice-${i}`;
      cb.addEventListener('change', () => { view.muted[i] = !cb.checked; view.draw(); });
      const sw = document.createElement('span');
      sw.className = 'swatch';
      const name = document.createElement('span');
      name.textContent = v.name;
      lab.append(cb, sw, name);
      return lab;
    }),
  );
  $('fugueEmpty').hidden = true;
  $('fugueBody').hidden = false;
  view.set(result);
}

// ---------- playback ----------
function loop(): void {
  const t = player.tick();
  if (playingWhat === 'subject') { roll.playhead = t; roll.draw(); }
  if (playingWhat === 'fugue') { view.playhead = t; view.draw(); view.follow(); }
  if (t !== null) raf = requestAnimationFrame(loop);
}
function stop(): void {
  player.stop();
  cancelAnimationFrame(raf);
  playingWhat = null;
  roll.playhead = null;
  roll.draw();
  view.draw();
  setPlaying();
}
function setPlaying(): void {
  $('playSubject').setAttribute('aria-pressed', String(playingWhat === 'subject'));
  $('playFugue').setAttribute('aria-pressed', String(playingWhat === 'fugue'));
  $('playFugueLabel').textContent = playingWhat === 'fugue' ? 'Playing…' : 'Play fugue';
}
function playSubject(): void {
  stop();
  if (!state.subject.length) return;
  playingWhat = 'subject';
  player.play([{ notes: state.subject, pan: 0 }], state.bpm, state.instrument, 0, stop);
  setPlaying();
  raf = requestAnimationFrame(loop);
}
function playFugue(from = 0): void {
  stop();
  if (!result) return;
  playingWhat = 'fugue';
  const n = result.notes.length;
  const voices = result.notes
    .map((notes, i) => ({ notes, pan: n > 1 ? -0.45 + (0.9 * i) / (n - 1) : 0 }))
    .filter((_, i) => !view.muted[i]);
  player.play(voices, state.bpm, state.instrument, from, () => { stop(); view.playhead = null; view.draw(); });
  setPlaying();
  raf = requestAnimationFrame(loop);
}

// ---------- export ----------
function toast(msg: string): void {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  window.clearTimeout((el as unknown as { _t: number })._t);
  (el as unknown as { _t: number })._t = window.setTimeout(() => { el.hidden = true; }, 3200);
}

type Downloads = { save(req: { filename: string; data: Uint8Array | string }): Promise<unknown> };
type ClaudeHost = { use(name: string): Promise<unknown> };

async function exportMidi(): Promise<void> {
  if (!result) return;
  const midi = writeMidi(
    result.voices.map((v, i) => ({ name: v.name, notes: result!.notes[i], channel: i })),
    state.bpm,
    state.settings.beatsPerBar,
  );
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (host?.use) {
    // Published artifact: hosts only accept whitelisted types, so wrap in a zip.
    const downloads = (await host.use('downloads')) as Downloads | null;
    if (!downloads) { toast('Saving files is not available in this view.'); return; }
    const json = new TextEncoder().encode(JSON.stringify({ subject: state.subject, settings: state.settings }, null, 2));
    try {
      await downloads.save({ filename: 'fugue.zip', data: zipFiles([{ name: 'fugue.mid', data: midi }, { name: 'fugue-settings.json', data: json }]) });
      toast('Saved fugue.zip (MIDI inside).');
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'declined') toast('The file could not be saved here.');
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([midi as Uint8Array<ArrayBuffer>], { type: 'audio/midi' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'fugue.mid' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Saved fugue.mid');
}

// ---------- events ----------
const on = (id: string, ev: string, fn: (e: Event) => void) => $(id).addEventListener(ev, fn);
const settings = () => state.settings;

document.querySelectorAll<HTMLInputElement>('input[name="voices"]').forEach((r) =>
  r.addEventListener('change', () => { settings().voices = Number(r.value) as 2 | 3 | 4; settings().entryOrder = null; view.muted = []; syncForm(); schedule(); }));
document.querySelectorAll<HTMLInputElement>('input[name="answerType"]').forEach((r) =>
  r.addEventListener('change', () => { settings().answerType = r.value as 'tonal' | 'real'; schedule(); }));
document.querySelectorAll<HTMLInputElement>('input[name="len"]').forEach((r) =>
  r.addEventListener('change', () => { state.len = Number(r.value); roll.defaultLen = state.len; save(state); }));

on('example', 'change', (e) => {
  const ex = EXAMPLES.find((x) => x.id === (e.target as HTMLSelectElement).value);
  if (!ex) return;
  state.subject = ex.notes.map((n) => ({ ...n }));
  state.bars = ex.bars;
  settings().key = null;
  settings().mutation = null;
  settings().entryOrder = null;
  settings().beatsPerBar = 4;
  (e.target as HTMLSelectElement).value = '';
  syncForm();
  regenerate();
  roll.center();
});
on('clear', 'click', () => { state.subject = []; settings().key = null; settings().mutation = null; schedule(); });
on('bars', 'change', (e) => {
  state.bars = Number((e.target as HTMLSelectElement).value);
  const max = state.bars * settings().beatsPerBar * TPB;
  state.subject = state.subject.filter((n) => n.start < max).map((n) => ({ ...n, dur: Math.min(n.dur, max - n.start) }));
  schedule();
});
on('meter', 'change', (e) => { settings().beatsPerBar = Number((e.target as HTMLSelectElement).value); schedule(); });
on('key', 'change', (e) => {
  const v = (e.target as HTMLSelectElement).value;
  if (v === 'auto') settings().key = null;
  else { const [t, m] = v.split('-'); settings().key = { tonic: Number(t), mode: m as Mode }; }
  settings().mutation = null;
  schedule();
});
on('answerInterval', 'change', (e) => { settings().answerInterval = (e.target as HTMLSelectElement).value as FugueSettings['answerInterval']; schedule(); });
on('mutation', 'change', (e) => { const v = (e.target as HTMLSelectElement).value; settings().mutation = v === 'auto' ? null : Number(v); schedule(); });
on('order', 'change', (e) => { const v = (e.target as HTMLSelectElement).value; settings().entryOrder = v === 'auto' ? null : v.split(',').map(Number); schedule(); });
on('cs', 'change', (e) => { settings().countersubject = (e.target as HTMLInputElement).checked; schedule(); });
on('cadence', 'change', (e) => { settings().cadence = (e.target as HTMLInputElement).checked; schedule(); });
on('picardy', 'change', (e) => { settings().picardy = (e.target as HTMLInputElement).checked; schedule(); });
on('codetta', 'change', (e) => { settings().codettaBars = Number((e.target as HTMLSelectElement).value); schedule(); });
on('seed', 'change', (e) => { settings().seed = Math.max(1, Math.floor(Number((e.target as HTMLInputElement).value) || 1)); syncForm(); schedule(); });
on('reroll', 'click', () => { settings().seed = 1 + Math.floor(Math.random() * 9999); syncForm(); regenerate(); });
on('bpm', 'input', (e) => { state.bpm = Number((e.target as HTMLInputElement).value); $('bpmOut').textContent = String(state.bpm); save(state); });
on('instrument', 'change', (e) => { state.instrument = (e.target as HTMLSelectElement).value as Instrument; save(state); });
on('ghost', 'change', (e) => { state.ghost = (e.target as HTMLInputElement).checked; schedule(); });
on('playSubject', 'click', () => (playingWhat === 'subject' ? stop() : playSubject()));
on('playFugue', 'click', () => (playingWhat === 'fugue' ? stop() : playFugue(view.playhead ?? 0)));
on('stop', 'click', () => { stop(); view.playhead = null; view.draw(); });
on('export', 'click', () => { void exportMidi(); });

document.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (e.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'CANVAS'].includes(tag)) {
    e.preventDefault();
    if (playingWhat) stop(); else playFugue();
  }
});

const repaint = () => { roll.refreshPalette(); view.refreshPalette(); };
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint);
new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

syncForm();
regenerate();
roll.center();
