// Request handlers for fugue-cli: plain objects in, plain objects out, no I/O,
// so they can be tested directly. See fugue-cli.ts for the command line.
import { Note, TPB, VOICE_SETS, makeMonophonic, noteEnd, sortNotes } from '../engine/model';
import { Key, keyName } from '../engine/theory';
import { analyzeSubject } from '../engine/analyze';
import { AnswerType, makeAnswer } from '../engine/answer';
import { FugueSettings, generateFugue } from '../engine/fugue';
import { writeMidi } from '../engine/midi';
import { ReportOptions, summarizeReport, voiceLeadingReport } from '../engine/report';

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

function reportOptions(o: Obj): ReportOptions {
  const out: ReportOptions = {};
  if (o.ticksPerBeat !== undefined) out.ticksPerBeat = int(o.ticksPerBeat, 'ticksPerBeat', 1);
  if (o.strongEvery !== undefined) out.strongEvery = int(o.strongEvery, 'strongEvery', 1);
  if (o.classify !== undefined) out.classify = o.classify !== false;
  if (o.suspensions !== undefined) out.suspensions = o.suspensions === true;
  return out;
}

/** {subject, settings?, midi?, bpm?, report?: ReportOptions} → the generated exposition plus its report summary. */
export function generateCommand(req: unknown): CommandResult {
  const r = obj(req, 'request');
  const subject = notes(r.subject, 'subject');
  if (subject.length === 0) throw new RequestError('subject is empty');
  const settings = (r.settings === undefined ? {} : obj(r.settings, 'settings')) as Partial<FugueSettings>;
  if (settings.voices !== undefined && !(settings.voices in VOICE_SETS)) throw new RequestError('settings.voices must be 2, 3 or 4');
  if (settings.key !== undefined) settings.key = key(settings.key) ?? null;
  const f = generateFugue(subject, settings);
  const opts = reportOptions(r.report === undefined ? {} : obj(r.report, 'report'));
  const issues = voiceLeadingReport(f.notes, opts);
  const files: OutputFile[] = [];
  if (typeof r.midi === 'string' && r.midi) {
    const bpm = r.bpm === undefined ? 72 : int(r.bpm, 'bpm', 1);
    files.push({ path: r.midi, data: writeMidi(f.voices.map((v, i) => ({ name: v.name, notes: f.notes[i], channel: i })), bpm, f.beatsPerBar) });
  }
  return {
    json: {
      ticksPerBeat: TPB,
      keyName: keyName(f.key),
      ...f,
      report: summarizeReport(issues, f.length, TPB * f.beatsPerBar),
      issues,
    },
    files,
  };
}

/** {voices: Note[][], ticksPerBeat?, beatsPerBar?, strongEvery?, classify?, suspensions?} → issues and per-bar summary. */
export function reportCommand(req: unknown): CommandResult {
  const r = obj(req, 'request');
  if (!Array.isArray(r.voices) || r.voices.length < 2) throw new RequestError('voices must be an array of at least two note arrays');
  const opts = reportOptions(r);
  const tpb = opts.ticksPerBeat ?? TPB;
  const beatsPerBar = r.beatsPerBar === undefined ? 4 : int(r.beatsPerBar, 'beatsPerBar', 1);
  let trimmed = 0;
  const voices = r.voices.map((v, i) => {
    const line = notes(v, `voices[${i}]`);
    const sorted = sortNotes(line);
    for (let k = 1; k < sorted.length; k++) if (noteEnd(sorted[k - 1]) > sorted[k].start) trimmed++;
    return makeMonophonic(line);
  });
  const length = Math.max(0, ...voices.flat().map(noteEnd));
  const issues = voiceLeadingReport(voices, opts);
  return {
    json: { summary: summarizeReport(issues, length, tpb * beatsPerBar), issues, overlapsTrimmed: trimmed },
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
