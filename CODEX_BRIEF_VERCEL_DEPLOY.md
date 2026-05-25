# Codex Brief — Vercel Deployment + Logout Button

## Goal
Get Discovery OS v2 live on Vercel and add a logout button to the app nav.

---

## Part 1 — Logout button

The app now has a sign out control in the main app nav and admin nav.

Primary route:

- `POST /api/auth/sign-out`

Compatibility route:

- `POST /api/auth/signout`

---

## Part 2 — Vercel deployment

### Step 1 — Create Vercel project

1. Go to [vercel.com](https://vercel.com) → New Project
2. Import the GitHub repo (`discovery-os-v2`)
3. Framework preset: **Next.js** (auto-detected)
4. Root directory: leave as-is (repo root is the Next.js project)
5. Do **not** deploy yet — set env vars first

### Step 2 — Environment variables

Add all of the following in Vercel → Project → Settings → Environment Variables. Set each one for **Production**, **Preview**, and **Development**.

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role secret key |
| `ANTHROPIC_API_KEY` | Anthropic console → API Keys |
| `OPENAI_API_KEY` | OpenAI platform → API Keys |
| `INNGEST_EVENT_KEY` | Inngest Dashboard → Project → Keys |
| `INNGEST_SIGNING_KEY` | Inngest Dashboard → Project → Keys |
| `NEXT_PUBLIC_APP_URL` | The Vercel production URL, e.g. `https://discovery-os.vercel.app` |

> `SUPABASE_SERVICE_ROLE_KEY` is secret — mark it as sensitive/encrypted in Vercel.
> Current CLI check showed no Vercel environment variables configured yet, so this is the deployment blocker.

### Step 3 — Deploy

Click **Deploy**. The build should pass cleanly (`npm run build` passes locally). First deploy typically takes ~2 minutes.

Note the production URL Vercel assigns (e.g. `https://discovery-os-v2.vercel.app`).

### Step 4 — Supabase auth redirect URLs

After deploy, add the production URL to Supabase's allowed redirect list:

1. Supabase Dashboard → **Authentication → URL Configuration**
2. **Site URL**: set to your Vercel production URL (e.g. `https://discovery-os-v2.vercel.app`)
3. **Redirect URLs**: add `https://discovery-os-v2.vercel.app/**`

Without this, login redirects will fail in production.

### Step 5 — Inngest production sync

Inngest needs to know your production endpoint:

1. Inngest Dashboard → **Apps**
2. Add app URL: `https://your-vercel-url.vercel.app/api/inngest`
3. Inngest will auto-sync the function list on first request

### Step 6 — Verify post-deploy

- [ ] `/login` loads and accepts credentials
- [ ] Uploading a source triggers background processing (check Inngest dashboard)
- [ ] `/admin` loads for the super admin user
- [ ] Sign out button works and redirects to `/login`

---

## What NOT to change

- `next.config.ts` — already correct for Vercel
- Supabase RLS policies — production uses the same schema as local
- Inngest functions — no changes needed, they auto-register via `/api/inngest`

---

## TypeScript check before committing

```bash
cd discovery-os-v2
npm run type-check
npm run build
```

Both must pass before pushing.
