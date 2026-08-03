/**
 * Real x402 seller on Stellar testnet, the counterpart used to demo the full
 * pay-and-unlock loop. Settlement goes through the OpenZeppelin Channels
 * facilitator, which sponsors the network fees, so the paying agent needs USDC
 * but no XLM.
 *
 * Requires in .env (see .env.example):
 *   STELLAR_RECIPIENT   G... account with a USDC trustline (receives the payment)
 *   OZ_API_KEY          https://channels.openzeppelin.com/testnet/gen
 *   STELLAR_NETWORK     stellar:testnet (default)
 *   FACILITATOR_URL     defaults to the testnet facilitator
 *
 *   node examples/seller/server.js
 */
import "dotenv/config";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";

const NETWORK = process.env.STELLAR_NETWORK || "stellar:testnet";
const PORT = Number(process.env.SELLER_PORT || 3001);

if (!process.env.OZ_API_KEY) {
  throw new Error(
    "OZ_API_KEY is required. Generate one at https://channels.openzeppelin.com/testnet/gen (testnet) or https://channels.openzeppelin.com/gen (mainnet)",
  );
}
if (!process.env.STELLAR_RECIPIENT) {
  throw new Error("STELLAR_RECIPIENT is required: the G... account that receives the USDC");
}

const facilitator = new HTTPFacilitatorClient({
  url: process.env.FACILITATOR_URL ?? "https://channels.openzeppelin.com/x402/testnet",
  // OZ Channels requires Bearer auth on both testnet and mainnet.
  createAuthHeaders: async () => {
    const headers = { Authorization: `Bearer ${process.env.OZ_API_KEY}` };
    return { verify: headers, settle: headers, supported: headers };
  },
});

const resourceServer = new x402ResourceServer(facilitator).register(
  NETWORK,
  new ExactStellarScheme(),
);

const app = express();

app.use(
  paymentMiddleware(
    {
      "GET /weather": {
        accepts: {
          scheme: "exact",
          price: "$0.001",
          network: NETWORK,
          payTo: process.env.STELLAR_RECIPIENT,
        },
        description: "Current weather data",
      },
      "GET /premium-report": {
        accepts: {
          scheme: "exact",
          price: "$0.50",
          network: NETWORK,
          payTo: process.env.STELLAR_RECIPIENT,
        },
        description: "Full market intelligence report",
      },
    },
    resourceServer,
  ),
);

app.get("/weather", (_req, res) => {
  res.json({ city: "San José", temp: 24, conditions: "Partly cloudy" });
});

app.get("/premium-report", (_req, res) => {
  res.json({ title: "Q3 market report", pages: 42, summary: "…" });
});

app.get("/free", (_req, res) => {
  res.json({ note: "this endpoint costs nothing" });
});

app.listen(PORT, () => {
  console.log(`x402 seller on http://localhost:${PORT} (${NETWORK})`);
  console.log(`  paid to ${process.env.STELLAR_RECIPIENT}`);
  console.log("  GET /weather          $0.001");
  console.log("  GET /premium-report   $0.50");
  console.log("  GET /free             free");
});
