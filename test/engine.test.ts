import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaymentRequirements } from "@x402/core/types";
import { USDC_TESTNET_ADDRESS } from "@x402/stellar";
import { evaluate } from "../src/core/engine.js";
import { toAtomic } from "../src/core/money.js";
import { DEFAULT_POLICY, PolicySchema, type Policy } from "../src/core/policy.js";
import type { Spend } from "../src/core/audit.js";

const NO_SPEND: Spend = { total: 0n, byDomain: new Map() };

function requirements(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: "stellar:testnet",
    asset: USDC_TESTNET_ADDRESS,
    amount: toAtomic("0.001").toString(),
    payTo: "GAMX62ZD4FWIKMWGVPEDR6WNL2TYTPQMO2ZJEAZUAON7VCZ5G2GWDF7W",
    maxTimeoutSeconds: 60,
    extra: { areFeesSponsored: true },
    ...overrides,
  };
}

function policy(overrides: Partial<Policy> = {}): Policy {
  return PolicySchema.parse({
    ...DEFAULT_POLICY,
    allowedDomains: ["api.example.com"],
    ...overrides,
  });
}

const URL_UNDER_TEST = "https://api.example.com/weather";

test("a payment inside every limit is allowed", () => {
  const decision = evaluate({
    url: URL_UNDER_TEST,
    requirements: requirements(),
    policy: policy(),
    spend: NO_SPEND,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.violation, null);
  assert.ok(decision.checks.every((c) => c.status === "pass"));
});

test("an unlisted domain is blocked, and the allowlist opens it", () => {
  const blocked = evaluate({
    url: "https://api.other.com/weather",
    requirements: requirements(),
    policy: policy(),
    spend: NO_SPEND,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.violation?.rule, "domain_allowlist");

  const opened = evaluate({
    url: "https://api.other.com/weather",
    requirements: requirements(),
    policy: policy({ allowUnlistedDomains: true }),
    spend: NO_SPEND,
  });
  assert.equal(opened.allowed, true);
});

test("the denylist wins over the allowlist", () => {
  const decision = evaluate({
    url: URL_UNDER_TEST,
    requirements: requirements(),
    policy: policy({ blockedDomains: ["api.example.com"] }),
    spend: NO_SPEND,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.violation?.rule, "domain_blocked");
});

test("an over-priced request is blocked by the per-request ceiling", () => {
  const decision = evaluate({
    url: URL_UNDER_TEST,
    requirements: requirements({ amount: toAtomic("0.50").toString() }),
    policy: policy(),
    spend: NO_SPEND,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.violation?.rule, "max_per_request");
  assert.match(decision.violation.detail, /0\.50 USDC exceeds max per request of 0\.05/);
});

test("spend already booked against a domain closes its 24 h budget", () => {
  const spend: Spend = {
    total: toAtomic("0.99"),
    byDomain: new Map([["api.example.com", toAtomic("0.99")]]),
  };
  const decision = evaluate({
    url: URL_UNDER_TEST,
    requirements: requirements({ amount: toAtomic("0.02").toString() }),
    policy: policy(),
    spend,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.violation?.rule, "max_per_domain_per_day");
});

test("the agent-wide daily cap applies across domains", () => {
  const spend: Spend = {
    total: toAtomic("4.99"),
    byDomain: new Map([["other.example.org", toAtomic("4.99")]]),
  };
  const decision = evaluate({
    url: URL_UNDER_TEST,
    requirements: requirements({ amount: toAtomic("0.02").toString() }),
    policy: policy(),
    spend,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.violation?.rule, "max_per_day_per_agent");
});

test("a network outside the policy is refused", () => {
  const decision = evaluate({
    url: URL_UNDER_TEST,
    requirements: requirements({ network: "stellar:pubnet" }),
    policy: policy(),
    spend: NO_SPEND,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.violation?.rule, "network");
});

test("an asset outside allowedAssets is refused", () => {
  const decision = evaluate({
    url: URL_UNDER_TEST,
    requirements: requirements(),
    policy: policy({ allowedAssets: ["CSOMEOTHERASSET"] }),
    spend: NO_SPEND,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.violation?.rule, "asset");
});

test("requireHttps blocks plaintext but still permits localhost", () => {
  const remote = evaluate({
    url: "http://api.example.com/weather",
    requirements: requirements(),
    policy: policy({ requireHttps: true }),
    spend: NO_SPEND,
  });
  assert.equal(remote.allowed, false);
  assert.equal(remote.violation?.rule, "transport");

  const local = evaluate({
    url: "http://localhost:4021/weather",
    requirements: requirements(),
    policy: policy({ requireHttps: true, allowedDomains: ["localhost"] }),
    spend: NO_SPEND,
  });
  assert.equal(local.allowed, true);
});

test("a per-domain override raises the ceiling for that domain only", () => {
  const withOverride = policy({
    domainOverrides: { "api.example.com": { maxPerRequest: "1.00" } },
  });
  const allowed = evaluate({
    url: URL_UNDER_TEST,
    requirements: requirements({ amount: toAtomic("0.50").toString() }),
    policy: withOverride,
    spend: NO_SPEND,
  });
  assert.equal(allowed.allowed, true);

  const other = evaluate({
    url: "https://api.example.com.evil.test/weather",
    requirements: requirements({ amount: toAtomic("0.50").toString() }),
    policy: withOverride,
    spend: NO_SPEND,
  });
  assert.equal(other.allowed, false);
});
