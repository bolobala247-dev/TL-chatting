-- Storage: create the buckets the app depends on. Avatar/image uploads were
-- failing with "Bucket not found" because these were never provisioned.
--   avatars    — profile pictures, path: {userId}/{timestamp}.jpg
--   chat-media — image messages,   path: {roomId}/{timestamp}.jpg
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('avatars', 'avatars', true),
  ('chat-media', 'chat-media', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies on storage.objects (public read since buckets are public;
-- writes restricted to authenticated users).

-- avatars: users may only write inside their own {userId}/ folder
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "avatars_auth_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- chat-media: only participants of the room ({roomId}/ folder) may upload
CREATE POLICY "chat_media_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'chat-media');

CREATE POLICY "chat_media_auth_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.room_participants rp
      WHERE rp.room_id::text = (storage.foldername(name))[1]
        AND rp.user_id = auth.uid()
    )
  );
