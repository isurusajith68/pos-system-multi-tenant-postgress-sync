# Zentra POS System (Multi-tenant Sync)

Zentra is a desktop POS system built with Electron, React, and TypeScript. It runs offline-first on
SQLite and syncs to a multi-tenant PostgreSQL backend with resumable push/pull loops.

## Features

- Offline-first sales and inventory with local SQLite storage
- Multi-tenant PostgreSQL sync with resumable cursors and conflict tracking
- Role-based access control, permissions, and employee management
- POS checkout with discounts, taxes, and multiple payment modes
- Products, categories, suppliers, purchase orders, and stock transactions
- Customer profiles, loyalty tracking, and customer transactions
- Reports for sales, inventory, and employee performance
- License activation flow, backups, and configurable settings
- Barcode scanner and receipt printer integrations

## Offline Sync Model

The sync design is documented in `docs/sqlite-postgres-sync-design.md`. Highlights:

- Local writes go to SQLite and are appended to `sync_outbox`
- Push loop applies changes to PostgreSQL and records them in `sync_change_log`
- Pull loop replays changes from PostgreSQL into SQLite using a cursor
- Soft deletes and version checks prevent silent overwrites
- Conflicts are tracked in `sync_conflicts` for UI resolution

Local SQLite schema: `resources/sqlite-schema.sql`

## Project Structure

```
pos-system-multi-tenant-postgress-sync/
  src/
    main/                 # Electron main process
      index.ts            # Main entry point
      lib/                # Database, sync, backup, printer/scanner utilities
    preload/              # Preload scripts
    renderer/             # React frontend
      src/
        pages/            # Screens (POS, products, reports, settings, etc.)
        components/       # UI components
        contexts/         # Auth, user, and app data contexts
  prisma/
    schema.prisma         # PostgreSQL schema (multi-tenant models)
    migrations/           # Prisma migrations
  resources/
    sqlite-schema.sql     # Local SQLite schema
  docs/
    sqlite-postgres-sync-design.md
```

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Setup

1. Install dependencies

```bash
npm install
```

2. Configure environment

Create `.env` with your PostgreSQL connection string:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/zentra"
```

3. Apply migrations

```bash
npx prisma migrate deploy
```

4. Start the app

```bash
npm run dev
```

### Default Admin (created on first init)

- Email: `admin@posystem.com`
- Password: `admin123`

## Scripts

- `npm run dev` - Start Electron + Vite dev server
- `npm run build` - Typecheck and build production bundles
- `npm run build:win` - Build Windows installer
- `npm run build:mac` - Build macOS app
- `npm run build:linux` - Build Linux app
- `npm run typecheck` - Run TypeScript checks
- `npm run lint` - Run ESLint
- `npm run format` - Run Prettier

## Local Data Storage

The offline cache is stored as `pos-local.sqlite` in the Electron user data directory and is
initialized from `resources/sqlite-schema.sql`.

## License

MIT License. See `LICENSE`.
