import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { files, readJson, writeJson } from "./paths.js";

export type WalletFile = { version: 1; secretKey: string; publicKey: string; createdAt: string };

export type WalletSource = "env" | "file";

export type Wallet = { secretKey: string; publicKey: string; source: WalletSource };

export function isSecretKey(value: string): boolean {
  return StrKey.isValidEd25519SecretSeed(value.trim());
}

export function saveWallet(secretKey: string): Wallet {
  const trimmed = secretKey.trim();
  if (!isSecretKey(trimmed)) {
    throw new Error("not a valid Stellar secret key (expected an S... ed25519 seed)");
  }
  const publicKey = Keypair.fromSecret(trimmed).publicKey();
  writeJson(
    files.wallet(),
    { version: 1, secretKey: trimmed, publicKey, createdAt: new Date().toISOString() },
    true,
  );
  return { secretKey: trimmed, publicKey, source: "file" };
}

/**
 * STELLAR_SECRET_KEY wins over the stored wallet, so CI and ephemeral agents can
 * inject a key without ever writing it to disk.
 */
export function loadWallet(): Wallet | null {
  const fromEnv = process.env.STELLAR_SECRET_KEY?.trim();
  if (fromEnv) {
    if (!isSecretKey(fromEnv)) {
      throw new Error("STELLAR_SECRET_KEY is set but is not a valid S... secret key");
    }
    return {
      secretKey: fromEnv,
      publicKey: Keypair.fromSecret(fromEnv).publicKey(),
      source: "env",
    };
  }
  const stored = readJson<WalletFile>(files.wallet());
  if (!stored?.secretKey) return null;
  if (!isSecretKey(stored.secretKey)) {
    throw new Error(`${files.wallet()} holds an invalid secret key`);
  }
  return {
    secretKey: stored.secretKey,
    publicKey: Keypair.fromSecret(stored.secretKey).publicKey(),
    source: "file",
  };
}

export function requireWallet(): Wallet {
  const wallet = loadWallet();
  if (!wallet) {
    throw new Error(
      "no payer wallet configured, run `stellar-agent-pay wallet new --fund` or set STELLAR_SECRET_KEY",
    );
  }
  return wallet;
}
