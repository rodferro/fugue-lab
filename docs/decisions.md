# Decision log

One entry per decision, newest last. Change a decision by adding a new entry
that supersedes it, not by editing the old one.

## 2026-11-16

- **No new version of the app; research goes in a separate Python repo (name TBD).**
  The app needs to stay working while experimental models are not yet good;
  research code (data, training, eval) changes constantly and lives in Python.
- **The engine stays in TypeScript.** It runs in the browser with no server and
  powers the single-file build. Porting would duplicate ~1,400 tested lines and
  split the baseline from the app. The engine is reached from Python through
  `fugue-cli` (JSON / JSONL over a subprocess).
- **Hybrid scoring will use ONNX.** Beam search calls the scorer per candidate,
  too often for a subprocess bridge. Train in Python, export to ONNX, run it in
  TS (`onnxruntime-node` / `onnxruntime-web`). Port only `generateLine` to
  Python, and only if profiling shows the bridge is the bottleneck.
- **Suspension detection in the report is opt-in** (`suspensions: true`). The
  default stays unchanged, so the generator's quality tests keep counting every
  strong-beat dissonance; the research metric turns it on.
- **Paper scope: expositions only.** Episodes, middle entries and stretto come later.
- **Beat-based tokens for the learned model.** This addresses the rhythm weakness
  LakhNES reported.
- **CLI uses a minimal `src/cli/node.d.ts` instead of `@types/node`.** This keeps
  the repo free of new dependencies (`tsconfig` sets `"types": []`). Delete the
  shim if `@types/node` is ever added.
- **Workflow: code in Claude Code, research and writing in chat.** Shared state
  lives in the repo (`CLAUDE.md`, `docs/RESEARCH.md`, this file). Commit before
  switching between them.

- **The 4-voice quality test reports with `suspensions: true`** (refines the
  opt-in entry above; the report default stays off). The generator now writes
  prepared suspensions on purpose, so counting them as strong-beat dissonances
  would fail the test for the intended behaviour. The test counts unprepared
  dissonances instead (bound tightened from < 2 to < 1.5 per fugue), and a new
  test requires every generated suspension to resolve to a consonance, at
  0.1–0.8 per bar. The parallel-fifths/octaves guard is unchanged.
- **Suspension reward is hand-set** (`SUSP_REWARD = 1`, `SUSP_AGAINST_REWARD = 0.5`
  in `counterpoint.ts`). Larger rewards flood the texture (1.5 gave about 0.7
  suspensions per bar in 4 voices); calibrate against Bach's rate once the
  reference numbers exist (milestone 3).

## 2026-11-17

- **Research repo is `fugue-research`** (sibling of fugue-lab). Its data
  pipeline is stdlib-only Python (its own MIDI reader), so it runs anywhere
  without setup; training dependencies come later as an optional extra.
- **Ingest grid: 24 ticks per quarter.** That is exact for 32nds, 16th-note
  triplets and compound meters; quantization error is recorded per piece.
- **Reference rates check strong points on the meter's beat** (half notes in
  2/2, dotted quarters in 12/8), with `--beat quarter` to match the engine's
  every-quarter check. Rates are reported per bar and per bar per voice pair,
  since pieces with more voices have more pairs that can go wrong.
- **MIDI export header fixed.** `writeMidi` wrote an 8-byte header that read as
  0 tracks at 4 ticks per quarter, so standard readers rejected exported files
  or played them about 120× too slowly. Found by the fugue-research round-trip
  test; covered now by an engine test.
- **MCMA is read as MusicXML and fugues are picked by metadata title.** MCMA
  ships `.mxl`, not MIDI. Its editors renumber `<voice>` inside a part, so
  voices are chosen per measure (keep the only voice; where two sound at once,
  keep the part's dominant one).
- **First reference rates (fugue-research `results/2026-11-17-first-reference-rates.md`).**
  The 4-voice suspension rate already matches Bach's openings (0.53 per bar),
  so `SUSP_REWARD = 1` stays for now. 3 voices are low (0.27 vs 0.40).
- **"Strong-beat dissonance" is not yet an error metric.** Bach scores 5–10×
  the engine because the report counts chordal sevenths, accented passing
  tones and appoggiaturas. Classify strong-beat dissonances in the report
  before using it as the paper's violation rate, and don't tune the engine
  toward fewer of them until then.

## 2026-11-18

- **The report classifies strong-beat dissonances by default** (supersedes the
  2026-11-16 "suspension detection is opt-in" entry; answers the 2026-11-17
  "not yet an error metric" entry). Kinds, first rule wins: `suspension`,
  `passingTone`, `neighbourTone`, `appoggiatura`, `chordalSeventh`,
  `unexplainedDissonance`. Only `unexplainedDissonance` is the paper's
  violation rate; the others are style rates to compare with Bach.
  `classify: false` keeps the old `strongDissonance` (+ `suspensions`) output,
  and the 4-voice quality test and the UI use it so their bounds stay
  meaningful.
- **Melodic rules before the chord rule.** A dissonance explained by its line
  (suspension, passing, neighbour, appoggiatura) is reported as such even if
  the sonority also fits a seventh chord: the voice leading is the more
  specific explanation, and the chord rule is the loosest one.
- **Chordal seventh needs 3+ distinct pitch classes**, all inside one maj7,
  dom7, min7, half-diminished or diminished seventh chord on any root. Two
  notes alone always fit some seventh chord, so they would explain every
  2-voice dissonance. A diminished triad counts (a seventh chord without its
  root). The report knows no key, so chords are not checked for being diatonic.
- **No resolution-consonance check** for any kind, matching the suspension
  rule; the engine's own tests check resolutions where it matters. Revisit if
  Bach rates show too much landing in the explained classes.
- **Generator, for reference** (4 examples × 20 seeds, per bar, 2/3/4 voices):
  unexplained 0 / 0.002 / 0.013; suspension 0.09 / 0.27 / 0.53; neighbour
  0.03 / 0.03 / 0.06; passing 0 / 0.004 / 0.02; appoggiatura 0 / 0.01 / 0.01;
  chordal seventh 0 / 0 / 0.004. Classified totals equal the old
  `strongDissonance` counts exactly.
- **fugue-research picks the new kinds up as-is** (it iterates over the
  summary's counts), but its `strongDissonance` column is now always 0. Pass
  `classify: false` there to reproduce the 2026-11-17 reference rates.
