## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The problem it solves. -->

## Checklist

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] `npm run smoke` passes
- [ ] Docs updated if behaviour changed (`README.md` and `README.es.md`)

## If this touches the payment path

- [ ] The policy is still evaluated before anything is signed
- [ ] Every attempt still reaches the audit log, including refusals
- [ ] Exit codes still mean `0` ok, `1` error, `2` blocked by policy
- [ ] New or changed rules are covered in `test/engine.test.ts`
