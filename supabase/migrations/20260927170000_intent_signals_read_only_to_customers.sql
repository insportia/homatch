-- Homatch — a customer reads what was understood about them and writes none of it.
--
-- RLS already refuses a write: the table has one policy and it is SELECT, and a grant
-- without a permissive policy is refused. The grants are revoked anyway, for the same
-- reason `notifications` revokes its own — two independent things have to be wrong before
-- somebody can forge a signal, and "there is no policy for that" is a fact a future
-- migration can change by accident while adding an unrelated one.
--
-- What a forged row would be worth is the reason this is worth two mechanisms: an INSERT
-- here is somebody else demand, or your own interest in a stranger property, written
-- by you and believed by the matcher.

revoke insert, update, delete on public.intent_signals from authenticated, anon;

comment on column public.intent_signals.actor_user_id is
  'Resolved server-side from the row that owns the source event. A customer cannot write this table at all: RLS grants SELECT on their own rows and nothing else.';
