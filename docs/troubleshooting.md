# Troubleshooting

Every error below was hit while building and testing this tool. The cause given is the actual cause, not a guess.

Run any failing command with `STELLAR_AGENT_PAY_DEBUG=1` for a stack trace.

## The command does not exist

```
stellar-agent-pay : The term 'stellar-agent-pay' is not recognized ...
```

It is not on your PATH. Either install it globally, or link a local checkout:

```bash
npm install -g stellar-agent-pay
# or, from a clone
npm run build && npm link
```

`stellar agent-pay ...` also needs the [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli) itself installed. It resolves the subcommand to the `stellar-agent-pay` binary on your PATH, so both must be present for that form to work.

## Payments

### `resulting balance is not within the allowed range`

The payer has no USDC, or not enough. The failure is raised during Soroban simulation, before anything is signed, and the diagnostic event names the transfer amount it could not cover.

Check with `stellar-agent-pay status`. If the balance shows `0.0 USDC`, get testnet USDC from [faucet.circle.com](https://faucet.circle.com/). Note that the faucet credits in a few seconds but not instantly.

### `op_no_trust`

An account is missing the USDC trustline. The SAC transfer settles the underlying classic asset, which an account cannot hold without one.

**Both** sides need it. The payer:

```bash
stellar-agent-pay wallet trustline
```

And the recipient, the `payTo` in the 402. If it is an account you control, add the trustline there too. This is the single most common setup mistake, because the recipient is easy to forget.

### `Exact scheme requires areFeesSponsored to be true`

The 402 did not advertise fee sponsorship, so the Stellar `exact` scheme refuses to sign. A real seller gets this flag from the facilitator's advertised capabilities. If you are writing your own 402 responses, include it:

```json
"extra": { "areFeesSponsored": true }
```

### `Payment creation aborted: [rule] ...`

Not an error. This is the spending policy refusing the payment, surfaced from the core client. The CLI turns it into a `BLOCKED BY POLICY` message and exit code `2`. Nothing was signed.

### The server still answers 402 after paying

Verification or settlement failed on the server side. The message carries the server's reason where it gives one. Common causes: the recipient has no trustline, the facilitator key is invalid, or the authorization entry expired before submission.

### Auth entry expired at settle

The signed entry carries a ledger bound of roughly a minute. If the request sat too long before the facilitator submitted it, the entry is stale. Retry. If it happens repeatedly, look at latency between your machine, the resource server and the facilitator.

## Seller setup

### `no supported payment kinds loaded from any facilitator`

`OZ_API_KEY` is missing or rejected. It is required on testnet and mainnet both. Generate one at [channels.openzeppelin.com/testnet/gen](https://channels.openzeppelin.com/testnet/gen) for testnet, or [channels.openzeppelin.com/gen](https://channels.openzeppelin.com/gen) for mainnet, and put it in `.env`.

### The seller charges the wrong account

The example seller reads `.env` once, at startup. If you changed `STELLAR_RECIPIENT`, restart it.

To see which account it is actually charging, read the terms it advertises:

```bash
curl -s -D - -o /dev/null http://localhost:3001/weather | grep -i payment-required
```

That header is base64 JSON; decode it and look at `payTo`.

### The mock seller will not complete a payment

By design. `examples/mock-seller` has no facilitator, so it can quote a price but never settle one. Use `--dry-run` against it, or run `examples/seller` for the real loop.

## Policy

### Every request is refused with `domain_allowlist`

The default policy has an empty allowlist, which refuses everything. That is intentional. Name the domain:

```bash
stellar-agent-pay policy allow api.example.com --max-per-request 0.01
```

### A wildcard does not match what you expected

`*.example.com` matches sub-domains, not the bare domain. To cover both, list them:

```bash
stellar-agent-pay policy allow example.com
stellar-agent-pay policy allow '*.example.com'
```

Quote the pattern, or your shell will try to expand the `*`.

### `policy.json is invalid`

The file failed validation and the error names the field. This fails closed on purpose: a typo in a limit must not silently become an unlimited agent. Fix the field, or start over with `stellar-agent-pay policy reset`.

### A limit did not take effect

Per-domain overrides beat the globals. Check what is actually in force:

```bash
stellar-agent-pay policy show
```

The refusal message says which limit applied, including the override name when one did: `exceeds max per request (override "localhost") of 0.01`.

### The daily budget reset unexpectedly

Budgets are computed from `events.jsonl`. Deleting it clears the last 24 h of spend. Also remember the window is rolling, not a calendar day, so spend ages out 24 hours after each individual payment.

## Wallet and keys

### `wallet import` derived an address you did not expect

A recovery phrase yields many accounts, on the SEP-0005 path `m/44'/148'/<index>'`. Freighter may have had a different account selected than the one you had in mind. Confirm the address is the one holding the funds before relying on it.

### `a wallet already exists`

Replacing a stored key requires `--force`, so a key is never overwritten by accident:

```bash
stellar-agent-pay wallet import S... --force
```

### The wrong key is being used

`STELLAR_SECRET_KEY` takes precedence over `wallet.json`, including when it comes from a `.env` in the current directory. `stellar-agent-pay status` prints the source, either `STELLAR_SECRET_KEY` or the wallet file path. Check that first.

### `--fund` fails

Friendbot is testnet only, and it rate limits. Wait and retry, or fund the account another way. On `stellar:pubnet` the flag is rejected outright, because friendbot does not exist there.

## Publishing, for maintainers

### `npm error code EOTP`

The npm token requires a one time password, which cannot be supplied from CI. Use a classic **Automation** token, or a granular token with **Bypass two-factor authentication** enabled and read and write on the package.

### `Cannot publish over previously published version`

npm versions are immutable. Bump the version and cut a new release.

### Windows CI cannot find the test files

Windows shells do not expand globs, and Node 20's `--test` does not discover TypeScript files on its own. That is why `npm test` runs `scripts/test.mjs`, which resolves the files itself.

## Still stuck

Open an issue with the output of:

```bash
stellar-agent-pay --version
stellar-agent-pay status --json --offline
stellar-agent-pay audit --tail 5
```

Redact addresses if you prefer, and never paste a secret key, a wallet file or a recovery phrase. If the problem is a security issue, follow [SECURITY](../SECURITY.md) instead of opening a public issue.
