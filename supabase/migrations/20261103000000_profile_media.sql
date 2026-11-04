-- Profile picture and banner.
--
-- Images live in Supabase Storage (bucket `profile-media`, public to read),
-- one folder per user: <user id>/avatar.jpg and <user id>/banner.jpg. The
-- profile row keeps the public URL so pages can show it without a storage
-- lookup. Apply with `supabase db push` (or paste into the SQL editor).

alter table public.profiles
  add column if not exists avatar_url text check (avatar_url is null or avatar_url ~ '^https?://'),
  add column if not exists banner_url text check (banner_url is null or banner_url ~ '^https?://');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-media', 'profile-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone can view profile images; users manage only their own folder.
drop policy if exists "profile media: public read" on storage.objects;
create policy "profile media: public read"
  on storage.objects for select
  using (bucket_id = 'profile-media');

drop policy if exists "profile media: owner writes" on storage.objects;
create policy "profile media: owner writes"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "profile media: owner updates" on storage.objects;
create policy "profile media: owner updates"
  on storage.objects for update to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "profile media: owner deletes" on storage.objects;
create policy "profile media: owner deletes"
  on storage.objects for delete to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);
