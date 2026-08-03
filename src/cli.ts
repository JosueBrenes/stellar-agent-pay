#!/usr/bin/env node
import { Command } from "commander";
import "dotenv/config";
import { audit, type AuditOptions } from "./commands/audit.js";
import { init, type InitOptions } from "./commands/init.js";
import {
  allowDomain,
  blockDomain,
  policyPath,
  removeDomain,
  resetPolicy,
  setPolicy,
  showPolicy,
  unblockDomain,
} from "./commands/policy.js";
import { status, type StatusOptions } from "./commands/status.js";
import { unlock } from "./commands/unlock.js";
import { importWallet, newWallet, showWallet, trustline } from "./commands/wallet.js";
import { CliError, EXIT } from "./core/errors.js";
import { color, printErr } from "./core/output.js";
import { SETTABLE_KEYS } from "./core/policy.js";

const VERSION = "0.1.0";

type UnlockCliOptions = {
  method: string;
  header?: string[];
  data?: string;
  network?: string;
  rpcUrl?: string;
  dryRun?: boolean;
  json?: boolean;
  output?: string;
  quiet?: boolean;
  yes?: boolean;
};

type NewWalletOptions = {
  fund?: boolean;
  force?: boolean;
  network?: string;
  json?: boolean;
};

const program = new Command();

program
  .name("stellar-agent-pay")
  .description(
    "Pay for x402-protected HTTP resources on Stellar under a local spending policy.\n" +
      "Installed on PATH it is also reachable as `stellar agent-pay <command>`.",
  )
  .version(VERSION, "-v, --version")
  .showHelpAfterError();

program
  .command("unlock")
  .description(
    "GET a resource, pay the 402 in USDC if the spending policy allows it, print the result",
  )
  .argument("<url>", "resource URL")
  .option("-X, --method <method>", "HTTP method", "GET")
  .option(
    "-H, --header <header...>",
    "extra request header, e.g. -H 'accept: application/json'",
    [],
  )
  .option("-d, --data <body>", "request body (implies content-type: application/json)")
  .option(
    "-n, --network <caip2>",
    "CAIP-2 network id (default stellar:testnet or $STELLAR_NETWORK)",
  )
  .option("--rpc-url <url>", "Soroban RPC URL override")
  .option(
    "--dry-run",
    "negotiate the 402 and show the policy verdict without signing anything",
    false,
  )
  .option("--json", "emit a single JSON object instead of human output", false)
  .option("-o, --output <file>", "write the resource body to a file instead of stdout")
  .option("-q, --quiet", "suppress progress output (the resource still goes to stdout)", false)
  .option("-y, --yes", "reserved for future interactive confirmations", false)
  .addHelpText(
    "after",
    `
Exit codes:
  0  resource unlocked (or dry run allowed)
  1  request, configuration or settlement error
  2  blocked by the local spending policy

Examples:
  $ stellar-agent-pay unlock https://api.example.com/weather
  $ stellar-agent-pay unlock https://api.example.com/report --dry-run
  $ stellar agent-pay unlock https://api.example.com/weather --json | jq .body`,
  )
  .action(async (url: string, options: UnlockCliOptions) => {
    process.exitCode = await unlock(url, {
      method: options.method,
      header: options.header ?? [],
      data: options.data,
      network: options.network,
      rpcUrl: options.rpcUrl,
      dryRun: Boolean(options.dryRun),
      json: Boolean(options.json),
      output: options.output,
      quiet: Boolean(options.quiet),
      yes: Boolean(options.yes),
    });
  });

program
  .command("status")
  .description("show the payer wallet, its balances, the active policy and the last 24 h of spend")
  .option("--json", "machine-readable output", false)
  .option("-n, --network <caip2>", "CAIP-2 network id")
  .option("--offline", "skip the Horizon balance lookup", false)
  .action(async (options: StatusOptions) => {
    process.exitCode = await status(options);
  });

const policy = program
  .command("policy")
  .description("inspect and edit the spending policy")
  .action(() => {
    process.exitCode = showPolicy({});
  });

policy
  .command("show", { isDefault: true })
  .description("print the active policy")
  .option("--json", "machine-readable output", false)
  .action((options: { json?: boolean }) => {
    process.exitCode = showPolicy(options);
  });

policy
  .command("set")
  .description("set a policy value")
  .argument("<key>", `one of: ${SETTABLE_KEYS.join(", ")}`)
  .argument("<value>", "new value (comma-separated for list keys)")
  .addHelpText(
    "after",
    `
Examples:
  $ stellar-agent-pay policy set maxPerRequest 0.10
  $ stellar-agent-pay policy set maxPerDayPerAgent 2.50
  $ stellar-agent-pay policy set allowedNetworks stellar:testnet,stellar:pubnet
  $ stellar-agent-pay policy set allowUnlistedDomains false`,
  )
  .action((key: string, value: string) => {
    process.exitCode = setPolicy(key, value);
  });

policy
  .command("allow")
  .description("add a domain to the allowlist, optionally with its own limits")
  .argument("<domain>", 'hostname or "*.example.com"')
  .option("--max-per-request <amount>", "per-request ceiling for this domain")
  .option("--max-per-day <amount>", "rolling 24 h ceiling for this domain")
  .action((domain: string, options: { maxPerRequest?: string; maxPerDay?: string }) => {
    process.exitCode = allowDomain(domain, options);
  });

policy
  .command("block")
  .description("add a domain to the denylist")
  .argument("<domain>", "hostname")
  .action((domain: string) => {
    process.exitCode = blockDomain(domain);
  });

policy
  .command("unblock")
  .description("remove a domain from the denylist")
  .argument("<domain>", "hostname")
  .action((domain: string) => {
    process.exitCode = unblockDomain(domain);
  });

policy
  .command("remove")
  .description("remove a domain from the allowlist and drop its overrides")
  .argument("<domain>", "hostname")
  .action((domain: string) => {
    process.exitCode = removeDomain(domain);
  });

policy
  .command("reset")
  .description("restore the default policy")
  .action(() => {
    process.exitCode = resetPolicy();
  });

policy
  .command("path")
  .description("print the policy file path")
  .action(() => {
    process.exitCode = policyPath();
  });

const wallet = program.command("wallet").description("manage the agent's payer account");

wallet
  .command("new")
  .description(
    "generate a payer keypair (optionally fund it and add the USDC trustline on testnet)",
  )
  .option("--fund", "friendbot + USDC trustline (testnet only)", false)
  .option("--force", "replace an existing wallet", false)
  .option("-n, --network <caip2>", "CAIP-2 network id")
  .option("--json", "machine-readable output", false)
  .action(async (options: NewWalletOptions) => {
    process.exitCode = await newWallet(options);
  });

wallet
  .command("import")
  .description("store an existing S... secret key (or pipe it on stdin)")
  .argument("[secret]", "Stellar secret key")
  .option("--force", "replace an existing wallet", false)
  .action(async (secret: string | undefined, options: { force?: boolean }) => {
    process.exitCode = await importWallet(secret, options);
  });

wallet
  .command("show", { isDefault: true })
  .description("print the configured payer account")
  .option("--json", "machine-readable output", false)
  .option("-n, --network <caip2>", "CAIP-2 network id")
  .action(async (options: { json?: boolean; network?: string }) => {
    process.exitCode = await showWallet(options);
  });

wallet
  .command("trustline")
  .description("add the USDC trustline the payer needs before any settlement")
  .option("-n, --network <caip2>", "CAIP-2 network id")
  .action(async (options: { network?: string }) => {
    process.exitCode = await trustline(options);
  });

program
  .command("audit")
  .description("show the payment audit log")
  .option("--tail <n>", "number of entries to show", "20")
  .option("--json", "read the structured event log instead", false)
  .option("--domain <domain>", "only entries for this domain")
  .option("--result <result>", "paid | blocked | failed | simulated | free")
  .option("--path", "print the audit log path", false)
  .action((options: AuditOptions) => {
    process.exitCode = audit(options);
  });

program
  .command("init")
  .description("create ~/.stellar-agent-pay with a conservative default policy")
  .option("--force", "overwrite an existing policy", false)
  .option("--allow <domain...>", "seed the allowlist")
  .action((options: InitOptions) => {
    process.exitCode = init(options);
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CliError) {
      printErr(`${color.red("error")} ${error.message}`);
      process.exitCode = error.exitCode;
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    printErr(`${color.red("error")} ${message}`);
    if (process.env.STELLAR_AGENT_PAY_DEBUG && error instanceof Error && error.stack) {
      printErr(color.dim(error.stack));
    } else {
      printErr(color.dim("  set STELLAR_AGENT_PAY_DEBUG=1 for a stack trace"));
    }
    process.exitCode = EXIT.error;
  }
}

void main();
