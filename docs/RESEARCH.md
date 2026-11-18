# Research plan: subject-conditioned fugue expositions

Working notes for a possible paper built on Fugue Lab. Started 2026-11-16 from a
reading of LakhNES (Donahue et al., 2019, arXiv:1907.04868). Decisions and their
reasons are logged in `decisions.md`.

## Question

Given a fugue subject, can a system write a correct fugue **exposition**: the
answer, an invertible countersubject and free counterpoint, following fugal
conventions? Scope is the exposition only. Episodes, middle entries and stretto
are out of scope for a first paper.

## Framing

Fugue Lab already has a strong search-based system: beam search over hand-tuned
costs in `generateLine`. The paper compares three ways of scoring the same search:

1. **Hand-tuned costs** (current engine): the baseline.
2. **Learned cost**: a model trained on Bach supplies the score.
3. **Hybrid**: hand-tuned costs plus the model's log-probability.

The search stays the same in all three, so the comparison isolates the scoring.
The hybrid is the one most likely to flow back into the app.

## Prior work (quick search, not yet a full review)

- Genetic-algorithm and rule-based fugue systems: Milkie & Chestnutt (Cornell,
  2001); a CMMR paper that generates the countersubject from a given subject
  with a genetic algorithm.
- Two-part counterpoint as neural machine translation (Nichols et al., 2021;
  Kalonaris et al., NLP4MusA 2020, which also discusses evaluation metrics).
- General Bach-style generation trained on all of Bach's keyboard works
  (arXiv:2606.13626, June 2026), not conditioned on a subject.
- Not found yet: neural, subject-conditioned generation of structurally correct
  fugue expositions. **A proper literature review is the first task**
  (MMM, the Anticipatory Music Transformer, recent symbolic music LLMs).

## Data

- **Pre-train**: a large general MIDI corpus (Lakh or GigaMIDI).
- **Mid-train**: voice-separated contrapuntal music (chorales, inventions, sinfonias).
- **Fine-tune**: fugues (Well-Tempered Clavier, Art of Fugue, organ fugues,
  possibly other Baroque composers).
- Voice-separated sources matter: keyboard MIDI usually has no clean voices.
  MCMA (Multitrack Contrapuntal Music Archive) provides Bach's harpsichord works
  split into independent parts.
- Augmentation: transposition to all 12 keys is safe. Voice-part shuffling
  (LakhNES's trick) only within compatible ranges.
- Leakage: remove test pieces from the pre-training corpus. Famous fugues are
  likely in Lakh.

## Representation

- Beat-based tokens (bar, beat position, duration), not time shifts. LakhNES's
  main weakness was rhythm, and fugue entries are metrically placed.
- Separate voice streams with a voice tag on each event.
- Structure tokens: `SUBJECT`, `ANSWER`, `COUNTERSUBJECT`, `FREE`. Labels come
  automatically from an entry-finder that detects transposed copies of the
  subject's interval pattern and classifies each answer as real or tonal. The
  resulting labeled fugue dataset is a contribution in itself.

## Model

- Small decoder (tens of millions of parameters; one GPU is enough).
- Infilling setup: rules fix the subject/answer entries, and the model fills
  the countersubject and free voices around them.
- Trained in Python, exported to ONNX, run from TypeScript
  (`onnxruntime-node` in the CLI, `onnxruntime-web` in the app).

## Evaluation

Automatic (via `fugue-cli report` / `answer`):

1. Answer correctness against the real/tonal rules.
2. Counterpoint violations per bar (parallels, strong-beat dissonances,
   crossings), measured **relative to Bach's own rate**, not to zero. The
   violation rate is `unexplainedDissonance` from the classified report
   (default since 2026-11-18); the other classes are reported as style rates.
3. Countersubject consistency across entries.
4. Invertibility: does the countersubject work above and below the subject?
5. Perplexity on held-out fugues (learned models only).

Human: pairwise listening test with musicians against Bach and the baselines.
Fugue Lab can host it on a hidden page.

Baselines: rule-based/genetic system, the current engine (hand-tuned), learned
model without pre-training, an LLM prompted in ABC notation.

Ablations: rules vs. model writing the answer; with/without structure tokens;
each pre-training stage on/off; beat-based vs. time-shift tokens.

## Risks

- Memorization on a tiny fine-tuning set: hold out whole fugues, check for
  near-copies, test on new subjects (own or student-written).
- Following the rules is not the same as sounding good: keep the listening test.
- Report limits: retardations, ornamented resolutions and 4ths against the bass
  are not yet recognized (see CLAUDE.md).

## Engine prerequisites

- [x] `fugue-cli` (generate / report / answer, `--jsonl` batch mode)
- [x] Report works on any voices, at any grid resolution, with opt-in suspension detection
- [x] Report classifies strong-beat dissonances (suspension, ornamented suspension, retardation, passing, neighbour, appoggiatura, escape tone, anticipation, pedal point, chordal seventh, unexplained)
- [x] Generator: reward prepared suspensions in `harmonic()` (CLAUDE.md weakness #2)
- [x] Generator: reward ornamented suspensions, retardations, accented passing tones and chordal sevenths, calibrated to Bach's 4/4 rates (2026-11-18)
- [ ] Tonal answer tail mutation (weakness #3), or restrict the test set and say so
- [ ] Data pipeline keeps full resolution (32nds, compound meter); quantize only for engine metrics
      (engine side done 2026-11-18: generate and report take `ticksPerQuarter`/`ticksPerBeat` and a meter, x/8 compound)

## Milestones

1. Literature review: confirm the gap.
2. Python research repo: MCMA ingest and voice-separated JSON export (done: `../fugue-research`), entry-finder/labeler (open).
3. Bach reference rates: run `fugue-cli report` over the Bach corpus (first pass done 2026-11-17; next: classify strong-beat dissonances, then exposition-only rates once the entry-finder exists).
4. Baseline numbers: current engine across subjects and seeds.
5. Learned model, then hybrid scoring via ONNX.
6. Listening test, then write-up.

Venues: ISMIR (main target); NeurIPS creative-AI workshops or AIMC as lighter options.
