import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("the transferred Icey Server repo retains its product-specific skill", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aster-icey-server-"));
  try {
    await writeFile(path.join(root, "README.md"), "# Icey Server\n");
    await writeFile(path.join(root, "VERSION"), "0.2.5\n");
    await writeFile(path.join(root, "ICEY_VERSION"), "2.5.1\n");
    const script = fileURLToPath(new URL("./prepare-skill-upstream.mjs", import.meta.url));
    execFileSync(process.execPath, [script, "--target-repo-dir", root,
      "--target-repo", "auscaster/icey-server", "--output-dir", path.join(root, "output")],
    { stdio: "pipe" });
    const skill = await readFile(path.join(root, "SKILL.md"), "utf8");
    assert.match(skill, /name: icey-server-operator/);
    assert.match(skill, /auscaster\/icey-server/);
    assert.match(skill, /ghcr\.io\/auscaster\/icey-server:latest/);
    assert.match(skill, /pinned core `auscaster\/icey`/);
    assert.doesNotMatch(skill, /nilstate\/|0state\/icey-server|Docker Hub/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
