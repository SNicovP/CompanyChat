# CompanyChat

Internal team chat (Slack/Teams alternative). Nuxt 4 + Supabase.

## Setup
```bash
npm install
cp .env.example .env   # fill in Supabase URL + key
npm run dev
```

## Supabase
- Local: needs Docker. `npx supabase start`, then copy the printed API URL and anon key into `.env`.
- Cloud: create a project, `npx supabase link`, then `npx supabase db push`.

## Roadmap (one branch per stage)
1. feat/initial-scaffold: Nuxt, Supabase config, tooling
2. Auth, profiles, route guards
3. Schema + RLS: clients, projects, memberships, roles
4. Realtime channel messaging
5. DMs
6. Presence and status
7. Admin UI

Requires Node ^22.21 || ^24.11 || >=26 (Nuxt 4).

## Auth
- Invite-only: public signup is disabled (`enable_signup = false`). Invite users from the Supabase dashboard (Authentication > Users > Invite) or create them there.
- The first user created becomes the `owner`; everyone after is a `member`.

## Roles and access
- App roles: `owner` > `admin` > `member`. Owner/admin manage all clients, projects and memberships. Only the owner can promote/demote (`set_app_role`).
- Client and project memberships: `manager` > `member`. A client manager manages that client's members and projects.
- Projects are visible to all client members unless marked private (then only channel members, the client's managers and admins).
- DMs are created with `get_or_create_dm` and are visible only to participants, admins included.

## Tests
`npm test` runs the RLS policies against an in-process Postgres (PGlite), no Docker needed.

## Messaging
- Sidebar lists the clients you belong to with their projects, plus your DMs. Admins create clients and projects; a client's managers create projects for it.
- Messages load the latest 100 and update live (Supabase Realtime, subject to the same RLS as reads). Authors can edit/delete their own; project managers can delete any message in their project.

## Resetting for go-live
Wipe test content but keep the schema and users:
```sql
truncate public.messages, public.channel_members, public.channels, public.client_members, public.clients cascade;
```
`npx supabase db reset --linked` also deletes users; the first user created afterwards becomes the owner again.

## Managing people
- Client page (`/clients/<id>`, click a client name in the sidebar): managers and admins add/remove client members and change roles.
- Project members: the "Members" button in a project channel (private projects: only listed people, the client's managers and admins can see it).
- Users page (`/admin/users`, admins): see everyone; only the owner changes app roles. Invites still go through the Supabase dashboard.

## Presence
- Connected users are tracked with Supabase Realtime Presence; anyone not connected shows grey/Offline, connected users show their manual status (Online/Away/Busy/Do not disturb).
- Status changes reach other users live (profiles are in the realtime publication).

## Unread counts
- Read markers live in `channel_reads` and are only reachable through `mark_channel_read` / `get_unread_counts`.
- Opening (or focusing) a channel marks it read; new messages in other channels bump a sidebar badge and the browser tab title.
- A project you have never seen starts as "read now" so old history isn't flagged; a new DM counts from its first message.

## Inviting and deactivating users
Both need the service role key, so they run in a Supabase Edge Function (`supabase/functions/admin-users`), never in the browser. The authorization rules live in `supabase/functions/_shared/policy.ts` (unit tested).

One-time setup:
```bash
npx supabase db push
npx supabase secrets set SITE_URL=http://localhost:3000   # your real app URL once deployed
npx supabase functions deploy admin-users --use-api
```
In the Supabase dashboard (Authentication > URL Configuration) add `<SITE_URL>/**` to the Redirect URLs, and check Authentication > Emails if you want to customise the invite email.

- Invite: Admin > Users > "Invite someone". They get an email, choose a password at `/set-password`, and appear in the list.
- Deactivate: bans the auth user (no sign-in or token refresh) and flips `profiles.is_active`; restrictive RLS policies cut off any session that is still valid. History is kept. Reactivate reverses it. Admins can deactivate members; only the owner can deactivate admins; nobody can deactivate the owner or themselves.
- Supabase's built-in email sender is rate-limited; configure custom SMTP before inviting many people.

## Attachments
- Attach with the paperclip, paste an image, or drop files onto the composer (up to 5 files, 10 MB each).
- Files go to the private `attachments` storage bucket at `<channel_id>/<message_id>/<n>_<name>`; `message_attachments` records them. Storage policies mirror channel access: only the message author uploads into their message's folder, channel members read, the uploader or a project manager deletes.
- Viewed through signed URLs (6 hours). PNG/JPEG/GIF/WebP show inline; everything else (including SVG) downloads.
- Deleting one attachment (the x on hover; the author or a project manager) removes the file but keeps the message, which then shows an "Attachment deleted" tag. Deleting the whole message removes its files too (best effort from the app). Files orphaned by a failed delete can be cleaned up later from the Storage page.
