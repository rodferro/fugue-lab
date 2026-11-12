// Real and tonal answers.
import { Note, sortNotes } from './model';
import { Key, diatonicShift, toScalePitch } from './theory';

export type AnswerType = 'real' | 'tonal';

export interface Answer {
  notes: Note[];
  /** Number of opening notes that received the tonal mapping. */
  head: number;
}

/**
 * Build the answer a fifth above the subject (callers move it by octaves).
 * Tonal: inside the head, ^1 → ^5 and ^5 → ^1 (a fourth instead of a fifth);
 * other head notes move diatonically by a fifth before the first ^5 and by a
 * fourth after it, so the line stays smooth. After the mutation point the
 * answer is an exact transposition into the dominant.
 */
export function makeAnswer(subject: Note[], key: Key, type: AnswerType, mutation: number): Answer {
  const notes = sortNotes(subject);
  const head = type === 'tonal' ? Math.max(0, Math.min(mutation, notes.length)) : 0;
  let pastFifth = false;
  const out = notes.map((n, i) => {
    if (i >= head) return { ...n, pitch: n.pitch + 7 };
    const sp = toScalePitch(n.pitch, key);
    if (sp.deg === 4 && sp.acc === 0) pastFifth = true;
    const steps = sp.deg === 0 ? 4 : sp.deg === 4 ? 3 : pastFifth ? 3 : 4;
    return { ...n, pitch: diatonicShift(n.pitch, steps, key) };
  });
  return { notes: out, head };
}
