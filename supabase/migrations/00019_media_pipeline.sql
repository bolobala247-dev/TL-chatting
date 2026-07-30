-- ============================================
-- Talo: Media pipeline hardening (Phase 7A/7B — media plane)
-- See docs/phase-7a-media-pipeline-design.md §4.4, §13.3.
--
-- Three additive changes, all backward compatible with the legacy
-- sendAlbumMessage path and old clients:
--   1. Extend send_message_idempotent with p_attachments / p_media_url so a
--      media message delivers with its attachments already rewritten to remote
--      URLs by the completion gate — keeping the server row authoritative so a
--      realtime echo can never wipe them (design M10).
--   2. Harden the chat-media bucket: size limit + MIME allowlist (§13.1).
--   3. Add a UUID-shape guard to the chat-media write policies so object paths
--      must begin with a well-formed room-id folder (§13.3). Membership is
--      still required; legacy paths ({roomId}/{ts}.jpg) still pass.
--
-- The messages.type CHECK already allows 'video' (00008/00013) and the
-- attachments/media_url columns already exist (00001/00009) — nothing to add.
-- ============================================

-- --------------------------------------------------------------------------
-- 1. Idempotent send RPC — add optional media columns
--
-- DROP first: adding defaulted params changes the argument list, so
-- CREATE OR REPLACE would register a SECOND overload and make calls with the
-- original 7-arg shape ambiguous. Dropping the exact old signature and
-- recreating keeps a single function (design §4.4 / RPC gap note).
-- --------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.send_message_idempotent(
  uuid, uuid, text, text, jsonb, uuid, timestamptz
);

CREATE OR REPLACE FUNCTION public.send_message_idempotent(
  p_id          uuid,
  p_room_id     uuid,
  p_content     text,
  p_type        text,
  p_metadata    jsonb       DEFAULT NULL,
  p_reply_to    uuid        DEFAULT NULL,
  p_created_at  timestamptz DEFAULT now(),
  p_attachments jsonb       DEFAULT NULL,
  p_media_url   text        DEFAULT NULL
)
RETURNS SETOF public.messages
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- sender_id is forced to the caller (never trusted from the client).
  -- attachments/media_url are NULL for text/poll sends (unchanged behavior)
  -- and carry the remote-rewritten media for a media message.
  INSERT INTO public.messages (
    id, room_id, sender_id, content, type, metadata, reply_to, created_at,
    attachments, media_url
  )
  VALUES (
    p_id, p_room_id, auth.uid(), p_content, p_type, p_metadata, p_reply_to,
    p_created_at, p_attachments, p_media_url
  )
  ON CONFLICT (id) DO NOTHING;

  -- Return the row whether we just inserted it or it already existed (missed ACK).
  RETURN QUERY SELECT * FROM public.messages WHERE id = p_id;
END;
$$;

-- --------------------------------------------------------------------------
-- 2. Bucket hardening (idempotent update; §13.1)
--    100 MB matches MEDIA_MAX_VIDEO_BYTES; the allowlist is the curated set of
--    kinds the pipeline produces (images/videos re-encoded to jpeg/png/mp4,
--    common document/file types). Legacy objects remain readable (public read).
-- --------------------------------------------------------------------------

UPDATE storage.buckets
   SET file_size_limit = 104857600,
       allowed_mime_types = ARRAY[
         'image/jpeg', 'image/png', 'image/webp', 'image/gif',
         'image/heic', 'image/heif',
         'video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm',
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.ms-powerpoint',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         'text/plain', 'text/csv',
         'application/zip',
         'audio/mpeg', 'audio/mp4', 'audio/wav'
       ]
 WHERE id = 'chat-media';

-- --------------------------------------------------------------------------
-- 3. Path-shape guard on chat-media writes (§13.3)
--    The membership predicate (00007/00015) is preserved; we additionally
--    require the first path folder to be a well-formed UUID (the room id), so
--    a member can only write into a real room folder. DROP + recreate because
--    Postgres has no ALTER POLICY ... WITH CHECK for storage.objects here.
-- --------------------------------------------------------------------------

DROP POLICY IF EXISTS "chat_media_auth_insert" ON storage.objects;
CREATE POLICY "chat_media_auth_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    AND EXISTS (
      SELECT 1 FROM public.room_participants rp
      WHERE rp.room_id::text = (storage.foldername(name))[1]
        AND rp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chat_media_auth_update" ON storage.objects;
CREATE POLICY "chat_media_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    AND EXISTS (
      SELECT 1 FROM public.room_participants rp
      WHERE rp.room_id::text = (storage.foldername(name))[1]
        AND rp.user_id = auth.uid()
    )
  );
