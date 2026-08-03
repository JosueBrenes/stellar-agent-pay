import { readAuditLines, readEvents, type PaymentEvent } from "../core/audit.js";
import { color, json, print } from "../core/output.js";
import { files } from "../core/paths.js";
import { EXIT } from "../core/errors.js";

export type AuditOptions = {
  tail?: string;
  json?: boolean;
  domain?: string;
  result?: string;
  path?: boolean;
};

export function audit(options: AuditOptions): number {
  if (options.path) {
    print(files.audit());
    return EXIT.ok;
  }

  const limit = options.tail ? Number.parseInt(options.tail, 10) : 20;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`--tail expects a positive number, got "${options.tail}"`);
  }

  if (options.json || options.domain || options.result) {
    let events = readEvents();
    if (options.domain) events = events.filter((e) => e.domain === options.domain!.toLowerCase());
    if (options.result) events = events.filter((e) => e.result === options.result);
    const window = events.slice(-limit);
    if (options.json) {
      json({ path: files.events(), count: window.length, events: window });
    } else {
      for (const event of window) print(colorize(renderFiltered(event)));
    }
    return EXIT.ok;
  }

  const lines = readAuditLines();
  if (lines.length === 0) {
    print(color.dim(`no payment attempts recorded yet (${files.audit()})`));
    return EXIT.ok;
  }
  for (const line of lines.slice(-limit)) print(colorize(line));
  return EXIT.ok;
}

function renderFiltered(event: PaymentEvent): string {
  const amount = event.amount && event.decimals !== undefined ? `${event.amount}` : "-";
  return `${event.ts}  ${event.result.toUpperCase().padEnd(9)}  ${event.domain.padEnd(28)}  ${amount.padEnd(18)}  ${event.method} ${event.url}`;
}

function colorize(line: string): string {
  if (/\sPAID\s/.test(line)) return line.replace("PAID", color.green("PAID"));
  if (/\sBLOCKED\s/.test(line)) return line.replace("BLOCKED", color.red("BLOCKED"));
  if (/\sFAILED\s/.test(line)) return line.replace("FAILED", color.yellow("FAILED"));
  if (/\sSIMULATED\s/.test(line)) return line.replace("SIMULATED", color.blue("SIMULATED"));
  return line;
}
