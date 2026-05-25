# Deployment Guide

## GitHub setup (first time only)

The `discovery-os-v2` folder must be its own standalone git repository — separate from the parent Discovery OS folder which contains internal documents that must not be made public.

```bash
cd "/Users/jimmykeogh/PM - Assistant/Discovery/Product Discovery/Discovery OS/discovery-os-v2"

# Remove any inherited git tracking from the parent repo
rm -rf .git

# Init fresh repo
git init
git branch -M main
git add .
git commit -m "chore: initial commit — Discovery OS v2"

# Create a new repo at github.com (name: discovery-os-v2) then:
git remote add origin https://github.com/YOUR_USERNAME/discovery-os-v2.git
git push -u origin main
```

## Vercel deployment

1. Go to vercel.com → New Project → Import from GitHub → select `discovery-os-v2`
2. Framework: Next.js (auto-detected)
3. Root directory: `.` (the repo root is already the Next.js project)
4. Set Node.js Version to **20.x** in Vercel → Project Settings → General.
5. Add environment variables for **Production**, **Preview**, and **Development**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY`
   - `INNGEST_EVENT_KEY` (from Inngest dashboard → project → Event keys)
   - `INNGEST_SIGNING_KEY` (from Inngest dashboard → project → Signing key)
   - `NEXT_PUBLIC_APP_URL` (set to your Vercel URL, e.g. https://discovery-os.vercel.app)

6. Deploy

## Inngest production sync

After deploy, register the production app with Inngest:
- Go to app.inngest.com → your project → Apps → Add app
- URL: `https://YOUR_VERCEL_URL/api/inngest`

## Supabase auth redirect URL

Add your Vercel URL to Supabase allowed redirects:
- Supabase Dashboard → Authentication → URL Configuration
- Site URL: `https://YOUR_VERCEL_URL`
- Redirect URLs:
  - `https://YOUR_VERCEL_URL/auth/callback`
  - `https://YOUR_VERCEL_URL/reset-password`
  - `https://YOUR_VERCEL_URL/**`

## Post-deploy verification

- `/login` loads and accepts credentials.
- Sign out redirects to `/login`.
- `/admin` loads for users in `super_admins`.
- Uploading a source queues and completes in Inngest.
- Evidence, sources, documents, people, companies, and competitors pages render without server errors.
