# Persistent PostgreSQL hosting

Set `DATABASE_URL` alongside the existing `APP_ACCOUNTS` and `APP_PUBLIC_ORIGIN`.
The existing account authentication and AES-GCM capsule encryption remain in use.
Without `DATABASE_URL`, local SQLite behavior remains available.

The PostgreSQL factory shares one pool (maximum four connections). Each account
uses a schema derived from its complete SHA-256 identifier. Schemas are selected
by authenticated server-side routing, never a caller-supplied tenant field.
Initialization and demo seeding are transactional and serialized with an advisory
lock. Remote connections require certificate validation. Attempt budgets are atomic
and survive app restarts. The 365-day default retention still applies after unlock.

This rollout starts a fresh demo database: on 2026-11-09 the owner confirmed that
Afterglow and EchoMap contain only test data and do not require migration.
The adapter does not automatically migrate existing SQLite files. Do not use this
fresh-start procedure for a deployment containing real capsules.

Validation: the normal SQLite suite plus PostgreSQL 16 integration tests in CI
cover encrypted writes, unlock timing, account separation, concurrent attempt
limits, repeated initialization and reopening through a new pool.

The existing SQLite maintenance and snapshot commands apply only to SQLite.
PostgreSQL needs a separate scheduled backup and verified restore workflow;
enabling this backend alone does not complete that operational requirement.
