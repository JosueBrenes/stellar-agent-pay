/**
 * Test runner. Resolves the test files itself instead of relying on a shell glob,
 * because Windows shells do not expand globs and node 20's --test does not
 * discover TypeScript files on its own.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_DIR = path.join(ROOT, "test");

function collect(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collect(full);
    return entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

const files = collect(TEST_DIR);
if (files.length === 0) {
  console.error(`no test files found under ${TEST_DIR}`);
  process.exit(1);
}

const child = spawn(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit",
  cwd: ROOT,
});
child.on("close", (code) => process.exit(code ?? 1));
