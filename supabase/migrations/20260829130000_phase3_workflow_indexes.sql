-- Production workflow indexes for chat, notifications, and viewing requests.
create index if not exists idx_conversations_property on public.conversations(property_id) where property_id is not null;
create index if not exists idx_messages_sender on public.messages(sender_id);
create index if not exists idx_message_receipts_user on public.message_receipts(user_id);
create index if not exists idx_conversation_blocks_blocked on public.conversation_blocks(blocked_id);
create index if not exists idx_contact_shares_sharer on public.conversation_contact_shares(sharer_id);
create index if not exists idx_viewing_requests_property on public.viewing_requests(property_id);
create index if not exists idx_viewing_requests_conversation on public.viewing_requests(conversation_id) where conversation_id is not null;
create index if not exists idx_viewing_requests_completed_by on public.viewing_requests(completed_by) where completed_by is not null;
create index if not exists idx_notifications_property on public.notifications(property_id) where property_id is not null;
