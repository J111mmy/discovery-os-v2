# Discovery OS v2

Evidence intelligence platform for product teams. Cloud-native rebuild of the local os-cockpit prototype.

## Stack

- **Next.js 14** (App Router, TypeScript)
- **Supabase** — Postgres + pgvector + Auth
- **Inngest** — background job orchestration
- **Vercel** — deployment

## Quick start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment variables
```bash
cp .env.local.example .env.local
# Fill in your Supabase, Anthropic, OpenAI, and Inngest keys
```

### 3. Run database migrations
In the Supabase SQL editor (or via Supabase CLI):
```bash
# Via CLI:
supabase db push

# Or paste the contents of these files into the SQL editor:
# supabase/migrations/0001_initial_schema.sql
# supabase/migrations/0002_match_evidence_fn.sql
```

### 4. Start development server
```bash
npm run dev
```

### 5. Start Inngest dev server (separate terminal)
```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

Open [http://localhost:3000](http://localhost:3000)

## Project structure

```
src/
├── app/
│   ├── (auth)/          # Login, auth callback
│   ├── (app)/           # Protected app routes
│   └── api/             # Route handlers
│       ├── inngest/     # Inngest event handler
│       ├── ingest/      # Source ingest endpoint
│       ├── query/       # Evidence semantic search
│       └── compose/     # Document draft generation
├── lib/
│   ├── supabase/        # Browser + server clients
│   ├── inngest/         # Client + background functions
│   ├── llm/             # Model abstraction, persona detection, PII redaction
│   ├── compose/         # Draft pipeline
│   └── query/           # Evidence retrieval
└── types/               # Database types
supabase/
└── migrations/          # SQL schema files
```

## Architecture decisions

See `Discovery-OS-v2-PRD-final.docx` for full rationale. Key rules:

- Always `WHERE org_id = ?` — never trust project_id alone for multi-tenancy
- Three data layers: Source → Source_Segment → Evidence
- PII redaction runs before any LLM call — `raw_content` never sent to LLM
- Model names never hardcoded — use `task_tier` in `src/lib/llm/models.ts`
- Claim verification is async and non-blocking — inline UI flags only
