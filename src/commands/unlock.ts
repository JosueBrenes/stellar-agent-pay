import fs from "node:fs";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { buildEvent, recordEvent, spendLast24h, type PaymentEvent } from "../core/audit.js";
import { evaluate, type Decision } from "../core/engine.js";
import { formatPolicyUnits, toDecimal } from "../core/money.js";
import { color, glyph, heading, keyValue, json, print, printErr } from "../core/output.js";
import { files } from "../core/paths.js";
import { loadPolicy } from "../core/policy.js";
import { loadWallet, requireWallet } from "../core/wallet.js";
import { createPaymentClient, DEFAULT_NETWORK, settlementOf } from "../core/x402.js";
import { CliError, EXIT } from "../core/errors.js";

export type UnlockOptions = {
  method: string;
  header: string[];
  data?: string;
  network?: string;
  rpcUrl?: string;
  dryRun: boolean;
  json: boolean;
  output?: string;
  quiet: boolean;
  yes: boolean;
};

export async function unlock(rawUrl: string, options: UnlockOptions): Promise<number> {
  const url = normalizeUrl(rawUrl);
  const policy = loadPolicy();
  const network = options.network ?? process.env.STELLAR_NETWORK ?? DEFAULT_NETWORK;
  const method = options.method.toUpperCase();
  const headers = parseHeaders(options.header);
  const spend = spendLast24h();
  const emit = (line = "") => {
    if (!options.quiet && !options.json) printErr(line);
  };

  emit(`${glyph.arrow} ${color.bold(method)} ${url}`);

  // Without a wallet we can still negotiate the 402 and show the verdict. A free
  // resource then works, and a paid one fails with an actionable message instead
  // of demanding a key up front.
  const configuredWallet = loadWallet();
  if (options.dryRun || !configuredWallet) {
    return preflight({
      url,
      method,
      headers,
      body: options.data,
      network,
      policy,
      spend,
      options,
      mode: options.dryRun ? "dry-run" : "no-wallet",
    });
  }

  const wallet = requireWallet();
  const client = createPaymentClient({
    secretKey: wallet.secretKey,
    network,
    policy,
    url,
    spend,
    ...(options.rpcUrl ? { rpcUrl: options.rpcUrl } : {}),
  });

  const request: RequestInit = { method, headers };
  if (options.data !== undefined && method !== "GET" && method !== "HEAD") {
    request.body = options.data;
    if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
      headers["content-type"] = "application/json";
    }
  }

  let response: Response;
  try {
    response = await client.fetch(url, request);
  } catch (error) {
    const decision = client.decision();
    if (decision && !decision.allowed) {
      return reportBlocked({ decision, url, method, network, options });
    }
    return reportFailure({
      error,
      decision,
      url,
      method,
      network,
      options,
    });
  }

  const decision = client.decision();
  const body = await readBody(response);

  // A 402 that survived the payment attempt means the server or facilitator refused it.
  if (response.status === 402) {
    return reportFailure({
      error: new Error(describeServerRefusal(body)),
      decision,
      url,
      method,
      network,
      options,
    });
  }

  if (!decision) {
    // The resource was free: nothing was signed, but the attempt is still audited.
    const event = buildEvent({
      result: "free",
      method,
      url,
      domain: new URL(url).hostname,
      network,
    });
    recordEvent(event);
    if (!options.json) {
      emit(
        `${glyph.pass} ${color.dim("no payment required")} ${color.dim(`(${response.status})`)}`,
      );
    }
    return finish({
      options,
      body,
      event,
      decision: null,
      settlement: null,
      status: response.status,
    });
  }

  const settlement = settlementOf(client.httpClient, response);
  const event = buildEvent({
    result: response.ok ? "paid" : "failed",
    method,
    url,
    domain: decision.host,
    network: decision.requirements.network,
    amount: decision.requirements.amount,
    asset: decision.requirements.asset,
    mode: "x402",
    ...(settlement?.transaction ? { tx: settlement.transaction } : {}),
    ...(settlement?.payer ? { payer: settlement.payer } : {}),
    ...(response.ok ? {} : { reason: `resource returned HTTP ${response.status}` }),
  });
  recordEvent(event);

  if (!options.json) {
    emit();
    emit(
      `${glyph.pass} ${color.green("PAID")} ${color.bold(formatPolicyUnits(decision.amountPolicyUnits, decision.asset.symbol))} ${color.dim("→")} ${decision.requirements.payTo}`,
    );
    emit(
      keyValue([
        ["network", decision.requirements.network],
        [
          "tx",
          settlement?.transaction
            ? explorerLine(settlement.transaction, decision.requirements.network)
            : color.dim("not reported by server"),
        ],
        ["audit", files.audit()],
      ]),
    );
    emit();
  }

  return finish({ options, body, event, decision, settlement, status: response.status });
}

type PreflightInput = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  network: string;
  policy: ReturnType<typeof loadPolicy>;
  spend: ReturnType<typeof spendLast24h>;
  options: UnlockOptions;
  mode: "dry-run" | "no-wallet";
};

/** Negotiates the 402 and shows the verdict without ever building a signer. */
async function preflight(input: PreflightInput): Promise<number> {
  const { url, method, headers, network, policy, spend, options, mode } = input;
  const httpClient = new x402HTTPClient(new x402Client());
  const request: RequestInit = { method, headers };
  if (input.body !== undefined && method !== "GET" && method !== "HEAD") request.body = input.body;

  const response = await fetch(url, request);
  const body = await readBody(response);

  if (response.status !== 402) {
    if (!options.json) {
      printErr(
        `${glyph.pass} ${color.dim(`resource answered ${response.status}, no payment required`)}`,
      );
    }
    const event = buildEvent({
      result: "free",
      method,
      url,
      domain: new URL(url).hostname,
      network,
    });
    return finish({
      options,
      body,
      event,
      decision: null,
      settlement: null,
      status: response.status,
    });
  }

  let paymentRequired: PaymentRequired;
  try {
    paymentRequired = httpClient.getPaymentRequiredResponse((n) => response.headers.get(n), body);
  } catch {
    throw new CliError(
      "the server returned 402 but no readable x402 payment requirements (missing PAYMENT-REQUIRED header)",
      EXIT.error,
    );
  }

  const requirements = selectRequirements(paymentRequired, network);
  const decision = evaluate({ url, requirements, policy, spend });

  const walletMissing = mode === "no-wallet";
  const noWalletHint =
    "no payer wallet configured, run `stellar-agent-pay wallet new --fund` or set STELLAR_SECRET_KEY";

  if (!options.json) {
    printRequirements(paymentRequired, requirements, decision);
    printChecks(decision);
    printErr();
    if (!decision.allowed) {
      printErr(
        `${glyph.fail} ${color.red(walletMissing ? "BLOCKED BY POLICY" : "WOULD BLOCK")} ${color.dim(`rule=${decision.violation!.rule}`)}`,
      );
      printErr(`  ${decision.violation!.detail}`);
      for (const hint of remediation(decision)) printErr(`  ${color.dim("hint:")} ${hint}`);
    } else if (walletMissing) {
      printErr(
        `${glyph.fail} ${color.red("CANNOT PAY")} ${color.dim("(policy allows this payment)")}`,
      );
      printErr(`  ${noWalletHint}`);
    } else {
      printErr(
        `${glyph.pass} ${color.green("WOULD PAY")} ${color.dim("(dry run, nothing was signed)")}`,
      );
    }
    printErr();
  }

  const result: "simulated" | "blocked" | "failed" = !decision.allowed
    ? walletMissing
      ? "blocked"
      : "simulated"
    : walletMissing
      ? "failed"
      : "simulated";

  const event = buildEvent({
    result,
    method,
    url,
    domain: decision.host,
    network: requirements.network,
    amount: requirements.amount,
    asset: requirements.asset,
    mode: "x402",
    ...(decision.allowed
      ? { reason: walletMissing ? noWalletHint : "dry run: would pay" }
      : { rule: decision.violation!.rule, reason: decision.violation!.detail }),
  });
  recordEvent(event);

  const exitCode = !decision.allowed ? EXIT.blocked : walletMissing ? EXIT.error : EXIT.ok;
  finish({ options, body: null, event, decision, settlement: null, status: 402 });
  return exitCode;
}

type BlockedInput = {
  decision: Decision;
  url: string;
  method: string;
  network: string;
  options: UnlockOptions;
};

function reportBlocked({ decision, url, method, options }: BlockedInput): number {
  const violation = decision.violation!;
  const event = buildEvent({
    result: "blocked",
    method,
    url,
    domain: decision.host,
    network: decision.requirements.network,
    amount: decision.requirements.amount,
    asset: decision.requirements.asset,
    mode: "x402",
    rule: violation.rule,
    reason: violation.detail,
  });
  recordEvent(event);

  if (options.json) {
    json({
      status: "blocked",
      url,
      method,
      rule: violation.rule,
      reason: violation.detail,
      amount: toDecimal(decision.amountPolicyUnits),
      asset: decision.asset.address,
      assetSymbol: decision.asset.symbol,
      network: decision.requirements.network,
      payTo: decision.requirements.payTo,
      checks: decision.checks,
      auditLog: files.audit(),
    });
    return EXIT.blocked;
  }

  printChecks(decision);
  printErr();
  printErr(
    `${glyph.fail} ${color.red(color.bold("BLOCKED BY POLICY"))} ${color.dim(`rule=${violation.rule}`)}`,
  );
  printErr(`  ${violation.detail}`);
  printErr(`  ${color.dim("no authorization entry was signed; no funds left the wallet")}`);
  printErr();
  for (const hint of remediation(decision)) printErr(`  ${color.dim("hint:")} ${hint}`);
  printErr(`  ${color.dim("audit:")} ${files.audit()}`);
  printErr();
  return EXIT.blocked;
}

type FailureInput = {
  error: unknown;
  decision: Decision | null;
  url: string;
  method: string;
  network: string;
  options: UnlockOptions;
};

function reportFailure({ error, decision, url, method, network, options }: FailureInput): number {
  const message = error instanceof Error ? error.message : String(error);
  const event = buildEvent({
    result: "failed",
    method,
    url,
    domain: new URL(url).hostname,
    network: decision?.requirements.network ?? network,
    mode: "x402",
    reason: message,
    ...(decision
      ? { amount: decision.requirements.amount, asset: decision.requirements.asset }
      : {}),
  });
  recordEvent(event);

  if (options.json) {
    json({ status: "failed", url, method, error: message, auditLog: files.audit() });
    return EXIT.error;
  }
  printErr();
  printErr(`${glyph.fail} ${color.red("PAYMENT FAILED")}`);
  printErr(`  ${message}`);
  printErr(`  ${color.dim("audit:")} ${files.audit()}`);
  printErr();
  return EXIT.error;
}

type FinishInput = {
  options: UnlockOptions;
  body: unknown;
  event: PaymentEvent;
  decision: Decision | null;
  settlement: { transaction?: string; payer?: string; success?: boolean } | null;
  status: number;
};

/** Resource content goes to stdout; everything else went to stderr, so piping stays clean. */
function finish({ options, body, event, decision, settlement, status }: FinishInput): number {
  if (options.json) {
    json({
      status: event.result,
      httpStatus: status,
      url: event.url,
      method: event.method,
      ...(decision
        ? {
            allowed: decision.allowed,
            ...(decision.violation
              ? { rule: decision.violation.rule, reason: decision.violation.detail }
              : {}),
            amount: toDecimal(decision.amountPolicyUnits),
            asset: decision.asset.address,
            assetSymbol: decision.asset.symbol,
            network: decision.requirements.network,
            payTo: decision.requirements.payTo,
            checks: decision.checks,
          }
        : {}),
      ...(settlement?.transaction ? { tx: settlement.transaction } : {}),
      body,
      auditLog: files.audit(),
    });
    return EXIT.ok;
  }

  const rendered =
    body === null ? "" : typeof body === "string" ? body : JSON.stringify(body, null, 2);
  if (options.output) {
    fs.writeFileSync(options.output, rendered.endsWith("\n") ? rendered : `${rendered}\n`, "utf8");
    printErr(`${glyph.pass} ${color.dim(`resource written to ${options.output}`)}`);
  } else if (rendered) {
    print(rendered);
  }
  return EXIT.ok;
}

/** Mirrors the core client's default selector: first option the wallet can actually pay. */
export function selectRequirements(
  paymentRequired: PaymentRequired,
  network: string,
): PaymentRequirements {
  const accepts = paymentRequired.accepts ?? [];
  if (accepts.length === 0) {
    throw new CliError("the 402 response did not advertise any payment option", EXIT.error);
  }
  return accepts.find((r) => r.network === network) ?? accepts[0]!;
}

function printRequirements(
  paymentRequired: PaymentRequired,
  requirements: PaymentRequirements,
  decision: Decision,
): void {
  printErr(
    `${color.yellow("402 Payment Required")} ${color.dim("·")} ${color.bold(decision.host)}${
      paymentRequired.resource?.description
        ? color.dim(` · ${paymentRequired.resource.description}`)
        : ""
    }`,
  );
  printErr(
    keyValue([
      ["amount", color.bold(formatPolicyUnits(decision.amountPolicyUnits, decision.asset.symbol))],
      [
        "asset",
        decision.asset.known
          ? `${decision.asset.symbol} (${requirements.asset})`
          : requirements.asset,
      ],
      ["network", requirements.network],
      ["pay to", requirements.payTo],
      ["scheme", `${requirements.scheme} (x402 v${paymentRequired.x402Version})`],
    ]),
  );
  printErr();
}

function printChecks(decision: Decision): void {
  printErr(heading("Spending policy"));
  const width = Math.max(...decision.checks.map((c) => c.label.length));
  for (const check of decision.checks) {
    const mark =
      check.status === "pass" ? glyph.pass : check.status === "fail" ? glyph.fail : glyph.skip;
    const label = check.label.padEnd(width);
    const detail = check.status === "fail" ? color.red(check.detail) : color.dim(check.detail);
    printErr(`  ${mark} ${label}  ${detail}`);
  }
}

function remediation(decision: Decision): string[] {
  const rule = decision.violation?.rule;
  switch (rule) {
    case "domain_allowlist":
      return [`stellar-agent-pay policy allow ${decision.host}`];
    case "domain_blocked":
      return [`stellar-agent-pay policy unblock ${decision.host}`];
    case "max_per_request":
      return [
        `stellar-agent-pay policy set maxPerRequest ${toDecimal(decision.amountPolicyUnits)}`,
        `stellar-agent-pay policy allow ${decision.host} --max-per-request ${toDecimal(decision.amountPolicyUnits)}`,
      ];
    case "max_per_domain_per_day":
      return [`stellar-agent-pay policy allow ${decision.host} --max-per-day <amount>`];
    case "max_per_day_per_agent":
      return ["stellar-agent-pay policy set maxPerDayPerAgent <amount>"];
    case "network":
      return [`stellar-agent-pay policy set allowedNetworks ${decision.requirements.network}`];
    case "asset":
      return [`stellar-agent-pay policy set allowedAssets ${decision.requirements.asset}`];
    case "transport":
      return ["stellar-agent-pay policy set requireHttps false"];
    default:
      return ["stellar-agent-pay policy show"];
  }
}

function describeServerRefusal(body: unknown): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const detail = record.error ?? record.message ?? record.errorMessage;
    if (typeof detail === "string") return `server rejected the payment: ${detail}`;
  }
  return "server still answered 402 after the payment was submitted (verification or settlement failed)";
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function normalizeUrl(raw: string): string {
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).toString();
  } catch {
    throw new CliError(`"${raw}" is not a valid URL`, EXIT.error);
  }
}

function parseHeaders(entries: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of entries) {
    const index = entry.indexOf(":");
    if (index < 1)
      throw new CliError(`invalid --header "${entry}" (expected "Name: value")`, EXIT.error);
    headers[entry.slice(0, index).trim()] = entry.slice(index + 1).trim();
  }
  return headers;
}

function explorerLine(tx: string, network: string): string {
  const net = network === "stellar:pubnet" ? "public" : "testnet";
  return `${tx} ${color.dim(`https://stellar.expert/explorer/${net}/tx/${tx}`)}`;
}
