# Examples

Two sellers ship with the repo: one that runs offline for demos and CI, and one that settles real payments on Stellar testnet.

## mock-seller (no keys, no funds, no network)

`examples/mock-seller/server.js` answers `402 Payment Required` with protocol correct x402 v2 payment requirements, encoded in the `PAYMENT-REQUIRED` header exactly as `@x402/express` does. It has no facilitator, so it can advertise a price but never settle one.

```bash
npm run demo:mock     # http://localhost:4021

stellar-agent-pay policy allow localhost
stellar-agent-pay unlock http://localhost:4021/weather --dry-run         # 0.001 USDC, inside the policy
stellar-agent-pay unlock http://localhost:4021/premium-report --dry-run  # 0.50 USDC, blocked
stellar-agent-pay unlock http://localhost:4021/free                      # no payment required
```

| Route             | Price      | Purpose                                         |
| ----------------- | ---------- | ----------------------------------------------- |
| `/weather`        | 0.001 USDC | Inside the default per request ceiling          |
| `/bulk-dataset`   | 0.02 USDC  | Useful for exercising the 24 h domain budget    |
| `/premium-report` | 0.50 USDC  | Over the default 0.05 ceiling, so it is refused |
| `/free`           | free       | No 402 at all                                   |

`PORT` and `STELLAR_RECIPIENT` are configurable. `npm run smoke` drives this server end to end.

## seller (real settlement on testnet)

`examples/seller/server.js` is an `@x402/express` resource server. Verification and settlement go through the OpenZeppelin Channels facilitator, which sponsors the network fees, so the paying agent needs USDC but no XLM.

### Setup

1. **Recipient account.** A `G...` account with a USDC trustline. `stellar-agent-pay wallet new --fund` produces one, or use Stellar Lab.
2. **OZ Channels API key.** Required on both testnet and mainnet: <https://channels.openzeppelin.com/testnet/gen>. Without it the server fails at startup with `no supported payment kinds loaded from any facilitator`.
3. **`.env`** in the repo root:

   ```
   STELLAR_NETWORK=stellar:testnet
   STELLAR_RECIPIENT=G...
   OZ_API_KEY=...
   ```

4. **Payer with USDC.** On the buyer side:

   ```bash
   stellar-agent-pay wallet new --fund     # keypair + friendbot XLM + USDC trustline
   # then fund it at https://faucet.circle.com (web captcha, no API)
   ```

### Run

```bash
npm run demo:seller                       # terminal 1

stellar-agent-pay policy allow localhost --max-per-request 0.01
stellar-agent-pay unlock http://localhost:3001/weather          # pays 0.001 USDC, prints the resource
stellar-agent-pay unlock http://localhost:3001/premium-report   # 0.50 USDC, blocked before signing
stellar-agent-pay audit
```

A settled payment prints the transaction hash and writes it to the audit log, where it can be checked on <https://stellar.expert/explorer/testnet>.

### Common failures

| Symptom                                                  | Cause                                                  |
| -------------------------------------------------------- | ------------------------------------------------------ |
| `op_no_trust` during settlement                          | Payer or recipient is missing the USDC trustline       |
| `no supported payment kinds loaded from any facilitator` | `OZ_API_KEY` missing or rejected                       |
| `resulting balance is not within the allowed range`      | The payer has no USDC yet, only XLM                    |
| `Exact scheme requires areFeesSponsored to be true`      | The 402 did not advertise fee sponsorship              |
| Auth entry expired at settle                             | The signed entry sat too long before submission, retry |
