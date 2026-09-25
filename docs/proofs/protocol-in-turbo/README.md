# Generated types join the task graph (audit M4)

**Question.** Can the daemon be typechecked against protocol bindings that no
longer match `protocol/schema.json`?

**Method.** Two clean clones at `origin/master` (commit a919bd9), one with this
branch's `turbo.json` and root `package.json`. Each ran
`node protocol/generate.mjs && pnpm install --frozen-lockfile`, then deleted the
generated `packages/protocol-types/src` (standing in for any stale or missing
generation) and ran `pnpm turbo run typecheck --force`.

**Result.** [without.txt](without.txt): `master` fails at
`@mastra-cc/protocol-types#build`. [with.txt](with.txt): the branch regenerates
through the root `//#generate` task first and passes 9/9.

**Second check.** `daemon/src/__tests__/every-parameter-reaches-the-backend.test.ts`
compares every parameter the schema defines for a forwarded method with the
object `server.ts` hands to `backend.<method>`. Mutation
`a-schema-parameter-never-reaches-the-backend` (drops `capturedAt` from
`clickElement`, the original instance of this bug) goes red.

**Limit.** A fresh clone still runs the generator once before `pnpm install`:
pnpm resolves the workspace before any lifecycle hook, so it cannot link a
package that does not exist yet. After install, turbo keeps the bindings current.
