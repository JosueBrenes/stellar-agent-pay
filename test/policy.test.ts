import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_POLICY,
  domainMatches,
  limitsForDomain,
  normalizeDomain,
  PolicySchema,
  setPolicyValue,
} from "../src/core/policy.js";
import { toAtomic } from "../src/core/money.js";

test("wildcard patterns match sub-domains but not the bare domain", () => {
  assert.ok(domainMatches("api.example.com", "api.example.com"));
  assert.ok(domainMatches("*.example.com", "api.example.com"));
  assert.ok(domainMatches("*.example.com", "a.b.example.com"));
  assert.equal(domainMatches("*.example.com", "example.com"), false);
  assert.equal(domainMatches("api.example.com", "evil-api.example.com"), false);
});

test("normalizeDomain strips scheme, path and port", () => {
  assert.equal(normalizeDomain("https://API.Example.com/paid/thing"), "api.example.com");
  assert.equal(normalizeDomain("localhost:4021"), "localhost");
  assert.equal(normalizeDomain(" example.com "), "example.com");
});

test("per-domain overrides beat the global limits, most specific first", () => {
  const policy = PolicySchema.parse({
    ...DEFAULT_POLICY,
    maxPerRequest: "0.05",
    maxPerDomainPerDay: "1.00",
    domainOverrides: {
      "*.example.com": { maxPerRequest: "0.10" },
      "api.example.com": { maxPerRequest: "0.75", maxPerDay: "9.00" },
    },
  });

  const specific = limitsForDomain(policy, "api.example.com");
  assert.equal(specific.overrideKey, "api.example.com");
  assert.equal(specific.maxPerRequest, toAtomic("0.75"));
  assert.equal(specific.maxPerDay, toAtomic("9.00"));

  const wildcard = limitsForDomain(policy, "cdn.example.com");
  assert.equal(wildcard.overrideKey, "*.example.com");
  assert.equal(wildcard.maxPerRequest, toAtomic("0.10"));
  // Falls back to the global daily cap because the override does not set one.
  assert.equal(wildcard.maxPerDay, toAtomic("1.00"));

  const other = limitsForDomain(policy, "example.org");
  assert.equal(other.overrideKey, null);
  assert.equal(other.maxPerRequest, toAtomic("0.05"));
});

test("setPolicyValue validates amounts, booleans and lists", () => {
  const updated = setPolicyValue(DEFAULT_POLICY, "maxPerRequest", "$0.25");
  assert.equal(updated.maxPerRequest, "0.25");

  assert.equal(
    setPolicyValue(DEFAULT_POLICY, "allowUnlistedDomains", "true").allowUnlistedDomains,
    true,
  );
  assert.deepEqual(
    setPolicyValue(DEFAULT_POLICY, "allowedNetworks", "stellar:testnet, stellar:pubnet")
      .allowedNetworks,
    ["stellar:testnet", "stellar:pubnet"],
  );

  assert.throws(() => setPolicyValue(DEFAULT_POLICY, "maxPerRequest", "lots"), /invalid value/);
  assert.throws(() => setPolicyValue(DEFAULT_POLICY, "requireHttps", "maybe"), /true or false/);
});

test("the default policy blocks every domain until one is allowed", () => {
  assert.equal(DEFAULT_POLICY.allowUnlistedDomains, false);
  assert.deepEqual(DEFAULT_POLICY.allowedDomains, []);
});
