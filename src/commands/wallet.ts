import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { DEFAULT_PUBNET_HORIZON_URL, DEFAULT_TESTNET_HORIZON_URL } from "@x402/stellar";
import { color, json, keyValue, print, printErr } from "../core/output.js";
import { files, readJson } from "../core/paths.js";
import { loadWallet, saveWallet, type WalletFile } from "../core/wallet.js";
import { DEFAULT_NETWORK } from "../core/x402.js";
import { CliError, EXIT } from "../core/errors.js";

/** Circle's classic USDC issuers, the trustline anchor for SAC settlements. */
const USDC_ISSUER = {
  "stellar:testnet": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "stellar:pubnet": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
} as const;

const FRIENDBOT = "https://friendbot.stellar.org";

type NetworkOption = { network?: string };

function resolveNetwork(options: NetworkOption): string {
  return options.network ?? process.env.STELLAR_NETWORK ?? DEFAULT_NETWORK;
}

function horizonFor(network: string): Horizon.Server {
  return new Horizon.Server(
    network === "stellar:pubnet" ? DEFAULT_PUBNET_HORIZON_URL : DEFAULT_TESTNET_HORIZON_URL,
  );
}

function passphraseFor(network: string): string {
  return network === "stellar:pubnet" ? Networks.PUBLIC : Networks.TESTNET;
}

export async function newWallet(options: {
  fund?: boolean;
  force?: boolean;
  network?: string;
  json?: boolean;
}): Promise<number> {
  const network = resolveNetwork(options);
  const existing = readJson<WalletFile>(files.wallet());
  if (existing && !options.force) {
    throw new CliError(
      `a wallet already exists (${existing.publicKey}), pass --force to replace it, or use \`wallet import\``,
    );
  }
  if (options.fund && network === "stellar:pubnet") {
    throw new CliError("--fund only works on testnet (friendbot does not exist on pubnet)");
  }

  const keypair = Keypair.random();
  const wallet = saveWallet(keypair.secret());
  printErr(`${color.green("✓")} new payer wallet ${color.bold(wallet.publicKey)}`);
  printErr(color.dim(`  secret stored in ${files.wallet()}`));

  const steps: Record<string, string> = {};
  if (options.fund) {
    printErr(color.dim("  funding with friendbot…"));
    const response = await fetch(`${FRIENDBOT}?addr=${wallet.publicKey}`);
    if (!response.ok) {
      throw new CliError(`friendbot refused to fund the account (HTTP ${response.status})`);
    }
    steps.friendbot = "funded";
    printErr(`${color.green("✓")} funded with testnet XLM`);
    printErr(color.dim("  adding USDC trustline…"));
    const tx = await addTrustline(keypair, network);
    steps.trustline = tx;
    printErr(`${color.green("✓")} USDC trustline added ${color.dim(tx)}`);
  }

  if (options.json) {
    json({ publicKey: wallet.publicKey, network, walletFile: files.wallet(), ...steps });
    return EXIT.ok;
  }

  printErr();
  printErr(color.bold("Next steps"));
  if (!options.fund) {
    printErr(`  1. fund the account:      ${FRIENDBOT}?addr=${wallet.publicKey}`);
    printErr("  2. add a USDC trustline:  stellar-agent-pay wallet trustline");
    printErr(`  3. get testnet USDC:      https://faucet.circle.com  → ${wallet.publicKey}`);
  } else {
    printErr(`  get testnet USDC:  https://faucet.circle.com  → ${color.bold(wallet.publicKey)}`);
  }
  printErr();
  return EXIT.ok;
}

export async function importWallet(
  secret: string | undefined,
  options: { force?: boolean },
): Promise<number> {
  const value = secret ?? (await readStdin());
  if (!value)
    throw new CliError("no secret key given (pass it as an argument or pipe it on stdin)");
  const existing = readJson<WalletFile>(files.wallet());
  if (existing && !options.force) {
    throw new CliError(
      `a wallet already exists (${existing.publicKey}), pass --force to replace it`,
    );
  }
  const wallet = saveWallet(value);
  print(`${color.green("✓")} imported ${wallet.publicKey}`);
  print(color.dim(`  ${files.wallet()}`));
  return EXIT.ok;
}

export async function showWallet(options: { json?: boolean; network?: string }): Promise<number> {
  const wallet = loadWallet();
  if (!wallet) {
    if (options.json) {
      json({ wallet: null });
      return EXIT.ok;
    }
    throw new CliError("no wallet configured, run `stellar-agent-pay wallet new --fund`");
  }
  const network = resolveNetwork(options);
  if (options.json) {
    json({ publicKey: wallet.publicKey, source: wallet.source, network });
    return EXIT.ok;
  }
  print(
    keyValue([
      ["address", wallet.publicKey],
      ["source", wallet.source === "env" ? "STELLAR_SECRET_KEY" : files.wallet()],
      ["network", network],
    ]),
  );
  return EXIT.ok;
}

export async function trustline(options: { network?: string }): Promise<number> {
  const wallet = loadWallet();
  if (!wallet)
    throw new CliError("no wallet configured, run `stellar-agent-pay wallet new --fund`");
  const network = resolveNetwork(options);
  const hash = await addTrustline(Keypair.fromSecret(wallet.secretKey), network);
  print(`${color.green("✓")} USDC trustline in place ${color.dim(hash)}`);
  return EXIT.ok;
}

/**
 * The SAC `transfer` settles the underlying classic asset, so both payer and
 * recipient need a USDC trustline or settlement fails with `op_no_trust`.
 */
async function addTrustline(keypair: Keypair, network: string): Promise<string> {
  const issuer = USDC_ISSUER[network as keyof typeof USDC_ISSUER];
  if (!issuer) throw new CliError(`no known USDC issuer for network "${network}"`);
  const horizon = horizonFor(network);

  let account: Awaited<ReturnType<Horizon.Server["loadAccount"]>>;
  try {
    account = await horizon.loadAccount(keypair.publicKey());
  } catch (error) {
    if ((error as { response?: { status?: number } }).response?.status === 404) {
      throw new CliError(
        `${keypair.publicKey()} is not funded yet, fund it first (${FRIENDBOT}?addr=${keypair.publicKey()})`,
      );
    }
    throw error;
  }

  const existing = account.balances.find(
    (b) =>
      (b as { asset_code?: string }).asset_code === "USDC" &&
      (b as { asset_issuer?: string }).asset_issuer === issuer,
  );
  if (existing) return "already present";

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: passphraseFor(network),
  })
    .addOperation(Operation.changeTrust({ asset: new Asset("USDC", issuer) }))
    .setTimeout(60)
    .build();
  tx.sign(keypair);
  const result = await horizon.submitTransaction(tx);
  return result.hash;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}
