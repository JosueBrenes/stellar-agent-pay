/**
 * End-to-end smoke test that needs no keys, no funds and no network:
 * boots the offline mock seller and asserts the CLI's policy verdicts and exit codes.
 *
 *   npm run smoke
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "dist", "cli.js");
const PORT = Number(process.env.SMOKE_PORT || 4123);
const BASE = `http://localhost:${PORT}`;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "stellar-agent-pay-smoke-"));

if (!fs.existsSync(CLI)) {
  console.error("dist/cli.js is missing, run `npm run build` first");
  process.exit(1);
}

const env = { ...process.env, STELLAR_AGENT_PAY_HOME: HOME, PORT: String(PORT), NO_COLOR: "1" };

function cli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function waitForServer(attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      await fetch(`${BASE}/free`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`mock seller never came up on ${BASE}`);
}

const server = spawn(process.execPath, [path.join(ROOT, "examples", "mock-seller", "server.js")], {
  env,
  stdio: "ignore",
});

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures++;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
};

try {
  await waitForServer();

  const init = await cli(["init"]);
  check("init writes a policy", () => assert.equal(init.code, 0));

  const unlisted = await cli(["unlock", `${BASE}/weather`, "--dry-run"]);
  check("an unlisted domain is blocked (exit 2)", () => {
    assert.equal(unlisted.code, 2);
    assert.match(unlisted.stderr, /domain_allowlist/);
  });

  const allow = await cli(["policy", "allow", "localhost"]);
  check("policy allow succeeds", () => assert.equal(allow.code, 0));

  const cheap = await cli(["unlock", `${BASE}/weather`, "--dry-run"]);
  check("a cheap resource is inside the policy (exit 0)", () => {
    assert.equal(cheap.code, 0);
    assert.match(cheap.stderr, /WOULD PAY/);
  });

  const expensive = await cli(["unlock", `${BASE}/premium-report`, "--dry-run", "--json"]);
  check("an over-priced resource is blocked (exit 2)", () => {
    assert.equal(expensive.code, 2);
    const payload = JSON.parse(expensive.stdout);
    assert.equal(payload.allowed, false);
    assert.equal(payload.rule, "max_per_request");
    assert.equal(payload.amount, "0.50");
  });

  const free = await cli(["unlock", `${BASE}/free`]);
  check("a free resource needs no payment", () => {
    assert.equal(free.code, 0);
    assert.match(free.stdout, /costs nothing/);
  });

  const audited = await cli(["audit", "--tail", "10"]);
  check("every attempt is written to the audit log", () => {
    assert.equal(audited.code, 0);
    assert.match(audited.stdout, /SIMULATED/);
    assert.equal(audited.stdout.split("\n").filter(Boolean).length >= 3, true);
  });

  const status = await cli(["status", "--json", "--offline"]);
  check("status reports the policy and spend", () => {
    assert.equal(status.code, 0);
    const payload = JSON.parse(status.stdout);
    assert.equal(payload.policy.allowedDomains.includes("localhost"), true);
    assert.equal(payload.spend24h.total, "0.00");
  });
} finally {
  server.kill();
  fs.rmSync(HOME, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log("\nall smoke checks passed");
