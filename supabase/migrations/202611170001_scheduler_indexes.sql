-- The routine scheduler lists every account's live routines on each wake. Records are keyed by
-- (user_id, collection, id), so a filter on collection alone could only scan the whole table.
-- This partial index holds just the live routine rows, so the scheduler reads only those.
create index if not exists brain_records_live_routines
  on public.brain_records (user_id, id)
  where collection = 'routines' and deleted = false;
