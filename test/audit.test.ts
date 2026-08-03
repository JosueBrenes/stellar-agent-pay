import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { USDC_TESTNET_ADDRESS } from "@x402/stellar";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "stellar-agent-pay-test-"));
process.env.STELLAR_AGENT_PAY_HOME = HOME;

const { buildEvent, readEvents, recordEvent, renderAuditLine, spendSince, DAY_MS } =
  await import("../src/core/audit.js");
const { toAtomic } = await import("../src/core/money.js");

after(() => fs.rmSync(HOME, { recursive: true, force: true }));

test("a recorded payment lands in both the human log and the event ledger", () => {
  recordEvent(
    buildEvent({
      result: "paid",
      method: "GET",
      url: "https://api.example.com/weather",
      domain: "api.example.com",
      network: "stellar:testnet",
      amount: toAtomic("0.001").toString(),
      asset: USDC_TESTNET_ADDRESS,
      tx: "abc123",
      mode: "x402",
    }),
  );

  const line = fs.readFileSync(path.join(HOME, "audit.log"), "utf8").trim();
  assert.match(line, /PAID/);
  assert.match(line, /api\.example\.com/);
  assert.match(line, /0\.001 USDC/);
  assert.match(line, /tx=abc123/);

  const events = readEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]!.policyUnits, toAtomic("0.001").toString());
});

test("blocked attempts are audited but never counted as spend", () => {
  recordEvent(
    buildEvent({
      result: "blocked",
      method: "GET",
      url: "https://api.example.com/premium",
      domain: "api.example.com",
      network: "stellar:testnet",
      amount: toAtomic("0.50").toString(),
      asset: USDC_TESTNET_ADDRESS,
      rule: "max_per_request",
      reason: "0.50 USDC exceeds max per request of 0.05",
    }),
  );

  const spend = spendSince(Date.now() - DAY_MS);
  assert.equal(spend.total, toAtomic("0.001"));
  assert.equal(spend.byDomain.get("api.example.com"), toAtomic("0.001"));
});

test("spend outside the window is ignored", () => {
  const spend = spendSince(Date.now() + 1_000);
  assert.equal(spend.total, 0n);
});

test("multi-line SDK errors stay on a single audit line", () => {
  const line = renderAuditLine(
    buildEvent({
      result: "failed",
      method: "GET",
      url: "https://api.example.com/weather",
      domain: "api.example.com",
      reason: "simulation failed\n  0: [Diagnostic Event] topics:[error]\n  1: more detail",
    }),
  );
  assert.equal(line.includes("\n"), false);
  assert.match(line, /reason="simulation failed 0: \[Diagnostic Event\]/);
});
