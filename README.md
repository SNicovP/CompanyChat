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
