import fs from "node:fs";
import { ensureHome, files } from "./paths.js";
import { assetInfo, toDecimal, toPolicyUnits } from "./money.js";

export type EventResult = "paid" | "blocked" | "failed" | "free" | "simulated";

export type PaymentEvent = {
  ts: string;
  result: EventResult;
  method: string;
  url: string;
  domain: string;
  network?: string;
  /** Atomic units of `asset`. */
  amount?: string;
  asset?: string;
  assetSymbol?: string;
  decimals?: number;
  /** Amount normalized to 7-decimal policy units, so budgets can be summed. */
  policyUnits?: string;
  tx?: string;
  payer?: string;
  rule?: string;
  reason?: string;
  mode?: "x402" | "channel";
};

const COLUMN = { result: 9, domain: 28, amount: 18 };

function pad(value: string, width: number): string {
  return value.length >= width ? value : value.padEnd(width);
}

/** Keeps the log strictly one line per attempt: SDK errors can be multi-line and long. */
function oneLine(value: string, max = 240): string {
  const flat = value.replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** One grep-able line per attempt: what, where, how much, and why it went that way. */
export function renderAuditLine(event: PaymentEvent): string {
  const amount =
    event.amount !== undefined && event.decimals !== undefined
      ? `${toDecimal(BigInt(event.amount), event.decimals)} ${event.assetSymbol ?? ""}`.trim()
      : "-";
  const parts = [
    event.ts,
    pad(event.result.toUpperCase(), COLUMN.result),
    pad(event.domain, COLUMN.domain),
    pad(amount, COLUMN.amount),
    `${event.method} ${oneLine(event.url, 200)}`,
  ];
  const trailer: string[] = [];
  if (event.network) trailer.push(`network=${event.network}`);
  if (event.mode === "channel") trailer.push("mode=channel");
  if (event.tx) trailer.push(`tx=${event.tx}`);
  if (event.rule) trailer.push(`rule=${event.rule}`);
  if (event.reason) trailer.push(`reason="${oneLine(event.reason)}"`);
  return `${parts.join("  ")}${trailer.length ? `  ${trailer.join(" ")}` : ""}`;
}

/**
 * Appends to both sinks: audit.log for humans (and demos), events.jsonl as the
 * machine-readable ledger that budget accounting reads back.
 */
export function recordEvent(event: PaymentEvent): void {
  ensureHome();
  fs.appendFileSync(files.audit(), `${renderAuditLine(event)}\n`, "utf8");
  fs.appendFileSync(files.events(), `${JSON.stringify(event)}\n`, "utf8");
}

export function buildEvent(
  base: Omit<PaymentEvent, "ts" | "assetSymbol" | "decimals" | "policyUnits">,
): PaymentEvent {
  const info = base.asset ? assetInfo(base.asset) : null;
  const event: PaymentEvent = { ts: new Date().toISOString(), ...base };
  if (info) {
    event.assetSymbol = info.symbol;
    event.decimals = info.decimals;
  }
  if (base.amount !== undefined && info) {
    event.policyUnits = toPolicyUnits(BigInt(base.amount), info.decimals).toString();
  }
  return event;
}

export function readEvents(): PaymentEvent[] {
  let raw: string;
  try {
    raw = fs.readFileSync(files.events(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as PaymentEvent];
      } catch {
        return []; // tolerate a partially written trailing line
      }
    });
}

export function readAuditLines(): string[] {
  try {
    return fs.readFileSync(files.audit(), "utf8").split("\n").filter(Boolean);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export type Spend = { total: bigint; byDomain: Map<string, bigint> };

/** Settled spend inside a rolling window, in 7-decimal policy units. */
export function spendSince(sinceMs: number, events = readEvents()): Spend {
  const byDomain = new Map<string, bigint>();
  let total = 0n;
  for (const event of events) {
    if (event.result !== "paid" || !event.policyUnits) continue;
    if (Date.parse(event.ts) < sinceMs) continue;
    const units = BigInt(event.policyUnits);
    total += units;
    byDomain.set(event.domain, (byDomain.get(event.domain) ?? 0n) + units);
  }
  return { total, byDomain };
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function spendLast24h(events = readEvents()): Spend {
  return spendSince(Date.now() - DAY_MS, events);
}
