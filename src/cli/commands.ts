// Request handlers for fugue-cli: plain objects in, plain objects out, no I/O,
// so they can be tested directly. See fugue-cli.ts for the command line.
import { Meter, Note, TPB, VOICE_SETS, makeMonophonic, noteEnd, parseMeter, sortNotes, timeGrid } from '../engine/model';
import { Key, keyName } from '../engine/theory';
import { analyzeSubject } from '../engine/analyze';
import { AnswerType, makeAnswer } from '../engine/answer';
import { FugueSettings, generateFugue } from '../engine/fugue';
import { writeMidi } from '../engine/midi';
import { ReportOptions, meterTicks, summarizeReport, voiceLeadingReport } from '../engine/report';

export class RequestError extends Error {}

export interface OutputFile {
  path: string;
  data: Uint8Array;
}

export interface CommandResult {
  json: unknown;
  files: OutputFile[];
}

type Obj = Record<string, unknown>;

function obj(v: unknown, what: string): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new RequestError(`${what} must be an object`);
  return v as Obj;
}

function int(v: unknown, what: string, min = -Infinity): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) throw new RequestError(`${what} must be an integer${min > -Infinity ? ` >= ${min}` : ''}`);
  return v;
}

function notes(v: unknown, what: string): Note[] {
  if (!Array.isArray(v)) throw new RequestError(`${what} must be an array of {pitch, start, dur}`);
  return v.map((n, i) => {
    const o = obj(n, `${what}[${i}]`);
    return { pitch: int(o.pitch, `${what}[${i}].pitch`, 0), start: int(o.start, `${what}[${i}].start`, 0), dur: int(o.dur, `${what}[${i}].dur`, 1) };
  });
}

function key(v: unknown): Key | undefined {
  if (v === undefined || v === null) return undefined;
  const o = obj(v, 'key');
  if (o.mode !== 'major' && o.mode !== 'minor') throw new RequestError('key.mode must be "major" or "minor"');
  const tonic = int(o.tonic, 'key.tonic', 0);
  if (tonic > 11) throw new RequestError('key.tonic must be a pitch class 0-11');
  return { tonic, mode: o.mode };
}

/** "6/8" or {num, den}. */
function meter(v: unknown, what: string): Meter {
  try {
    if (typeof v === 'string') return parseMeter(v);
    const o = obj(v, what);
    return parseMeter(`${int(o.num, `${what}.num`, 1)}/${int(o.den, `${what}.den`, 1)}`);
  } catch (e) {
    throw e instanceof RequestError ? e : new RequestError(`${what}: ${(e as Error).message}`);
  }
}

function reportOptions(o: Obj): ReportOptions {
  const out: ReportOptions = {};
  if (o.ticksPerBeat !== undefined) out.ticksPerBeat = int(o.ticksPerBeat, 'ticksPerBeat', 1);
  if (o.strongEvery !== undefined) out.strongEvery = int(o.strongEvery, 'strongEvery', 1);
  if (o.meter !== undefined) {
    out.meter = meter(o.meter, 'meter');
    if (out.meter.den === 8 && (out.ticksPerBeat ?? TPB) % 2) throw new RequestError('an x/8 meter needs an even ticksPerBeat');
  }
  if (o.classify !== undefined) out.classify = o.classify !== false;
  if (o.keys !== undefined) {
    if (!Array.isArray(o.keys) || o.keys.length === 0) throw new RequestError('keys must be a non-empty array of {start, key}');
    out.keys = o.keys.map((k, i) => {
      const span = obj(k, `keys[${i}]`);
      const sk = key(span.key);
      if (!sk) throw new RequestError(`keys[${i}].key is required`);
      return { start: int(span.start, `keys[${i}].start`, 0), key: sk };
    });
  } else if (o.key !== undefined) out.keys = [{ start: 0, key: key(o.key)! }];
  if (o.suspensions !== undefined) out.suspensions = o.suspensions === true;
  return out;
}

/**
 * {subject, settings?, midi?, bpm?, report?: ReportOptions} → the generated exposition plus its report summary.
 * settings.meter is "6/8" or {num, den}; settings.ticksPerQuarter (default 4) is the grid of the subject and the result.
 * settings.constraints "hard" gives the hard-constraint baseline; the output's hardRelaxations counts its dead ends.
 * settings.targetDissonance (per bar) searches a reward offset (or scale, targetControl) and adds `dissonance` to the output.
 */
export function generateCommand(req: unknown): CommandResult {
  const r = obj(req, 'request');
  const subject = notes(r.subject, 'subject');
  if (subject.length === 0) throw new RequestError('subject is empty');
  const settings = { ...(r.settings === undefined ? {} : obj(r.settings, 'settings')) } as Partial<FugueSettings>;
  if (settings.voices !== undefined && !(settings.voices in VOICE_SETS)) throw new RequestError('settings.voices must be 2, 3 or 4');
  if (settings.key !== undefined) settings.key = key(settings.key) ?? null;
  if (settings.meter !== undefined) settings.meter = meter(settings.meter, 'settings.meter');
  if (settings.beatsPerBar !== undefined) int(settings.beatsPerBar, 'settings.beatsPerBar', 1);
  if (settings.clashPenalty !== undefined && !(typeof settings.clashPenalty === 'number' && Number.isFinite(settings.clashPenalty) && settings.clashPenalty >= 0)) {
    throw new RequestError('settings.clashPenalty must be a number >= 0');
  }
  if (settings.constraints !== undefined && settings.constraints !== 'soft' && settings.constraints !== 'hard') {
    throw new RequestError('settings.constraints must be "soft" or "hard"');
  }
  const num = (v: unknown, what: string, ok: (x: number) => boolean, rule: string) => {
    if (v !== undefined && !(typeof v === 'number' && Number.isFinite(v) && ok(v))) throw new RequestError(`settings.${what} must be ${rule}`);
  };
  num(settings.rewardScale, 'rewardScale', (x) => x > 0, 'a number > 0');
  num(settings.rewardOffset, 'rewardOffset', () => true, 'a number');
  num(settings.targetDissonance, 'targetDissonance', (x) => x >= 0, 'a number >= 0 (strong-beat dissonances per bar)');
  num(settings.targetTolerance, 'targetTolerance', (x) => x > 0, 'a number > 0');
  num(settings.targetTries, 'targetTries', (x) => Number.isInteger(x) && x >= 1, 'an integer >= 1');
  if (settings.targetControl !== undefined && settings.targetControl !== 'scale' && settings.targetControl !== 'offset') {
    throw new RequestError('settings.targetControl must be "scale" or "offset"');
  }
  if (settings.targetDissonance !== undefined && settings.constraints === 'hard') {
    throw new RequestError('settings.targetDissonance cannot be used with constraints "hard": hard mode has no dissonance rewards to steer');
  }
  if (settings.ticksPerQuarter !== undefined) {
    const q = int(settings.ticksPerQuarter, 'settings.ticksPerQuarter', 4);
    if (q % 4 || 480 % q) throw new RequestError('settings.ticksPerQuarter must be a multiple of 4 that divides 480 (4, 8, 12, 24, ...)');
  }
  try {
    timeGrid(settings.ticksPerQuarter ?? TPB, settings.meter ?? { num: settings.beatsPerBar ?? 4, den: 4 });
  } catch (e) {
    throw new RequestError(`settings: ${(e as Error).message}`);
  }
  const f = generateFugue(subject, settings);
  const opts: ReportOptions = { ...reportOptions(r.report === undefined ? {} : obj(r.report, 'report')), ticksPerBeat: f.ticksPerQuarter, meter: f.meter, keys: f.keys };
  const issues = voiceLeadingReport(f.notes, opts);
  const files: OutputFile[] = [];
  if (typeof r.midi === 'string' && r.midi) {
    const bpm = r.bpm === undefined ? 72 : int(r.bpm, 'bpm', 1);
    files.push({ path: r.midi, data: writeMidi(f.voices.map((v, i) => ({ name: v.name, notes: f.notes[i], channel: i })), bpm, f.meter, f.ticksPerQuarter) });
  }
  return {
    json: {
      ticksPerBeat: f.ticksPerQuarter,
      keyName: keyName(f.key),
      ...f,
      report: summarizeReport(issues, f.length, f.grid.bar),
      issues,
      /** Hard mode: how many steps had to relax a hard rule (0 in soft mode); each is in `relaxations` with its bar and beat. */
      hardRelaxations: f.relaxations.length,
    },
    files,
  };
}

/**
 * {voices: Note[][], ticksPerBeat?, meter? | beatsPerBar?, strongEvery?, classify?, suspensions?, key? | keys?} → issues and per-bar summary.
 * meter ("6/8" or {num, den}) sets the bar and the strong beats; beatsPerBar counts quarters and is ignored with a meter.
 */
export function reportCommand(req: unknown): CommandResult {
  const r = obj(req, 'request');
  if (!Array.isArray(r.voices) || r.voices.length < 2) throw new RequestError('voices must be an array of at least two note arrays');
  const opts = reportOptions(r);
  const tpb = opts.ticksPerBeat ?? TPB;
  const beatsPerBar = r.beatsPerBar === undefined ? 4 : int(r.beatsPerBar, 'beatsPerBar', 1);
  const bar = meterTicks(tpb, { meter: opts.meter, beatsPerBar }).bar;
  let trimmed = 0;
  const voices = r.voices.map((v, i) => {
    const line = notes(v, `voices[${i}]`);
    const sorted = sortNotes(line);
    for (let k = 1; k < sorted.length; k++) if (noteEnd(sorted[k - 1]) > sorted[k].start) trimmed++;
    return makeMonophonic(line);
  });
  const length = Math.max(0, ...voices.flat().map(noteEnd));
  const issues = voiceLeadingReport(voices, { ...opts, beatsPerBar });
  return {
    json: { summary: summarizeReport(issues, length, bar), issues, overlapsTrimmed: trimmed },
    files: [],
  };
}

/** {subject, key?, type?: 'real'|'tonal', mutation?} → the answer the engine would write. */
export function answerCommand(req: unknown): CommandResult {
  const r = obj(req, 'request');
  const subject = notes(r.subject, 'subject');
  if (subject.length === 0) throw new RequestError('subject is empty');
  const type = (r.type ?? 'tonal') as AnswerType;
  if (type !== 'real' && type !== 'tonal') throw new RequestError('type must be "real" or "tonal"');
  const analysis = analyzeSubject(makeMonophonic(subject), key(r.key));
  const mutation = r.mutation === undefined || r.mutation === null ? analysis.autoMutation : int(r.mutation, 'mutation', 0);
  const answer = makeAnswer(subject, analysis.key, type, mutation);
  return {
    json: { key: analysis.key, keyName: keyName(analysis.key), type, mutation, head: answer.head, notes: answer.notes, warnings: analysis.warnings },
    files: [],
  };
}

export const COMMANDS: Record<string, (req: unknown) => CommandResult> = {
  generate: generateCommand,
  report: reportCommand,
  answer: answerCommand,
};
