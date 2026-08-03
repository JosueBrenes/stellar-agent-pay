# stellar-agent-pay

[![npm](https://img.shields.io/npm/v/stellar-agent-pay?logo=npm&color=cb3837)](https://www.npmjs.com/package/stellar-agent-pay)
[![node](https://img.shields.io/node/v/stellar-agent-pay?logo=node.js&color=5fa04e)](https://www.npmjs.com/package/stellar-agent-pay)
[![npm test](https://github.com/JosueBrenes/stellar-agent-pay/actions/workflows/test.yml/badge.svg)](https://github.com/JosueBrenes/stellar-agent-pay/actions/workflows/test.yml)
[![npm run build](https://github.com/JosueBrenes/stellar-agent-pay/actions/workflows/build.yml/badge.svg)](https://github.com/JosueBrenes/stellar-agent-pay/actions/workflows/build.yml)
[![npm run lint](https://github.com/JosueBrenes/stellar-agent-pay/actions/workflows/lint.yml/badge.svg)](https://github.com/JosueBrenes/stellar-agent-pay/actions/workflows/lint.yml)
[![npm run smoke](https://github.com/JosueBrenes/stellar-agent-pay/actions/workflows/smoke.yml/badge.svg)](https://github.com/JosueBrenes/stellar-agent-pay/actions/workflows/smoke.yml)
[![CodeQL](https://github.com/JosueBrenes/stellar-agent-pay/actions/workflows/codeql.yml/badge.svg)](https://github.com/JosueBrenes/stellar-agent-pay/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A Stellar CLI plugin that lets an AI agent unlock x402 paid HTTP resources with USDC, under a spending policy you control, with a readable audit trail of every attempt.

```
$ stellar agent-pay unlock https://api.example.com/premium-report

402 Payment Required · api.example.com · Full market intelligence report
  amount:  0.50 USDC
  network: stellar:testnet
  pay to:  GAMX62ZD4FWIKMWGVPEDR6WNL2TYTPQMO2ZJEAZUAON7VCZ5G2GWDF7W

Spending policy
  ✓ Transport             https
  ✓ Network               stellar:testnet
  ✓ Denylist              api.example.com not denied
  ✓ Allowlist             api.example.com matches "api.example.com"
  ✓ Asset                 USDC (any asset allowed)
  ✗ Per-request limit     0.50 USDC exceeds max per request of 0.05
  ✓ Domain budget (24 h)  0.50 of 1.00 used after this payment
  ✓ Agent budget (24 h)   0.50 of 5.00 used after this payment

✗ BLOCKED BY POLICY rule=max_per_request
  0.50 USDC exceeds max per request of 0.05
  no authorization entry was signed; no funds left the wallet

  hint: stellar-agent-pay policy set maxPerRequest 0.50
  audit: ~/.stellar-agent-pay/audit.log
```

## What problem this solves

Plenty of useful APIs charge for access. Getting that access means signing up, generating a key and putting a credit card on file, which is fine for a person and impossible for an autonomous agent.

x402 removes the signup. It puts HTTP 402, a status code that sat unused for decades, back to work:

```
agent   GET /report
server  402 Payment Required, this costs 0.001 USDC, pay to G...
agent   signs the payment
agent   GET /report + proof of payment
server  200 OK, here is the report
```

No account, no API key, no card. One machine buys from another, per request.

Which creates the obvious problem: an agent holding a wallet can now spend money on its own. A prompt injection, a compromised tool, or a server that quotes 500 USDC for a weather lookup all end the same way, with the agent signing.

**`stellar-agent-pay` is the thing that says no.** It sits between the 402 and the signature and checks the quoted payment against limits you set: a ceiling per request, a budget per domain per 24 h, a budget for the whole agent per 24 h, and an allowlist of domains that can be paid at all. Anything outside those limits is refused before a signature exists, and every attempt is written to an audit log, whether it paid or not.

Think of it as a prepaid card for your agent, with a limit per purchase, a limit per merchant, a daily limit, and a receipt for every attempt including the declined ones.

- The policy is evaluated at `onBeforePaymentCreation`, the last moment before any authorization entry is signed. A refused payment never produces a signature.
- Every attempt, paid or refused, is appended to `~/.stellar-agent-pay/audit.log`.
- Budgets are enforced from the local ledger of settled payments, per request, per domain per 24 h, and per agent per 24 h.

### Who pays what

A settled payment involves three parties, and the agent is not the one covering the network fee:

| Party                                   | Puts in                            |
| --------------------------------------- | ---------------------------------- |
| Your agent's wallet                     | The price of the resource, in USDC |
| The API seller                          | Nothing, it receives the USDC      |
| The facilitator (OpenZeppelin Channels) | The Stellar network fee, in XLM    |

On Stellar the client signs only a contract authorization entry, not a full transaction. The facilitator assembles the transaction, pays the fee and submits it. So the agent's wallet needs USDC and **zero XLM**, and never deals with sequence numbers or fee bumps.

## Install

Published on npm as [`stellar-agent-pay`](https://www.npmjs.com/package/stellar-agent-pay).

```bash
npm install -g stellar-agent-pay
```

Without installing anything:

```bash
npx stellar-agent-pay unlock https://api.example.com/weather
```

As a dependency of a project that drives the CLI from a script:

```bash
npm install stellar-agent-pay
```

Or from source:

```bash
git clone https://github.com/JosueBrenes/stellar-agent-pay.git
cd stellar-agent-pay
npm install
npm run build
npm link
```

`npm link` puts `stellar-agent-pay` on your PATH. The Stellar CLI resolves `stellar <name>` to a `stellar-<name>` binary, so both of these work:

```bash
stellar-agent-pay unlock <url>
stellar agent-pay unlock <url>
```

Requires Node.js 20 or newer.

## Quick start

```bash
# 1. conservative defaults in ~/.stellar-agent-pay/policy.json
stellar-agent-pay init

# 2. a testnet payer: keypair + friendbot XLM + USDC trustline
stellar-agent-pay wallet new --fund

# 3. fund it with testnet USDC (web captcha, no API)
#    https://faucet.circle.com  ->  the G... address printed above

# 4. open a domain, with its own ceiling
stellar-agent-pay policy allow api.example.com --max-per-request 0.01

# 5. pay and read the resource
stellar-agent-pay unlock https://api.example.com/weather
```

Nothing is spendable until you allow a domain. The default policy blocks every paid request.

## Try it without keys or funds

An offline mock seller ships with the repo. It emits protocol correct 402 responses with no facilitator, no API key and no money, which is enough to exercise the whole policy path:

```bash
npm run demo:mock            # http://localhost:4021

stellar-agent-pay unlock http://localhost:4021/weather --dry-run         # blocked: domain not allowed
stellar-agent-pay policy allow localhost
stellar-agent-pay unlock http://localhost:4021/weather --dry-run         # allowed: 0.001 USDC
stellar-agent-pay unlock http://localhost:4021/premium-report --dry-run  # blocked: 0.50 over the 0.05 ceiling
stellar-agent-pay audit
```

`npm run smoke` runs exactly this as an automated end to end check.

For the real loop against Stellar testnet, `examples/seller` is an `@x402/express` server that settles through the OZ Channels facilitator. See [examples/README.md](examples/README.md).

## Commands

| Command                                    | What it does                                                          |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `unlock <url>`                             | GET the resource, pay the 402 if the policy allows it, print the body |
| `unlock <url> --dry-run`                   | Negotiate the 402 and show the verdict without signing anything       |
| `status`                                   | Payer address, balances, active policy, spend in the last 24 h        |
| `policy show`                              | Print the active policy                                               |
| `policy set <key> <value>`                 | Change a limit or a list                                              |
| `policy allow <domain>`                    | Allowlist a domain, optionally with its own limits                    |
| `policy block / unblock / remove <domain>` | Manage the denylist and the allowlist                                 |
| `policy reset`                             | Restore the defaults                                                  |
| `wallet new --fund`                        | Generate a payer, fund it on testnet, add the USDC trustline          |
| `wallet import <secret>`                   | Store an existing `S...` key (also reads stdin)                       |
| `wallet trustline`                         | Add the USDC trustline to the configured payer                        |
| `audit`                                    | Read the audit log, filter by domain or result                        |
| `init`                                     | Create `~/.stellar-agent-pay` with a conservative policy              |

`unlock` writes the resource body to stdout and everything else to stderr, so piping stays clean:

```bash
stellar-agent-pay unlock https://api.example.com/weather | jq .temp
stellar-agent-pay unlock https://api.example.com/weather --json | jq '{tx, amount, body}'
```

Exit codes: `0` unlocked, `1` request or settlement error, `2` blocked by the spending policy. An agent can branch on `2` without parsing text.

## The spending policy

`~/.stellar-agent-pay/policy.json`:

```json
{
  "version": 1,
  "allowedNetworks": ["stellar:testnet"],
  "maxPerRequest": "0.05",
  "maxPerDomainPerDay": "1.00",
  "maxPerDayPerAgent": "5.00",
  "allowedDomains": ["api.example.com", "*.data.example.org"],
  "blockedDomains": [],
  "allowUnlistedDomains": false,
  "allowedAssets": [],
  "requireHttps": false,
  "domainOverrides": {
    "api.example.com": { "maxPerRequest": "0.25", "maxPerDay": "3.00" }
  }
}
```

| Rule          | `rule=` in the audit log | Refuses when                                                                      |
| ------------- | ------------------------ | --------------------------------------------------------------------------------- |
| Transport     | `transport`              | `requireHttps` is on and the URL is plaintext (localhost is exempt)               |
| Network       | `network`                | The 402 asks for a network outside `allowedNetworks`                              |
| Denylist      | `domain_blocked`         | The host matches `blockedDomains`                                                 |
| Allowlist     | `domain_allowlist`       | The host is not in `allowedDomains` and `allowUnlistedDomains` is false           |
| Asset         | `asset`                  | `allowedAssets` is set and the asset is not in it                                 |
| Per request   | `max_per_request`        | The single payment is over the ceiling                                            |
| Domain budget | `max_per_domain_per_day` | Settled spend on that host in the last 24 h plus this payment is over the cap     |
| Agent budget  | `max_per_day_per_agent`  | Settled spend across all hosts in the last 24 h plus this payment is over the cap |

Notes:

- Domains support one leading wildcard label, `*.example.com`, which matches sub-domains but not the bare domain.
- `domainOverrides` wins over the global limits, exact host first, then the longest matching wildcard.
- Budgets use a rolling 24 h window computed from `events.jsonl`, counting only settled payments. Blocked and failed attempts are audited but never consume budget.
- Amounts are denominated in 7 decimal token units. Stellar assets carry 7 decimals, not 6. No FX conversion is applied between different assets.

## Audit trail

Two files, written on every attempt:

- `audit.log`, one grep friendly line per attempt.
- `events.jsonl`, the structured ledger that budget accounting reads back.

```
2026-08-03T14:12:44.907Z  PAID       api.example.com   0.001 USDC   GET https://api.example.com/weather  network=stellar:testnet tx=8f3c...
2026-08-03T14:14:07.919Z  BLOCKED    api.example.com   0.50 USDC    GET https://api.example.com/premium-report  rule=max_per_request reason="0.50 USDC exceeds max per request of 0.05"
```

Results: `paid`, `blocked`, `failed`, `simulated` (dry run), `free` (no payment was required).

```bash
stellar-agent-pay audit --tail 50
stellar-agent-pay audit --result blocked
stellar-agent-pay audit --domain api.example.com --json | jq .
```

## Configuration

| Variable                  | Purpose                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `STELLAR_SECRET_KEY`      | Payer secret. Takes precedence over the stored wallet, so nothing has to touch disk |
| `STELLAR_NETWORK`         | CAIP-2 network id, default `stellar:testnet`                                        |
| `STELLAR_AGENT_PAY_HOME`  | Move the config directory, useful for tests and per agent isolation                 |
| `STELLAR_AGENT_PAY_DEBUG` | Print stack traces                                                                  |
| `NO_COLOR`                | Disable colour                                                                      |

A `.env` file in the working directory is loaded automatically.

## Security

The payer key is stored in plaintext in `~/.stellar-agent-pay/wallet.json` with `0600` permissions where the platform supports it. Prefer `STELLAR_SECRET_KEY` for anything beyond testnet, keep the balance small, and treat the policy as a budget guard for an agent you run, not as a defence against a compromised machine. See [SECURITY.md](SECURITY.md) for the full threat model.

## Mainnet

Change the environment, not the code:

```bash
STELLAR_NETWORK=stellar:pubnet
stellar-agent-pay policy set allowedNetworks stellar:pubnet
stellar-agent-pay policy set requireHttps true
```

Test on testnet first, and lower the limits before you raise them.

## Development

```bash
npm install
npm run typecheck
npm test          # unit tests for money, policy, engine and audit
npm run build
npm run smoke     # offline end to end run against the mock seller
```

## Roadmap

MPP channel mode, one deposit, off-chain cumulative commitments per request, one settlement at close, is not shipped yet. `@stellar/mpp` currently pins `@stellar/stellar-sdk@^15` while `@x402/stellar@2.20` requires `^16`, and channel mode also needs a one way channel contract deployed per session. It will land as an optional integration once those resolve, reusing the same policy engine and audit log.

## License

MIT. See [LICENSE](LICENSE).
