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
