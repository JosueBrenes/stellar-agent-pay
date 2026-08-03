import { USDC_PUBNET_ADDRESS, USDC_TESTNET_ADDRESS } from "@x402/stellar";

/** Stellar assets are 7-decimal (not 6 like EVM USDC). */
export const DEFAULT_DECIMALS = 7;

const KNOWN_ASSETS: Record<string, { symbol: string; decimals: number }> = {
  [USDC_TESTNET_ADDRESS]: { symbol: "USDC", decimals: 7 },
  [USDC_PUBNET_ADDRESS]: { symbol: "USDC", decimals: 7 },
};

export type AssetInfo = { address: string; symbol: string; decimals: number; known: boolean };

export function assetInfo(address: string): AssetInfo {
  const known = KNOWN_ASSETS[address];
  if (known) return { address, symbol: known.symbol, decimals: known.decimals, known: true };
  return {
    address,
    symbol: `${address.slice(0, 4)}…${address.slice(-4)}`,
    decimals: DEFAULT_DECIMALS,
    known: false,
  };
}

/** "0.05" -> 500000n at 7 decimals. Rejects anything that is not a plain decimal. */
export function toAtomic(decimal: string, decimals = DEFAULT_DECIMALS): bigint {
  const trimmed = decimal.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`invalid amount "${decimal}" (expected a decimal like 0.05)`);
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`amount "${decimal}" has more than ${decimals} decimal places`);
  }
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

/** 500000n -> "0.05" at 7 decimals (trailing zeros trimmed, at least 2 decimals kept). */
export function toDecimal(atomic: bigint, decimals = DEFAULT_DECIMALS): string {
  const negative = atomic < 0n;
  const abs = negative ? -atomic : atomic;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const padded = fraction.length < 2 ? fraction.padEnd(2, "0") : fraction;
  return `${negative ? "-" : ""}${whole}.${padded}`;
}

/**
 * Re-scales an atomic amount between decimal bases so a payment in a non-7-decimal
 * asset can still be compared against policy limits. Truncates toward zero when
 * scaling down, which can only ever under-report, so we round up to stay conservative.
 */
export function rescale(atomic: bigint, from: number, to: number): bigint {
  if (from === to) return atomic;
  if (to > from) return atomic * 10n ** BigInt(to - from);
  const divisor = 10n ** BigInt(from - to);
  const quotient = atomic / divisor;
  return atomic % divisor === 0n ? quotient : quotient + 1n;
}

/** Policy limits are denominated in 7-decimal token units; no FX is applied across assets. */
export function toPolicyUnits(atomic: bigint, decimals: number): bigint {
  return rescale(atomic, decimals, DEFAULT_DECIMALS);
}

export function formatAmount(atomic: bigint, asset: AssetInfo): string {
  return `${toDecimal(atomic, asset.decimals)} ${asset.symbol}`;
}

/** Formats an amount already normalized to policy units (7 decimals). */
export function formatPolicyUnits(atomic: bigint, symbol: string): string {
  return `${toDecimal(atomic)} ${symbol}`;
}
