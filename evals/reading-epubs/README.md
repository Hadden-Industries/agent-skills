# Evaluating `reading-epubs`

This maintainer-only suite evaluates the deployable skill at
`skills/reading-epubs/`. It is not part of the skill payload installed by
`npx skills add Hadden-Industries/agent-skills`. Its two eval sets answer
different questions; passing one says nothing about the other.

| File | Question it answers |
|---|---|
| `evals.json` | Once activated, does the skill produce better behaviour? |
| `trigger-evals.json` | Does the skill activate on the right requests, and stay out of the wrong ones? |

## Score consumption, not correctness

**A capable agent does not need this skill to reach an EPUB's text.** `unzip` is
one command and the XHTML inside is readable. An early draft of this file
claimed the text was "unreachable without conversion"; an A/B run disproved it
in the first tool call.

Scoring on correctness therefore reads flat, and will keep reading flat. Across
every controlled run below — two models, with and without the skill — **all
four arms answered all three questions correctly.** An eval that asks "did it
answer" cannot see this skill working.

What separates them is what it cost to answer.

### The measured result

Four runs, one real standards document, three questions with verified ground
truth: quote a sentence exactly, read a value out of a table, resolve a
cross-reference. Same prompts, same book; only the mention of the skill varied.

| Model | No skill | With skill | Token reduction | Tool calls |
|---|---|---|---|---|
| Haiku 4.5 | 66,597 | 36,343 | **45.4%** | 7 → 7 |
| Opus | 46,480 | 42,503 | **8.6%** | 14 → 6 |

**The benefit scales inversely with model capability.** A weaker agent gains
five times as much, because the skill supplies the targeting it would otherwise
have to work out: the without-skill Haiku run read a 500-line XHTML file in two
large chunks to extract three small facts, while the with-skill run read the
table of contents, jumped to an anchor, and read about thirty lines.

Note the diagonal: **Haiku with the skill consumed less than Opus without it.**
The skill acts as a capability floor rather than a multiplier, which matches the
published finding that a weaker model with skills can outperform a stronger one
without them.

### The one correctness difference

The without-skill Haiku run answered question 3 correctly but presented a
*quotation* that had silently dropped three normative citations —
`(ISO/IEC 11179-3:2023, 8.4.1)` and two others — while reporting "100%
confidence". Every other run reproduced them. In a standards document those
references are the requirement's teeth, and losing them inside quotation marks
is a real fidelity failure that a correctness rubric scored as a pass.

This is the only such difference across four runs, so treat it as a signal to
test for rather than an established pattern.

### What this does not establish

Each cell is **n = 1**. A published 180-run study of skills in another domain
found a +8.9pp marginal benefit that was *not statistically significant*; four
runs here have no power whatever. These figures are directional.

The three questions also target known locations, which is the case a table of
contents and a single searchable file most favour. A question requiring the
whole book to be read would likely narrow the gap, because both arms would end
up reading everything.

Getting a clean baseline took two attempts. The first "without skill" Opus run
found and used the skill anyway, because the scratch path it was given
contained the repository name and the agent's working directory was the
repository. Isolating a baseline needs an explicit instruction, not just
silence.

## What the skill measurably improves

`measure_conversion.py` reports this for any book or folder. It compares three
representations: the spine documents an agent must open and read natively, the
Markdown Pandoc alone produces, and what this skill produces after cleaning.

```bash
python evals/reading-epubs/measure_conversion.py --directory "path/to/books"
```

Measured over 80 real books — 23 ISO standards and 57 trade titles — the
benefit is real but **very unevenly distributed**, so both segments are given
here rather than the flattering one:

| Corpus | Native chars | Cleaned chars | Conversion earns | Cleaning earns | Overall |
|---|---|---|---|---|---|
| 23 ISO standards | 5,239,430 | 3,685,820 | 12.7% | **19.4%** | **29.7%** |
| 57 trade books | 45,018,882 | 37,896,909 | 12.3% | 4.0% | 15.8% |
| All 80 | 50,258,312 | 41,582,729 | 12.4% | 5.6% | 17.3% |

In tokens, the whole corpus goes from roughly 12.56 million to 10.40 million.

Conversion is worth a steady ~12.4% whatever the book. **Cleaning is what
varies**: 19.4% on standards typeset in InDesign, where every identifier is
wrapped in a styling span, against 4.0% across trade titles that barely use
classes at all. The skill's styling work pays for itself on technical documents
and is close to a rounding error on fiction.

The largest individual reductions come from code-dense technical books, where
conversion replaces markup-heavy listings with fenced blocks:

| Book | Native | Cleaned | Reduction |
|---|---|---|---|
| JSON Web Token handbook | 323,538 | 164,884 | **49.0%** |
| Database Design and Relational Theory | 1,279,310 | 840,634 | **34.3%** |
| SVG Essentials | 1,642,794 | 1,264,495 | 23.0% |

Two structural savings the character counts do not show:

- **File count.** Natively an agent opens every spine document — 5 to 12 per
  standard, more for a novel. Through the skill it opens one.
- **Navigation.** The converted Markdown reports a `toc` file whose entries
  resolve to anchors inside it, so a section can be reached directly instead of
  by scanning.

### Where it does not help

`ISO_IEC 19763-3_2020` comes out **7% larger** than its source. Pandoc's grid
tables are more verbose than the compact HTML tables they replace, so on a
table-dense book the conversion can cost more than it saves. A few trade titles
land within a percent of break-even for the same reason.

The reduction is an average, not a guarantee. If the question is whether to use
this skill on one particular book, measure that book.

## Trigger evals

`trigger-evals.json` is a flat array of `{ query, should_trigger }`, the format
`skill-creator`'s description-optimization workflow consumes.

The should-not-trigger cases are deliberately near-misses rather than obviously
unrelated prompts, because only near-misses discriminate:

- **Producing** an EPUB rather than reading one — opposite direction, same noun.
- **Adjacent formats** (PDF, MOBI) — same task shape, different skill.
- **File management** — operates on `.epub` files without needing their content.
- **Writing EPUB-parsing code** — heavy shared vocabulary, but the deliverable is
  code, not an answer drawn from a book.
- **General knowledge about EPUB** — mentions the format, has no file to read.

The description keys on *needing an EPUB's content* rather than on an `.epub`
extension being present anywhere, and names the excluded cases. Re-run these
after any description change, and keep some cases held out: optimizing a
description against the same prompts used to write it measures nothing.

## The fixture

`fixtures/sample.epub` is generated, not hand-built. Its bytes are exactly what
`tests/helpers/epub.mjs` `buildEpub({ crossLink: true })` produces, and
`tests/reading-epubs/eval-fixture.test.mjs` fails if the two drift apart. That
keeps a binary in the repository reviewable: read the builder, not the blob.

Its entries are deflated, as a real EPUB's are. An uncompressed archive leaves
its chapter text in plain sight, which misrepresents the format.

**It is too small to demonstrate the figures above.** Two chapters in one
archive is the case where reading the source directly is easy. The cases in
`evals.json` therefore check that the workflow runs, stays within the converted
representation, and reports honestly — not that it beats the alternative. For
that, run `measure_conversion.py` against real books.

## Untested

Case 3 requires Pandoc to be absent. The machine used for the A/B had it
installed, so that case has not been exercised.

The `assertions` in `evals.json` have not been machine-graded. They were written
to be checkable against a transcript, and the A/B run above was read by hand.
