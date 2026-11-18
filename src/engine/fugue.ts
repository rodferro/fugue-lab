// Exposition planner and renderer: places subject/answer entries, the
// countersubject, free counterpoint, links between entries and a closing cadence.
import { Note, Role, TPB, VNote, VOICE_SETS, VoiceDef, lengthOf, makeMonophonic, noteEnd, shiftTime, sortNotes, transpose } from './model';
import { Key, KeySpan, dominantOf, sameKey, tonicTriad } from './theory';
import { SubjectAnalysis, analyzeSubject } from './analyze';
import { Answer, AnswerType, makeAnswer } from './answer';
import { DissonanceRewards, Relation, Slot, complementaryRhythm, generateLine } from './counterpoint';
import { Rng, makeRng } from './rng';
import { Chord, SkeletonBeat, chordLookup, planHarmony } from './harmony';

/**
 * Rewards for treated strong-beat dissonances, per number of voices (see
 * DissonanceRewards in counterpoint.ts). 2-3 voices: tuned to Bach's 4/4 fugue
 * openings. 4 voices: tuned on the development split of fugue-research's
 * held-out test (WTC II + Art of Fugue), checked on WTC I. Values and reasons
 * in docs/decisions.md.
 */
export const TEXTURE_REWARDS: Record<2 | 3 | 4, Partial<DissonanceRewards>> = {
  // Thinner textures need more pull to write as many suspensions and passing tones per bar.
  2: { suspension: 4, ornamentedSuspension: 5.7, retardation: 0.6, passingTone: -1, chordalSeventh: 1 },
  3: { suspension: 4, ornamentedSuspension: 5.7, retardation: 0.6, passingTone: -1, chordalSeventh: 1 },
  4: { suspension: 3.6, ornamentedSuspension: 6.3, retardation: -1.2, passingTone: -2.2, chordalSeventh: 1 },
};

export interface FugueSettings {
  voices: 2 | 3 | 4;
  /** null = detect from the subject */
  key: Key | null;
  answerType: AnswerType;
  /** Where the answer sits relative to the subject before fitting voice ranges. */
  answerInterval: 'fifthUp' | 'fourthDown';
  /** Number of head notes that get the tonal mapping; null = automatic. */
  mutation: number | null;
  /** Voice indices (0 = top) in order of entry; null = automatic. */
  entryOrder: number[] | null;
  countersubject: boolean;
  /** Extra bars of free material after the answer (3+ voices). */
  codettaBars: number;
  cadence: boolean;
  /** End a minor-key fugue on a major chord. */
  picardy: boolean;
  beatsPerBar: number;
  seed: number;
  /** Overrides for the texture's dissonance rewards (TEXTURE_REWARDS); for tuning experiments. */
  rewards?: Partial<DissonanceRewards>;
}

export const DEFAULT_SETTINGS: FugueSettings = {
  voices: 3,
  key: null,
  answerType: 'tonal',
  answerInterval: 'fifthUp',
  mutation: null,
  entryOrder: null,
  countersubject: true,
  codettaBars: 0,
  cadence: true,
  picardy: true,
  beatsPerBar: 4,
  seed: 1,
};

export interface Entry {
  index: number;
  voice: number;
  role: 'subject' | 'answer';
  start: number;
  end: number;
  key: Key;
}

export interface Section {
  start: number;
  end: number;
  label: string;
}

export interface FugueResult {
  voices: VoiceDef[];
  /** Notes per voice, index 0 = top voice. */
  notes: VNote[][];
  entries: Entry[];
  sections: Section[];
  analysis: SubjectAnalysis;
  key: Key;
  answer: Answer;
  mutation: number;
  order: number[];
  /** Countersubject as generated against the subject (tonic, time 0). */
  countersubject: Note[] | null;
  length: number;
  beatsPerBar: number;
  /** Chord per beat that the free voices were written to (4 voices only; otherwise empty). */
  harmony: SkeletonBeat[];
  /**
   * The key plan the voices were written in, as spans: each entry's key while
   * the subject or answer sounds, then the next entry's key, the tonic for
   * the cadence. Pass it to voiceLeadingReport (`keys`) so the report spells
   * intervals the way the generator did.
   */
  keys: KeySpan[];
}

function outOfRange(notes: Note[], range: [number, number]): number {
  let c = 0;
  for (const n of notes) c += Math.max(0, range[0] - n.pitch) + Math.max(0, n.pitch - range[1]);
  return c;
}

/** Octave shift (in semitones, relative to `base`) that best fits notes into a range. */
export function fitShift(notes: Note[], range: [number, number], base = 0): number {
  let best = base;
  let bestCost = Infinity;
  for (let k = -3; k <= 3; k++) {
    const shift = base + 12 * k;
    const cost = outOfRange(transpose(notes, shift), range) + 0.4 * Math.abs(k);
    if (cost < bestCost) { bestCost = cost; best = shift; }
  }
  return best;
}

/** Start with the voice the subject was written for, then move to the nearest unused voice. */
export function defaultOrder(subject: Note[], voices: VoiceDef[]): number[] {
  const mean = subject.reduce((s, n) => s + n.pitch, 0) / Math.max(1, subject.length);
  let first = 0;
  let bestCost = Infinity;
  voices.forEach((v, i) => {
    const cost = outOfRange(subject, v.range) * 10 + Math.abs(mean - (v.range[0] + v.range[1]) / 2);
    if (cost < bestCost) { bestCost = cost; first = i; }
  });
  const order = [first];
  while (order.length < voices.length) {
    const last = order[order.length - 1];
    let pick = -1;
    for (let i = 0; i < voices.length; i++) {
      if (order.includes(i)) continue;
      if (pick < 0 || Math.abs(i - last) < Math.abs(pick - last) || (Math.abs(i - last) === Math.abs(pick - last) && i > pick)) pick = i;
    }
    order.push(pick);
  }
  return order;
}

function validOrder(order: number[] | null, n: number): order is number[] {
  return !!order && order.length === n && new Set(order).size === n && order.every((v) => v >= 0 && v < n);
}

export function generateFugue(input: Note[], settings: Partial<FugueSettings> = {}): FugueResult {
  const s: FugueSettings = { ...DEFAULT_SETTINGS, ...settings };
  const rng: Rng = makeRng(s.seed);
  const subject = sortNotes(makeMonophonic(input));
  const analysis = analyzeSubject(subject, s.key ?? undefined);
  const key = analysis.key;
  const dom = dominantOf(key);
  const mutation = s.mutation ?? analysis.autoMutation;
  const answer = makeAnswer(subject, key, s.answerType, mutation);
  const voices = VOICE_SETS[s.voices];
  const n = voices.length;
  const order = validOrder(s.entryOrder, n) ? s.entryOrder : defaultOrder(subject, voices);
  const bar = TPB * s.beatsPerBar;
  const subLen = Math.max(1, lengthOf(subject));
  const blockLen = Math.ceil(subLen / bar) * bar;
  const notes: VNote[][] = voices.map(() => []);
  const fixed: VNote[][] = voices.map(() => []);

  const add = (v: number, ns: Note[], role: Role, isFixed = false) => {
    for (const x of ns) {
      const vn: VNote = { ...x, role, voice: v };
      notes[v].push(vn);
      if (isFixed) fixed[v].push(vn);
    }
  };

  // 1. Entries.
  const entries: Entry[] = [];
  const entryShift: number[] = [];
  let t = 0;
  for (let k = 0; k < n; k++) {
    const role = k % 2 === 0 ? 'subject' : 'answer';
    const base = role === 'subject' ? subject : answer.notes;
    const v = order[k];
    const shift = fitShift(base, voices[v].range, role === 'answer' && s.answerInterval === 'fourthDown' ? -12 : 0);
    entryShift.push(shift);
    const len = blockLen + (k === 1 && n > 2 ? s.codettaBars * bar : 0);
    entries.push({ index: k, voice: v, role, start: t, end: t + len, key: role === 'subject' ? key : dom });
    add(v, shiftTime(transpose(base, shift), t), role, true);
    t += len;
  }
  const expEnd = t;

  // 2. Countersubject: written once against subject and answer, then placed.
  let cs0: Note[] | null = null;
  if (s.countersubject && n >= 2) {
    const mean = Math.round(subject.reduce((a, x) => a + x.pitch, 0) / subject.length);
    const range: [number, number] = [mean + 1, mean + 17];
    const slots = complementaryRhythm([subject], 0, subLen, s.beatsPerBar, rng, { leadRest: 2, endLong: true });
    cs0 = generateLine(
      {
        slots,
        range,
        keyAt: () => key,
        contexts: [[subject], [transpose(answer.notes, -7)]],
        relations: [['above'], ['above']],
        invertible: true,
        beatsPerBar: s.beatsPerBar,
        rewards: { ...TEXTURE_REWARDS[n as 2 | 3 | 4], ...s.rewards },
        beam: 160,
      },
      rng,
    );
    for (let k = 1; k < n; k++) {
      const e = entries[k];
      const c = order[k - 1];
      const base = transpose(e.role === 'answer' ? transpose(cs0, 7) : cs0, entryShift[k]);
      const entryNotes = fixed[e.voice].filter((x) => x.start >= e.start && x.start < e.end);
      const wantAbove = c < e.voice;
      let best = 0;
      let bestCost = Infinity;
      for (const sh of [0, -12, -24, 12, -36]) {
        const cand = shiftTime(transpose(base, sh), e.start);
        let cost = outOfRange(cand, voices[c].range);
        for (const x of cand) {
          const under = entryNotes.find((y) => y.start <= x.start && noteEnd(y) > x.start);
          if (under && (wantAbove ? x.pitch <= under.pitch : x.pitch >= under.pitch)) cost += 3;
        }
        if (cost < bestCost) { bestCost = cost; best = sh; }
      }
      add(c, shiftTime(transpose(base, best), e.start), 'countersubject', true);
    }
  }

  const sounding = (v: number, a: number, b: number): Note[] => notes[v].filter((x) => x.start < b && noteEnd(x) > a);
  const lastPitchBefore = (v: number, at: number): number | undefined => {
    let best: VNote | undefined;
    for (const x of notes[v]) if (x.start < at && (!best || x.start > best.start)) best = x;
    return best?.pitch;
  };
  const nextFixedPitch = (v: number, at: number): number | undefined => {
    const x = fixed[v].filter((y) => y.start >= at && y.start < at + bar).sort((a, b) => a.start - b.start)[0];
    return x?.pitch;
  };

  // Harmonic skeleton, planned per entry from the fixed voices before any free
  // voice is written. With two or more free voices this keeps the later ones
  // from being boxed in by whatever the earlier ones happened to choose.
  const useSkeleton = n >= 4;
  const harmony: SkeletonBeat[] = [];
  let chordAt: ((tick: number) => Chord | undefined) | undefined;
  const planSkeleton = (a: number, b: number, keyAt: (t: number) => Key, closeOn: Key) => {
    if (!useSkeleton || b <= a) return;
    harmony.push(...planHarmony(fixed, a, b, keyAt, s.beatsPerBar, { before: harmony[harmony.length - 1]?.chord, closeOn }));
    chordAt = chordLookup(harmony);
  };

  const writeLine = (v: number, a: number, b: number, keyAt: (t: number) => Key, role: Role, slots?: Slot[], allowedPcs?: number[]) => {
    if (b <= a) return;
    const others: Note[][] = [];
    const rel: (Relation | undefined)[] = [];
    for (let j = 0; j < n; j++) {
      if (j === v) continue;
      others.push(sounding(j, a - 1, b));
      rel.push(j < v ? 'below' : 'above');
    }
    const sl = slots ?? complementaryRhythm(others, a, b, s.beatsPerBar, rng, { endLong: role === 'link' });
    const line = generateLine(
      {
        slots: sl,
        range: voices[v].range,
        keyAt,
        contexts: [others],
        relations: [rel],
        startPitch: lastPitchBefore(v, a),
        targetPitch: nextFixedPitch(v, b),
        allowedPcs,
        chordAt: allowedPcs ? undefined : chordAt,
        beatsPerBar: s.beatsPerBar,
        rewards: { ...TEXTURE_REWARDS[n as 2 | 3 | 4], ...s.rewards },
      },
      rng,
    );
    add(v, line, role);
  };

  // 3. Free counterpoint and links, in time order.
  const keys: KeySpan[] = [];
  const keyFrom = (start: number, k: Key) => {
    if (!keys.length || !sameKey(keys[keys.length - 1].key, k)) keys.push({ start, key: k });
  };
  for (let k = 0; k < n; k++) {
    const e = entries[k];
    const subEnd = e.start + subLen;
    const nextKey = k + 1 < n ? entries[k + 1].key : key;
    keyFrom(e.start, e.key);
    keyFrom(subEnd, nextKey);
    const keyAt = (tt: number) => (tt < subEnd ? e.key : nextKey);
    const csVoice = s.countersubject && k > 0 ? order[k - 1] : -1;
    const free = order.slice(0, k).filter((v) => v !== csVoice).sort((a, b) => a - b);
    planSkeleton(e.start, e.end, keyAt, nextKey);
    if (useSkeleton) {
      // Most constrained first: a free voice next to (or between) fixed voices
      // has the least room, so it chooses before the others close in on it.
      const fixedVoices = [e.voice, csVoice].filter((v) => v >= 0);
      const room = (v: number) => Math.min(...fixedVoices.map((f) => Math.abs(f - v)));
      free.sort((x, y) => room(x) - room(y) || x - y);
    }
    for (const v of free) writeLine(v, e.start, e.end, keyAt, 'free');
    if (useSkeleton && free.length > 1) {
      // The first free voice was written without knowing the others; redo it now that it can hear them.
      for (const v of free.slice(0, -1)) {
        const old = notes[v].filter((x) => x.role === 'free' && x.start >= e.start && x.start < e.end);
        notes[v] = notes[v].filter((x) => !old.includes(x));
        writeLine(v, e.start, e.end, keyAt, 'free', old.map(({ start, dur }) => ({ start, dur })));
      }
    }
    const linkers = [e.voice, csVoice].filter((v) => v >= 0).sort((a, b) => a - b);
    for (const v of linkers) writeLine(v, subEnd, e.end, () => nextKey, 'link');
  }

  // 4. Closing cadence on the tonic chord, bass first.
  const sections: Section[] = [{ start: 0, end: expEnd, label: 'Exposition' }];
  if (n > 2 && s.codettaBars > 0) sections.push({ start: entries[1].start + blockLen, end: entries[1].end, label: 'Codetta' });
  let length = expEnd;
  keyFrom(expEnd, key);
  if (s.cadence) {
    const triad = tonicTriad(key, s.picardy && key.mode === 'minor');
    for (let v = n - 1; v >= 0; v--) {
      writeLine(v, expEnd, expEnd + bar, () => key, 'cadence', [{ start: expEnd, dur: bar }], v === n - 1 ? [key.tonic] : triad);
    }
    sections.push({ start: expEnd, end: expEnd + bar, label: 'Cadence' });
    length += bar;
  }

  return {
    voices,
    notes: notes.map((ns) => sortNotes(ns)),
    entries,
    sections,
    analysis,
    key,
    answer,
    mutation,
    order,
    countersubject: cs0,
    length,
    beatsPerBar: s.beatsPerBar,
    harmony,
    keys,
  };
}
