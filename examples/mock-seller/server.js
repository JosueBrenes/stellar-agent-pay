/**
 * Offline x402 seller that emits protocol-correct 402 responses with no facilitator,
 * no API key and no funds, so the spending-policy behaviour of the CLI can be
 * demonstrated on a laptop with nothing configured.
 *
 *   node examples/mock-seller/server.js
 *   stellar-agent-pay unlock http://localhost:4021/weather --dry-run
 *   stellar-agent-pay unlock http://localhost:4021/premium-report --dry-run
 *
 * It cannot settle a payment: signing an auth entry requires a real Soroban RPC
 * simulation and a funded payer. For the full pay-and-unlock loop use
 * examples/seller (real @x402/express + OZ Channels facilitator on testnet).
 */
import http from "node:http";
import { Keypair } from "@stellar/stellar-sdk";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { USDC_TESTNET_ADDRESS } from "@x402/stellar";

const PORT = Number(process.env.PORT || 4021);
const NETWORK = process.env.STELLAR_NETWORK || "stellar:testnet";
// Deterministic stand-in merchant account, so the demo output is stable.
const PAY_TO =
  process.env.STELLAR_RECIPIENT || Keypair.fromRawEd25519Seed(Buffer.alloc(32, 42)).publicKey();

/** price is in USDC; Stellar assets carry 7 decimals. */
const ROUTES = {
  "/weather": {
    price: "0.001",
    description: "Current weather data",
    body: { city: "San José", temp: 24, conditions: "Partly cloudy" },
  },
  "/premium-report": {
    price: "0.50",
    description: "Full market intelligence report",
    body: { title: "Q3 market report", pages: 42 },
  },
  "/bulk-dataset": {
    price: "0.02",
    description: "Bulk dataset page",
    body: { rows: 1000, page: 1 },
  },
};

const toAtomic = (usdc) => {
  const [whole, fraction = ""] = usdc.split(".");
  return BigInt(whole + fraction.padEnd(7, "0")).toString();
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = ROUTES[url.pathname];

  if (url.pathname === "/free") {
    return json(res, 200, { note: "this endpoint costs nothing" });
  }
  if (!route) {
    return json(res, 404, { error: `no such resource: ${url.pathname}` });
  }

  const paid = req.headers["payment-signature"] || req.headers["x-payment"];
  if (paid) {
    // A signed payload arrived, but this server has no facilitator to verify or
    // settle it, so say so instead of pretending the resource was paid for.
    return json(
      res,
      402,
      {
        error:
          "mock seller cannot settle payments (no facilitator configured). Use --dry-run here, or run examples/seller for the real testnet loop",
      },
      paymentRequiredHeader(url, route),
    );
  }

  return json(res, 402, { error: "payment required" }, paymentRequiredHeader(url, route));
});

function paymentRequiredHeader(url, route) {
  return {
    "PAYMENT-REQUIRED": encodePaymentRequiredHeader({
      x402Version: 2,
      error: "payment required",
      resource: {
        url: url.toString(),
        description: route.description,
        mimeType: "application/json",
        serviceName: "mock-seller",
      },
      accepts: [
        {
          scheme: "exact",
          network: NETWORK,
          asset: USDC_TESTNET_ADDRESS,
          amount: toAtomic(route.price),
          payTo: PAY_TO,
          maxTimeoutSeconds: 60,
          // The facilitator advertises fee sponsorship; the Stellar exact scheme
          // refuses to sign without it, so the mock mirrors a sponsored setup.
          extra: { areFeesSponsored: true },
        },
      ],
    }),
  };
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

server.listen(PORT, () => {
  console.log(`mock x402 seller on http://localhost:${PORT}  (${NETWORK})`);
  console.log(`  pay to ${PAY_TO}`);
  for (const [path, route] of Object.entries(ROUTES)) {
    console.log(`  ${path.padEnd(18)} $${route.price}  ${route.description}`);
  }
  console.log("  /free              $0.00   no payment required");
});
