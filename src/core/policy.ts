import { z } from "zod";
import { files, readJson, writeJson } from "./paths.js";
import { toAtomic } from "./money.js";

const Amount = z
  .string()
  .regex(/^\d+(\.\d{1,7})?$/, "expected a decimal amount with at most 7 decimals, e.g. 0.05");

const DomainLimits = z.object({
  maxPerRequest: Amount.optional(),
  maxPerDay: Amount.optional(),
});

export const PolicySchema = z.object({
  version: z.literal(1).default(1),
  /** CAIP-2 networks the agent is allowed to pay on. */
  allowedNetworks: z.array(z.string()).default(["stellar:testnet"]),
  /** Hard ceiling for a single 402 payment. */
  maxPerRequest: Amount.default("0.05"),
  /** Rolling 24 h ceiling per domain. */
  maxPerDomainPerDay: Amount.default("1.00"),
  /** Rolling 24 h ceiling across every domain. */
  maxPerDayPerAgent: Amount.default("5.00"),
  /** Domains the agent may pay. Supports a leading "*." wildcard. */
  allowedDomains: z.array(z.string()).default([]),
  /** Always refused, evaluated before the allowlist. */
  blockedDomains: z.array(z.string()).default([]),
  /** When false (default) anything outside allowedDomains is refused. */
  allowUnlistedDomains: z.boolean().default(false),
  /** Empty means "any asset the server asks for". Otherwise SAC contract ids. */
  allowedAssets: z.array(z.string()).default([]),
  /** Refuse to pay over plaintext HTTP (localhost is always exempt). */
  requireHttps: z.boolean().default(false),
  /** Per-domain overrides of maxPerRequest / maxPerDay. */
  domainOverrides: z.record(z.string(), DomainLimits).default({}),
});

export type Policy = z.infer<typeof PolicySchema>;
export type PolicyInput = z.input<typeof PolicySchema>;

export const DEFAULT_POLICY: Policy = PolicySchema.parse({});

/** Scalar/array keys reachable from `policy set <key> <value>`. */
export const SETTABLE_KEYS = [
  "maxPerRequest",
  "maxPerDomainPerDay",
  "maxPerDayPerAgent",
  "allowUnlistedDomains",
  "requireHttps",
  "allowedNetworks",
  "allowedDomains",
  "blockedDomains",
  "allowedAssets",
] as const;

export type SettableKey = (typeof SETTABLE_KEYS)[number];

export function policyExists(): boolean {
  return readJson<unknown>(files.policy()) !== null;
}

export function loadPolicy(): Policy {
  const raw = readJson<unknown>(files.policy());
  if (raw === null) return DEFAULT_POLICY;
  const parsed = PolicySchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`${files.policy()} is invalid:\n${detail}`);
  }
  return parsed.data;
}

export function savePolicy(policy: Policy): void {
  writeJson(files.policy(), PolicySchema.parse(policy));
}

/** Applies a `policy set` assignment, validating the resulting document. */
export function setPolicyValue(policy: Policy, key: SettableKey, value: string): Policy {
  const next: Record<string, unknown> = { ...policy };
  switch (key) {
    case "maxPerRequest":
    case "maxPerDomainPerDay":
    case "maxPerDayPerAgent":
      next[key] = value.trim().replace(/^\$/, "");
      break;
    case "allowUnlistedDomains":
    case "requireHttps":
      if (!/^(true|false)$/i.test(value.trim())) {
        throw new Error(`${key} expects true or false, got "${value}"`);
      }
      next[key] = value.trim().toLowerCase() === "true";
      break;
    default:
      next[key] = value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
  }
  const parsed = PolicySchema.safeParse(next);
  if (!parsed.success) {
    throw new Error(`invalid value for ${key}: ${parsed.error.issues[0]?.message ?? "rejected"}`);
  }
  return parsed.data;
}

export function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) throw new Error("domain must not be empty");
  if (trimmed.includes("://")) return new URL(trimmed).hostname;
  // Accept "example.com/path" and "example.com:8080" too.
  return trimmed.split("/")[0]!.replace(/:\d+$/, "");
}

/** Exact match, or "*.example.com" matching any sub-domain of example.com. */
export function domainMatches(pattern: string, host: string): boolean {
  const p = pattern.trim().toLowerCase();
  const h = host.trim().toLowerCase();
  if (p === h) return true;
  if (p.startsWith("*.")) {
    const suffix = p.slice(1); // ".example.com"
    return h.endsWith(suffix) && h.length > suffix.length;
  }
  return false;
}

export function matchDomain(patterns: string[], host: string): string | null {
  return patterns.find((p) => domainMatches(p, host)) ?? null;
}

/** Effective limits for a host, after applying the most specific override. */
export function limitsForDomain(
  policy: Policy,
  host: string,
): { maxPerRequest: bigint; maxPerDay: bigint; overrideKey: string | null } {
  const overrideKey =
    Object.keys(policy.domainOverrides)
      .filter((key) => domainMatches(key, host))
      // Prefer the exact host over a wildcard, then the longest pattern.
      .sort((a, b) => Number(b === host) - Number(a === host) || b.length - a.length)[0] ?? null;
  const override = overrideKey ? policy.domainOverrides[overrideKey] : undefined;
  return {
    maxPerRequest: toAtomic(override?.maxPerRequest ?? policy.maxPerRequest),
    maxPerDay: toAtomic(override?.maxPerDay ?? policy.maxPerDomainPerDay),
    overrideKey,
  };
}
