# Contributing

## Getting set up

```bash
npm install        # also installs the husky hooks
npm run build
npm link           # puts stellar-agent-pay on your PATH
```

Node.js 20 or newer.

## Before you open a pull request

```bash
npm run format     # prettier
npm run lint       # eslint, type aware
npm run typecheck  # tsc, src and test
npm test           # unit tests
npm run build
npm run smoke      # offline end to end against the mock seller
```

The husky hooks run a subset automatically: `pre-commit` runs lint-staged, `npm run lint` and `npm run build`; `pre-push` runs the full list.

Every one of these also runs in CI, as a separate workflow named after the command it executes.

## Layout

```
src/cli.ts             commander wiring, one file per command below
src/commands/          unlock, status, policy, wallet, audit, init
src/core/policy.ts     policy schema, load and save, domain matching
src/core/engine.ts     the rules, one check each, evaluated in order
src/core/x402.ts       x402 client, with the policy hook attached
src/core/audit.ts      audit.log and events.jsonl, budget accounting
examples/              mock seller (offline) and real seller (testnet)
scripts/smoke.mjs      end to end run used by npm run smoke and CI
```

## Adding a policy rule

1. Add the field to `PolicySchema` in `src/core/policy.ts`, with a default that does not change existing behaviour.
2. Push a `Check` in `evaluate()` in `src/core/engine.ts`. Give it a stable `rule` id, since that id ends up in the audit log and in `--json` output.
3. Add a remediation hint in `remediation()` in `src/commands/unlock.ts`.
4. Cover it in `test/engine.test.ts`, both the pass and the refusal.
5. Document it in the rules table in `README.md`.

Rules must be evaluated before any signing happens. The policy hook is attached at `onBeforePaymentCreation`, which is the last point where a payment can still be refused without producing a signature. Do not move enforcement later than that.

## Conventions

- No em dashes in code, comments or docs.
- Amounts are handled as `bigint` in atomic units. Never use floating point for money.
- Diagnostics go to stderr, resource content goes to stdout, so pipes stay clean.
- Exit codes are part of the contract: `0` ok, `1` error, `2` blocked by policy.

## Reporting security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).
