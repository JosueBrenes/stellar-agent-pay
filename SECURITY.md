# Security policy

## Reporting a vulnerability

Report privately through GitHub Security Advisories on this repository: **Security -> Report a vulnerability**. Please do not open a public issue for anything that could put funds at risk.

Include the affected version, reproduction steps, and the impact you believe it has. Expect a first response within 7 days.

## Threat model

`stellar-agent-pay` holds a Stellar key that can spend USDC, and it signs payments on behalf of an automated process. What the spending policy does and does not protect against:

**In scope**

- An agent, or a prompt injected into it, being talked into paying an unexpected domain, an unexpected amount, or an unexpected number of times. The policy is evaluated in `onBeforePaymentCreation`, the last point before an authorization entry is signed, so a refused payment never produces a signature.
- A resource server quoting a price far above what its endpoint is worth. Per request, per domain and per agent budgets all apply.
- Silent spend. Every attempt, paid or refused, is appended to the audit log before the command exits.

**Out of scope**

- A compromised machine or account. The policy file, the event ledger and the wallet file are ordinary files owned by the user, and anything running as that user can edit them.
- The key at rest. `~/.stellar-agent-pay/wallet.json` stores the secret in plaintext, with `0600` permissions where the platform supports them. Windows does not map `chmod`, so on Windows the file inherits the directory ACL. Prefer `STELLAR_SECRET_KEY` outside testnet.
- Resource server behaviour after settlement. x402 settles the payment, then the server decides what to return. The CLI records what it paid and what it received; it cannot enforce delivery.
- Facilitator availability and correctness. Verification and settlement run through OpenZeppelin Channels.

## Operating guidance

- Fund the payer account with the smallest balance the workload needs. A key that holds 5 USDC cannot lose more than 5 USDC.
- Keep `allowUnlistedDomains` at `false` and add domains one at a time, each with its own `--max-per-request`.
- Set `requireHttps true` on anything that is not localhost.
- Use a separate `STELLAR_AGENT_PAY_HOME` per agent so budgets and audit trails do not blend together.
- Review `stellar-agent-pay audit --result blocked` periodically. Repeated blocks on a domain you did not expect are a signal worth looking into.

## Supported versions

The latest published minor version receives security fixes.
