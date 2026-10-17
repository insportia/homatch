-- Production as it stands before the expansion: the owner has toggled Live Chat
-- (version 4, OFF again) and the other five are at version 1, all OFF.
update public.service_controls set version = 4, reason = 'owner tested live chat', updated_by = 'aaaaaaaa-0000-0000-0000-00000000000a'
 where service_key = 'live_chat';
create table public._before as select * from public.service_controls;
