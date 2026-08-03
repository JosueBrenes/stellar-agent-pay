import { color, print, printErr } from "../core/output.js";
import { ensureHome, files } from "../core/paths.js";
import { DEFAULT_POLICY, loadPolicy, policyExists, savePolicy } from "../core/policy.js";
import { loadWallet } from "../core/wallet.js";
import { EXIT } from "../core/errors.js";

export type InitOptions = { force?: boolean; allow?: string[] };

/** Creates the policy file with conservative defaults; never touches an existing one unless --force. */
export function init(options: InitOptions): number {
  const dir = ensureHome();
  const existed = policyExists();

  if (existed && !options.force) {
    printErr(color.yellow(`policy already exists at ${files.policy()}, leaving it untouched`));
    printErr(color.dim("  pass --force to overwrite it with the defaults"));
  } else {
    savePolicy({
      ...DEFAULT_POLICY,
      allowedDomains: options.allow ?? DEFAULT_POLICY.allowedDomains,
    });
    printErr(`${color.green("✓")} policy written to ${files.policy()}`);
  }

  const policy = loadPolicy();
  const wallet = loadWallet();

  printErr();
  printErr(color.bold("Configured"));
  printErr(`  home            ${dir}`);
  printErr(`  max per request ${policy.maxPerRequest}`);
  printErr(
    `  domains         ${policy.allowedDomains.join(", ") || color.dim("(none, every paid request is blocked)")}`,
  );
  printErr(`  wallet          ${wallet ? wallet.publicKey : color.yellow("not configured")}`);
  printErr();

  if (!wallet) {
    printErr(color.bold("Next"));
    printErr(
      "  stellar-agent-pay wallet new --fund     # testnet keypair + friendbot + USDC trustline",
    );
    printErr("  stellar-agent-pay policy allow api.example.com --max-per-request 0.01");
    printErr();
  }
  print(files.policy());
  return EXIT.ok;
}
