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
- **Five more dissonance kinds, and rests next to passing/neighbour tones**
  (extends the classification entry above). New kinds: `ornamentedSuspension`
  (prepared; one decorating note of any pitch, then the step down, within three
  beats), `retardation` (prepared; resolves directly up by step within two
  beats), `escapeTone` (struck on the beat; step in, leap of 3+ semitones out
  the other way), `anticipation` (struck on the beat; left by repeating the
  pitch, approached any way), `pedalPoint` (either voice holds its pitch for at
  least a bar). Passing and neighbour tones now allow a rest of up to an eighth
  on either side, kept under their existing kinds rather than new ones, since
  the shape is the same. Appoggiaturas, escape tones and anticipations still
  need their notes joined directly.
- **Precedence: prepared, then shape, then texture.** Suspension, ornamented
  suspension, retardation; passing, neighbour, appoggiatura, escape tone,
  anticipation; pedal point, chordal seventh. Ornamented suspension is checked
  before retardation, so in C–D–B the D is a decoration of a 7–6, not an
  upward resolution. A pedal explains less than the line does, so melodic
  kinds win over it; it wins over chordal seventh because the dissonance is
  against the held note itself.
- **Pedal length needs the bar, so the report takes `beatsPerBar`** (default 4;
  the CLI passes it from the request or the generated fugue). Directly joined
  re-strikes of the same pitch count as one held note, because ties often
  arrive split from MusicXML.
- **The eighth is `ticksPerBeat / 2`.** The report documents `ticksPerBeat` as
  ticks per quarter. fugue-research passes the meter's beat there instead (a
  half note in 2/2), so in 2/2 its rest allowance is a quarter, and the two-
  and three-beat windows are in half notes. Fine for 4/4 and 3/4; revisit
  if the 2/2 and 12/8 rates look off.
- **Generator, for reference** (4 examples × 20 seeds, per bar, 2/3/4 voices):
  unexplained now 0 / 0 / 0.001 (was 0 / 0.002 / 0.013); the new kinds are
  rare (each ≤ 0.011). Totals still equal the old `strongDissonance` counts.
- **The generator rewards five treated-dissonance kinds, with rewards per
  texture tuned to Bach's 4/4 openings** (supersedes "Suspension reward is
  hand-set" and "SUSP_REWARD = 1 stays for now"; targets from fugue-research
  `results/2026-11-18-classifier-v2.md`). `harmonic()` now treats a strong-beat
  dissonance of the line as a suspension (prepared), an accented passing tone
  (struck by step) or a chordal seventh (the line's note is the seventh of a
  3+ pitch-class seventh chord, on the skeleton root when there is one). The
  waived penalty becomes an `Obligation` on the beam node: a suspension is
  resolved by a step down, a step up (retardation) or one decorating note and
  then the step down from the suspended pitch within three beats (ornamented
  suspension); a passing tone by a step on in the same direction; a seventh by
  a step down. Otherwise the debt (waived penalty plus reward) is charged.
  Values (`TEXTURE_REWARDS` in fugue.ts; negative = net cost, still far below
  the 16–30 penalty it replaces):

  | reward | 2 and 3 voices | 4 voices |
  |---|---|---|
  | suspension | 4 | 2.1 |
  | ornamentedSuspension | 5.7 | 3.3 |
  | retardation | 0.6 | −4.2 |
  | passingTone | −1 | −3.7 |
  | chordalSeventh | 1 | 1 |
  | againstSuspension (fixed voice suspended) | 0.5 | 0.5 |

  Result, report per bar, 4 examples × 20 seeds (target in brackets):

  | | 3 voices | 4 voices |
  |---|---|---|
  | suspension (0.55) | 0.525 (was 0.268) | 0.571 (was 0.533) |
  | ornamented suspension (0.15) | 0.150 (0.002) | 0.140 (0.007) |
  | passing tone (0.19) | 0.189 (0.004) | 0.176 (0.022) |
  | retardation (0.05) | 0.037 (0.004) | 0.039 (0.006) |
  | chordal seventh (0.05) | 0 (0) | 0.004 (0) |
  | unexplained (≤ 0.045 / ≤ 0.02) | 0 (0) | 0.003 (0.001) |
  | neighbour (Bach 0.045 / 0.083) | 0.002 | 0.024 |
  | appoggiatura (Bach 0.076 / 0.046) | 0.036 | 0.075 |

  2 voices (no target) use the 3-voice values: suspension 0.23, passing 0.07,
  unexplained 0. Parallels: 1 in 240 fugues over 20 seeds (4 voices); the
  parallel-fifths guard test is unchanged and passes.
- **Why per texture.** One reward set can't fit both: a suspension reward that
  gives Bach's 3-voice rate overshoots 4 voices by about half (0.86 per bar),
  and 3-voice passing tones needed a much smaller net cost (−1 vs −4) to
  appear at all. Uniform rewards flood the texture with passing tones (1.1
  per bar in 4 voices at +1).
- **The chordal-seventh target is not met, by construction.** A seventh that
  resolves down by step always has a melodic shape the report checks first
  (prepared → suspension, step in → passing or neighbour, leap in →
  appoggiatura), so the report labels it that way. The reward does write
  sevenths: in the tuning runs (4 voices, before the resolution surcharge
  below), turning it on took dissonances fitting a seventh chord from 0.42 to
  0.48 per bar, neighbours from 0.042 to 0.069 and appoggiaturas from 0.013 to
  0.029 (both toward Bach's), while `chordalSeventh` went from 0.001 to 0.003. Bach's 0.05–0.07 are
  sevenths with no melodic explanation (left by leap, or after a rest), which
  the resolution rule forbids. Kept at 1; changing the report's precedence or
  the rule is a separate decision.
- **Resolving into another dissonance costs `RESOLVE_INTO_DISSONANCE` = 12
  on top of the debt**, and so does a line note dissonant with a fixed voice
  that resolves a held-over note down by step. Without it about 1% of
  prepared dissonances (10 of 977) resolved against a clash, mostly the
  countersubject's suspension resolving against a free voice's weak-beat
  figure; with it 2 of 939, in the 20-seed sweep, none in the test's seeds.
- **Quality tests follow the classified report.** The 4-voice test now bounds
  `unexplainedDissonance` at ≤ 0.02 per bar (Bach's rate, replacing "< 1.5
  non-suspension dissonances per fugue", which would count the passing tones
  and sevenths written on purpose), and leaves on-beat notes that are treated
  dissonances out of the chord-tone share (still > 0.75). A new test bounds
  3-voice unexplained at ≤ 0.045. The resolution test now also covers
  ornamented suspensions and retardations and requires both to appear.
- **Cost: generation is about 3× slower** (4 voices 17 → 47 ms, 3 voices 9 →
  23 ms), because obligations keep more distinct states in the beam. Still
  within the main-thread budget (CLAUDE.md weakness #5).

## 2026-11-19

- **Vertical intervals are spelled in the key, in the generator and the
  report.** Two forms of one scale degree (same `deg` from `toScalePitch`,
  different `acc`) and augmented or diminished intervals were treated by
  semitone size: C against C♯ in D minor was an 11-semitone "seventh" the
  generator could reward as a suspension, and C♯ over F an 8-semitone "minor
  6th", consonant. Regression (D minor example, 3 voices, defaults): bar 5
  beat 3 had alto C4 against bass C♯3 (rewarded and reported as an ornamented
  suspension), bar 6 beat 2 soprano C♯4 against alto F3 (not reported at all);
  `main` had the same kinds of clash elsewhere in that fugue. Consonant now
  means unison/octave, 3rd (3 or 4 semitones), perfect 4th, perfect 5th or
  6th (8 or 9); anything else, e.g. the diminished 4th C♯–F, the augmented 2nd
  B♭–C♯ and the diminished 7th C♯–B♭, is dissonant. Helpers in `theory.ts`
  (`spelledInterval`, `spelledDissonant`, `chromaticClash`, `KeySpan`,
  `keyAtTick`).
- **Generator: a chromatic clash costs 30 at any tick and is never treated.**
  That is the unprepared downbeat penalty, the largest strong-beat one, and it
  applies on weak ticks too, so a clash can't pass as a passing note. It is
  checked before every reward (suspension, passing, seventh, a fixed voice's
  suspension), counts as a dissonance for resolutions, and is excluded from
  preparation. Spelling uses the slot's `keyAt`, so fixed and free voices are
  spelled in the same key at each moment.
- **Report: `chromaticClash` is checked before all other rules and is an
  error.** `DISSONANCE_ERRORS = ['chromaticClash', 'unexplainedDissonance']`;
  the summary adds `dissonanceErrors` and `dissonanceErrorsPerBar`. The paper's
  violation rate should use those, not `unexplainedDissonance` alone. With
  `classify: false` a clash or an augmented/diminished interval is a plain
  `strongDissonance`, so the old counts grow slightly.
- **The report gets the key from `keys` (spans of `{start, key}`)**, which
  `FugueResult.keys` provides from the generator's own key plan (each entry's
  key while the subject or answer sounds, then the next entry's key, the tonic
  for the cadence). The CLI's `generate` passes it automatically; `report`
  accepts `keys` or a single `key`. **Without keys the report detects one key
  from all the notes** (`detectKey`). That is approximate for modulating
  music: fugue-research should pass a key per piece (or per section) for Bach,
  otherwise passages in other keys are spelled in the home key.
- **Parallels stay semitone-based**, so the parallel-fifths guard measures
  exactly what it did; spelling only changes what counts as dissonant.
- **Effect** (4 examples × 20 seeds, per bar, report with `keys`): chromatic
  clashes 0 at any tick in 2, 3 and 4 voices (a new test checks every tick for
  3 and 4 voices, seeds 1–4); unexplained 0 / 0 / 0; parallels 2 in 240
  fugues, at most 1 per fugue. The rewards were not retuned, and the
  2026-11-18 rates drifted: 3 voices suspension 0.541, ornamented 0.130,
  passing 0.229, retardation 0.032; 4 voices suspension 0.592, ornamented
  0.117, passing 0.172, retardation 0.035. Retune if the drift matters.

## 2026-11-18 (held-out tuning)

- **Development/test split for everything tuned from now on.** fugue-research's
  held-out test (Bach's subjects through the engine) uses WTC II + Art of
  Fugue as the development set and WTC I (validated against Algomus) as the
  test set. Tune on development only; report test.
- **`autoMutation` also mutates an early ^5 leapt to from ^1, in a subject that
  starts on ^1** (C B C G, BWV 847; F E F C, BWV 880). Agreement with Bach's
  answers: development 16 → 17 of 30, test 13 → 14 of 20, no regressions.
  The window is the first 5 notes (`AUTO_MUTATION_WINDOW`).
- **4-voice rewards retuned on the development set:** suspension 3.6,
  ornamented suspension 6.3, retardation −1.2, passing tone −2.2 (was 2.1,
  3.3, −4.2, −3.7). On the test set, 4-voice strong-beat dissonance goes from
  1.08 to 1.49 per bar against Bach's 1.64, suspensions from 0.53 to 0.80
  (Bach 0.80), squared-error loss 0.40 → 0.06.
- **3-voice rewards unchanged.** The development-tuned value (suspension 2.5)
  fits the development set exactly but puts an augmented second (B♭ under C♯)
  on bar 6 beat 2 of the D minor default, which the regression test for the
  dissonance you heard there forbids. (It also did worse on the test set,
  0.022 → 0.061, but the decision rests on the regression test.) The
  development set's 3-voice fugues are much lighter than WTC I's (0.48 vs
  0.90 per bar): one set of rewards can't fit both, which argues for a
  subject-dependent (learned) score.
- **`FugueSettings.rewards`** overrides the texture's rewards, for tuning
  experiments (fugue-research `heldout --rewards`).

## 2026-11-18 (grid resolution and compound meter)

- **Ticks per quarter is a setting** (`FugueSettings.ticksPerQuarter`, a
  multiple of 4, default 4). Subjects with 32nds (8 per quarter), 16th
  triplets (12) or both (24) can be entered and generated. Every time in the
  engine is derived from a `TimeGrid` (beat, bar, eighth, 16th) instead of
  `TPB`. Tick-count costs (in `harmony.ts`) are counted in 16ths and key
  detection weighs durations in 16ths, so nothing depends on the resolution.
  A test checks this: the examples at ×2, ×3 and ×6 give exactly the scaled
  fugue, harmony, key plan and report.
- **16th-grid input is unchanged, bit for bit.** In simple meters the rhythm
  patterns, their weights and the RNG draws are the same, and the old
  bar-crossing join in 3/4 is kept. 144 configurations (4 examples ×
  2/3/4 voices × 4/4 and 3/4 × 6 seeds) gave the same notes, harmony, keys,
  reports and MIDI bytes as before.
- **The free voices still move in 16ths at the finest.** On a finer grid they
  play 16th-based rhythms against the subject's 32nds or triplets. Writing
  32nds or triplets in the free voices would need new rhythm patterns and
  more beam work; not needed for expositions so far.
- **Compound meters (3/8, 6/8, 9/8, 12/8) beat in dotted quarters.** Strong
  beats (the dissonance rules, suspension windows of 2 and 3 beats, the
  4-voice harmonic skeleton's chord per beat) fall on dotted quarters, so 6/8
  has two per bar and **3/8 one** (felt in one, as in Bach's fast 3/8 fugues).
  Compound beats get their own eighth-based rhythm patterns, and two beats are
  never joined across a bar line. Other x/8 meters (5/8, 7/8) are refused by
  the generator; the report beats them in eighths.
- **The report takes `meter`**, which sets the bar and, unless `strongEvery`
  is given, the strong beats. `ticksPerBeat`, `strongEvery` and `beatsPerBar`
  (quarters per bar) work as before, so fugue-research's calls are unaffected.
- **Rewards were not retuned for compound meters** (see the 2026-11-18
  held-out entry: no more tuning on our own subjects). Measured on four
  original subjects written for this change (6/8, 12/8, 3/8 and 9/8; three are
  in grid.test.ts), 20 seeds each (unexplained + chromatic clash per bar,
  3 / 4 voices): 6/8 0 / 0, 12/8 0 / 0.006, 3/8 0 / 0, 9/8 0 / 0.027
  (two chromatic clashes in 20 fugues). Parallels: 3 in 20 four-voice 6/8
  fugues, 2 in 9/8. Suspension rates are not comparable to the 4/4 targets
  (a 6/8 bar has two beats); they await Bach compound-meter reference rates.
- **The UI edits at 24 per quarter** (snap 1/8, 1/16 by default, 1/32, 1/8 and
  1/16 triplets) and generates on the coarsest grid that holds the subject
  (`coarsestTicksPerQuarter`). A 16th-grid subject runs at 4 per quarter,
  exactly as before. Saved subjects from older versions are scaled ×6 on load,
  and their `beatsPerBar` becomes a meter. The tempo slider counts beats
  (♩. in x/8); MIDI gets the quarter-note tempo, the real time signature
  (clocks per click 36 in x/8) and 480 PPQ at any grid that divides it.

## 2026-11-18 (chromatic clashes with chromatic subjects)

- **The clashes were not between two fixed voices.** fugue-research's held-out
  run found chromatic clashes only with chromatic subjects (BWV 869, 861,
  Contrapunctus XVIII and XIX), and the guess was the transposed
  countersubject against an entry. Regenerating all 280 held-out requests
  (56 subjects × 5 seeds) on the current engine gave 8 clashes, every one
  involving a free voice or a link: free against answer (3), against
  countersubject (2), against subject (1), free against link (2). The
  countersubject's placement was left alone.
- **Cause 1, the skeleton.** In BWV 869 the answer sounds G♮ in F♯ minor (the
  subject's C♮), and `planHarmony` chose VII (E–G♯–B) on that beat: `fitCost`
  saw G♮ as an ordinary non-chord tone. The free voice was then pulled to G♯.
  `fitCost` now adds `CHORD_CLASH` = 20 when a fixed note overlapping the beat
  is another form of a chord tone's degree. 8 → 3 clashes.
- **Cause 2, the penalty.** The other three were beam-search trade-offs where
  chord pull and voice-leading costs outweighed `CHROMATIC_CLASH` = 30.
  Raised to **60**: above any other single fault (downbeat dissonance 30,
  parallel perfect 45), since a clash is an error, not a style choice. This is
  a rule, not a fit: 45 left 2, 60 and 100 left none, and 60 is the smallest
  value tried that clears them. 3 → 0 clashes; held-out parallels 3 → 1,
  unexplained dissonances 16 → 14.
- **Drift on the built-in examples** (4 examples × 10 seeds; 52 of 120 fugues
  change): clashes and unexplained stay at 0 / 0 / 0.006 per bar for 2 / 3 / 4
  voices; suspensions 0.280 → 0.275, 0.575 → 0.582, 0.686 → 0.719; passing
  tones 0.189 → 0.204 (3 voices), 0.253 → 0.261 (4 voices). Rewards not retuned.
- Regression test in engine.test.ts: BWV 869's subject, 4 voices, Bach's entry
  order, 8 seeds, no chromatic clash and no skeleton chord contradicting a
  fixed voice's note on its beat.

## 2026-11-18 (clash penalty re-checked on the development split)

- **Why:** `CHROMATIC_CLASH` = 60 (previous entry) was picked on all 280
  held-out requests, and 5 of the 8 clashes came from BWV 869 and 861, which
  are in the test set (WTC I). Re-checked on the development split only
  (WTC II + Art of Fugue: 36 subjects, 5 seeds, 180 requests; 85 in 3 voices
  over 1080 bars, 95 in 4 voices over 1660 bars), built with fugue-research's
  `subject_request` and `split_of` (the same 180 requests as `heldout --split
  dev --seeds 5`). The test set was not looked at.
- **`settings.clashPenalty`** overrides the penalty for experiments, like
  `settings.rewards`; the default stays `CHROMATIC_CLASH` = 60.

  | penalty | chromatic clashes | parallels | unexplained | strong-beat dissonance / bar, 3 v | 4 v |
  |---|---|---|---|---|---|
  | 30  | 1 (4 v) | 2 | 11 | 0.439 | 0.959 |
  | 45  | 1 (4 v) | 1 | 6  | 0.420 | 0.943 |
  | 60  | 0       | 1 | 9  | 0.440 | 0.994 |
  | 100 | 0       | 1 | 15 | 0.448 | 0.950 |

  Strong-beat dissonance counts every classified kind (treated, errors and
  the clashes themselves).
- **Chosen: 60**, the smallest of the values tried that leaves no chromatic
  clash on the development set. Unchanged, so the choice is now independent of
  the test set. The evidence is thin: one clash separates 45 from 60, and
  values between them were not tried. Unexplained dissonances and the
  dissonance rate move without a trend across the values (seed-level noise),
  so they did not enter the choice.
