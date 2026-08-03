import { Horizon } from "@stellar/stellar-sdk";
import { DEFAULT_PUBNET_HORIZON_URL, DEFAULT_TESTNET_HORIZON_URL } from "@x402/stellar";
import { readEvents, spendLast24h } from "../core/audit.js";
import { toAtomic, toDecimal } from "../core/money.js";
import { color, heading, json, keyValue, print } from "../core/output.js";
import { files, homeDir } from "../core/paths.js";
import { limitsForDomain, loadPolicy, policyExists } from "../core/policy.js";
import { loadWallet } from "../core/wallet.js";
import { DEFAULT_NETWORK } from "../core/x402.js";
import { EXIT } from "../core/errors.js";

export type StatusOptions = { json?: boolean; network?: string; offline?: boolean };

type Balance = { asset: string; balance: string };

export async function status(options: StatusOptions = {}): Promise<number> {
  const policy = loadPolicy();
  const wallet = loadWallet();
  const network = options.network ?? process.env.STELLAR_NETWORK ?? DEFAULT_NETWORK;
  const events = readEvents();
  const spend = spendLast24h(events);
  const agentCap = toAtomic(policy.maxPerDayPerAgent);

  let balances: Balance[] | null = null;
  let accountError: string | null = null;
  if (wallet && !options.offline) {
    const result = await loadBalances(wallet.publicKey, network);
    balances = result.balances;
    accountError = result.error;
  }

  const domainRows = [...spend.byDomain.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .map(([domain, units]) => ({
      domain,
      spent: toDecimal(units),
      limit: toDecimal(limitsForDomain(policy, domain).maxPerDay),
    }));

  if (options.json) {
    json({
      home: homeDir(),
      network,
      wallet: wallet
        ? { publicKey: wallet.publicKey, source: wallet.source, balances, error: accountError }
        : null,
      policy: { path: files.policy(), exists: policyExists(), ...policy },
      spend24h: {
        total: toDecimal(spend.total),
        limit: toDecimal(agentCap),
        remaining: toDecimal(agentCap > spend.total ? agentCap - spend.total : 0n),
        byDomain: domainRows,
      },
      events: {
        path: files.events(),
        total: events.length,
        paid: events.filter((e) => e.result === "paid").length,
        blocked: events.filter((e) => e.result === "blocked").length,
      },
      auditLog: files.audit(),
    });
    return EXIT.ok;
  }

  print(heading("stellar-agent-pay"));
  print(color.dim(`  ${homeDir()}`));
  print();

  print(heading("Wallet"));
  if (!wallet) {
    print(color.yellow("  no payer wallet configured"));
    print(
      color.dim("  run `stellar-agent-pay wallet new --fund` (testnet) or set STELLAR_SECRET_KEY"),
    );
  } else {
    print(
      keyValue([
        ["address", wallet.publicKey],
        ["source", wallet.source === "env" ? "STELLAR_SECRET_KEY" : files.wallet()],
        ["network", network],
        [
          "balances",
          accountError
            ? color.yellow(accountError)
            : balances && balances.length > 0
              ? balances.map((b) => `${b.balance} ${b.asset}`).join("  ")
              : color.dim("(none)"),
        ],
      ]),
    );
    if (balances && !balances.some((b) => b.asset === "USDC")) {
      print(color.dim("  no USDC trustline, run `stellar-agent-pay wallet trustline`"));
    }
  }
  print();

  print(heading("Policy") + color.dim(policyExists() ? "" : "  (defaults, not saved yet)"));
  print(
    keyValue([
      ["max per request", policy.maxPerRequest],
      ["max per domain / 24 h", policy.maxPerDomainPerDay],
      ["max per agent / 24 h", policy.maxPerDayPerAgent],
      ["allowed domains", policy.allowedDomains.join(", ") || color.dim("(none)")],
      ["unlisted domains", policy.allowUnlistedDomains ? color.yellow("allowed") : "blocked"],
      ["networks", policy.allowedNetworks.join(", ")],
    ]),
  );
  print();

  print(heading("Spend, last 24 h"));
  const remaining = agentCap > spend.total ? agentCap - spend.total : 0n;
  print(
    keyValue([
      ["settled", `${toDecimal(spend.total)} of ${toDecimal(agentCap)}`],
      ["remaining", toDecimal(remaining)],
      [
        "requests",
        `${events.filter((e) => e.result === "paid").length} paid · ${events.filter((e) => e.result === "blocked").length} blocked`,
      ],
    ]),
  );
  if (domainRows.length > 0) {
    print();
    for (const row of domainRows) {
      print(`  ${row.domain.padEnd(28)} ${row.spent} ${color.dim(`/ ${row.limit}`)}`);
    }
  }
  print();
  print(color.dim(`  audit log: ${files.audit()}`));
  print();
  return EXIT.ok;
}

async function loadBalances(
  publicKey: string,
  network: string,
): Promise<{ balances: Balance[] | null; error: string | null }> {
  const url =
    network === "stellar:pubnet" ? DEFAULT_PUBNET_HORIZON_URL : DEFAULT_TESTNET_HORIZON_URL;
  try {
    const account = await new Horizon.Server(url).loadAccount(publicKey);
    return {
      balances: account.balances.map((b) => ({
        asset:
          b.asset_type === "native" ? "XLM" : ((b as { asset_code?: string }).asset_code ?? "?"),
        balance: trimBalance(b.balance),
      })),
      error: null,
    };
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 404) {
      return { balances: null, error: "account not funded on this network" };
    }
    return { balances: null, error: `Horizon unreachable (${(error as Error).message})` };
  }
}

function trimBalance(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, ".0") : value;
}
