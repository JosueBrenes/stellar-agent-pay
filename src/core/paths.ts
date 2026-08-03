import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * All CLI state lives in a single directory so an operator can inspect, back up
 * or wipe an agent's payment identity, policy and history in one place.
 * Override with STELLAR_AGENT_PAY_HOME (useful for tests and demos).
 */
export function homeDir(): string {
  return process.env.STELLAR_AGENT_PAY_HOME || path.join(os.homedir(), ".stellar-agent-pay");
}

export const files = {
  policy: () => path.join(homeDir(), "policy.json"),
  wallet: () => path.join(homeDir(), "wallet.json"),
  audit: () => path.join(homeDir(), "audit.log"),
  events: () => path.join(homeDir(), "events.jsonl"),
  session: () => path.join(homeDir(), "session.json"),
};

export function ensureHome(): string {
  const dir = homeDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Best-effort 0600. No-op on Windows, where chmod does not map to ACLs. */
export function restrictPermissions(file: string): void {
  if (process.platform === "win32") return;
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* non-fatal */
  }
}

export function writeJson(file: string, value: unknown, secret = false): void {
  ensureHome();
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  if (secret) restrictPermissions(file);
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`${file} is not readable JSON: ${(err as Error).message}`, { cause: err });
  }
}
