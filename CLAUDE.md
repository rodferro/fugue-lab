# Fugue Lab — notes for Claude Code

A web app that turns a user-written fugue subject into a fugue. The current
prototype generates the **exposition** (plus an optional codetta and closing
cadence). A published single-file build of it exists as a claude.ai artifact.

## Stack

- TypeScript, Vite, no UI framework (plain DOM + Canvas 2D). No runtime dependencies.
- Audio: Web Audio, synthesized instruments in `src/app/audio.ts` (no samples).
- Tests: `node:test` + `node:assert`, run with `tsx` (`npm test`).
- `scripts/build-single.mjs` builds `dist/fugue-lab.html` without a bundler by
  transpiling each file and concatenating them with imports/exports stripped.
  **Consequence: top-level names must be unique across all files in its list**,
  and new files must be added to that list in dependency order. If you add
  `vite-plugin-singlefile` later, this script can go.

## Layout

```
src/engine/            pure TS, no DOM — keep it that way (reusable in a worker/CLI)
  model.ts             Note {pitch MIDI, start, dur} in ticks (TPB = 4 → 16th grid), VNote, voice sets/ranges
  theory.ts            Key, scales, ScalePitch (degree/oct/acc), diatonicShift, chordsOf, names
  analyze.ts           detectKey (KS profiles + first/last-note bias), autoMutation, warnings
  answer.ts            makeAnswer(subject, key, 'real'|'tonal', mutation)
  counterpoint.ts      generateLine (beam search) + complementaryRhythm
  fugue.ts             generateFugue(subject, settings) → FugueResult (exposition planner/renderer)
  report.ts            voiceLeadingReport: parallels, strong-beat dissonances, crossings
  midi.ts              SMF type-1 writer
  engine.test.ts
src/app/               UI
  main.ts              state, form wiring, playback, export, localStorage
  pianoRoll.ts         subject editor (monophonic; edited note wins overlaps)
  fugueView.ts         read-only multi-voice roll with entry band, mute, seek, hover tip
  audio.ts, theme.ts (canvas colors from CSS vars), zip.ts, examples.ts, styles.css
index.html             markup; <!--HEAD/BODY-START/END--> markers are used by build-single
```

## Engine conventions

- Time in ticks (16ths). Pitch is MIDI at the edges; use `toScalePitch` /
  `diatonicShift` when reasoning in degrees. Minor keys allow raised 6/7.
- Voices are indexed top (0) to bottom. `VOICE_SETS[n]` has names and ranges.
- Determinism: everything random goes through the seeded `Rng`. Same subject +
  settings + seed must give identical output (there's a test).
- `generateLine` scoring (in `counterpoint.ts`) is where musical quality lives:
  strong-beat dissonance 22–30, unresolved weak dissonance 15–18, parallel
  perfects 45, crossings 24, melodic costs per interval, minor-key tendency
  tones, triad fit on strong beats. `contexts` holds *alternative* textures the
  line must satisfy at once (the countersubject uses subject + answer);
  `invertible` makes 4ths/5ths count as dissonant.
- Countersubject is generated once against the subject (time 0, tonic), then
  transposed (+7 for answer entries) and octave-placed above/below the entry.

## Known weaknesses (good first tasks)

1. 4-voice texture: free voices are written one at a time, so later voices get
   boxed in (more strong-beat dissonances/crossings). Fix: harmonic skeleton
   first (chord per beat), or a joint beam search over the free voices.
2. No suspensions: a strong-beat dissonance prepared and resolved down by step
   is penalized like any other. Add a suspension rule in `harmonic()`.
3. Tonal answer only handles a ^1/^5 head. Subjects that modulate to V need a
   tail mutation too; let the user drag the mutation marker in the roll.
4. The countersubject can clash with the tonal head when the head is long.
5. Generation runs on the main thread (~30–90 ms). Move to a Web Worker when
   episodes make it slower.

## Roadmap (milestones from the design discussion)

- [x] 1. Piano roll, playback, key detection
- [x] 2. Real and tonal answers, 2-voice exposition
- [x] 3. Countersubject + 3/4-voice exposition
- [~] 4. Export: MIDI done; MusicXML not yet (hand-write it, quantized to the 16th grid)
- [ ] 5. Episodes (sequence head motif / CS fragment through the circle of fifths),
      middle entries in related keys (key plan e.g. I → V → vi → IV → I), stretto
      (precompute a stretto map: offsets/intervals where the subject fits itself),
      final entry over a tonic pedal.
- [ ] Later: entry-order/mutation editing directly on the roll, SoundFont
      instruments, score view (VexFlow or MusicXML preview), undo/redo.

## Checks before committing

`npm run typecheck && npm test`, and `npm run build:single` if the artifact build matters.
The test "generated parts avoid parallel fifths and octaves" is the quality
guard — don't loosen it to make a change pass.
