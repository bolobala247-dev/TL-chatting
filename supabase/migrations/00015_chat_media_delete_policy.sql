-- Storage cleanup: clients now remove chat-media objects when the media is
-- deleted app-side (message recall, group avatar replacement) so the bucket
-- does not grow unbounded. 00007 only created INSERT for chat-media, so
-- UPDATE (needed by upsert) and DELETE were silently denied by RLS.
-- Same rule as inserts: only participants of the {roomId}/ folder may touch it.

CREATE POLICY "chat_media_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.room_participants rp
      WHERE rp.room_id::text = (storage.foldername(name))[1]
        AND rp.user_id = auth.uid()
    )
  );

CREATE POLICY "chat_media_auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.room_participants rp
      WHERE rp.room_id::text = (storage.foldername(name))[1]
        AND rp.user_id = auth.uid()
    )
  );
