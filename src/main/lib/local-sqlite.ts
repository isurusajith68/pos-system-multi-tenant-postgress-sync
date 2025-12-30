import { app } from "electron";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require("better-sqlite3");

let localDbInstance: any | null = null;

const resolveLocalDbPath = (): string => {
  const baseDir = (() => {
    try {
      if (app && app.isReady && app.isReady()) {
        return app.getPath("userData");
      }
    } catch {
      // Fall through to process.cwd()
    }
    return process.cwd();
  })();

  return join(baseDir, "pos-local.sqlite");
};

const resolveSchemaPath = (): string => {
  const candidates = [
    resolve(process.resourcesPath ?? "", "resources", "sqlite-schema.sql"),
    resolve(process.resourcesPath ?? "", "sqlite-schema.sql"),
    resolve(process.cwd(), "resources", "sqlite-schema.sql"),
    resolve(__dirname, "../../resources/sqlite-schema.sql"),
    resolve(__dirname, "../../../resources/sqlite-schema.sql")
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("SQLite schema file not found (resources/sqlite-schema.sql)");
};

const initializeSchema = (db: any): void => {
  const schemaPath = resolveSchemaPath();
  const schemaSql = readFileSync(schemaPath, "utf8");
  db.exec(schemaSql);
};

export const getLocalDbPath = (): string => resolveLocalDbPath();

export const getLocalDb = (): any => {
  if (localDbInstance) {
    return localDbInstance;
  }

  const dbPath = getLocalDbPath();
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  initializeSchema(db);

  localDbInstance = db;
  return db;
};

export const closeLocalDb = (): void => {
  if (!localDbInstance) {
    return;
  }

  try {
    localDbInstance.close();
  } finally {
    localDbInstance = null;
  }
};

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, "\"\"")}"`;

export const hasLocalDbData = (): boolean => {
  const db = getLocalDb();
  const tables = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name != 'local_meta'
      `
    )
    .all() as { name: string }[];

  for (const { name } of tables) {
    const row = db.prepare(`SELECT 1 FROM ${quoteIdentifier(name)} LIMIT 1`).get();
    if (row) {
      return true;
    }
  }

  return false;
};

export const clearLocalDb = (options?: { preserveDeviceId?: boolean }): void => {
  const db = getLocalDb();
  const preserveDeviceId = options?.preserveDeviceId ?? true;
  const deviceIdRow = preserveDeviceId
    ? db.prepare("SELECT value FROM local_meta WHERE key = ?").get("device_id")
    : null;

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];

  db.pragma("foreign_keys = OFF");

  const clearTx = db.transaction(() => {
    for (const { name } of tables) {
      db.prepare(`DELETE FROM ${quoteIdentifier(name)}`).run();
    }
    if (preserveDeviceId && deviceIdRow?.value) {
      db.prepare("INSERT INTO local_meta (key, value) VALUES (?, ?)").run(
        "device_id",
        deviceIdRow.value
      );
    }
  });

  try {
    clearTx();
  } finally {
    db.pragma("foreign_keys = ON");
  }
};
