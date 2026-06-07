import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = mkdtempSync(path.join(repoRoot, ".tmp-artifact-html-sanitizer-"));

function findCompiledFile(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findCompiledFile(fullPath);
      if (found) return found;
    }

    if (entry.isFile() && entry.name === "artifact-html.js") {
      return fullPath;
    }
  }

  return null;
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  execFileSync(
    path.join(repoRoot, "node_modules/.bin/tsc"),
    [
      "src/lib/sanitize/artifact-html.ts",
      "src/lib/sanitize/artifact-markdown.ts",
      "--target",
      "ES2020",
      "--module",
      "commonjs",
      "--moduleResolution",
      "node",
      "--esModuleInterop",
      "--skipLibCheck",
      "--outDir",
      outDir,
    ],
    { cwd: repoRoot, stdio: "inherit" }
  );

  const compiledFile = findCompiledFile(outDir);
  if (!compiledFile) {
    throw new Error("Could not find compiled artifact-html.js");
  }

  const require = createRequire(import.meta.url);
  const { sanitizeArtifactHtml, validateSanitizedArtifactHtml } = require(compiledFile);
  const { markdownToSanitizedArtifactHtml } = require(path.join(path.dirname(compiledFile), "artifact-markdown.js"));

  const richDoc = sanitizeArtifactHtml(`
    <section class="sec unknown" id="sec-one">
      <h2 class="dp-h2" data-section="The problem"><span class="dp-num">01</span>The problem</h2>
      <p class="lede">Trusted claim <cite data-n="3">3</cite></p>
    </section>
  `);
  expect(richDoc.includes('class="sec"'), "allowed section class should remain");
  expect(!richDoc.includes("unknown"), "unknown class should be stripped");
  expect(richDoc.includes('data-n="3"'), "valid citation data-n should remain");

  const hostileMarkup = sanitizeArtifactHtml(`
    <p onclick="alert(1)" style="color:red">Text <svg><circle /></svg><script>alert(1)</script></p>
  `);
  expect(!hostileMarkup.includes("onclick"), "event handler should be stripped");
  expect(!hostileMarkup.includes("style="), "inline style should be stripped");
  expect(!hostileMarkup.includes("<svg"), "svg should be stripped");
  expect(!hostileMarkup.includes("<script"), "script should be stripped");

  const bodyTextWithDangerousWords = sanitizeArtifactHtml(`
    <pre>javascript:alert(1) and data:text/plain are plain body text here.</pre>
  `);
  validateSanitizedArtifactHtml(bodyTextWithDangerousWords);
  expect(
    bodyTextWithDangerousWords.includes("javascript:alert(1)") &&
      bodyTextWithDangerousWords.includes("data:text/plain"),
    "validator must not reject or strip dangerous-looking body text"
  );

  const hrefs = sanitizeArtifactHtml(`
    <a href="javascript:alert(1)">bad</a>
    <a href="data:text/plain,hello">also bad</a>
    <a href="/relative">relative</a>
    <a href="https://example.com">ok</a>
    <a href="mailto:test@example.com">mail</a>
  `);
  expect(!hrefs.includes("javascript:"), "javascript href should be stripped");
  expect(!hrefs.includes("data:text"), "data href should be stripped");
  expect(!hrefs.includes('href="/relative"'), "relative href should be stripped");
  expect(hrefs.includes('href="https://example.com"'), "https href should remain");
  expect(hrefs.includes('href="mailto:test@example.com"'), "mailto href should remain");

  const citationAttrs = sanitizeArtifactHtml(`
    <cite data-n="01">bad</cite>
    <span class="ev" data-n="99999">bad</span>
    <span data-n="4">not evidence</span>
    <span class="ev" data-n="4">4 sources</span>
  `);
  expect(!citationAttrs.includes('data-n="01"'), "leading-zero data-n should be stripped");
  expect(!citationAttrs.includes('data-n="99999"'), "oversized data-n should be stripped");
  expect(citationAttrs.includes('<span>not evidence</span>'), "span data-n without ev class should be stripped");
  expect(citationAttrs.includes('<span class="ev" data-n="4">'), "valid ev data-n should remain");

  const flowAndSplit = sanitizeArtifactHtml(`
    <div class="dp-split">
      <div><ol class="flow"><li class="flow-step pain"><span class="fs-n">01</span><span class="fs-t">Bounce</span><span class="fs-d">Two days lost.</span></li></ol></div>
      <div><ul class="dp-list pos"><li>Validated</li></ul></div>
    </div>
  `);
  expect(flowAndSplit.includes('class="dp-split"'), "split class should remain");
  expect(flowAndSplit.includes('class="flow-step pain"'), "flow step classes should remain");
  expect(flowAndSplit.includes('class="dp-list pos"'), "list tone classes should remain");

  const markdownFallback = markdownToSanitizedArtifactHtml(`
    # Legacy brief

    ## Evidence section

    Claim with citation [2] and **bold** text.

    <script>alert(1)</script>
  `);
  expect(markdownFallback.includes('<header class="dp-hero"><h1>Legacy brief</h1></header>'), "markdown h1 should become contract hero");
  expect(markdownFallback.includes('<cite data-n="2">2</cite>'), "markdown citation should become cite[data-n]");
  expect(!markdownFallback.includes("<script>"), "markdown fallback should escape script tags before sanitizing");

  console.log("artifact-html sanitizer checks passed");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
