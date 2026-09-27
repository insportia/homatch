# Native match — production proof (rolled back)

Run on production project `ptxajsjhobhvsfhmutjn`, 2026-09-27, as ONE `DO` block that ends in
`RAISE EXCEPTION` — so every row it wrote (three fixture accounts, a property, a live chat
message, a signal, a demand, a match, a conversation, a disclosure) and the migration itself
were rolled back. A follow-up read confirmed nothing persisted
(`native_property_relationships` absent, 0 proof users, property and chat counts unchanged).

The script is `native-match-rollback-proof.sql` beside this file. It applies
`20260928010000_native_intent_pipeline.sql` inside the transaction, then:

| Step | Evidence |
|---|---|
| User B writes `ვეძებ კრწანისში 2 საძინებლიან ბინას $220,000-მდე` in the common room | `wake_requests_queued: 1` — the trigger queued exactly one wake-up for the reader, carrying no text |
| The canonical signal (constraints exactly as `demandFromText()` reads that sentence) | `signals_for_message: 1`, retry → `signal_idempotent: true` |
| Projection → universal matcher → `upsert_native_match` | `native_matches: 1`; row: supply user = A, demand user = B, property = P, demand = D, `INTERNAL_HOMATCH`, `COMPATIBLE` |
| Re-run of the matcher | `match_rerun_same_row: true` |
| Owner A as their own demand | `supply_matches_not_self` check violation — refused |
| Message: B twice, A once, and `ensure_conversation(A,B,P)` reversed | `conversation_reused: true`, `conversations_between_A_and_B: 1`, `ensure_conversation_reversed_is_same: true` |
| Call: B (seeker) | `{"phone": "+995555000111"}` and `disclosures_recorded: 1` |
| Call: A (owner), B never shared a number | `{"phone": null, "reason": "NOT_SHARED"}` |
| Stranger C | `REFUSED/conversation-REFUSED` |
| Customer lists | seeker 1 row, owner 1 row |
| Property relationship (viewing + private message) | idempotent; owner's own relationship with their property → `NULL (refused)` |
| Grants | anon cannot reveal; authenticated can; authenticated cannot call `ensure_conversation` or `upsert_native_match` |
| Schedules | `homatch-native-intent` (every minute), `homatch-supply-matching` (every 15 min, `nativeOnly`) |

Nothing reserved credits, recorded a cost event or started discovery: the reader and the
network-only matcher contain no billing path (asserted in `tests/matrix/nativePipeline.test.mjs`).
