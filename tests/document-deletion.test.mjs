import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("only deactivates documents in PersonalLab and can restore them", async () => {
  const [ui, server] = await Promise.all([
    readFile(new URL("../app/personallab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../local-api/server.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(ui, /editMode && <button className="dangerButton"/);
  assert.match(ui, /Dokument ausblenden\?/);
  assert.match(ui, /Paperless wurde nicht verändert/);
  assert.doesNotMatch(ui, /method: "DELETE"/);
  assert.match(server, /disablePersonalLabDocument/);
  assert.match(server, /restorePersonalLabDocument/);
  assert.doesNotMatch(server, /method: "DELETE"/);
  assert.match(server, /state\.documents = state\.documents\.filter/);
  assert.match(server, /disabledDocuments/);
});
