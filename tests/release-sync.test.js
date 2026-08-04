const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

test("website release files match the canonical root sources", () => {
  const projectRoot = path.resolve(__dirname, "..");
  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, "scripts", "sync-release-assets.mjs"), "--check"],
    { cwd: projectRoot, encoding: "utf8" },
  );

  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
});
