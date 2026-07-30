-- ============================================
-- Talo: Idempotent send RPC (Phase 5A — Offline Outbox)
-- See docs/phase-5a-offline-outbox-design.md §4.1.
--
-- send_message_idempotent(...) is an insert-or-return keyed on a CLIENT-minted
-- message id (a v4 UUID = the idempotency key). A retried send of the same id
-- hits the messages PK and returns the existing row instead of duplicating it,
-- so retries / missed-ACK re-drives can never create a second server row
-- (design Invariants #6/#7).
--
--   - SECURITY INVOKER: runs as the caller, so the existing messages RLS
--     (INSERT policy = room membership) applies unchanged. No new surface.
--   - sender_id is forced to auth.uid() inside the function — the client can
--     never spoof a sender.
--   - RETURNS SETOF messages reuses the existing row→domain mapping; a brand
--     new message has no reactions/votes yet, so none are embedded (the
--     realtime path stays authoritative for later embeds).
--
-- Additive: coexists with the plain INSERT send (messageService.sendMessage)
-- used by the flag-off path. Nothing is deleted.
-- ============================================

CREATE OR REPLACE FUNCTION public.send_message_idempotent(
  p_id         uuid,
  p_room_id    uuid,
  p_content    text,
  p_type       text,
  p_metadata   jsonb DEFAULT NULL,
  p_reply_to   uuid  DEFAULT NULL,
  p_created_at timestamptz DEFAULT now()
)
RETURNS SETOF public.messages
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- sender_id is forced to the caller (never trusted from the client)
  INSERT INTO public.messages (id, room_id, sender_id, content, type, metadata, reply_to, created_at)
  VALUES (p_id, p_room_id, auth.uid(), p_content, p_type, p_metadata, p_reply_to, p_created_at)
  ON CONFLICT (id) DO NOTHING;

  -- Return the row whether we just inserted it or it already existed (missed ACK).
  RETURN QUERY SELECT * FROM public.messages WHERE id = p_id;
END;
$$;
