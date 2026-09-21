# Maison Studio — Phase 1: Supabase Backend Setup

This is the setup guide for standing up the Supabase backend behind Maison
Studio. It does not change anything in the existing app — `home.html`,
`content.html`, `planner.html`, `goals.html`, `board.html`, and `inbox.html`
still run entirely on localStorage until Phase 2 wires them up to this
backend. This phase is infrastructure only.

## What was inspected first

Before writing any schema, the live repo was cloned and every localStorage
key actually used across the six linked pages (`home`, `content`, `planner`,
`goals`, `board`, `inbox` — `board.html` turned out to be orphaned, not
linked from any nav, superseded by `content.html`) was traced through the
real code. The schema below is a direct mirror of those data shapes — same
field names in spirit, same relationships (e.g. `vaultRefs` on a content
item, the two goal "shapes" in one `goals` array) — not a redesign.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**.
2. Name it something like `maison-studio` (or `maison-studio-dev` if you
   want a separate project per environment later — recommended once you
   have real users, not needed yet).
3. Pick a strong database password and **save it somewhere** (1Password,
   etc.) — you'll need it for direct DB access later, though day-to-day work
   uses the API keys instead.
4. Pick a region close to you/your users.
5. Wait for provisioning (~2 min).

## 2. Apply the migration

The schema lives at `supabase/migrations/0001_init.sql` in this repo. It has
already been dry-run against a real Postgres 16 instance during development
(created every table, verified RLS is enabled on all 11 tables, verified the
`updated_at` triggers fire, verified the auto-create-profile-on-signup
trigger fires, and verified the file is safe to re-run) — so it should apply
cleanly.

**Option A — SQL editor (fastest, no local tooling needed)**
1. In the Supabase dashboard: **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase/migrations/0001_init.sql`.
3. Run it.
4. Check **Table Editor** — you should see 11 tables: `profiles`,
   `content_pillars`, `content_items`, `vault_items`, `planner_activities`,
   `planner_routines`, `goals`, `routine_goal_completions`, `inbox_status`,
   `home_tasks`, `home_schedule`.

**Option B — Supabase CLI (better once you have more than one migration)**
```powershell
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>   # found in Project Settings → General
supabase db push
```

## 3. Turn on email/password auth (or whichever providers you want)

**Authentication → Providers** in the dashboard. Email is on by default.
If you want Apple Sign-In (recommended for App Store review — Apple
requires it if you offer any other third-party login, and it's the most
native fit for an iPhone app), that gets configured in Phase 3 once the iOS
project exists, since it needs your Apple Developer Team ID.

## 4. Grab your API credentials

**Project Settings → API**:
- `Project URL`
- `anon` `public` key (safe to ship in client code — RLS is what actually
  protects the data, not secrecy of this key)

Keep the `service_role` key out of any client code entirely — it bypasses
RLS. You won't need it for the app itself.

## 5. What's in the schema, and why it maps this way

| localStorage key | Table | Notes |
|---|---|---|
| `content-desk-items` | `content_items` | Core pipeline items. `stage` is the same 0–7 int as `STAGES` in `content.html`. `media`/`checklist` kept as `jsonb` since the app already treats them as flexible arrays; `vault_refs` is a `uuid[]` to mirror the existing array-of-ids pattern rather than a join table. |
| `maison-content-pillars` | `content_pillars` | One row per pillar instead of one JSON array, so pillars can be queried/ordered independently. |
| `maison-vault-items` | `vault_items` | `linked_content_ids` kept as `uuid[]`, same pattern as `vault_refs` above. |
| `maison-planner-activities` | `planner_activities` | `content_id` is a real foreign key to `content_items` now (was just a string id). |
| `maison-planner-routines` | `planner_routines` | Direct mirror. |
| `maison-goals` | `goals` | Both goal "shapes" (`activity` and `outcome`) share one table, same as the original JSON array — columns only used by one type are just left null on the other. |
| `maison-routine-goal-completions` | `routine_goal_completions` | The old `"<goalId>:<weekStartISO>": true` map becomes real rows with a unique `(user_id, goal_id, week_start)` constraint — same information, queryable. |
| `maison-inbox-status` | `inbox_status` | Only your tags on emails (needs-reply/waiting/done) are stored — actual email content is never persisted, same as today; it's fetched live from Gmail. |
| `maison-home-v2` (`.tasks`) | `home_tasks` | Direct mirror. |
| `maison-home-v2` (`.schedule`) | `home_schedule` | Direct mirror. |
| *(new)* | `profiles` | Didn't exist before — one row per Supabase auth user, auto-created by a trigger the moment someone signs up. This is what makes every other table "belong" to a person. |

Every table has a `user_id uuid references auth.users(id)` column and a
row-level-security policy restricting all access to `auth.uid() = user_id`.
That's the actual multi-tenancy enforcement — even if a bug in the app
sent the wrong query, Postgres itself won't return another user's rows.

## 6. A few things worth deciding before Phase 2 (not urgent)

These don't block the backend from existing, but they're worth having an
opinion on before the app starts writing to it:

- **`board.html`** is dead code (not in any nav, superseded by
  `content.html`'s pipeline). Fine to leave as-is or delete later — no
  backend work was done for it since nothing links to it.
- **Gmail integration** in `inbox.html` currently uses Google's client-side
  implicit OAuth flow (`google.accounts.oauth2.initTokenClient`), which
  works in a desktop browser tab but does not work well inside a native iOS
  WebView. Phase 3 will need to swap this for either a native
  `ASWebAuthenticationSession` flow or Google's native iOS Sign-In SDK —
  flagging now so it's not a surprise later.
- **Planner's "goal strip"** (`maison-planner-goals`, a tiny separate
  `{name, current, target}` array) duplicates what `goals.html` now
  computes properly from real content data. It was **not** given its own
  table — Phase 2 should point that widget at the real `goals` table
  instead of carrying it forward as a second, stale goals concept.

## 7. Roadmap after this

1. **Phase 2 — Client integration**: add the Supabase JS client to each
   page, replace `localStorage.getItem/setItem` calls with Supabase reads/
   writes (page by page, so the app keeps working throughout), add sign-in/
   sign-up screens, add a one-time "import my local data" migration for your
   own existing localStorage content so nothing gets lost.
2. **Phase 3 — Capacitor/iOS**: wrap the (now backend-connected) web app in
   a Capacitor project, configure `capacitor.config.ts`, get it running in
   Xcode on a simulator/device, sort out the Gmail auth flow for native,
   set up icons/launch screens from your existing branding, and prep for
   TestFlight.
3. **Phase 4 — App Store**: Apple Developer account, App Store Connect
   listing, privacy nutrition labels (this matters here — you're now
   collecting real user data and reading Gmail), TestFlight beta, submission.

Say the word when you want to start Phase 2.
