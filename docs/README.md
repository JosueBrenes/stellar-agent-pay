# Documentation

`stellar-agent-pay` lets an AI agent buy access to x402 paid HTTP resources with USDC on Stellar, under a spending policy that refuses anything outside its limits before a signature exists, and records every attempt.

## Start here

| Document                                  | Read it when                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| [Getting started](getting-started.md)     | You want the whole thing working on testnet, from nothing to a settled payment |
| [CLI reference](cli.md)                   | You need the exact flags, exit codes and output shapes                         |
| [Spending policy](policy.md)              | You are deciding what your agent is allowed to buy                             |
| [Audit trail](audit.md)                   | You need to know what was spent, on what, and why something was refused        |
| [Driving it from an agent](for-agents.md) | You are wiring this into an autonomous loop or a script                        |
| [Architecture](architecture.md)           | You want to know how it works inside, or you are contributing                  |
| [Glossary](glossary.md)                   | A term in the output is unfamiliar                                             |
| [Troubleshooting](troubleshooting.md)     | Something failed and you want the cause, not a guess                           |

Also in the repository root: [README](../README.md) for the overview, [SECURITY](../SECURITY.md) for the threat model, [CONTRIBUTING](../CONTRIBUTING.md) for the development workflow, and [examples](../examples/README.md) for the two seller servers.

## The idea in one page

Paid APIs normally require a signup, an API key and a credit card. An autonomous agent can do none of that. x402 replaces the signup with a payment handshake over HTTP:

```
agent   GET /report
server  402 Payment Required, this costs 0.001 USDC, pay to G...
agent   signs the payment
agent   GET /report + proof of payment
server  200 OK, here is the report
```

That solves access and creates a new problem: an agent holding a wallet can spend money on its own. A prompt injection, a compromised tool, or a server quoting 500 USDC for a weather lookup all end with the agent signing.

This CLI is the part that refuses. It sits at the exact point where the payment would be signed, checks the quoted amount, the domain, the network and the asset against your policy, and stops there if anything is out of bounds. Nothing is signed, no funds move, and the refusal is written to the audit log with the rule that caused it.

## The three parties in a payment

| Party              | Puts in                         | Gets                          |
| ------------------ | ------------------------------- | ----------------------------- |
| The agent's wallet | The price, in USDC              | The resource                  |
| The API seller     | Nothing                         | The USDC                      |
| The facilitator    | The Stellar network fee, in XLM | Nothing, it is infrastructure |

The agent signs only a contract authorization entry, never a full transaction. The facilitator assembles, pays for and submits the transaction. The agent needs USDC and zero XLM. See [Architecture](architecture.md#the-payment-path) for the full sequence.
