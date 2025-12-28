# SQLite (offline) -> PostgreSQL (online sync) design

This doc defines a clean offline-first sync model for a POS app: local SQLite
for instant UX, PostgreSQL as the online source of truth, and a deterministic
sync pipeline that survives disconnects.

## Goals

- Offline-first: all writes hit SQLite and are usable immediately.
- Deterministic sync: a single push + pull loop with resumable cursors.
- Multi-tenant safe: every record belongs to a tenant and device.
- Conflict-aware: avoid silent data loss for mutable records.

## Core strategy

- Writes are local first, appended to an outbox table.
- Sync is two phases:
  1) Push outbox -> server applies -> server returns acks.
  2) Pull server changes -> apply to SQLite -> update cursor.
- Every mutable table has a version number and updated timestamps.
- Deletes are soft deletes so they can sync and be replayed.

## PostgreSQL schema (core sync tables)

These live in the shared schema; domain tables can be tenant-scoped with
either a `tenant_id` column or per-tenant schemas.

```sql
-- Devices allowed to sync for a tenant.
create table devices (
  device_id text primary key,
  tenant_id text not null,
  name text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

-- Global change log for pull-based sync.
create table sync_change_log (
  change_id bigserial primary key,
  tenant_id text not null,
  table_name text not null,
  row_id text not null,
  op text not null check (op in ('insert','update','delete')),
  version int not null,
  changed_at timestamptz not null default now(),
  source_device_id text,
  outbox_id text,
  payload jsonb
);

-- Tracks the last acknowledged change per device.
create table sync_cursors (
  device_id text primary key,
  tenant_id text not null,
  last_change_id bigint not null default 0,
  updated_at timestamptz not null default now()
);

create unique index sync_change_log_outbox_id_uq
  on sync_change_log (tenant_id, outbox_id)
  where outbox_id is not null;
```

## PostgreSQL schema (domain tables: required sync columns)

Every mutable table should include these fields.

```sql
-- Example for products; same shape applies to customers, suppliers, etc.
create table products (
  id text primary key,
  tenant_id text not null,
  name text not null,
  price numeric(12,2) not null,
  stock_level numeric(12,3) not null default 0,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  last_modified_by_device_id text
);
```

Notes:
- Prefer immutable records for sales, payments, and audits. Avoid updates.
- Use `version` for concurrency control (increment on each update).
- Treat `stock_level` as derived/cached only. Do not sync direct edits to it.

## SQLite schema (local sync tables)

```sql
-- Single-row metadata.
create table local_meta (
  key text primary key,
  value text not null
);

-- Outbox of pending local changes.
create table sync_outbox (
  outbox_id text primary key,
  batch_id text,
  tenant_id text not null,
  device_id text not null,
  table_name text not null,
  row_id text not null,
  op text not null check (op in ('insert','update','delete')),
  version int not null,
  payload text not null, -- JSON
  created_at text not null
);

-- Cached credential verifier for offline login.
create table credential_cache (
  user_id text primary key,
  email text not null,
  password_hash text not null,
  roles text,
  last_verified_at text not null,
  expires_at text not null,
  failed_attempts int not null default 0
);

-- Conflicts to resolve in the admin UI.
create table sync_conflicts (
  conflict_id text primary key,
  table_name text not null,
  row_id text not null,
  local_payload text not null,
  remote_payload text not null,
  local_version int,
  remote_version int,
  detected_at text not null,
  resolved_at text
);
```

Suggested `local_meta` keys:
- `device_id`, `tenant_id`
- `last_change_id` (pull cursor)
- `last_push_at`

## Sync flow

### Push (device -> server)

1) Read outbox rows ordered by `created_at`.
2) For each row, send `{table, row_id, op, version, payload, device_id}`.
3) Server applies:
   - If insert: ignore if row already exists (idempotent).
   - If update: require `version` == current version; else conflict.
   - If delete: soft delete and log change.
   - If `(tenant_id, outbox_id)` already exists in `sync_change_log`, ignore.
4) Server writes to `sync_change_log` for every accepted change.
5) Server returns ack list (outbox_ids applied + any conflicts).
6) Client removes acked outbox rows and records conflicts locally.

### Pull (server -> device)

1) Get `last_change_id` from `local_meta`.
2) Request `GET /sync/pull?tenant_id=...&cursor=last_change_id`.
3) Server returns ordered changes and `new_cursor`.
4) Client applies changes to SQLite:
   - `insert` -> upsert if missing.
   - `update` -> apply only if remote version >= local version.
   - `delete` -> soft delete locally.
5) Update `local_meta.last_change_id`.

## Conflict rules (pragmatic and safe)

- Mutable tables: use version check; if mismatch, mark conflict.
- Immutable tables: avoid conflicts by design (append-only).
- Default resolution: "server wins" and store local diff for review.
- Optional: for low-risk fields, use last-write-wins with
  `updated_at` + `device_id` as tie-breaker.
- Treat `version` as authoritative. Timestamps are metadata only.

## Offline login (optional)

- After a successful online login, cache a verifier in `credential_cache`.
- Permit offline login only when:
  - `expires_at` is within 24 hours of `last_verified_at`.
  - `failed_attempts` is under the threshold.
- On next online login, refresh `last_verified_at` and reset failures.

## Production enhancements checklist

- Encrypt SQLite (SQLCipher or similar) and store the key in OS keychain.
- Background sync worker with exponential backoff and jitter.
- Sync status indicator: `idle`, `syncing`, `error`, `offline`.
- Manual "Sync Now" action to run an immediate push+pull.
- End-of-day auto sync (e.g., local 11:55pm) with user-visible status.

## API surface (minimal)

- `POST /sync/push` -> accepts batch of outbox items and returns acks.
- `GET /sync/pull?tenant_id=...&cursor=...` -> returns change list + cursor.
- `POST /sync/ack` -> optional, if you want explicit server-side receipt.

## Implementation notes

- Use UUID/CUID generated on device for new rows (no server round-trip).
- Enforce full-row snapshots for `insert` and `update` payloads.
- Treat `delete` payloads as minimal (row id + deleted_at).
- Index `sync_change_log(tenant_id, change_id)` for fast pulls.
- Store `device_id` once at install and never change it.
- Keep tombstones for a fixed period (e.g., 90 days); older devices require
  a full resync if they exceed the retention window.

## POS-specific hardening

### Stock movement (avoid mutable stock)

Use immutable stock movements and derive stock level.

- `stock_movements` are the synced source of truth.
- `products.stock_level` is derived (server-maintained or recomputed).
- Do not send `stock_level` in outbox payloads or accept it in server writes.

```sql
create table stock_movements (
  id text primary key,
  tenant_id text not null,
  product_id text not null,
  qty_delta numeric(12,3) not null,
  reason text not null, -- sale, adjustment, transfer
  ref_id text,
  created_at timestamptz not null default now()
);
```

### Receipts and numbering

- Receipt number should be a local human-readable sequence (not the PK).
- Use `STORECODE-YYYYMMDD-SEQ` and never renumber after sync.

### Roles and permissions

- Cache roles for offline use.
- If a role is revoked, enforce on next successful online sync.

### Fraud and audit flags

- Track `created_offline` and `offline_duration_ms` per sale.
- Flag long-offline sales for audit review.

## Optional pull filtering

For large tenants, allow `tables` filters:

```
GET /sync/pull?tenant_id=...&cursor=123&tables=products,customers
```
