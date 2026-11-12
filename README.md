# Fugue Lab

Write a fugue subject on a piano roll and hear a generated exposition: a real or tonal answer, an invertible countersubject, free counterpoint, links between entries and a closing cadence, for 2–4 voices.

## Run

```bash
npm install
npm run dev        # Vite dev server
npm test           # engine tests (node:test via tsx)
npm run typecheck
npm run build:single   # dist/fugue-lab.html, one self-contained page
```

## How it works

1. **Analyze** the subject: key (Krumhansl–Schmuckler), tonal head / mutation point, range warnings.
2. **Answer**: real = exact transposition up a fifth; tonal = ^1↔^5 swap inside the head, exact after the mutation point.
3. **Countersubject**: beam search over a rhythm that complements the subject, scored against the subject *and* the answer, treating 4ths and 5ths as dissonant so it inverts at the octave.
4. **Exposition**: entries in the chosen order; the voice that just finished takes the countersubject, earlier voices get free counterpoint, gaps between entries get links, then a tonic cadence.
5. **Report**: counts parallels, strong-beat dissonances and crossings.

See `CLAUDE.md` for architecture and the roadmap.
