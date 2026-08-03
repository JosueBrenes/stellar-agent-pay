import { toDecimal } from "../core/money.js";
import { color, heading, json, keyValue, print } from "../core/output.js";
import { files } from "../core/paths.js";
import {
  DEFAULT_POLICY,
  loadPolicy,
  normalizeDomain,
  policyExists,
  savePolicy,
  setPolicyValue,
  SETTABLE_KEYS,
  type Policy,
  type SettableKey,
} from "../core/policy.js";
import { limitsForDomain } from "../core/policy.js";
import { CliError, EXIT } from "../core/errors.js";

export function showPolicy(options: { json?: boolean } = {}): number {
  const policy = loadPolicy();
  if (options.json) {
    json({ path: files.policy(), exists: policyExists(), policy });
    return EXIT.ok;
  }
  print(
    heading("Spending policy") +
      color.dim(policyExists() ? "" : "  (defaults, file not created yet)"),
  );
  print(color.dim(`  ${files.policy()}`));
  print();
  print(
    keyValue([
      ["maxPerRequest", policy.maxPerRequest],
      ["maxPerDomainPerDay", policy.maxPerDomainPerDay],
      ["maxPerDayPerAgent", policy.maxPerDayPerAgent],
      ["allowedNetworks", policy.allowedNetworks.join(", ") || color.dim("(none)")],
      ["allowUnlistedDomains", String(policy.allowUnlistedDomains)],
      ["requireHttps", String(policy.requireHttps)],
      ["allowedAssets", policy.allowedAssets.join(", ") || color.dim("(any)")],
    ]),
  );
  print();
  print(heading("Allowed domains"));
  if (policy.allowedDomains.length === 0) {
    print(
      color.dim(
        policy.allowUnlistedDomains
          ? "  (empty, but allowUnlistedDomains is true so any domain may be paid)"
          : "  (empty, every paid request is blocked until you add one)",
      ),
    );
  } else {
    for (const domain of policy.allowedDomains) {
      const limits = limitsForDomain(policy, domain.replace(/^\*\./, ""));
      const suffix = limits.overrideKey
        ? color.dim(
            `  max/request ${toDecimal(limits.maxPerRequest)}  max/24h ${toDecimal(limits.maxPerDay)}`,
          )
        : "";
      print(`  ${color.green("+")} ${domain}${suffix}`);
    }
  }
  if (policy.blockedDomains.length > 0) {
    print();
    print(heading("Blocked domains"));
    for (const domain of policy.blockedDomains) print(`  ${color.red("-")} ${domain}`);
  }
  print();
  return EXIT.ok;
}

export function setPolicy(key: string, value: string): number {
  if (!(SETTABLE_KEYS as readonly string[]).includes(key)) {
    throw new CliError(
      `unknown policy key "${key}"\n  settable keys: ${SETTABLE_KEYS.join(", ")}\n  per-domain limits: stellar-agent-pay policy allow <domain> --max-per-request <amount>`,
    );
  }
  const updated = setPolicyValue(loadPolicy(), key as SettableKey, value);
  savePolicy(updated);
  print(`${color.green("✓")} ${key} = ${formatValue(updated[key as SettableKey])}`);
  print(color.dim(`  ${files.policy()}`));
  return EXIT.ok;
}

export function allowDomain(
  rawDomain: string,
  options: { maxPerRequest?: string; maxPerDay?: string },
): number {
  const domain = normalizeDomain(rawDomain);
  const policy = loadPolicy();
  const allowedDomains = policy.allowedDomains.includes(domain)
    ? policy.allowedDomains
    : [...policy.allowedDomains, domain];
  const next: Policy = { ...policy, allowedDomains };

  if (options.maxPerRequest || options.maxPerDay) {
    next.domainOverrides = {
      ...policy.domainOverrides,
      [domain]: {
        ...policy.domainOverrides[domain],
        ...(options.maxPerRequest
          ? { maxPerRequest: options.maxPerRequest.replace(/^\$/, "") }
          : {}),
        ...(options.maxPerDay ? { maxPerDay: options.maxPerDay.replace(/^\$/, "") } : {}),
      },
    };
  }
  savePolicy(next);

  const limits = limitsForDomain(next, domain.replace(/^\*\./, ""));
  print(`${color.green("✓")} ${domain} allowed`);
  print(
    keyValue([
      ["max per request", toDecimal(limits.maxPerRequest)],
      ["max per 24 h", toDecimal(limits.maxPerDay)],
    ]),
  );
  return EXIT.ok;
}

export function blockDomain(rawDomain: string): number {
  const domain = normalizeDomain(rawDomain);
  const policy = loadPolicy();
  savePolicy({
    ...policy,
    blockedDomains: policy.blockedDomains.includes(domain)
      ? policy.blockedDomains
      : [...policy.blockedDomains, domain],
    allowedDomains: policy.allowedDomains.filter((d) => d !== domain),
  });
  print(`${color.red("✓")} ${domain} blocked (and removed from the allowlist)`);
  return EXIT.ok;
}

export function unblockDomain(rawDomain: string): number {
  const domain = normalizeDomain(rawDomain);
  const policy = loadPolicy();
  savePolicy({ ...policy, blockedDomains: policy.blockedDomains.filter((d) => d !== domain) });
  print(`${color.green("✓")} ${domain} removed from the denylist`);
  return EXIT.ok;
}

export function removeDomain(rawDomain: string): number {
  const domain = normalizeDomain(rawDomain);
  const policy = loadPolicy();
  const { [domain]: _removed, ...domainOverrides } = policy.domainOverrides;
  savePolicy({
    ...policy,
    allowedDomains: policy.allowedDomains.filter((d) => d !== domain),
    domainOverrides,
  });
  print(`${color.green("✓")} ${domain} removed from the allowlist`);
  return EXIT.ok;
}

export function resetPolicy(): number {
  savePolicy(DEFAULT_POLICY);
  print(`${color.green("✓")} policy reset to defaults`);
  print(color.dim(`  ${files.policy()}`));
  return EXIT.ok;
}

export function policyPath(): number {
  print(files.policy());
  return EXIT.ok;
}

function formatValue(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") || "(empty)" : String(value);
}
