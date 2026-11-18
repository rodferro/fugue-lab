# Related work: subject-conditioned fugue expositions

First pass, 2026-11-17, from web searches and abstracts. Updated the same day
with full-text summaries of the two closest works (Roux & Prince; Jarski).
Papers marked **read next** have only been seen through abstracts.
Plan and decisions: `RESEARCH.md`, `decisions.md`.

## The gap, as precisely as we can state it now

Systems that **take a given fugue subject and write the rest of the
exposition** exist, but they are rule-based, procedural or evolutionary. The
closest, Roux & Prince (2022), takes a user's subject but answers only by
exact transposition (no tonal answers), writes two voices, assumes 4/4, and
reports no systematic evaluation. Neural counterpoint work targets chorales
(DeepBach, Coconet), two-part counterpoint without fugal structure (machine
translation, BachDuet), or Renaissance polyphony (Jarski 2026: a Transformer
with hard rule masking, continuing prompts rather than writing around fixed
entries). General infilling models (Anticipatory Music Transformer, MMM) can
fill voices around fixed notes but know nothing about subjects, answers or
countersubjects. Search with a learned objective exists for species
counterpoint and other styles (Herremans), not for fugue.

**Not found:** a learned or hybrid system that writes a structurally correct
3–4-voice exposition (tonal or real answer, invertible countersubject, free
voices) around a user's subject, evaluated with fugue-specific metrics
(answer correctness, countersubject consistency, invertibility) and with
voice-leading rates **calibrated against Bach rather than against zero**.
The last point is a real contrast with Jarski, whose headline result is zero
violations of the rules his solver enforces, and whose "no simultaneous
dissonance" rule he himself notes doesn't fit Bach. Our Bach rates show why:
Bach writes 0.5–0.7 non-suspension strong-beat dissonances per bar in his
openings.

## 1. Fugue and imitative counterpoint generation

**Rule-based, procedural and evolutionary, from a given subject**

- Milkie & Chestnutt (Cornell, 2001): genetic-algorithm fugue generation:
  generate a subject, then the answer and countersubjects from it. Course
  project; the answer is a simple transposition.
- CMMR 2005 (Springer LNCS, "Fugue Composition with Counterpoint Melody
  Generation Using Genetic Algorithms"): a fugue subject is the input, a GA
  generates the countersubject, with a basic rule set as fitness; tested on two
  input melodies.
- Roux, J. & Prince, V. (2022). "Prototype de génération procédurale de
  contrepoints à la manière de Jean-Sébastien Bach". In *Proceedings of the
  19th Sound and Music Computing Conference (SMC 2022)*, JIM Jeune Chercheur
  session, pp. 624–633, Saint-Étienne, France. In French; also HAL
  lirmm-03722814. (Zenodo 10.5281/zenodo.6822204 is the DOI of the whole
  proceedings, not of this paper.)
  **Closest prior system to Fugue Lab, and its design is close to ours.**
  - Input: a subject supplied by the user.
  - Answer: exact transposition by a fourth or fifth; tonal answers are not
    handled.
  - Countersubject: a rhythm chosen from predefined complementary patterns,
    then pitches by ordered melodic preferences with harmonic-interval checks
    against the other voice (compare Fugue Lab's `complementaryRhythm` + beam
    search).
  - Episodes: short motifs sequenced up or down, 2–4 repetitions. Cadence: V–I,
    optional Picardy third.
  - Large-scale form: a Markov graph ("HMM") of transitions between fugue
    events, estimated from Algomus's annotations of the 24 WTC I fugues
    (Dezrann), used to generate a fugue *skeleton* before any notes.
  - Limits: local generation is two voices and mostly 4/4; they cite
    O(t^v) complexity as the obstacle to more voices; a proof of concept with
    no systematic evaluation of complete fugues.
  - For us: Fugue Lab already goes further on the exposition (tonal answers,
    3–4 voices, invertible countersubject, harmonic skeleton, voice-leading
    report). Their form model is directly useful for roadmap milestone 5
    (episodes, middle entries), and shows Algomus annotations are usable.

**Statistical**

- Farbood & Schöner (ICMC 2001): Palestrina-style species counterpoint from a
  given cantus firmus with Markov chains.
- Padilla & Conklin (IJIMAI 2018; SMC 2016): two-voice imitative counterpoint
  in the style of Palestrina; a template covered with discovered patterns,
  then filled with a first-order Markov model. Addresses imitation, which most
  counterpoint generators ignore.

**Neural**

- Nichols, Kalonaris, Micchi & Aljanaki (arXiv 2006.14221, 2020): two-part
  Baroque counterpoint as neural machine translation (one part = source, the
  other = target), Transformer, evaluated with BLEU and musicological
  analysis. The model produced idiomatic features such as imitation but fell
  short of correct contrapuntal motion (e.g. avoiding parallel fifths).
  Same group as MCMA.
- Jarski, *Neurosymbolic Counterpoint Generation* (Cal Poly MS thesis, March
  2026, 86 pp.). **Closest neural work.**
  - Model: decoder-only Transformer (8 layers, 8 heads, d=1024) whose next
    tokens are masked at inference by a Z3 constraint engine enforcing three
    rules (no parallel fifths, no parallel octaves, no simultaneous
    dissonances) plus token-grammar validity. Model and constraints are not
    trained jointly.
  - Data: 2,439 Renaissance works (Josquin Research Project, SIMSSA); 2,317
    training pieces × 12 transpositions = 27,804 examples.
  - Tokenization mattered most: naive MIDI-event tokens gave poor rhythm;
    REMI+ (bars, time signatures, positions, voice IDs) fixed it. Same lesson
    as LakhNES, and it supports our beat-based-token decision.
  - Conditioning: free generation or continuation of a prompt (e.g. a canon
    on "Happy Birthday", whose imitation the model continued). Not structural
    conditioning on fixed entries placed later in time.
  - Results: 9.269 rule violations per 1,000 tokens without constraints, 0
    with them (temperature 1.2), counting only the enforced rules. Quality is
    judged through examples and the author's analysis, not a listening study.
  - For us: hard masking is a third way to use rules, next to Fugue Lab's
    soft hand-tuned costs and a learned score; worth an ablation arm. And
    "zero violations" is the wrong target for Bach (see the gap above).
- Generative Modeling of Bach-Style Symbolic Music (arXiv 2606.13626, 2026):
  compares autoregressive, latent-variable and adversarial models on Bach's
  keyboard works (incl. WTC, Art of Fugue). Unconditional style generation,
  no fugal structure.

## 2. Bach and counterpoint models (not fugue-specific)

- DeepBach (Hadjeres, Pachet & Nielsen, ICML 2017): chorales; pseudo-Gibbs
  sampling makes it steerable with positional constraints (notes, rhythms,
  cadences). The model of choice for "fix some notes, fill the rest" in
  four-part Bach.
- Coconet, "Counterpoint by Convolution" (Huang et al., ISMIR 2017): CNN
  trained to complete partial scores of Bach chorales, sampled with blocked
  Gibbs; powered the Bach Google Doodle.
- BachDuet (Benetatos et al., 2020), RL-Duet (Jiang et al., AAAI 2020),
  FolkDuet (NeurIPS 2020): online, real-time counterpoint against a human
  line; RL-Duet trains with a learned reward model of counterpoint
  interaction. Relevant as "learned scores for counterpoint", not as
  generators of fugal structure.
- LakhNES (Donahue et al., ISMIR 2019): the starting point; cross-domain
  pre-training on Lakh helps a small multi-instrument corpus.

## 3. Infilling and controlled generation

- Anticipatory Music Transformer (Thickstun, Hall, Donahue & Liang, TMLR
  2024): interleaves control events (fixed notes) with generated events so an
  autoregressive model can condition on future fixed notes; trained on Lakh
  MIDI; listeners rated its accompaniments comparable to human music over
  20-second clips. **Strongest candidate for our learned model**: subject and
  answer entries are exactly "controls", and it already shares LakhNES's
  pre-training corpus.
- MMM (Ens & Pasquier, 2020) and MIDI-GPT (2025): track- and bar-level
  infilling with attribute controls. Composer's Assistant (Malandro, ISMIR
  2023): multi-track MIDI infilling. MIDI-RWKV (2025): long-context infilling.
  Alternatives for the same role; none model fugal roles.

## 4. Search with a learned (or rule) objective

This is the frame for the paper's main comparison (hand-tuned vs learned vs
hybrid scoring of one beam search).

- Herremans & Sörensen: variable neighbourhood search (VNS) for first and
  fifth species counterpoint, objective = quantified counterpoint rules
  (J. Math. Arts 2012; Expert Syst. Appl. 2013).
- Herremans, Weisser, Sörensen & Conklin; Herremans, Sörensen & Conklin (ICMC
  2014): the same VNS with a **Markov-model objective learned from a corpus**,
  compared with Gibbs sampling and random walks. The closest precedent for
  "same search, learned scoring". MorpheuS (Herremans & Chew) adds tension
  profiles and repeated-pattern constraints.
- Hard constraints instead of costs: Jarski's Z3 token masking (section 1);
  FuxCP (Sprockeels, Wafflard & Van Roy, JIM 2023, and later Louvain theses):
  Fux's species counterpoint as constraint programming, ranking feasible
  solutions with a cost model.
- Our difference: a neural scorer trained with large-corpus pre-training, in
  a fugal template, measured against Bach. The rule side of the comparison
  can be run three ways: hard masking, soft hand-tuned costs (the current
  engine), and none (learned score only).

## 5. LLMs and sheet-music language models (the baseline reviewers will ask for)

- NotaGen (Wang et al., IJCAI 2025): ABC-notation model pre-trained on 1.6M
  sheets, fine-tuned on ~9K classical pieces with "period-composer-
  instrumentation" prompts (Baroque-Bach exists), plus CLaMP-DPO. A strong
  "prompt it with the subject" baseline.
- ChatMusician (ACL Findings 2024): general LLM with ABC music abilities and
  the MusicTheoryBench benchmark.
- Benchmarks of LLM score understanding: MSU-Bench (2025), WildScore (EMNLP
  2025), ABC-Eval (ICASSP 2026), a LilyPond benchmark (2026). Useful for
  framing, not for fugue writing.
- Plus: a current frontier LLM prompted in ABC, as planned.

## 6. Computational fugue analysis (for the entry-finder)

- Giraud, Groult & Levé, "Subject and Counter-Subject Detection for Analysis
  of the WTC Fugues" (CMMR 2012, LNCS 7900, 2013): on WTC I, finds 66% of
  subjects with a musically relevant end and retrieves 85% of subject
  occurrences, with almost no false positives, using diatonic interval
  similarity and strict length matching. Needs voice-separated scores, as we
  have from MCMA.
- Giraud, Groult, Leguy & Levé, "Computational Fugue Analysis" (Computer
  Music Journal 39(2), 2015): subjects, countersubjects, harmonic sequences in
  episodes, subject scale degrees, cadences, pedals, and exposition/episode
  segmentation; 36 fugues by Bach and Shostakovich; good results on about half
  the fugues; **publishes formalized ground truth** for the corpus.
- Giraud et al., "Detecting Episodes with Harmonic Sequences" (ISMIR 2012).
- Implication: don't build the entry-finder blind. Validate it against
  Algomus's ground truth, and cite it as a reimplementation/extension. Their
  exposition segmentation also gives exposition-only Bach rates.

## 7. Evaluation

- Yang & Lerch, "On the evaluation of generative models in music" (Neural
  Comput. Appl., 2020): musically informed objective metrics; shows models
  can fail even on low-level distributions (pitch range, counts).
- Lerch et al., "Survey on the Evaluation of Generative Models in Music"
  (arXiv 2506.05104, 2025): current overview incl. music-theory-rule metrics
  and subjective designs.
- Kalonaris, McLachlan & Aljanaki (NLP4MusA 2020) and Kalonaris & Aljanaki
  (HER metric, 2020): MT metrics vs human judgments for generated
  counterpoint.
- Memorization: Yin, Reuben, Stepney & Collins, "Measuring When a Music
  Generation Algorithm Copies Too Much" (originality report, SN Comput. Sci.);
  "Why Do Music Models Plagiarize? A Motif-Centric Perspective" (NeurIPS 2025
  AI for Music workshop). Directly relevant to our tiny fine-tuning set.
- Dissonance classification (needed before "strong-beat dissonance" is an
  error metric, see results note): non-chord-tone taxonomies are standard
  (passing, neighbour, appoggiatura, suspension, retardation...); automatic
  NCT recognition exists for melodies (e.g. arXiv 2105.05385) and in melodic
  analysis surveys (Rizo et al.). **Read next** for a rule set to implement.

## What this changes in the plan

1. Novelty after reading the two closest works: the claim holds and is
   sharper. Position the paper against both explicitly: Roux & Prince (same
   input, rules only, real answers, two voices, no evaluation) and Jarski
   (neural + hard rules, Renaissance, prompt continuation, evaluated against
   zero rather than against a composer).
2. Add a **hard-constraint arm** to the scoring comparison: mask candidates
   that break the rules instead of penalizing them. Expect it to suppress
   exactly the dissonances Bach uses.
3. Keep **beat-based tokens** (REMI-style, with voice IDs): Jarski's
   tokenization result is the second piece of evidence after LakhNES.
4. For roadmap milestone 5 (episodes, middle entries), start from Roux &
   Prince's form model: transitions estimated from Algomus annotations.
5. Entry-finder: start from Giraud et al.'s method and validate on their
   ground truth instead of inventing our own labels.
6. Learned model: the Anticipatory Music Transformer is the natural first
   choice (controls = fixed entries; Lakh pre-training like LakhNES).
7. Related-work framing for the hybrid: Herremans's VNS with a learned
   objective is the precedent; our contribution is a neural scorer, fugal
   structure, and Bach-calibrated evaluation.
8. Add NotaGen (and a frontier LLM in ABC) as baselines.
9. Add an originality/memorization check (originality report) to the
   evaluation, as the plan's risk section already anticipates.

## Read next

- Giraud et al. 2015 (CMJ) and the Algomus ground-truth format.
- Anticipatory Music Transformer: control format, checkpoints, licence.
- NotaGen: can it be conditioned on a given opening?
- A non-chord-tone classification method suitable for 2–5 voice counterpoint.

## Sources

- LakhNES: https://arxiv.org/abs/1907.04868
- Milkie & Chestnutt 2001: https://www.cs.cornell.edu/boom/2001sp/milkie/fugue%20generation%20through%20genetic%20algorithms_files/csReport.htm
- GA countersubject (CMMR 2005): https://link.springer.com/content/pdf/10.1007%2F978-3-540-31807-1_7.pdf
- Roux & Prince: https://hal-lirmm.ccsd.cnrs.fr/lirmm-03722814v1/document
- SMC 2022 program (JIM Jeune Chercheur session): https://smc22.grame.fr/program.html
- SMC 2022 proceedings (whole volume): https://zenodo.org/records/6822204
- Farbood & Schöner 2001: https://bpb-us-e1.wpmucdn.com/wp.nyu.edu/dist/f/11865/files/2020/08/Farbood-ICMC2001.pdf
- Padilla & Conklin 2018: https://ijimai.researchcommons.org/ijimai/vol5/iss3/12
- Nichols et al. 2020: https://arxiv.org/abs/2006.14221
- Jarski 2026: https://digitalcommons.calpoly.edu/theses/3244
- Bach-style comparative study 2026: https://arxiv.org/abs/2606.13626
- DeepBach: https://arxiv.org/abs/1612.01010
- Coconet: https://arxiv.org/abs/1903.07227
- BachDuet: https://labsites.rochester.edu/air/publications/benetatos20bachduet.pdf
- RL-Duet: https://arxiv.org/abs/2002.03082
- Anticipatory Music Transformer: https://arxiv.org/abs/2306.08620
- MMM: https://arxiv.org/abs/2008.06048
- MIDI-GPT: https://arxiv.org/abs/2501.17011
- Composer's Assistant: https://ismir2023program.ismir.net/static/posters/113.pdf
- MIDI-RWKV: https://arxiv.org/abs/2506.13001
- Herremans et al. (Markov objective, ICMC 2014): https://speech.di.uoa.gr/ICMC-SMC-2014/images/VOL_2/1096.pdf
- Herremans & Sörensen, fifth species VNS: https://search.isc.ac/inventory/10/2353968.htm
- FuxCP (Sprockeels et al., JIM 2023): https://jim2023.sciencesconf.org/data/pages/3_2_SPROCKEELS_ET_AL.pdf
- MorpheuS: https://arxiv.org/abs/1812.04832
- NotaGen: https://www.ijcai.org/proceedings/2025/1134
- ChatMusician: https://aclanthology.org/2024.findings-acl.373.pdf
- MSU-Bench: https://arxiv.org/abs/2511.20697
- WildScore: https://arxiv.org/html/2509.04744v1
- Giraud et al. 2012/2013 (subject detection): https://hal.archives-ouvertes.fr/hal-00712554
- Giraud et al. 2015 (CMJ): https://hal.archives-ouvertes.fr/hal-01113520v1
- Giraud et al. ISMIR 2012 (episodes): https://core.ac.uk/download/49882556.pdf
- Yang & Lerch: https://musicinformatics.gatech.edu/wp-content_nondefault/uploads/2018/11/postprint.pdf
- Lerch et al. 2025 survey: https://arxiv.org/abs/2506.05104
- Kalonaris et al. 2020: https://aclanthology.org/2020.nlp4musa-1.9/
- Originality report: https://link.springer.com/article/10.1007/s42979-022-01220-y
- Motif-centric plagiarism (NeurIPS 2025 workshop): https://neurips.cc/virtual/2025/123788
- NCT recognition (melody reduction): https://arxiv.org/abs/2105.05385
