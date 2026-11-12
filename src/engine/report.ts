// Voice-leading report over a finished texture: counts the classic errors so
// the UI and the tests can show how clean a result is.
import { Note, TPB, noteEnd } from './model';

export interface Issue {
  kind: 'parallel5' | 'parallel8' | 'strongDissonance' | 'crossing';
  tick: number;
  voices: [number, number];
}

const DISS = new Set([1, 2, 6, 10, 11]);

export function voiceLeadingReport(voices: Note[][]): Issue[] {
  const end = Math.max(0, ...voices.flat().map(noteEnd));
  const grid = voices.map((v) => {
    const g = new Int16Array(end + 1).fill(-1);
    const on = new Uint8Array(end + 1);
    for (const n of v) {
      for (let t = n.start; t < noteEnd(n); t++) g[t] = n.pitch;
      on[n.start] = 1;
    }
    return { g, on };
  });
  const issues: Issue[] = [];
  for (let i = 0; i < voices.length; i++) {
    for (let j = i + 1; j < voices.length; j++) {
      const a = grid[i];
      const b = grid[j];
      for (let t = 1; t < end; t++) {
        const pa = a.g[t], pb = b.g[t];
        if (pa < 0 || pb < 0) continue;
        if (!(a.on[t] || b.on[t])) continue;
        const qa = a.g[t - 1], qb = b.g[t - 1];
        if (qa >= 0 && qb >= 0 && qa !== pa && qb !== pb) {
          const now = Math.abs(pa - pb) % 12;
          const before = Math.abs(qa - qb) % 12;
          if (now === 7 && before === 7) issues.push({ kind: 'parallel5', tick: t, voices: [i, j] });
          if (now === 0 && before === 0) issues.push({ kind: 'parallel8', tick: t, voices: [i, j] });
        }
        if (t % TPB === 0 && DISS.has(Math.abs(pa - pb) % 12)) issues.push({ kind: 'strongDissonance', tick: t, voices: [i, j] });
        if (pa < pb) issues.push({ kind: 'crossing', tick: t, voices: [i, j] });
      }
    }
  }
  return issues;
}
