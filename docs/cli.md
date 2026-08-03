# CLI reference

Every command is available under both names, because the Stellar CLI resolves `stellar <name>` to a `stellar-<name>` binary on your PATH:

```bash
stellar-agent-pay <command>
stellar agent-pay <command>
```

## Exit codes

These are part of the contract. An agent can branch on them without parsing text.

| Code | Meaning                                                                                       |
| ---- | --------------------------------------------------------------------------------------------- |
| `0`  | The resource was unlocked, or the dry run would have been allowed, or no payment was required |
| `1`  | Request, configuration or settlement error                                                    |
| `2`  | Refused by the local spending policy                                                          |

## Output streams

`unlock` writes the resource body to **stdout** and everything else to **stderr**. Piping stays clean:

```bash
stellar-agent-pay unlock https://api.example.com/weather | jq .temp
```

With `--json`, a single JSON object goes to stdout instead, and the resource body is inside it under `body`.

---

## unlock

```
stellar-agent-pay unlock [options] <url>
```

Requests the resource. If the server answers `402`, the payment terms are checked against the spending policy. If the policy allows it, the payment is signed, settled and the request is retried, then the resource is printed.

| Option                     | Default                                 | Description                                                      |
| -------------------------- | --------------------------------------- | ---------------------------------------------------------------- |
| `-X, --method <method>`    | `GET`                                   | HTTP method                                                      |
| `-H, --header <header...>` | none                                    | Extra request header, repeatable, `Name: value`                  |
| `-d, --data <body>`        | none                                    | Request body, implies `content-type: application/json`           |
| `-n, --network <caip2>`    | `stellar:testnet` or `$STELLAR_NETWORK` | CAIP-2 network id                                                |
| `--rpc-url <url>`          | provider default                        | Soroban RPC endpoint override                                    |
| `--dry-run`                | off                                     | Negotiate the 402 and show the verdict without signing anything  |
| `--json`                   | off                                     | Emit one JSON object instead of human output                     |
| `-o, --output <file>`      | stdout                                  | Write the resource body to a file                                |
| `-q, --quiet`              | off                                     | Suppress progress output, the resource still goes to stdout      |
| `-y, --yes`                | off                                     | Reserved for future interactive confirmations, currently a no-op |

### Behaviour without a wallet

If no payer wallet is configured, `unlock` still runs. A resource that needs no payment is returned normally. A resource that answers 402 is evaluated against the policy, and then:

- If the policy would refuse it, you get the refusal and exit `2`. The verdict does not depend on having a key.
- If the policy would allow it, you get an actionable error and exit `1`, because there is no key to sign with.

### JSON shape

```json
{
  "status": "paid",
  "httpStatus": 200,
  "url": "https://api.example.com/weather",
  "method": "GET",
  "allowed": true,
  "amount": "0.001",
  "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "assetSymbol": "USDC",
  "network": "stellar:testnet",
  "payTo": "G...",
  "checks": [
    { "rule": "transport", "label": "Transport", "status": "pass", "detail": "https not enforced" }
  ],
  "tx": "2f4d1419...",
  "body": { "city": "San Jose", "temp": 24 },
  "auditLog": "/home/you/.stellar-agent-pay/audit.log"
}
```

`status` is one of `paid`, `blocked`, `failed`, `simulated` (a dry run) or `free` (the resource needed no payment). When the policy refuses, the object also carries `rule` and `reason`, and `allowed` is `false`. `amount` is a decimal string in token units; the atomic value lives in the event log.

### Examples

```bash
# pay and print
stellar-agent-pay unlock https://api.example.com/weather

# see the verdict without spending anything
stellar-agent-pay unlock https://api.example.com/report --dry-run

# POST with a body and a header
stellar-agent-pay unlock https://api.example.com/query \
  -X POST -H 'accept: application/json' -d '{"q":"stellar"}'

# machine readable, for a script
stellar-agent-pay unlock https://api.example.com/weather --json | jq '{tx, amount, body}'

# save the payload, keep the terminal quiet
stellar-agent-pay unlock https://api.example.com/dataset -o data.json -q
```

---

## status

```
stellar-agent-pay status [--json] [-n <caip2>] [--offline]
```

Shows the payer address and where it came from, its balances from Horizon, the active policy, and settled spend in the last 24 h broken down by domain.

`--offline` skips the Horizon lookup, which makes it usable with no network.

The JSON form carries `home`, `network`, `wallet`, `policy`, `spend24h` with `total`, `limit`, `remaining` and `byDomain`, plus `events` counts and the audit log path.

---

## policy

Manages `~/.stellar-agent-pay/policy.json`. Full field reference in [Spending policy](policy.md).

| Command                                                                       | Description                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `policy show [--json]`                                                        | Print the active policy. This is the default when no subcommand is given |
| `policy set <key> <value>`                                                    | Set a scalar or list value                                               |
| `policy allow <domain> [--max-per-request <amount>] [--max-per-day <amount>]` | Add a domain to the allowlist, optionally with its own limits            |
| `policy block <domain>`                                                       | Add a domain to the denylist and drop it from the allowlist              |
| `policy unblock <domain>`                                                     | Remove a domain from the denylist                                        |
| `policy remove <domain>`                                                      | Remove a domain from the allowlist and drop its overrides                |
| `policy reset`                                                                | Restore the defaults                                                     |
| `policy path`                                                                 | Print the policy file path                                               |

Keys accepted by `policy set`: `maxPerRequest`, `maxPerDomainPerDay`, `maxPerDayPerAgent`, `allowUnlistedDomains`, `requireHttps`, `allowedNetworks`, `allowedDomains`, `blockedDomains`, `allowedAssets`.

List values are comma separated. Per-domain limits are not settable through `policy set`, use `policy allow` for those.

```bash
stellar-agent-pay policy set maxPerRequest 0.10
stellar-agent-pay policy set allowedNetworks stellar:testnet,stellar:pubnet
stellar-agent-pay policy set requireHttps true
stellar-agent-pay policy allow '*.data.example.org' --max-per-day 2.00
```

---

## wallet

| Command                                               | Description                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `wallet new [--fund] [--force] [-n <caip2>] [--json]` | Generate a payer keypair. `--fund` adds friendbot XLM and the USDC trustline, testnet only |
| `wallet import [secret] [--force]`                    | Store an existing `S...` secret. Reads stdin when the argument is omitted                  |
| `wallet show [--json] [-n <caip2>]`                   | Print the configured payer. This is the default when no subcommand is given                |
| `wallet trustline [-n <caip2>]`                       | Add the USDC trustline to the configured payer                                             |

`--force` is required to replace an existing wallet, so a stored key is never overwritten by accident.

The secret is stored in `~/.stellar-agent-pay/wallet.json` with `0600` permissions where the platform supports them. `STELLAR_SECRET_KEY` takes precedence over the file, which lets an agent run without writing a key to disk at all.

---

## audit

```
stellar-agent-pay audit [--tail <n>] [--json] [--domain <domain>] [--result <result>] [--path]
```

Reads the payment log. Format and semantics in [Audit trail](audit.md).

| Option              | Default | Description                                             |
| ------------------- | ------- | ------------------------------------------------------- |
| `--tail <n>`        | `20`    | How many entries to show                                |
| `--json`            | off     | Read the structured event log instead of the human one  |
| `--domain <domain>` | all     | Only entries for this domain                            |
| `--result <result>` | all     | One of `paid`, `blocked`, `failed`, `simulated`, `free` |
| `--path`            | off     | Print the audit log path and exit                       |

```bash
stellar-agent-pay audit --tail 50
stellar-agent-pay audit --result blocked
stellar-agent-pay audit --domain api.example.com --json | jq '.events[].amount'
```

---

## init

```
stellar-agent-pay init [--force] [--allow <domain...>]
```

Creates `~/.stellar-agent-pay` with a conservative default policy. An existing policy is left untouched unless `--force` is given. `--allow` seeds the allowlist so an agent can be provisioned in one command:

```bash
stellar-agent-pay init --allow api.example.com data.example.org
```

Prints the policy path to stdout, so it can be captured in a script.

---

## Environment variables

| Variable                  | Purpose                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `STELLAR_SECRET_KEY`      | Payer secret. Takes precedence over the stored wallet                                             |
| `STELLAR_NETWORK`         | CAIP-2 network id, default `stellar:testnet`                                                      |
| `STELLAR_AGENT_PAY_HOME`  | Move the config, policy and audit directory. Use it to give each agent its own budget and history |
| `STELLAR_AGENT_PAY_DEBUG` | Any value prints stack traces on error                                                            |
| `NO_COLOR`                | Any value disables colour. Colour is also disabled automatically when stdout is not a terminal    |

A `.env` file in the working directory is loaded automatically.
