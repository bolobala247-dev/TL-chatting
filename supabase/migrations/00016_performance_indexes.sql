-- ============================================
-- Talo: Performance indexes (index-only — no schema changes)
--
-- 1. FK indexes on every column referencing messages(id).
--    A hard message delete (undo send, messageService.deleteMessage)
--    fires ON DELETE CASCADE / SET NULL referential checks that
--    previously seq-scanned messages.reply_to (the whole messages
--    table per delete!), saved_messages, scheduled_messages and
--    user_reports. thread_id is already covered by idx_messages_thread.
--    Partial WHERE ... IS NOT NULL keeps them tiny: the RI check is a
--    strict equality, so the planner can still use them.
--
-- 2. profiles lookup indexes.
--    get_email_by_username / is_username_available filter on
--    lower(username) — the plain btree can't serve that (login path).
--    search_profiles uses ILIKE '%q%' on username/display_name —
--    pg_trgm (enabled in 00012) GIN indexes back both.
--
-- 3. Drop idx_profiles_username: fully redundant with the UNIQUE
--    constraint's own index (profiles_username_key) — pure write
--    overhead on every profile update.
-- ============================================

-- ============================================
-- 1. FK indexes for the message-delete path
-- ============================================

CREATE INDEX IF NOT EXISTS idx_messages_reply_to
  ON public.messages(reply_to)
  WHERE reply_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_saved_messages_message
  ON public.saved_messages(message_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_reply_to
  ON public.scheduled_messages(reply_to)
  WHERE reply_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_sent_message
  ON public.scheduled_messages(sent_message_id)
  WHERE sent_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_reports_message
  ON public.user_reports(message_id)
  WHERE message_id IS NOT NULL;

-- ============================================
-- 2. profiles: login + user search
-- ============================================

-- Backs lower(username) = lower($1) in get_email_by_username (00005)
-- and is_username_available (00010)
CREATE INDEX IF NOT EXISTS idx_profiles_username_lower
  ON public.profiles(lower(username));

-- Backs username/display_name ILIKE '%q%' in search_profiles (00010)
CREATE INDEX IF NOT EXISTS idx_profiles_username_trgm
  ON public.profiles USING GIN (username gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_profiles_display_name_trgm
  ON public.profiles USING GIN (display_name gin_trgm_ops)
  WHERE display_name IS NOT NULL;

-- ============================================
-- 3. Drop the duplicate username index
-- (UNIQUE constraint profiles_username_key already indexes it)
-- ============================================

DROP INDEX IF EXISTS public.idx_profiles_username;
