import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the analyzer companion exposes data and improves human-facing Ollama texts", async () => {
  const repository = await readFile(new URL("../companions/digital-akte-analyzer-1.2.4/app/repository.py", import.meta.url), "utf8");
  const main = await readFile(new URL("../companions/digital-akte-analyzer-1.2.4/app/main.py", import.meta.url), "utf8");
  const ollama = await readFile(new URL("../companions/digital-akte-analyzer-1.2.4/app/ollama.py", import.meta.url), "utf8");
  assert.match(repository, /short_title/);
  assert.match(repository, /keywords/);
  assert.match(repository, /search_text/);
  assert.match(repository, /analysis_results/);
  assert.match(repository, /prepare_prompt_upgrade/);
  assert.match(main, /version="1\.2\.4"/);
  assert.match(main, /"app_version": "1\.2\.4"/);
  assert.match(ollama, /digital-akte-v3\.3-presentation/);
  assert.match(ollama, /Niemals Seitenzahlen/);
  assert.match(ollama, /Immer Gegenstand oder Anlass nennen/);
});

test("the Paperless AI search starts only after explicit submission", async () => {
  const component = await readFile(new URL("../app/personallab.tsx", import.meta.url), "utf8");
  assert.match(component, /<form className="searchBox compactSearch" onSubmit=/);
  assert.match(component, /searchRevision/);
  assert.doesNotMatch(component, /window\.setTimeout\(async \(\) => \{\s*setRagSearch/);
  assert.match(component, /ANTWORT DER PAPERLESS KI-SUCHE/);
  assert.match(component, /presentationSummary: source\.excerpt/);
});
