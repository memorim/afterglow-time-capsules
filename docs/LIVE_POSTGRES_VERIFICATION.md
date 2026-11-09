# Live PostgreSQL verification — 2026-11-09

The owner confirmed the previous Afterglow and EchoMap data was test-only and
authorized a fresh persistent store without migrating the old ephemeral files.

Afterglow uses the existing free Render service and a separate Neon Free project,
`autumn-boat-18848454`, in Frankfurt. `DATABASE_URL` is held in Render environment
variables, not this repository. Existing account credentials were preserved.

Implementation: PR #12 (`bb9b018a02abb04e7be65323b0a53a3713e52fc4`) adds
PostgreSQL; PR #14 (`be1272b50b16d2311c4f9b30791e44fe31f429b8`) verifies all
configured account databases before the HTTP listener starts. CI passed for both,
including PostgreSQL 16, account authentication and isolation, encrypted capsule
round-trips, concurrent attempt budgets, existing SQLite tests and browser checks.

The live startup created one account schema containing four encrypted demo
capsules. A second deployment of exactly the same source was deliberately run
to check persistence, without changing the database configuration.

| Check | Result |
| --- | --- |
| Initial deployment | `dep-dbot6768bjmc73bktb70`, live 14:06:07 UTC |
| Independent restart deployment | `dep-dbot702jnfac73fvegd0`, live 14:07:31 UTC |
| Capsules before / after | 4 / 4 |
| Ordered row fingerprint before / after | `0860ec77ec7851d7fd3ea7ffeb9170e2` / identical |

The fingerprint includes encrypted payloads, salts and IVs. This checks preserved
rows, not just replacement seeds with the same count. Verification queried counts
and hashes without printing capsule contents or account credentials.

Remaining: independent external PostgreSQL backup storage, scheduled backup and
restore verification. Existing SQLite backup scripts do not back up this backend.
Authenticated operation of the live owner interface was not exercised in this
check; hosted routing and encryption were exercised against real PostgreSQL in CI.
