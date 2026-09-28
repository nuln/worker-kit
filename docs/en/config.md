# @nuln/worker-kit/config — Deployment Preflight & Setup Gate

## The problem

Missing bindings and secrets in a Cloudflare Worker **do not fail at deploy
time**: wrangler publishes, the code keeps accepting requests, and the failure
surfaces only when some path reaches `env.SOMETHING_KV.get(...)` at runtime.

Worse are the paths that **fail silently** — a single `console.warn` nobody
sees in production, so the misconfiguration persists:

| Forgotten | Consequence |
|---|---|
| `AUTH_SESSION_DO_SECRET` | Session DO's HTTP endpoint has no auth → credentials readable anonymously |
| `RATE_LIMITER_DO` | Rate limiting is entirely absent; dashboards stay green |
| `RESEND_API_KEY` | Password reset "succeeds" while no email was ever sent |
| `RP_ID` / `ORIGIN` | WebAuthn verification fails closed; nobody can log in |

And on first visit to `/setup`: the initialization form renders **regardless of
configuration state** — the user fills in their email, binds a Passkey, and only
then does something break.

This module provides one set of primitives: **missing config raises, returns
503, or is shown on the page** — never logged-and-ignored.

## Two usage patterns

### 1. Startup self-check (recommended)

```ts
import { preflightGuard } from "@nuln/worker-kit/config";

export default {
  async fetch(request, env) {
    const denied = preflightGuard(env, {
      secrets:  { AUTH_SESSION_DO_SECRET: "Session DO endpoint auth" },
      bindings: { DB: "D1", RATE_LIMITER_DO: "Rate limit DO" },
      vars:     { ORIGIN: "WebAuthn origin anchor" },
      apiKeys:  { RESEND_API_KEY: "Email delivery" },
    }, "tower");
    if (denied) return denied;   // 503 + missing list
    // …normal handling
  },
};
```

### 2. In-capability backstop

Even if the caller forgets the startup check, capabilities that depend on
external state check on first use:

| Capability | Behaviour when unconfigured |
|---|---|
| `AuthSessionDO.fetch()` | **503** `missing_config` + missing list |
| `AuthSessionDO.assertConfigured()` | throws `ConfigError` (for non-HTTP callers) |
| `RateLimitService.consume()` | `ok:false` + `error:"missing_config"` → middleware returns **503** |
| `createEmailProvider()` | one-time `console.error` warning that password reset would "succeed" falsely |

## Setup gate (`/setup` page)

```ts
import { renderAuthPage, authPageResponse } from "@nuln/worker-kit";
import { defineRequirements, REQUIREMENTS } from "@nuln/worker-kit/config";

export const requirements = defineRequirements(
  REQUIREMENTS.passkey,     // RP_ID + ORIGIN
  REQUIREMENTS.session,     // COOKIE_SECRET + AUTH_SESSION_DO_SECRET
  { name: "ADMIN_EMAIL", kind: "var", why: "Initial admin email" },
);

export function handleSetup(request: Request, env: any) {
  return authPageResponse({
    view: "setup", serviceName: "Tower", basePath: "/tower",
    request, env, requirements,
  });
}
```

When something is missing, the page renders the **checklist** instead of the
form — and the Passkey registration script is not injected, so there is no
half-working ceremony to click through.

## Key design constraint: adding an env var requires no code change

Requirements are **pure data** (`SetupRequirement[]`). Evaluation and rendering
are both plain iteration — there is **no per-variable switch or branch**.

```ts
// ① today
export const requirements = defineRequirements(
  REQUIREMENTS.passkey,
  { name: "ADMIN_EMAIL", kind: "var", why: "Initial admin email" },
);

// ② later — one more line; page and API gate pick it up automatically
export const requirements = defineRequirements(
  REQUIREMENTS.passkey,
  { name: "ADMIN_EMAIL", kind: "var", why: "Initial admin email" },
  { name: "SMTP_HOST",   kind: "var", why: "Self-hosted mail server", required: false },
);
```

This is locked by test (`test/integration/setup-gate.test.ts` → "Extensibility:
adding an env var requires no code change"): it appends a requirement at runtime
and asserts the page immediately reflects it with the right remediation command.

### Built-in capability presets

| Preset | Items |
|---|---|
| `REQUIREMENTS.passkey` | `RP_ID` `ORIGIN` |
| `REQUIREMENTS.session` | `COOKIE_SECRET` `AUTH_SESSION_DO_SECRET` |
| `REQUIREMENTS.ratelimit` | `RATE_LIMITER_DO` |
| `REQUIREMENTS.database` | `DB` |
| `REQUIREMENTS.mail` | `RESEND_API_KEY` |
| `REQUIREMENTS.backup` | `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` `S3_BUCKET` |
| `REQUIREMENTS.sync` | `BACKUP_SYNC_SECRET` |
| `REQUIREMENTS.oidc` | `COOKIE_SECRET` `RP_ID` `ORIGIN` |

## API

| Function | On failure | Returns |
|---|---|---|
| `inspect(env, spec, kind)` | never throws | `ConfigReport` |
| `assertConfigured(env, spec, kind, scope)` | **throws `ConfigError`** | `void` |
| `preflight(env, groups, scope)` | never throws | `ConfigReport` |
| `toConfigError(report, scope)` | never throws | `ConfigError \| null` |
| `configErrorResponse(err)` | — | `Response` (503 or 500) |
| `preflightGuard(env, groups, scope)` | never throws | `Response \| null` |
| `evaluateRequirements(env, reqs)` | never throws | `{ ok, blocking, advisory, all }` |
| `defineRequirements(...groups)` | **throws `TypeError`** on bad shape | `Requirements` |

### Evaluation rules

- `undefined` / `null` / `""` / whitespace-only → missing
- Non-string values (e.g. a `KVNamespace` object) → considered present
- `required: false` → lands in `advisory`, does not block
- A custom `check(v)` returning `false` → treated as misconfigured

### Response format

Status **503** ("dependency unavailable") rather than 500 ("code crashed").
Body follows the AGENTS §7.1 contract, with `cache-control: no-store`:

```json
{
  "ok": false,
  "error": "service_not_configured",
  "code": "CONFIG_MISSING",
  "details": [
    { "kind": "binding", "name": "RATE_LIMITER_DO",
      "reason": "not bound — rate limiting cannot run",
      "hint": "declare the RATE_LIMITER_DO binding in wrangler.jsonc" }
  ]
}
```

**`details` never contains secret values** — only names, reasons, and
remediation steps. A test asserts that an injected secret never appears in the
report, the rendered page, or the exception message.

## Shape validation in `defineRequirements`

```ts
defineRequirements(REQUIREMENTS.passkey)                    // ✅ array
defineRequirements({ name: "A", kind: "var", why: "…" })    // ✅ single item
defineRequirements({ A: { kind: "var", why: "…" } })        // ❌ TypeError
defineRequirements({ name: "A", why: "…" })                 // ❌ TypeError (missing kind)
defineRequirements({ name: "A", kind: "var" })              // ❌ TypeError (missing why)
```

The second bad shape was a genuine trap: passing `{ A: { kind, why } }` (which
reads like "a set of requirement items") made the function treat the whole
object as **one** requirement named `A` with `kind` and `why` both `undefined` —
silently producing nonsense. It now throws, with both the type system and a
runtime check.
---

## Build-time scan: surfacing what you did *not* notice

### Why declaration alone is not enough

The `/setup` gate reads the `requirements` a service explicitly declares. The
moment a developer reads a new `env.FOO` and forgets to register it, that
variable is invisible:

- `/setup` says nothing, CI stays green
- At runtime it blows up with only `undefined is not a function`

A Worker **cannot enumerate "which variables the code will read" at runtime** —
the platform hands you one `env` object with no configured/unconfigured list.
Automatic discovery therefore has to happen at **build time**: statically scan
the source for `env` accesses and compare against the actual configuration.

### Three layers

```text
(1) build    scanEnvAccess()   scan the source for "read but never registered"
(2) declare  requirements      pure data; shared by the gate and the /setup list
(3) runtime  assertConfigured  missing -> throw / 503, never a silent downgrade
```

Each layer alone has a blind spot. All three together is what "covered" means.

### Usage

```bash
npm run check:env -- ../workers/tower
```

```text
X ROOT_PATH   17 accesses [guarded x12 bare x1 defaulted x4] - no fallback at:
    src/helpers.ts:14
      return normalizeBasePath(env.ROOT_PATH);
```

| Flag | Effect |
|---|---|
| `--json` | machine-readable output for CI |
| `--warn` | always exit 0 |
| `--quiet` | problems only |

Exit code is 1 when undeclared accesses exist, so it works as a CI gate.

### Classification

Each access site is classified by **its own syntax**:

| Kind | Basis | Must be configured? |
|---|---|---|
| `defaulted` | `env.FOO ?? x` / `|| x` / `?.` / destructuring default | no |
| `guarded` | guarded in the enclosing scope by `&&` / `\|\|` / ternary / comparison / `typeof` / `!` / `if (...)`, possibly via a **one-hop local alias** | no |
| `bare` | none of the above | **yes - candidate** |

The aggregate takes the **strictest** kind, and keeps both the `kinds`
distribution and `bareLocations` — the report points at *the lines that made it
bare*, not at an arbitrary first few.

### `bare` is a candidate, not a verdict

Static analysis cannot prove a value is needed at runtime (the branch may be
unreachable, intercepted upstream, or the variable may simply be an optional
argument to a helper). The module therefore exists to **surface what manual
registration missed**, for a human to confirm.

Every reported item needs one of two verdicts:

1. genuinely required -> add it to `requirements` (`/setup` will list it)
2. genuinely optional -> add a fallback or a guard at the use site, re-run

### Measured across this workspace's 8 services

> A **2026-09-28 snapshot**, 31 items to confirm in total.
> Reproduce: `npm run check:env -- ../workers/<service>`.
> These numbers move with the code — after fixing false negatives the
> count should **go up** (that is real signal, not new noise). A count that
> never moves is itself a sign the scanner has regressed.


| Service | Files | Vars | To confirm |
|---|---|---|---|
| tower | 170 | 39 | 12 |
| mail | 233 | 51 | 2 |
| push | 47 | 6 | 2 |
| oidc | 146 | 37 | 2 |
| flash | 110 | 25 | 5 |
| console | 119 | 13 | 3 |
| pay | 72 | 11 | 2 |
| haeo | 73 | 18 | 3 |

`console.ADMIN_PASSWORD` is a **real defect**: 9 bare accesses, absent from
`.dev.vars`, so a production deploy that forgot to inject it hands SSH sessions
`envSecret: undefined`.

### Known limits (stated honestly)

- **Cross-function defaults are invisible**: in `parseAllowlist(env.FOO)`,
  `env.FOO` is classified `bare` even though the callee may supply a fallback.
  This is the main source of false positives.
- **Regex literals vs division are not distinguished**: text inside
  `/env\.FOO/` is kept as code.
- Guard dominance is approximated: the scope is the enclosing block (300-char
  cap); control flow across functions cannot be decided.
- Only ALL_CAPS names are recognised (`DB`, `RATE_LIMITER_DO`); relax with
  `namePattern`.
- `process.env.X` / `import.meta.env.X` are **excluded** — those are Node and
  build-time variables.

### On the lexer (`stripCommentsAndStrings`)

This repo's TSDoc is dense and nearly every doc block contains `env.XXX`
examples. Without stripping, the check lists dozens of variables that exist
only in prose and becomes immediately useless.

The stripper is a mini-lexer **with regex-literal recognition**, because of a
subtle trap:

```ts
const INDEXED_RE = /env\s*\[\s*["'`]([A-Za-z_$]+)["'`]\s*\]/g;
```

The `'` inside the character class was treated as "string start", and it ran
forward to the next `'` — preserving everything in between, comments included.
An `env.AUTH_SESSION_DO_SECRET` mentioned only in TSDoc was then reported as a
real access, with the actual cause **hundreds of lines away**.



## See also

- [`auth.md`](./auth.md) — auth pages and Passkey
- `examples/20-config-preflight-example.ts` — three preflight patterns
- `examples/21-setup-gate-example.ts` — setup gate
- `examples/22-env-scan-example.ts` — build-time env scan
