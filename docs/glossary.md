# Glossary

Terms that appear in the output, the docs or the code.

## The protocol

**x402**
A payment protocol that uses the HTTP `402 Payment Required` status code as a real handshake. The server answers 402 with machine readable terms, the client pays, the request is retried with proof, and the resource is returned. No account, no API key, no card.

**402 Payment Required**
An HTTP status code reserved in the original spec and left unused for decades. x402 gives it a concrete meaning and a payload.

**Payment requirements**
The terms in a 402: scheme, network, asset, amount, recipient and a timeout. Carried in the `PAYMENT-REQUIRED` response header as base64 JSON in x402 v2. A single 402 can advertise several options, and the client picks one.

**`exact` scheme**
The x402 scheme where the client pays exactly the quoted amount. This is what Stellar implements. The server advertises `scheme: "exact"` with `x402Version: 2`.

**`PAYMENT-SIGNATURE`**
The request header carrying the signed payment when the client retries. The v1 equivalent was `X-PAYMENT`.

**`PAYMENT-RESPONSE`**
The response header carrying the settlement receipt, including the transaction hash. The v1 equivalent was `X-PAYMENT-RESPONSE`.

**Facilitator**
The service that verifies a payment and settles it on chain on the client's behalf. This CLI uses OpenZeppelin Channels. It assembles the transaction, pays the network fee and submits it, which is why the paying agent needs no XLM.

**Fee sponsorship**
The facilitator paying the Stellar network fee instead of the payer. The agent's wallet needs USDC and zero XLM, and never deals with sequence numbers.

**MPP**
Machine Payments Protocol, a Stellar native alternative to x402. Charge mode settles per request without a facilitator; channel mode deposits once and signs cumulative off-chain commitments. Not shipped in this CLI yet, see [Architecture](architecture.md#not-shipped-yet).

## Stellar

**Authorization entry**
On Stellar the x402 client signs a contract authorization entry, not a full transaction envelope. It authorises a specific contract call, in this case a USDC transfer of a specific amount to a specific recipient. The facilitator wraps it into a transaction. This is the exact artifact the spending policy prevents from ever being created when it refuses a payment.

**SAC, Stellar Asset Contract**
A classic Stellar asset wrapped so smart contracts can move it. x402 payments call `transfer` on the SAC. Its address is a `C...` contract id.

**Two USDC addresses**
USDC has two identities on Stellar and mixing them is a common mistake. The **classic issuer** is a `G...` account, used when adding a trustline. The **SAC** is a `C...` contract address, what the protocol invokes `transfer` on and what appears in payment requirements. The `payTo` in a 402 is always a classic `G...` account, never the SAC.

**Trustline**
An explicit opt-in by an account to hold a given asset. **Both** the payer and the recipient need a USDC trustline, because the SAC transfer settles the underlying classic asset. A recipient without one fails settlement with `op_no_trust`.

**Soroban**
Stellar's smart contract platform. The client simulates the transfer against a Soroban RPC endpoint before signing, which is where an insufficient balance is detected.

**Horizon**
Stellar's HTTP API for accounts, balances and transaction history. `status` uses it to read balances.

**Friendbot**
The testnet faucet for XLM. It funds an account with test lumens. It does not exist on mainnet.

**Stroop**
The smallest unit of XLM, one ten millionth. Network fees are quoted in stroops.

**Base reserve**
The minimum XLM an account must hold to exist, plus more per trustline. It is why an account cannot be fully emptied without first removing its trustlines and merging it.

**strkey**
Stellar's text encoding for keys. `G...` is a public key, `S...` is a secret seed, `C...` is a contract address. It is base32 with a version byte and a CRC16 checksum, which is why a mistyped key is rejected rather than silently accepted.

**CAIP-2**
A chain identifier standard, `namespace:reference`. Stellar uses `stellar:testnet` and `stellar:pubnet`. These exact strings are what the protocol expects.

**Testnet and pubnet**
The test network, where funds are free and get reset, and the public network, where they are real. An address is the same string on both, so a seed phrase exposed on testnet is exposed on mainnet too.

**SEP-0005**
The Stellar standard for deriving keys from a BIP-39 recovery phrase, on the path `m/44'/148'/<account>'`. It is how a Freighter phrase maps to a specific `G...` address, and why one phrase yields many accounts.

## This tool

**Payer**
The account that pays, whose secret this CLI holds. Needs USDC and a trustline, needs no XLM.

**Recipient**
The `payTo` account in the 402, the seller's classic `G...` address. Needs a USDC trustline. This CLI never holds its key.

**Policy**
The rules that decide whether a quoted payment may be signed. See [Spending policy](policy.md).

**Rule**
One check inside the policy, with a stable id such as `max_per_request`. That id appears in the audit log as `rule=` and in `--json`, so tooling can branch on it without matching prose.

**Check**
The result of evaluating one rule: a rule id, a label, `pass` or `fail`, and a human readable detail. All checks are evaluated so the CLI can print the whole checklist; the first failure is what refuses the payment.

**Decision**
The full verdict for one attempt: every check, the first violation if any, the host, the normalised amount and the spend at that moment.

**Atomic units**
An amount as an integer in the asset's smallest unit. Stellar assets carry **7 decimals**, so `0.001 USDC` is `10000`. Every amount in this codebase is a `bigint` in atomic units, never a float.

**Policy units**
An amount rescaled to 7 decimals so assets of different precision can be summed against one budget. For USDC on Stellar this is identical to atomic units.

**Rolling 24 h window**
Budgets count settled payments in the last 24 hours ending now, not a calendar day. A burst at 23:50 still counts the next morning.

**Dry run**
`--dry-run` negotiates the 402 and evaluates the policy without constructing a signer. Same rules, same verdict, nothing signed.

**Preflight**
The path taken when no wallet is configured: the 402 is still negotiated and judged, so a refusal is reported accurately even with no key present.

## Supply chain

**Provenance**
A signed attestation, published to a public transparency log, tying a package on npm to the exact commit and workflow run that built it. Version 0.1.1 onward carries one. Verify with `npm audit signatures`.

**CodeQL**
GitHub's static analysis engine. It runs over this repository on every push and weekly.

**gitleaks**
A secret scanner. It runs over the full history, so a key committed and later removed is still caught.
