# Driving it from an agent

This CLI is built to be called by a program, not only by a person. Three properties make that practical: stable exit codes, a clean split between stdout and stderr, and a `--json` mode on every command that produces data.

## Exit codes are the interface

```
0  unlocked, or the dry run would have been allowed, or nothing was owed
1  request, configuration or settlement error
2  refused by the local spending policy
```

The split between `1` and `2` is the important one. An agent must be able to tell "I was not allowed to buy this" from "the network is down", because the right reaction differs. A `2` should never be retried; the answer will not change until a human changes the policy. A `1` may be worth one retry.

```bash
#!/usr/bin/env bash
if body=$(stellar-agent-pay unlock "$URL" --quiet); then
  echo "$body"
elif [ $? -eq 2 ]; then
  echo "refused by policy, asking the operator" >&2
  exit 2
else
  echo "transient failure, will retry once" >&2
fi
```

## Streams

The resource body goes to **stdout**. Progress, the policy checklist and errors go to **stderr**. So this is always safe:

```bash
stellar-agent-pay unlock "$URL" --quiet > payload.json
```

Or write it directly:

```bash
stellar-agent-pay unlock "$URL" -o payload.json
```

## Structured output

```bash
stellar-agent-pay unlock "$URL" --json
```

One JSON object on stdout, containing the verdict, the payment details, every check, the transaction hash when it settled, and the resource under `body`. Shape in the [CLI reference](cli.md#json-shape).

Useful fields when a payment is refused:

```json
{
  "status": "blocked",
  "allowed": false,
  "rule": "max_per_request",
  "reason": "0.50 USDC exceeds max per request of 0.05"
}
```

`rule` is a stable identifier. Branch on it, not on `reason`, which is prose written for a person and may be reworded.

## Ask before committing

`--dry-run` negotiates the 402 and returns the verdict without signing anything. It runs the same rules the real path runs, so the answer is trustworthy, and it costs nothing.

```bash
verdict=$(stellar-agent-pay unlock "$URL" --dry-run --json)
price=$(echo "$verdict" | jq -r .amount)
allowed=$(echo "$verdict" | jq -r .allowed)
```

This is how an agent can reason about cost before spending: check the price, decide whether the answer is worth it, then unlock.

## One budget per agent

`STELLAR_AGENT_PAY_HOME` moves the whole state directory. Give each agent its own, and their budgets, allowlists and audit trails stay separate.

```bash
export STELLAR_AGENT_PAY_HOME=/srv/agents/researcher
stellar-agent-pay init --allow api.example.com
stellar-agent-pay policy set maxPerDayPerAgent 1.00
```

The researcher agent now cannot spend more than 1.00 in 24 hours no matter what it is told to do, and its spending is recorded separately from every other agent on the machine.

## Keys without touching disk

`STELLAR_SECRET_KEY` takes precedence over the stored wallet, so an agent running in a container can receive its key from a secret manager and never write it anywhere:

```bash
STELLAR_SECRET_KEY=$(vault kv get -field=key secret/agents/researcher) \
  stellar-agent-pay unlock "$URL" --json
```

## As a tool in an LLM loop

Expose it as a tool with a narrow contract. A workable description:

> `unlock(url)` fetches a URL that may require payment. Returns the resource on success. If it returns exit code 2, the payment was refused by the spending policy and you must not retry; report the reason to the operator instead.

Two things matter here.

**Do not give the model the policy commands.** If the agent can run `stellar-agent-pay policy set maxPerRequest 500`, the policy protects nothing. The rules are the operator's, not the agent's. Expose `unlock`, and at most `audit` and `status`. Keep `policy` and `wallet` out of the tool surface.

**Treat exit code 2 as terminal.** A model that retries a refused payment in a loop will produce a long trail of blocked entries and no progress. The refusal is the answer.

## Reading spend back

```bash
stellar-agent-pay status --json --offline | jq .spend24h
```

```json
{
  "total": "0.42",
  "limit": "5.00",
  "remaining": "4.58",
  "byDomain": [{ "domain": "api.example.com", "spent": "0.42", "limit": "1.00" }]
}
```

`--offline` skips the Horizon call, which makes it fast and usable with no network. Drop it when you also want on chain balances.

For the full history:

```bash
stellar-agent-pay audit --json --tail 200 | jq '.events[] | select(.result=="blocked") | {ts, domain, rule}'
```

Repeated blocks on a domain nobody expected is worth an alert. That is the signal an audit trail exists to give you.

## What it will not do for you

It authorises payments. It does not verify that the seller delivered anything useful. x402 settles the payment and then the server decides what to return, so an agent that pays for garbage gets garbage, and the log will honestly record a settled payment.

Quality of what you bought is your loop's problem. Keeping the bill bounded, recorded and refusable is this tool's problem.
