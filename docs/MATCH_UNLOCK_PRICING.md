# What a match unlock costs, and the 10× question nobody has answered

**Found 2026-09-27, while looking at a real customer's Matches page on
production. Nothing here has been changed. It is a pricing decision and a
ledger decision, and both are the operator's to make.**

One customer has been charged **35.00 CR** for one match unlock. Every other
unlock in the ledger is **1.60 CR or less**. A factor of twenty-one between
two comparable leads.

Both numbers are what the code produced. That is the problem: 35.00 is the
VERY_STRONG base in the stored configuration, 1.60 is what the engines that do
not read that configuration charge for the same tier, and nothing in the
system reconciles them.

## The three implementations

`unlock_price_credits` is written in three places, and they do not agree.

| writer | bases (POTENTIAL → EXCEPTIONAL) | upper bound | reads `admin_settings`? |
|---|---|---|---|
| `run-matching-v2` | from config | from config | **yes** |
| `run-matching` | 0.5 / 1.0 / 1.8 / 3.0 / 5.0 | **none** — only `Math.max(0.5, …)` | no |
| `_shared/jobs.ts` `computePrice()` | 0.5 / 1.0 / 2.0 / 3.5 / 5.0 | 10.0 | no |

Only one of the three obeys the admin Pricing Config. The other two are
hardcoded, and `run-matching` has no ceiling at all — its price is bounded
only by the arithmetic happening to stay small.

## The 10×

`run-matching-v2` carries `PRICING_DEFAULTS` described in its own comment as
matching the documented defaults exactly. `admin_settings` holds a value for
every one of those keys, written **2026-09-11**, and each stored value is
**exactly ten times** the code default:

| key | code default | stored | ratio |
|---|---|---|---|
| `pricing_base_potential` | 0.50 | 5 | ×10 |
| `pricing_base_good` | 1.00 | 10 | ×10 |
| `pricing_base_strong` | 2.00 | 20 | ×10 |
| `pricing_base_very_strong` | 3.50 | 35 | ×10 |
| `pricing_base_exceptional` | 5.00 | 50 | ×10 |
| `pricing_min_credits` | 0.10 | 1 | ×10 |
| `pricing_max_credits` | 10.0 | 100 | ×10 |

Ten across every row, bounds included. That is not a retune; it is a unit.

**10 credits = $1.** So the stored 35 CR is $3.50, and the code default of
3.50 CR is $0.35. The code's defaults are the documented figures **in
dollars**; the stored configuration is the same figures **in credits**.

Which means one of two things is true, and the evidence in the database does
not settle which:

1. **The configuration is right.** A VERY_STRONG lead is meant to cost $3.50,
   the stored 35 CR says so, and the two hardcoded engines have been
   undercharging by 10× for every match they wrote — including every unlock
   in the ledger at 1.60 CR ($0.16) and 0.50 CR ($0.05).
2. **The configuration was entered in the wrong unit.** A VERY_STRONG lead is
   meant to cost 3.50 CR ($0.35), and one customer has been overcharged 10×.

## What is actually in the ledger, and the same ten again

All fourteen unlocks, joined to the match they opened:

| charged | price on the match | rows | price ÷ charged |
|---|---|---|---|
| 35.0000 | 35.0000 | 1 | **1.00** |
| 1.6000 | 1.6000 | 1 | **1.00** |
| 0.5000 | 5.0000 | 1 | 10.00 |
| 0.1600 | 1.6000 | 9 | 10.00 |
| 0.1000 | 1.0000 | 2 | 10.00 |

**Twelve of the fourteen were charged exactly one tenth of the price the match
carried. Two were charged exactly the price.** No partial ratios, nothing in
between — it is the same factor of ten as the configuration table above,
appearing a second time in a different place.

And the two that match are the two most recent: 2026-09-12 and 2026-09-25.
The configuration was written **2026-09-11**. Before that date the ledger
charged a tenth of the quoted price; after it, the quoted price. Whatever the
divide-by-ten was, the reprice on the 11th is when the system stopped applying
it — or when the two scales happened to line up.

The customer-facing consequence is that the quoted price and the amount taken
were not the same number for twelve unlocks, in the customer's favour, and the
first unlock after that stopped was the 35.00 CR one.

## And the oldest leads are the most expensive

Across all 74 matches, joined to `raw_signals.published_at`:

| age of the signal | matches | average price |
|---|---|---|
| 30–180 days | 26 | 1.42 CR |
| 180–365 days | 24 | 1.05 CR |
| 1–3 years | 9 | 1.07 CR |
| **over 3 years** | **10** | **7.80 CR** |
| unknown | 5 | 2.16 CR |

The price rises with `signal_strength`, and `signal_strength` rises with
`Description/needs overlap` among other dimensions — so a long, detailed forum
post from 2009 scores well and prices high. The published dates are real; they
were checked. The two most expensive matches in the table are a 2009 thread
and a 2014 thread.

Nothing about that is a bug in the arithmetic. It is a question about whether
a seventeen-year-old forum post should be sold as a lead at all, and it is not
a question the presentation layer can answer. What the presentation layer did
do is stop hiding the age behind a four-digit day count — see `scaleDays()` in
`src/matching/presentation.ts`; the card now says "17 years ago" where it said
"6309 დღის წინ".

## What would settle it

1. Decide the unit, and make `PRICING_DEFAULTS` and `admin_settings` agree.
   Whichever is right, they must not differ by a factor of ten.
2. Give `run-matching` and `_shared/jobs.ts` the same config the v2 engine
   reads, or retire them as price writers. A price that depends on which
   function ran is not a price.
3. Give `run-matching` an upper bound.
4. Reconcile `unlock_price_credits` against `credits_charged`. Twelve rows
   differ by exactly ten; two do not. Find which side applied the factor and
   when it stopped, because a quoted price that is not the amount taken is the
   one thing a credit ledger may not do.
5. Decide what to do about the 35.00 CR charge.
