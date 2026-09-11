/* ══════════════════════════════════════════════════════════════════════
 * A FRESHNESS POLICY FOR EVERY FACT WE ACTUALLY STORE
 * ══════════════════════════════════════════════════════════════════════
 *
 * A fact with no policy is assessed STALE. That is the right default — an
 * unknown kind of fact is one nobody has thought about, and assuming it ages
 * slowly would silently reuse something that might change hourly — but it
 * means an UNCOVERED fact key is indistinguishable from an expired one, and
 * the stage holding it never stops paying to re-find it.
 *
 * The original seed was written against the fact vocabulary the stage planner
 * talks about. harvest.ts emits a different one. Reading a real plan, every
 * single non-fresh fact on a property verified forty minutes earlier gave the
 * same reason: "no freshness policy for this kind of fact". Eight facts across
 * three families — company., project. and property. — were permanently stale
 * from the moment they were written.
 *
 * This was already patched once for listing., symptomatically. The families
 * below are the result of going through what harvest.ts can actually emit,
 * key by key, and a test now fails if a new one is added without a policy.
 *
 * Nothing here loosens an existing rule: every pattern added is a PREFIX, and
 * a prefix always loses to the exact rules already seeded (listing.price,
 * company.representation, project.identity and the rest keep their own,
 * tighter, ages).
 */

insert into public.intelligence_freshness_policy (fact_key_pattern, freshness_class, max_age_hours, notes)
values
  -- Directors change, and a stale board stated as current is a real error.
  -- Tighter than the rest of company. on purpose. The registry stage re-reads
  -- this every run regardless: it is in official_collection, which never eases
  -- off whatever the graph holds.
  ('company.directors', 'MEDIUM_VOLATILITY', 168,  'Seven days. Directors change, and a stale board read as current is wrong.'),

  -- Name, legal form and registration date. A company changes its name rarely
  -- and its registration date never; company.status (dissolved, in
  -- liquidation) already has its own rule at the same age, and
  -- company.representation keeps its 24h.
  ('company.',          'MEDIUM_VOLATILITY', 720,  'A month. Identity of the company, not its current standing.'),

  -- Floors, buildings, unit counts, marketing aliases. A development does not
  -- gain a floor, but it can gain a phase, so this is two weeks rather than a
  -- year. project.identity (the name) stays at a year and project.inventory
  -- (units still for sale) stays at two weeks by its own exact rule.
  ('project.',          'MEDIUM_VOLATILITY', 336,  'Two weeks. Structure and naming of the development.'),

  -- What kind of property this is. An apartment does not become a land parcel.
  -- Uncovered until now, which meant the one value the planner reads to decide
  -- which fact families a property can even have was itself always stale.
  ('property.',         'LOW_VOLATILITY',    8760, 'A year. A property does not change its asset class.')
on conflict (fact_key_pattern) do nothing;
