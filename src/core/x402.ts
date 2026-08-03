import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import type { Network, PaymentRequired, SettleResponse } from "@x402/core/types";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { evaluate, type Decision } from "./engine.js";
import type { Policy } from "./policy.js";
import type { Spend } from "./audit.js";

export const DEFAULT_NETWORK = "stellar:testnet";

export class PolicyViolation extends Error {
  constructor(readonly decision: Decision) {
    super(decision.violation?.detail ?? "blocked by spending policy");
    this.name = "PolicyViolation";
  }
}

export type PaymentClientOptions = {
  secretKey: string;
  network: string;
  policy: Policy;
  url: string;
  spend?: Spend;
  rpcUrl?: string;
};

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type PaymentClient = {
  fetch: FetchLike;
  httpClient: x402HTTPClient;
  /** Populated as soon as a 402 is negotiated, whether or not the payment is allowed. */
  decision: () => Decision | null;
};

/**
 * Wires the spending policy into the x402 client's `onBeforePaymentCreation` hook,
 * the last point before the agent signs an authorization entry. Returning `abort`
 * makes the core client throw, so nothing is ever signed for a refused payment.
 */
export function createPaymentClient(options: PaymentClientOptions): PaymentClient {
  const network = asNetwork(options.network);
  const signer = createEd25519Signer(options.secretKey, network);
  const scheme = options.rpcUrl
    ? new ExactStellarScheme(signer, { url: options.rpcUrl })
    : new ExactStellarScheme(signer);

  let decision: Decision | null = null;

  const client = new x402Client()
    .register(network, scheme)
    .onBeforePaymentCreation(async (context) => {
      decision = evaluate({
        url: options.url,
        requirements: context.selectedRequirements,
        policy: options.policy,
        spend: options.spend,
      });
      if (!decision.allowed) {
        const violation = decision.violation!;
        return { abort: true, reason: `[${violation.rule}] ${violation.detail}` };
      }
      return undefined;
    });

  const httpClient = new x402HTTPClient(client);

  return {
    fetch: wrapFetchWithPayment(fetch, httpClient),
    httpClient,
    decision: () => decision,
  };
}

/** Reads the settlement receipt the resource server echoes back after a paid request. */
export function settlementOf(
  httpClient: x402HTTPClient,
  response: Response,
): SettleResponse | null {
  try {
    return httpClient.getPaymentSettleResponse((name) => response.headers.get(name));
  } catch {
    return null;
  }
}

/** Parses a raw 402 into payment requirements without signing anything (dry-run path). */
export async function readPaymentRequired(
  httpClient: x402HTTPClient,
  response: Response,
  body: unknown,
): Promise<PaymentRequired> {
  return httpClient.getPaymentRequiredResponse((name) => response.headers.get(name), body);
}

export function isPolicyViolation(error: unknown): error is PolicyViolation {
  return error instanceof PolicyViolation;
}

/** x402 network ids are CAIP-2 (`namespace:reference`); reject anything else early. */
export function asNetwork(value: string): Network {
  if (!/^[^:\s]+:[^:\s]+$/.test(value)) {
    throw new Error(`"${value}" is not a CAIP-2 network id (expected e.g. stellar:testnet)`);
  }
  return value as Network;
}
