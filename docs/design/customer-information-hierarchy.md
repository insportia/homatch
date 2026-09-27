# The customer surfaces, in order of what matters

Six screens. For each one, what the reader came for, in the order they came for it —
written down **before** the components were touched, because the rejection was not that
the spacing was wrong. It was that every one of these screens led with the system's
internal view of itself.

The test each hierarchy has to pass: **cover everything below rank A and the screen is
still recognisable as a product.** Cover everything above rank C and it should be
useless. If hiding a block changes nothing, the block was decoration.

The ranks:

| | means |
|---|---|
| **A** | The reason the screen exists. Visible without scrolling, without expanding, in every locale, at 320 px. |
| **B** | What the reader asks immediately after A. Same viewport. |
| **C** | Supporting judgement. Visible but quiet. |
| **D** | The action. Labelled with words. One primary per screen. |
| **E** | Accountability and audit: evidence, provenance, scores, source. Real, reachable, and behind a control that says what it holds. |
| **✗** | Does not belong on a customer screen at all. Operator or debug material. |

---

## 1. Owner workspace — `ჩემი ქონება & მყიდველის/მოიჯარის პოვნა`

The reader owns property and wants to know what is happening with it.

- **A** — Each property, identifiable at a glance: photo, address, price, SALE or RENT.
- **B** — What Homatch has done for it: how many people are interested, how many are new.
- **C** — Its state: published or private, imported or entered by hand, archived.
- **D** — Per property: **Find buyers** / **Find tenants** — the verb depends on the
  transaction type, because a rental has no buyers. Page level: **Add property**.
- **E** — Where an imported property came from, and when it was last read.
- **✗** — Matchability percentages as a headline. Counts of database rows. The words
  "campaign", "signal", "sweep", "job".

Density is the point: ten properties must read as a list a person can scan, not ten
full-width panels. One property must not look like a layout error.

## 2. Matches

The reader has a property and wants to know who wants it. **This screen was the worst
offender and it is the one rebuilt first.**

- **A** — **Who this is and what they want.** "A buyer looking for an apartment." Then
  how well it fits, as a word: Strong / Good / Possible.
- **B** — The human facts: city · budget · rooms · how recently they spoke.
- **C** — What they said, in their words. One sentence on what agrees.
- **D** — One labelled button. On an unpaid result: a price. On a result the campaign
  already covered: **View**, with no price, because charging twice in attention is still
  charging twice. Everything else — ask the AI, message, arrange a viewing — behind one
  menu that has words in it.
- **E** — **"Why this match?"**, closed by default, holding every matched dimension, the
  mismatches, the platform, the language, and the freshness verdict.
- **✗** — `Transaction intent matches` / `Country matches` / `City matches` as the body of
  the card. `GOOGLE`. `KA`. A raw confidence percentage anywhere. A wallet balance in the
  header. A pulsing green "matching is active" banner. A card whose **background colour**
  is derived from its strength — that turns a list of opportunities into a status board.
- **✗** — Four unlabelled icon buttons in a row. A customer should not have to press
  something to learn what it does.

The strength mapping is a claim, so it is fixed in one module and written down:
`EXCEPTIONAL`, `VERY_STRONG`, `STRONG` → **Strong**; `GOOD` → **Good**; everything else,
including a value we have never seen, → **Possible**. Five internal grades become three
words because no customer can act differently on "exceptional" than on "very strong", and
offering the distinction implies they should. See `src/matching/presentation.ts`.

## 3. Find Property

The reader wants something and has not found it. Today this is a heading, a textarea and
a disabled button — an input form, not a product.

- **A** — One composer that accepts a sentence in any of six languages, with examples
  already in it, so nobody faces an empty box wondering what it accepts.
- **B** — **What Homatch understood**, shown back as a plan the reader can read and
  correct: where, what, how much, how many rooms — each labelled as required, preferred or
  flexible, because `ConstraintStrength` is a real distinction and a customer understands
  "must be" versus "would like".
- **C** — What happens next, and what it costs, before anything is spent.
- **D** — **Start searching**, enabled the moment the plan has enough to act on, and a
  readiness line that says what is still missing when it does not.
- **E** — The normalised plan as stored.
- **✗** — A disabled button with no explanation of what would enable it. The word
  "intent profile". An empty state that is genuinely empty.

## 4. Property details

What the reader is selling, presented as an asset.

- **A** — Photography first and large, then address, price, type.
- **B** — The facts that decide a purchase: area, rooms, floor, condition, year.
- **C** — Description. Amenities. Interest so far.
- **D** — **Find buyers / Find tenants**, **Edit**, and the lifecycle actions —
  publish, archive, delete — each labelled and each reversible except the last, which asks.
- **E** — Provenance of an imported property: the source, the URL, when it was read, what
  has been edited by hand since. Never lost, never overwritten by an edit.
- **✗** — A matchability score as the hero. Storage keys. Row ids.

## 5. Add / edit property

- **A** — What is being asked for right now, one thing at a time.
- **B** — Why it is being asked: what each field improves about the result.
- **C** — Progress, and what may be skipped.
- **D** — **Save**, always available; nothing is lost by leaving.
- **E** — Validation, stated in the reader's language, next to the field.
- **✗** — A wall of fifty inputs. Field names borrowed from column names.

## 6. Broker surfaces

Two things that must never be confused, and the hierarchy is where that separation is
either legible or lost.

**Directory** — brokers with an active paid Homatch listing, and only those.

- **A** — Who they are, where they work, what they cover.
- **B** — Their standing: paid, current, verified — each shown only when the database says
  so.
- **C** — How to reach them.
- **D** — **Contact**.
- **✗** — Any broker discovered externally. A discovered broker is not a registered one
  and must never appear here by any automatic path.

**Discovered broker intelligence** — an operator-facing view of what we observed.

- **A** — What was observed, and that it was observed rather than registered.
- **B** — Where it came from and how fresh it is.
- **E** — The identity keys and the lineage.
- **✗** — Any badge that reads as paid, verified or registered. Any control that
  promotes a row into the directory.

---

## What this does not change

The matching engine, the ledger, the reservation and settlement path, the storage
architecture, `VERIFY`, the main dashboard and the admin design system. This document is
about **presentation**: which of the true things we already compute a customer sees first,
and which are one control away.
