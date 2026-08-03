# Audit trail

Every attempt is recorded before the command exits, whether it paid, was refused, or failed. An agent that spends money without leaving a record is not auditable, and the refusals matter as much as the payments: repeated blocks on a host you did not expect are a signal.

Two files are written on every attempt, in `~/.stellar-agent-pay/` or under `$STELLAR_AGENT_PAY_HOME`.

## audit.log, for humans

One line per attempt, aligned into columns, greppable.

```
2026-08-03T15:40:19.695Z  PAID       localhost   0.001 USDC   GET http://localhost:3001/weather  network=stellar:testnet tx=2f4d1419...
2026-08-03T15:40:40.158Z  BLOCKED    localhost   0.50 USDC    GET http://localhost:3001/premium-report  network=stellar:testnet rule=max_per_request reason="0.50 USDC exceeds max per request of 0.05"
```

Columns, in order: UTC timestamp, result, domain, amount, method and URL. Then key value trailers as they apply: `network=`, `tx=`, `rule=`, `reason=`, and `mode=channel` if the payment went through a channel.

Multi-line SDK errors are collapsed and truncated, so the file stays strictly one line per attempt and stays usable with `grep`, `tail` and `wc -l`.

## events.jsonl, for machines

One JSON object per line. This is the ledger that budget accounting reads back.

```json
{
  "ts": "2026-08-03T15:46:15.137Z",
  "result": "simulated",
  "method": "GET",
  "url": "http://localhost:4077/premium-report",
  "domain": "localhost",
  "network": "stellar:testnet",
  "amount": "5000000",
  "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "assetSymbol": "USDC",
  "decimals": 7,
  "policyUnits": "5000000",
  "mode": "x402",
  "rule": "max_per_request",
  "reason": "0.50 USDC exceeds max per request of 0.05"
}
```

| Field                              | Present                 | Meaning                                                        |
| ---------------------------------- | ----------------------- | -------------------------------------------------------------- |
| `ts`                               | always                  | ISO 8601 UTC timestamp                                         |
| `result`                           | always                  | `paid`, `blocked`, `failed`, `simulated` or `free`             |
| `method`, `url`, `domain`          | always                  | What was requested and from where                              |
| `network`                          | when a 402 was parsed   | CAIP-2 network id                                              |
| `amount`                           | when a price was quoted | **Atomic units of `asset`**, not a decimal                     |
| `asset`, `assetSymbol`, `decimals` | when a price was quoted | SAC contract id, resolved symbol, and its precision            |
| `policyUnits`                      | when a price was quoted | The amount normalised to 7 decimals, which is what budgets sum |
| `tx`, `payer`                      | on a settled payment    | Transaction hash and the account that paid                     |
| `rule`, `reason`                   | on a refusal or failure | The rule that stopped it, and the human explanation            |
| `mode`                             | on payment attempts     | `x402`                                                         |

`amount` is in atomic units so no precision is ever lost in the file. `policyUnits` exists so that assets with different decimals can be summed against one budget. For USDC on Stellar, which has 7 decimals, the two are identical.

## What each result means

| Result      | What happened                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| `paid`      | The payment settled and the resource was returned. Counts against budgets                                     |
| `blocked`   | The policy refused it. **No authorization entry was signed and no funds moved.** Never counts against budgets |
| `failed`    | The attempt reached the network or the signer and something went wrong. Does not count against budgets        |
| `simulated` | A `--dry-run`. The 402 was negotiated and judged, nothing was signed                                          |
| `free`      | The resource answered without a 402. There was nothing to pay                                                 |

Only `paid` consumes budget. This matters: a refused payment does not eat into the daily cap, because nothing was spent.

## Reading it

```bash
stellar-agent-pay audit                       # last 20 lines
stellar-agent-pay audit --tail 100
stellar-agent-pay audit --result blocked      # what was refused
stellar-agent-pay audit --domain api.example.com
stellar-agent-pay audit --json | jq '.events[] | select(.result=="paid") | .tx'
stellar-agent-pay audit --path                # just the file path
```

Both files are append only and plain text. Nothing stops you from shipping them to a log collector, or from watching them:

```bash
tail -f ~/.stellar-agent-pay/audit.log
```

A settled payment is independently verifiable. Take the `tx` value and look it up:

```
https://stellar.expert/explorer/testnet/tx/<hash>
```

That is the point of recording the hash. The log says what the agent believes it did; the ledger says what actually happened, and they can be compared by anyone.

## Rotation and reset

Neither file is rotated automatically. They grow by roughly 250 bytes per attempt, so an agent making a thousand payments a day adds about 90 MB a year across both.

Deleting them is safe and is how you reset a demo:

```bash
rm ~/.stellar-agent-pay/audit.log ~/.stellar-agent-pay/events.jsonl
```

Be aware of what that means: budgets are computed from `events.jsonl`, so deleting it also clears the last 24 h of spend and gives the agent a fresh allowance. If you rotate the file in production, keep the last 24 hours of `paid` entries, or the caps stop meaning anything.

## What the audit trail is not

It records what this CLI did. It cannot record what happened after settlement. x402 settles the payment and then the server decides what to return. If a seller takes the money and returns nothing useful, the log will show a `paid` entry with a real transaction hash, because that is what happened. Enforcing delivery is outside the protocol.
