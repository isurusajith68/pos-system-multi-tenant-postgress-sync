# Agent Instructions

## Scope
- This repository implements a POS system with multi-tenant PostgreSQL and an offline-first SQLite sync model.
- Follow the design in `docs/sqlite-postgres-sync-design.md` when implementing sync.

## General Rules
- Prefer `rg` for searching.
- Default to ASCII in edits unless a file already uses non-ASCII.
- Do not revert user changes or touch unrelated files.
- Do not use destructive commands (e.g., `git reset --hard`) unless explicitly asked.

## Editing Guidance
- Use `apply_patch` for single-file edits when practical.
- Keep changes minimal and focused on the task.
- Add brief comments only when logic is not self-explanatory.

## Sync Implementation Expectations
- Local writes go to SQLite first and are appended to `sync_outbox`.
- Implement push then pull sync loops with resumable cursors.
- Use soft deletes and version checks for mutable tables.
- Treat `stock_level` as derived; avoid syncing direct edits to it.
- Track conflicts in `sync_conflicts` for UI resolution.

