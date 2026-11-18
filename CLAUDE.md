# Fugue Lab — notes for Claude Code

A web app that turns a user-written fugue subject into a fugue. The current
prototype generates the **exposition** (plus an optional codetta and closing
cadence). A published single-file build of it exists as a claude.ai artifact.

## Research

Fugue Lab is also the base for a possible paper on subject-conditioned fugue
expositions. Read `docs/RESEARCH.md` (plan, metrics, milestones) and
`docs/decisions.md` (decisions with reasons; add an entry rather than
reversing one silently) before research-related work. Tick off items in
RESEARCH.md's "Engine prerequisites" when they land.

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
  harmony.ts           planHarmony: chord per beat from the fixed voices (DP), chordLookup
  counterpoint.ts      generateLine (beam search) + complementaryRhythm
  fugue.ts             generateFugue(subject, settings) → FugueResult (exposition planner/renderer)
  report.ts            voiceLeadingReport(voices, opts): parallels, classified strong-beat
                       dissonances, crossings; summarizeReport → counts per bar
  midi.ts              SMF type-1 writer
  engine.test.ts
src/cli/               fugue-cli: the engine as JSON in / JSON out (not part of build-single)
  commands.ts          generate / report / answer handlers, pure and tested (cli.test.ts)
  fugue-cli.ts         argv + stdin/file I/O, --jsonl batch mode, --pretty
  node.d.ts            minimal Node typings (tsconfig has "types": []); delete if @types/node is added
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
  tones, triad fit on strong beats. Treated strong-beat dissonances (prepared
  suspension → step down, retardation → step up, ornamented suspension → one
  decoration then step down; accented passing tone; chordal seventh → step down)
  get a reward from `DissonanceRewards` instead of the 16–30 penalty. The waived
  penalty rides on the beam node as an `Obligation` (and `fixedSusp` for a fixed
  voice's suspension) and is charged if the resolution doesn't come, plus
  `RESOLVE_INTO_DISSONANCE` if it lands on a dissonance. Rewards are per texture
  (`TEXTURE_REWARDS` in fugue.ts), tuned to Bach's 4/4 openings; see
  docs/decisions.md before changing them. `contexts` holds *alternative* textures the
  line must satisfy at once (the countersubject uses subject + answer);
  `invertible` makes 4ths/5ths count as dissonant.
- 4 voices only: `planHarmony` picks a chord per beat for each entry from the
  fixed voices (entry + countersubject) before the free voices are written;
  `generateLine` gets it as `chordAt` (on-beat pull to chord tones, bonus for
  tones nobody has yet). Free voices are then written most-constrained first
  (nearest a fixed voice) and all but the last are rewritten once they can hear
  the others. The skeleton is returned as `FugueResult.harmony`; the UI does
  not draw it yet.
- Countersubject is generated once against the subject (time 0, tonic), then
  transposed (+7 for answer entries) and octave-placed above/below the entry.

## Known weaknesses (good first tasks)

1. 4-voice texture, last entry: the remaining strong-beat dissonances are
   mostly free voice vs countersubject and free voice vs entry (about 0.95
   unprepared ones per fugue with suspensions told apart; 2.7 before the harmonic
   skeleton, 1.2 before suspensions). The skeleton is planned
   from fixed voices only and ignores register/inversion; a joint beam search
   over the free voices, or letting the countersubject shift octave per beat
   group, would be the next step. 2- and 3-voice textures do not use the skeleton.
2. ~~No suspensions~~ (done: suspensions, retardations, ornamented suspensions,
   accented passing tones and chordal sevenths are rewarded and calibrated against
   Bach). Still open: neighbour tones and escape tones are not rewarded (the
   engine writes fewer neighbours than Bach), and resolved chordal sevenths are
   labelled by their melodic shape in the report, so its `chordalSeventh` rate stays
   near 0.
3. Tonal answer only handles a ^1/^5 head. Subjects that modulate to V need a
   tail mutation too; let the user drag the mutation marker in the roll.
4. The countersubject can clash with the tonal head when the head is long.
5. Generation runs on the main thread (~25 ms for 3 voices, ~50 ms for 4, since
   the treated-dissonance obligations fill the beam). Move to a Web Worker when
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

## CLI and the report as a metric

`npm run cli -- <generate|report|answer> [file|-] [--jsonl]`. Notes are integer-tick
`{pitch, start, dur}`; `generate` is on the 16th grid, `report` takes `ticksPerBeat`,
`beatsPerBar` and `strongEvery` so imported music (e.g. voice-separated Bach) can be
measured at its own resolution.

Strong-beat dissonances are classified by default, first rule wins, trying either
voice of the pair. "Beat" below is `max(strongEvery, ticksPerBeat)`.

- Prepared (same pitch held or re-struck from a consonance with the other voice):
  `suspension` (next note directly a step down within two beats),
  `ornamentedSuspension` (one decorating note of any pitch, then the step down, within
  three beats; checked before retardation, so C–D–B is a decorated 7–6),
  `retardation` (next note directly a step up within two beats).
- Struck on the beat, next note within two beats: `passingTone` (step in, step on the
  same way), `neighbourTone` (step in, step back to the same pitch), both allowing a rest
  of up to an eighth (`ticksPerBeat / 2`) on either side; then, with notes joined
  directly, `appoggiatura` (leap in, step out), `escapeTone` (step in, leap out the
  other way), `anticipation` (left by repeating the pitch, approached any way).
- Texture: `pedalPoint` (either voice holds its pitch for at least a bar of
  `beatsPerBar`, default 4; joined re-strikes count as held), `chordalSeventh` (3+
  distinct pitch classes sounding, all in one maj7/dom7/min7/ø7/°7 chord).
- Else `unexplainedDissonance`, the error metric.

Resolution consonance is not checked. `classify: false` gives the old report:
everything is `strongDissonance`, or `suspension` too with `suspensions: true`; the
4-voice quality test and the UI chip use it so their bounds keep their meaning. Not
recognized yet: cambiatas, double neighbours, resolutions delayed by more than one
note, and 4ths against the bass (P4 is treated as consonant everywhere).

## Checks before committing

`npm run typecheck && npm test`, and `npm run build:single` if the artifact build matters.
The test "generated parts avoid parallel fifths and octaves" is the quality
guard — don't loosen it to make a change pass.
The default branch is main (tracking origin/main). Merge finished work into main; never create a master branch.
