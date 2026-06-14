#!/usr/bin/env node
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    const value = rawValue
      .replace(/^(['"])(.*)\1$/, "$2")
      .replace(/\\n/g, "\n");
    process.env[key] = value;
  }
}

loadEnvFile(path.join(repoRoot, ".env.local"));
loadEnvFile(path.join(repoRoot, ".env"));

require("sucrase/register");

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolveWithTsAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const mapped = path.join(repoRoot, "src", request.slice(2));
    return originalResolve.call(this, mapped, parent, isMain, options);
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).replace(/-/g, "_");
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

async function resolveOrgId(projectId, suppliedOrgId) {
  if (suppliedOrgId) return suppliedOrgId;
  const { createClient } = require("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("projects")
    .select("org_id")
    .eq("id", projectId)
    .single();
  if (error || !data) {
    throw new Error(`Could not resolve org_id for project ${projectId}: ${error?.message ?? "not found"}`);
  }
  return data.org_id;
}

const args = parseArgs(process.argv.slice(2));
const projectId = args.project_id;
const prompt = args.prompt;
const limit = args.limit ? Number.parseInt(args.limit, 10) : 18;

if (!projectId || !prompt) {
  console.error(
    [
      "Usage:",
      "  npm run dry-run:structure-compose -- --project-id <uuid> --prompt \"...\" [--org-id <uuid>] [--limit 18]",
      "",
      "This performs the #26 structure-driven compose dry-run: real scoped reads + real LLM, zero artifact/artifact_* writes.",
    ].join("\n")
  );
  process.exit(2);
}

const orgId = await resolveOrgId(projectId, args.org_id);
const { composeStructureDraft } = require("./structure.ts");

const draft = await composeStructureDraft({
  org_id: orgId,
  project_id: projectId,
  prompt,
  limit: Number.isFinite(limit) ? limit : 18,
  dry_run: true,
});

process.stdout.write(`${JSON.stringify(draft.report, null, 2)}\n`);
