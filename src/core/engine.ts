import type { PaymentRequirements } from "@x402/core/types";
import { assetInfo, formatPolicyUnits, toAtomic, toDecimal, toPolicyUnits } from "./money.js";
import { limitsForDomain, matchDomain, type Policy } from "./policy.js";
import { spendLast24h, type Spend } from "./audit.js";

export type CheckStatus = "pass" | "fail" | "skipped";

export type Check = {
  /** Stable machine-readable id, also written to the audit log as `rule=`. */
  rule: string;
  label: string;
  status: CheckStatus;
  detail: string;
};

export type Decision = {
  allowed: boolean;
  checks: Check[];
  /** First failing check, i.e. the reason the payment was refused. */
  violation: Check | null;
  host: string;
  amountPolicyUnits: bigint;
  requirements: PaymentRequirements;
  asset: ReturnType<typeof assetInfo>;
  spentDomain: bigint;
  spentTotal: bigint;
};

export type EvaluateInput = {
  url: string;
  requirements: PaymentRequirements;
  policy: Policy;
  spend?: Spend;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Decides whether the agent may sign this payment. Every rule is evaluated so the
 * CLI can show the full checklist, but the first failure is what blocks the payment.
 */
export function evaluate({ url, requirements, policy, spend }: EvaluateInput): Decision {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const asset = assetInfo(requirements.asset);
  const amount = toPolicyUnits(BigInt(requirements.amount), asset.decimals);
  const usage = spend ?? spendLast24h();
  const spentDomain = usage.byDomain.get(host) ?? 0n;
  const spentTotal = usage.total;
  const limits = limitsForDomain(policy, host);
  const checks: Check[] = [];

  const isLocal = LOCAL_HOSTS.has(host);
  checks.push(
    !policy.requireHttps || parsed.protocol === "https:" || isLocal
      ? {
          rule: "transport",
          label: "Transport",
          status: "pass",
          detail: policy.requireHttps
            ? isLocal && parsed.protocol !== "https:"
              ? "http allowed for localhost"
              : "https"
            : "https not enforced",
        }
      : {
          rule: "transport",
          label: "Transport",
          status: "fail",
          detail: `policy requires https, resource is ${parsed.protocol.replace(":", "")}`,
        },
  );

  checks.push(
    policy.allowedNetworks.includes(requirements.network)
      ? {
          rule: "network",
          label: "Network",
          status: "pass",
          detail: requirements.network,
        }
      : {
          rule: "network",
          label: "Network",
          status: "fail",
          detail: `${requirements.network} is not in allowedNetworks [${policy.allowedNetworks.join(", ")}]`,
        },
  );

  const blocked = matchDomain(policy.blockedDomains, host);
  checks.push(
    blocked
      ? {
          rule: "domain_blocked",
          label: "Denylist",
          status: "fail",
          detail: `${host} matches blocked entry "${blocked}"`,
        }
      : { rule: "domain_blocked", label: "Denylist", status: "pass", detail: `${host} not denied` },
  );

  const allowed = matchDomain(policy.allowedDomains, host);
  if (allowed) {
    checks.push({
      rule: "domain_allowlist",
      label: "Allowlist",
      status: "pass",
      detail: `${host} matches "${allowed}"`,
    });
  } else if (policy.allowUnlistedDomains) {
    checks.push({
      rule: "domain_allowlist",
      label: "Allowlist",
      status: "pass",
      detail: "allowUnlistedDomains is true",
    });
  } else {
    checks.push({
      rule: "domain_allowlist",
      label: "Allowlist",
      status: "fail",
      detail: `${host} is not in allowedDomains, add it with \`stellar-agent-pay policy allow ${host}\``,
    });
  }

  if (policy.allowedAssets.length === 0) {
    checks.push({
      rule: "asset",
      label: "Asset",
      status: "pass",
      detail: `${asset.symbol} (any asset allowed)`,
    });
  } else {
    checks.push(
      policy.allowedAssets.includes(requirements.asset)
        ? { rule: "asset", label: "Asset", status: "pass", detail: `${asset.symbol} allowed` }
        : {
            rule: "asset",
            label: "Asset",
            status: "fail",
            detail: `${requirements.asset} is not in allowedAssets`,
          },
    );
  }

  const perRequestLabel = limits.overrideKey
    ? `max per request (override "${limits.overrideKey}")`
    : "max per request";
  checks.push(
    amount <= limits.maxPerRequest
      ? {
          rule: "max_per_request",
          label: "Per-request limit",
          status: "pass",
          detail: `${formatPolicyUnits(amount, asset.symbol)} ≤ ${toDecimal(limits.maxPerRequest)} ${perRequestLabel}`,
        }
      : {
          rule: "max_per_request",
          label: "Per-request limit",
          status: "fail",
          detail: `${formatPolicyUnits(amount, asset.symbol)} exceeds ${perRequestLabel} of ${toDecimal(limits.maxPerRequest)}`,
        },
  );

  const domainAfter = spentDomain + amount;
  checks.push(
    domainAfter <= limits.maxPerDay
      ? {
          rule: "max_per_domain_per_day",
          label: "Domain budget (24 h)",
          status: "pass",
          detail: `${toDecimal(domainAfter)} of ${toDecimal(limits.maxPerDay)} used after this payment`,
        }
      : {
          rule: "max_per_domain_per_day",
          label: "Domain budget (24 h)",
          status: "fail",
          detail: `${toDecimal(spentDomain)} already spent on ${host} in the last 24 h; this payment would reach ${toDecimal(domainAfter)}, over the ${toDecimal(limits.maxPerDay)} cap`,
        },
  );

  const totalAfter = spentTotal + amount;
  const agentCap = toAtomic(policy.maxPerDayPerAgent);
  checks.push(
    totalAfter <= agentCap
      ? {
          rule: "max_per_day_per_agent",
          label: "Agent budget (24 h)",
          status: "pass",
          detail: `${toDecimal(totalAfter)} of ${toDecimal(agentCap)} used after this payment`,
        }
      : {
          rule: "max_per_day_per_agent",
          label: "Agent budget (24 h)",
          status: "fail",
          detail: `${toDecimal(spentTotal)} already spent across all domains in the last 24 h; this payment would reach ${toDecimal(totalAfter)}, over the ${toDecimal(agentCap)} cap`,
        },
  );

  const violation = checks.find((c) => c.status === "fail") ?? null;
  return {
    allowed: violation === null,
    checks,
    violation,
    host,
    amountPolicyUnits: amount,
    requirements,
    asset,
    spentDomain,
    spentTotal,
  };
}
