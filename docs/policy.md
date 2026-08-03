# Spending policy

The policy is the reason this tool exists. It decides whether a quoted payment may be signed, and it is evaluated at the last moment before any signature is produced.

It lives in `~/.stellar-agent-pay/policy.json`, or under `$STELLAR_AGENT_PAY_HOME` when that is set. It is a plain JSON file that you can read, diff, version and ship with an agent.

## The file

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

| Field                  | Type           | Default               | Meaning                                                                           |
| ---------------------- | -------------- | --------------------- | --------------------------------------------------------------------------------- |
| `version`              | `1`            | `1`                   | Schema version. Rejected if unknown, so an old binary cannot misread a newer file |
| `allowedNetworks`      | string[]       | `["stellar:testnet"]` | CAIP-2 network ids the agent may pay on                                           |
| `maxPerRequest`        | decimal string | `"0.05"`              | Ceiling for a single payment                                                      |
| `maxPerDomainPerDay`   | decimal string | `"1.00"`              | Rolling 24 h ceiling per domain                                                   |
| `maxPerDayPerAgent`    | decimal string | `"5.00"`              | Rolling 24 h ceiling across every domain                                          |
| `allowedDomains`       | string[]       | `[]`                  | Hosts that may be paid. One leading `*.` wildcard label is supported              |
| `blockedDomains`       | string[]       | `[]`                  | Hosts that are always refused                                                     |
| `allowUnlistedDomains` | boolean        | `false`               | When true, hosts outside the allowlist are payable                                |
| `allowedAssets`        | string[]       | `[]`                  | SAC contract ids. Empty means any asset the server asks for                       |
| `requireHttps`         | boolean        | `false`               | Refuse plaintext HTTP. Localhost is always exempt                                 |
| `domainOverrides`      | object         | `{}`                  | Per-domain `maxPerRequest` and `maxPerDay`                                        |

Amounts are decimal strings, never numbers. Money is handled as `bigint` in atomic units throughout, so no value ever passes through a float.

## The default is refuse

A fresh policy has an empty `allowedDomains` and `allowUnlistedDomains: false`. That combination refuses every paid request. Nothing is spendable until you name a domain.

This is deliberate. The failure mode of a permissive default is an agent that quietly spends money on a host you never considered.

## The rules

All rules are evaluated so the CLI can show the full checklist, but the **first failure** is what refuses the payment and what appears in the audit log as `rule=`.

| Order | `rule`                   | Refuses when                                                                              |
| ----- | ------------------------ | ----------------------------------------------------------------------------------------- |
| 1     | `transport`              | `requireHttps` is on and the URL is plaintext. Localhost is exempt                        |
| 2     | `network`                | The 402 asks for a network outside `allowedNetworks`                                      |
| 3     | `domain_blocked`         | The host matches an entry in `blockedDomains`                                             |
| 4     | `domain_allowlist`       | The host is not in `allowedDomains` and `allowUnlistedDomains` is false                   |
| 5     | `asset`                  | `allowedAssets` is non-empty and the quoted asset is not in it                            |
| 6     | `max_per_request`        | The single payment exceeds the effective per-request ceiling                              |
| 7     | `max_per_domain_per_day` | Settled spend on that host in the last 24 h, plus this payment, exceeds the domain cap    |
| 8     | `max_per_day_per_agent`  | Settled spend across all hosts in the last 24 h, plus this payment, exceeds the agent cap |

The denylist is checked before the allowlist, so a host in both is refused.

## Domain matching

Matching is on the URL hostname, lowercased. The port and the path are not part of it.

- `api.example.com` matches exactly that host.
- `*.example.com` matches `api.example.com` and `a.b.example.com`, but **not** the bare `example.com`.
- `api.example.com` does not match `evil-api.example.com`, and it does not match `api.example.com.attacker.test`. Matching is on labels, not on string prefixes.

Only one leading wildcard label is supported. There is no regular expression syntax, which keeps the rules readable and keeps a mistake from silently widening what is payable.

## Per-domain overrides

`domainOverrides` beats the global limits. When several patterns match a host, the most specific wins: the exact host first, then the longest matching wildcard.

```json
"domainOverrides": {
  "*.example.com":   { "maxPerRequest": "0.10" },
  "api.example.com": { "maxPerRequest": "0.75", "maxPerDay": "9.00" }
}
```

For `api.example.com` the effective ceiling is 0.75 per request and 9.00 per day. For `cdn.example.com` it is 0.10 per request, and the daily cap falls back to the global `maxPerDomainPerDay` because the wildcard override does not set one. For `example.org` both fall back to the globals.

Set them with:

```bash
stellar-agent-pay policy allow api.example.com --max-per-request 0.75 --max-per-day 9.00
```

## How budgets are counted

Budgets read `events.jsonl` and sum only entries whose result is `paid`, inside a rolling 24 hour window ending now. Not a calendar day, so a burst at 23:50 still counts against the following morning.

Refused, failed and dry run attempts are recorded but never consume budget. Money that did not move is not spent.

Amounts are normalised to 7 decimal token units before being summed, so assets with different precision can share one budget. No exchange rate is applied between different assets. If you let an agent pay in two different tokens, one unit of each counts the same against the caps. Constrain `allowedAssets` if that matters to you.

## Worked example

```bash
stellar-agent-pay policy set maxPerRequest 0.05
stellar-agent-pay policy set maxPerDomainPerDay 0.20
stellar-agent-pay policy allow api.example.com
```

| Attempt | Quoted                        | Outcome                                                                        |
| ------- | ----------------------------- | ------------------------------------------------------------------------------ |
| 1       | 0.01 on `api.example.com`     | Paid. Domain total 0.01                                                        |
| 2       | 0.50 on `api.example.com`     | Refused, `max_per_request`, over the 0.05 ceiling                              |
| 3       | 0.01 on `other.example.com`   | Refused, `domain_allowlist`, host not allowed                                  |
| 4       | 0.05 x 4 on `api.example.com` | The first three pay, the fourth is refused by `max_per_domain_per_day` at 0.21 |

Attempt 2 never reached the network. Attempt 3 never reached the signer. Both are in the audit log with the rule that stopped them.

## Editing the file directly

You can. It is validated on every read, and an invalid file is a hard error naming the offending field, rather than a silent fallback to defaults:

```
error /home/you/.stellar-agent-pay/policy.json is invalid:
  - maxPerRequest: expected a decimal amount with at most 7 decimals, e.g. 0.05
```

Failing closed here is intentional. A typo in a limit must not become an unlimited agent.

## Provisioning an agent

Give each agent its own directory, so budgets and history never blend:

```bash
export STELLAR_AGENT_PAY_HOME=/srv/agents/researcher
stellar-agent-pay init --allow api.example.com
stellar-agent-pay policy set maxPerDayPerAgent 1.00
```

The policy file can be checked into configuration management and shipped with the agent. It carries no secrets. The key lives in `wallet.json`, or in `STELLAR_SECRET_KEY` if you prefer nothing on disk.
