# Getting started

From nothing to a settled payment on Stellar testnet. Budget around 15 minutes, most of it waiting on two web forms that cannot be scripted.

If you only want to see the policy engine work, skip to [Without keys or funds](#without-keys-or-funds) at the end. That path needs no accounts, no money and no network.

## 1. Install

```bash
npm install -g stellar-agent-pay
```

Requires Node.js 20 or newer. Check it landed:

```bash
stellar-agent-pay --version
```

If you also have the [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli) installed, the same binary is reachable as a plugin, because the Stellar CLI resolves `stellar <name>` to a `stellar-<name>` executable on your PATH:

```bash
stellar agent-pay --version
```

Both forms are the same program. The rest of this guide uses the short one.

## 2. Create the policy

```bash
stellar-agent-pay init
```

This creates `~/.stellar-agent-pay/policy.json` with conservative defaults: 0.05 per request, 1.00 per domain per 24 h, 5.00 for the agent per 24 h, and an empty allowlist.

An empty allowlist means every paid request is refused. That is deliberate. Nothing is spendable until you name a domain in step 5.

## 3. Create the payer wallet

```bash
stellar-agent-pay wallet new --fund
```

This generates a keypair, funds it with testnet XLM through friendbot, and adds the USDC trustline. It prints the public key, which you need for the next step. The secret is stored in `~/.stellar-agent-pay/wallet.json`.

If you already have a key, import it instead:

```bash
stellar-agent-pay wallet import S...
stellar-agent-pay wallet trustline     # if the account has no USDC trustline yet
```

You can also pipe the secret in, so it never appears in your shell history:

```bash
echo "S..." | stellar-agent-pay wallet import
```

Or skip the file entirely and set `STELLAR_SECRET_KEY` in the environment, which takes precedence over the stored wallet.

## 4. Fund the payer with testnet USDC

Open [faucet.circle.com](https://faucet.circle.com/), pick Stellar testnet, and paste the public key from step 3. This step has a captcha and no API, so it cannot be scripted.

Verify it arrived:

```bash
stellar-agent-pay status
```

The balances line must show a USDC amount above zero. If it shows `0.0 USDC`, the faucet has not credited yet. A payment attempted now fails during simulation with `resulting balance is not within the allowed range`.

## 5. Allow a domain

```bash
stellar-agent-pay policy allow api.example.com --max-per-request 0.01
```

The domain is now payable, with its own ceiling of 0.01 per request that overrides the global 0.05. Everything else stays refused.

## 6. Unlock a resource

```bash
stellar-agent-pay unlock https://api.example.com/weather
```

If the seller quotes a price inside your limits, the CLI signs the authorization entry, the facilitator settles it, and the resource body is printed to stdout. The transaction hash goes to stderr and to the audit log.

## Running your own seller

To see both sides, the repository ships a working seller in [`examples/seller`](../examples/README.md). It needs two things of its own:

1. A recipient account, a `G...` address **with a USDC trustline**. This is a different account from the payer. The SAC transfer settles the underlying classic asset, so a recipient without a trustline fails settlement with `op_no_trust`.
2. An OpenZeppelin Channels API key, from [channels.openzeppelin.com/testnet/gen](https://channels.openzeppelin.com/testnet/gen). Required on testnet and mainnet both. Without it the server refuses to start.

You can create the recipient with this same CLI, pointing it at a separate home so it does not overwrite your payer:

```bash
STELLAR_AGENT_PAY_HOME=~/.stellar-agent-pay-seller stellar-agent-pay wallet new --fund
```

Put the values in a `.env` at the repository root:

```
STELLAR_NETWORK=stellar:testnet
STELLAR_RECIPIENT=G...
OZ_API_KEY=...
```

Then, in two terminals:

```bash
npm run demo:seller                                          # terminal 1

stellar-agent-pay policy allow localhost --max-per-request 0.01
stellar-agent-pay unlock http://localhost:3001/weather        # 0.001, pays
stellar-agent-pay unlock http://localhost:3001/premium-report # 0.50, refused
stellar-agent-pay audit
```

The seller reads `.env` once at startup. If you change the recipient, restart it.

## Without keys or funds

An offline mock seller ships with the repository. It emits protocol correct 402 responses with no facilitator, no API key and no money, which is enough to exercise the entire policy path:

```bash
npm run demo:mock            # http://localhost:4021

stellar-agent-pay unlock http://localhost:4021/weather --dry-run         # refused, domain not allowed
stellar-agent-pay policy allow localhost
stellar-agent-pay unlock http://localhost:4021/weather --dry-run         # allowed, 0.001 USDC
stellar-agent-pay unlock http://localhost:4021/premium-report --dry-run  # refused, over the ceiling
stellar-agent-pay audit
```

`npm run smoke` runs exactly this sequence as an automated check, and it is one of the jobs in CI.

The mock cannot settle a payment. Signing an authorization entry requires a real Soroban RPC simulation against a funded account, so `--dry-run` is the useful mode here. Drop the flag and the mock answers 402 again, explaining that it has no facilitator.

## Moving to mainnet

Change the environment, not the code:

```bash
STELLAR_NETWORK=stellar:pubnet
FACILITATOR_URL=https://channels.openzeppelin.com/x402
stellar-agent-pay policy set allowedNetworks stellar:pubnet
stellar-agent-pay policy set requireHttps true
```

You need a mainnet OZ Channels key from [channels.openzeppelin.com/gen](https://channels.openzeppelin.com/gen) and real USDC. Read [SECURITY](../SECURITY.md) first, keep the payer balance small, and lower the limits before you raise them.
