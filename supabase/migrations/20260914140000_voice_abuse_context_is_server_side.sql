-- HOMATCH Voice AI — whether a conversation has contained abuse is a fact the
-- SERVER establishes, not a claim the browser makes.
--
-- WHY THIS COLUMN EXISTS
--
-- The keyterm selector withholds the abuse lexicon unless the conversation has
-- already contained abuse, and for a good reason: sending a profanity list to
-- a realtime transcriber teaches it to hear profanity. Somebody asking about a
-- mortgage should not have fifty insults sitting in the recognition bias.
--
-- That switch was being read from the request body. A browser could set it and
-- have the lexicon sent — which is exactly the outcome the withholding exists
-- to prevent, reachable by anybody who can open developer tools. So the flag
-- moves here: set by the server when a turn it received actually matched the
-- lexicon, and read from the row rather than from the caller.
--
-- WHAT IT IS NOT
--
-- It is not the conversation. One boolean per session, no text, no term, no
-- count — the same privacy line every other part of this feature holds. A
-- session's transcript is still never stored, and this says nothing about what
-- was said beyond that something in it matched.

alter table public.comm_talk_sessions
  add column if not exists abuse_seen boolean not null default false;

comment on column public.comm_talk_sessions.abuse_seen is
  'Server-established: a turn in this session matched the abuse lexicon. Gates '
  'whether that lexicon may be sent to the transcriber. Never set from a request body.';
