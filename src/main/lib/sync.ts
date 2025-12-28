import { randomUUID } from "crypto";
import { getLocalDb } from "./local-sqlite";
import { getPublicPrismaClient, getTenantPrismaClient } from "./prisma";

type OutboxRow = {
  outbox_id: string;
  batch_id: string | null;
  tenant_id: string;
  device_id: string;
  table_name: string;
  row_id: string;
  op: "insert" | "update" | "delete";
  version: number;
  payload: string;
  created_at: string;
};

type SyncChangeRow = {
  change_id: number;
  tenant_id: string;
  table_name: string;
  row_id: string;
  op: "insert" | "update" | "delete";
  version: number;
  changed_at: Date;
  source_device_id: string | null;
  outbox_id: string | null;
  payload: any;
};

const SYNC_TABLES = new Set<string>([
  "categories",
  "products",
  "product_images",
  "product_tags",
  "product_tag_map",
  "employee",
  "inventory",
  "stock_transactions",
  "suppliers",
  "purchase_orders",
  "purchase_order_items",
  "customers",
  "sales_invoices",
  "payments",
  "custom_products",
  "sales_details",
  "shift_logs",
  "customer_transactions",
  "settings",
  "roles",
  "permissions",
  "role_permissions",
  "employee_roles"
]);

const PRIMARY_KEYS: Record<string, string[]> = {
  categories: ["category_id"],
  products: ["product_id"],
  product_images: ["image_id"],
  product_tags: ["tag_id"],
  product_tag_map: ["product_id", "tag_id"],
  employee: ["id"],
  inventory: ["inventory_id"],
  stock_transactions: ["transaction_id"],
  suppliers: ["supplier_id"],
  purchase_orders: ["po_id"],
  purchase_order_items: ["po_item_id"],
  customers: ["customer_id"],
  sales_invoices: ["invoice_id"],
  payments: ["payment_id"],
  custom_products: ["custom_product_id"],
  sales_details: ["sales_detail_id"],
  shift_logs: ["log_id"],
  customer_transactions: ["customer_id", "invoice_id"],
  settings: ["setting_id"],
  roles: ["role_id"],
  permissions: ["permission_id"],
  role_permissions: ["role_id", "permission_id"],
  employee_roles: ["employee_id", "role_id"]
};

const DISALLOWED_FIELDS_BY_TABLE: Record<string, string[]> = {
  products: ["stock_level"]
};

const nowIso = (): string => new Date().toISOString();

const ensureSyncInfrastructure = async (): Promise<void> => {
  const prisma = getPublicPrismaClient();
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.devices (
      device_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT,
      last_seen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.sync_change_log (
      change_id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      op TEXT NOT NULL CHECK (op IN ('insert','update','delete')),
      version INT NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      source_device_id TEXT,
      outbox_id TEXT,
      payload JSONB
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.sync_cursors (
      device_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      last_change_id BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS sync_change_log_outbox_id_uq
      ON public.sync_change_log (tenant_id, outbox_id)
      WHERE outbox_id IS NOT NULL;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS sync_change_log_tenant_change_id_idx
      ON public.sync_change_log (tenant_id, change_id);
  `);
};

const ensureTenantSchemaSyncColumns = async (tenantSchema: string): Promise<void> => {
  const prisma = getTenantPrismaClient(tenantSchema);

  for (const tableName of SYNC_TABLES) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${quoteIdentifier(tableName)}
        ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_modified_by_device_id TEXT,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    `);
  }
};

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, "\"\"")}"`;

const ensureAllowedTable = (tableName: string): void => {
  if (!SYNC_TABLES.has(tableName)) {
    throw new Error(`Sync table not allowed: ${tableName}`);
  }
};

const sanitizePayload = (tableName: string, payload: Record<string, any>): Record<string, any> => {
  const disallowed = DISALLOWED_FIELDS_BY_TABLE[tableName];
  if (!disallowed || disallowed.length === 0) {
    return payload;
  }

  const sanitized: Record<string, any> = { ...payload };
  for (const field of disallowed) {
    delete sanitized[field];
  }
  return sanitized;
};

const normalizePayloadForPostgres = (payload: Record<string, any>): Record<string, any> => {
  const normalized: Record<string, any> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined) {
      normalized[key] = null;
      continue;
    }

    if (key.endsWith("_at")) {
      if (value instanceof Date) {
        normalized[key] = value;
        continue;
      }

      if (typeof value === "string") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
          normalized[key] = parsed;
          continue;
        }
      }
    }

    normalized[key] = value;
  }

  return normalized;
};

const getLocalMeta = (key: string): string | null => {
  const db = getLocalDb();
  const row = db.prepare("SELECT value FROM local_meta WHERE key = ?").get(key);
  return row?.value ?? null;
};

const setLocalMeta = (key: string, value: string): void => {
  const db = getLocalDb();
  db.prepare(
    `
      INSERT INTO local_meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
  ).run(key, value);
};

export const ensureDeviceId = (): string => {
  const existing = getLocalMeta("device_id");
  if (existing) {
    return existing;
  }

  const deviceId = randomUUID();
  setLocalMeta("device_id", deviceId);
  return deviceId;
};

export const setTenantId = (tenantId: string): void => {
  setLocalMeta("tenant_id", tenantId);
};

export const getTenantId = (): string | null => {
  return getLocalMeta("tenant_id");
};

const getLastChangeId = (): number => {
  const raw = getLocalMeta("last_change_id");
  if (!raw) {
    return 0;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

const setLastChangeId = (value: number): void => {
  setLocalMeta("last_change_id", value.toString());
};

const resolveTenantSchema = async (tenantId: string): Promise<string> => {
  const prisma = getPublicPrismaClient();
  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT "schemaName"
      FROM public.tenants
      WHERE id = $1
    `,
    tenantId
  )) as { schemaName: string }[];

  const schemaName = rows[0]?.schemaName?.trim();
  if (!schemaName) {
    throw new Error(`Tenant schema not found for tenant_id=${tenantId}`);
  }
  return schemaName;
};

const fetchRowVersion = async (
  prisma: ReturnType<typeof getTenantPrismaClient>,
  tableName: string,
  rowId: string
): Promise<number | null> => {
  const primaryKeys = PRIMARY_KEYS[tableName];
  if (!primaryKeys || primaryKeys.length === 0) {
    throw new Error(`Primary key config missing for ${tableName}`);
  }

  const parsedRowId = parseRowId(primaryKeys, rowId);
  const whereClauses = primaryKeys.map((key, index) => `${quoteIdentifier(key)} = $${index + 1}`);
  const values = primaryKeys.map((key) => parsedRowId[key]);

  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT version
      FROM ${quoteIdentifier(tableName)}
      WHERE ${whereClauses.join(" AND ")}
      LIMIT 1
    `,
    ...values
  )) as { version: number }[];

  if (rows.length === 0 || rows[0]?.version === undefined || rows[0]?.version === null) {
    return null;
  }
  return Number(rows[0].version);
};

const fetchRowPayload = async (
  prisma: ReturnType<typeof getTenantPrismaClient>,
  tableName: string,
  rowId: string
): Promise<Record<string, any> | null> => {
  const primaryKeys = PRIMARY_KEYS[tableName];
  const parsedRowId = parseRowId(primaryKeys, rowId);
  const whereClauses = primaryKeys.map((key, index) => `${quoteIdentifier(key)} = $${index + 1}`);
  const values = primaryKeys.map((key) => parsedRowId[key]);

  const rows = (await prisma.$queryRawUnsafe(
    `
      SELECT *
      FROM ${quoteIdentifier(tableName)}
      WHERE ${whereClauses.join(" AND ")}
      LIMIT 1
    `,
    ...values
  )) as Record<string, any>[];

  return rows[0] ?? null;
};

const insertRow = async (
  prisma: ReturnType<typeof getTenantPrismaClient>,
  tableName: string,
  payload: Record<string, any>
): Promise<void> => {
  const normalizedPayload = normalizePayloadForPostgres(payload);
  const columns = Object.keys(normalizedPayload);
  const values = columns.map((column) => normalizedPayload[column]);
  const columnSql = columns.map((column) => quoteIdentifier(column)).join(", ");
  const valueSql = columns.map((_, index) => `$${index + 1}`).join(", ");

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO ${quoteIdentifier(tableName)} (${columnSql})
      VALUES (${valueSql})
      ON CONFLICT DO NOTHING
    `,
    ...values
  );
};

const updateRow = async (
  prisma: ReturnType<typeof getTenantPrismaClient>,
  tableName: string,
  rowId: string,
  payload: Record<string, any>
): Promise<void> => {
  const primaryKeys = PRIMARY_KEYS[tableName];
  const parsedRowId = parseRowId(primaryKeys, rowId);

  const normalizedPayload = normalizePayloadForPostgres(payload);
  const columns = Object.keys(normalizedPayload);
  const values = columns.map((column) => normalizedPayload[column]);
  const setSql = columns.map((column, index) => `${quoteIdentifier(column)} = $${index + 1}`);
  const whereOffset = columns.length;
  const whereSql = primaryKeys.map(
    (key, index) => `${quoteIdentifier(key)} = $${whereOffset + index + 1}`
  );

  const whereValues = primaryKeys.map((key) => parsedRowId[key]);

  await prisma.$executeRawUnsafe(
    `
      UPDATE ${quoteIdentifier(tableName)}
      SET ${setSql.join(", ")}
      WHERE ${whereSql.join(" AND ")}
    `,
    ...values,
    ...whereValues
  );
};

const softDeleteRow = async (
  prisma: ReturnType<typeof getTenantPrismaClient>,
  tableName: string,
  rowId: string,
  version: number,
  deletedAt: string
): Promise<void> => {
  const primaryKeys = PRIMARY_KEYS[tableName];
  const parsedRowId = parseRowId(primaryKeys, rowId);
  const whereSql = primaryKeys.map((key, index) => `${quoteIdentifier(key)} = $${index + 1}`);
  const whereValues = primaryKeys.map((key) => parsedRowId[key]);
  const deletedAtValue =
    deletedAt && !Number.isNaN(new Date(deletedAt).getTime()) ? new Date(deletedAt) : deletedAt;

  await prisma.$executeRawUnsafe(
    `
      UPDATE ${quoteIdentifier(tableName)}
      SET deleted_at = $${whereValues.length + 1},
          version = $${whereValues.length + 2},
          updated_at = $${whereValues.length + 3}
      WHERE ${whereSql.join(" AND ")}
    `,
    ...whereValues,
    deletedAtValue,
    version,
    deletedAtValue
  );
};

const parseRowId = (keys: string[], rowId: string): Record<string, any> => {
  if (keys.length === 1) {
    return { [keys[0]]: rowId };
  }

  try {
    const parsed = JSON.parse(rowId);
    if (typeof parsed === "object" && parsed) {
      return parsed;
    }
  } catch {
    // fall through
  }

  throw new Error(`Invalid composite row_id for keys=${keys.join(",")}`);
};

const insertChangeLog = async (
  tenantId: string,
  item: OutboxRow,
  payload: Record<string, any>
): Promise<void> => {
  const prisma = getPublicPrismaClient();
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO public.sync_change_log (
        tenant_id,
        table_name,
        row_id,
        op,
        version,
        changed_at,
        source_device_id,
        outbox_id,
        payload
      )
      VALUES ($1,$2,$3,$4,$5,now(),$6,$7,$8::jsonb)
    `,
    tenantId,
    item.table_name,
    item.row_id,
    item.op,
    item.version,
    item.device_id,
    item.outbox_id,
    JSON.stringify(payload)
  );
};

const recordDeviceSeen = async (tenantId: string, deviceId: string): Promise<void> => {
  const prisma = getPublicPrismaClient();
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO public.devices (device_id, tenant_id, last_seen_at, created_at)
      VALUES ($1, $2, now(), now())
      ON CONFLICT (device_id) DO UPDATE
      SET tenant_id = excluded.tenant_id,
          last_seen_at = now()
    `,
    deviceId,
    tenantId
  );
};

const upsertCursor = async (
  tenantId: string,
  deviceId: string,
  lastChangeId: number
): Promise<void> => {
  const prisma = getPublicPrismaClient();
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO public.sync_cursors (device_id, tenant_id, last_change_id, updated_at)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (device_id) DO UPDATE
      SET last_change_id = excluded.last_change_id,
          updated_at = now(),
          tenant_id = excluded.tenant_id
    `,
    deviceId,
    tenantId,
    lastChangeId
  );
};

const upsertConflict = (conflict: {
  tableName: string;
  rowId: string;
  localPayload: Record<string, any>;
  remotePayload: Record<string, any>;
  localVersion?: number | null;
  remoteVersion?: number | null;
}): void => {
  const db = getLocalDb();
  db.prepare(
    `
      INSERT INTO sync_conflicts (
        conflict_id,
        table_name,
        row_id,
        local_payload,
        remote_payload,
        local_version,
        remote_version,
        detected_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    randomUUID(),
    conflict.tableName,
    conflict.rowId,
    JSON.stringify(conflict.localPayload),
    JSON.stringify(conflict.remotePayload),
    conflict.localVersion ?? null,
    conflict.remoteVersion ?? null,
    nowIso()
  );
};

export const pushOutbox = async (limit = 100): Promise<{ acked: number; conflicts: number }> => {
  const tenantId = getTenantId();
  if (!tenantId) {
    throw new Error("Missing tenant_id in local_meta");
  }

  const deviceId = ensureDeviceId();
  const db = getLocalDb();

  const rows = db
    .prepare(
      `
        SELECT *
        FROM sync_outbox
        ORDER BY created_at ASC
        LIMIT ?
      `
    )
    .all(limit) as OutboxRow[];

  if (rows.length === 0) {
    return { acked: 0, conflicts: 0 };
  }

  let acked = 0;
  let conflicts = 0;

  const tenantSchema = await resolveTenantSchema(tenantId);
  const tenantPrisma = getTenantPrismaClient(tenantSchema);

  for (const item of rows) {
    ensureAllowedTable(item.table_name);

    const prisma = getPublicPrismaClient();
    const existing = (await prisma.$queryRawUnsafe(
      `
        SELECT change_id
        FROM public.sync_change_log
        WHERE tenant_id = $1 AND outbox_id = $2
        LIMIT 1
      `,
      tenantId,
      item.outbox_id
    )) as { change_id: number }[];

    if (existing.length > 0) {
      db.prepare("DELETE FROM sync_outbox WHERE outbox_id = ?").run(item.outbox_id);
      acked += 1;
      continue;
    }

    const localPayload = JSON.parse(item.payload) as Record<string, any>;
    const payload = sanitizePayload(item.table_name, localPayload);

    try {
      if (item.op === "insert") {
        await insertRow(tenantPrisma, item.table_name, payload);
        await insertChangeLog(tenantId, item, payload);
      } else if (item.op === "update") {
        const currentVersion = await fetchRowVersion(
          tenantPrisma,
          item.table_name,
          item.row_id
        );
        if (currentVersion === null || currentVersion !== item.version - 1) {
          const remote = await fetchRowPayload(
            tenantPrisma,
            item.table_name,
            item.row_id
          );
          upsertConflict({
            tableName: item.table_name,
            rowId: item.row_id,
            localPayload: payload,
            remotePayload: remote ?? {},
            localVersion: item.version,
            remoteVersion: currentVersion
          });
          conflicts += 1;
          continue;
        }

        await updateRow(tenantPrisma, item.table_name, item.row_id, payload);
        await insertChangeLog(tenantId, item, payload);
      } else if (item.op === "delete") {
        const currentVersion = await fetchRowVersion(
          tenantPrisma,
          item.table_name,
          item.row_id
        );
        if (currentVersion === null || currentVersion !== item.version - 1) {
          const remote = await fetchRowPayload(
            tenantPrisma,
            item.table_name,
            item.row_id
          );
          upsertConflict({
            tableName: item.table_name,
            rowId: item.row_id,
            localPayload: payload,
            remotePayload: remote ?? {},
            localVersion: item.version,
            remoteVersion: currentVersion
          });
          conflicts += 1;
          continue;
        }

        await softDeleteRow(
          tenantPrisma,
          item.table_name,
          item.row_id,
          item.version,
          payload.deleted_at ?? nowIso()
        );
        await insertChangeLog(tenantId, item, payload);
      }

      db.prepare("DELETE FROM sync_outbox WHERE outbox_id = ?").run(item.outbox_id);
      acked += 1;
    } catch (error) {
      console.error("Error applying outbox item:", error);
      throw error;
    }
  }

  await recordDeviceSeen(tenantId, deviceId);

  return { acked, conflicts };
};

const applyLocalChange = (change: SyncChangeRow): void => {
  const db = getLocalDb();
  ensureAllowedTable(change.table_name);

  const payload = sanitizePayload(change.table_name, change.payload ?? {});
  const primaryKeys = PRIMARY_KEYS[change.table_name];
  const parsedRowId = parseRowId(primaryKeys, change.row_id);

  const whereClause = primaryKeys.map((key) => `${key} = ?`).join(" AND ");
  const whereValues = primaryKeys.map((key) => parsedRowId[key]);
  const existing = db
    .prepare(`SELECT version FROM ${change.table_name} WHERE ${whereClause}`)
    .get(...whereValues);

  const localVersion = existing?.version ? Number(existing.version) : null;

  if (change.op === "delete") {
    if (localVersion !== null && localVersion > change.version) {
      return;
    }

    const deletedAt = payload.deleted_at ?? nowIso();
    db.prepare(
      `
        UPDATE ${change.table_name}
        SET deleted_at = ?, version = ?, updated_at = ?
        WHERE ${whereClause}
      `
    ).run(deletedAt, change.version, deletedAt, ...whereValues);
    return;
  }

  if (localVersion !== null && localVersion > change.version) {
    return;
  }

  const columns = Object.keys(payload);
  if (columns.length === 0) {
    return;
  }

  const placeholders = columns.map(() => "?").join(", ");
  const updateAssignments = columns.map((column) => `${column} = ?`).join(", ");
  const values = columns.map((column) => payload[column]);

  if (localVersion === null) {
    db.prepare(
      `
        INSERT INTO ${change.table_name} (${columns.join(", ")})
        VALUES (${placeholders})
      `
    ).run(...values);
  } else {
    db.prepare(
      `
        UPDATE ${change.table_name}
        SET ${updateAssignments}
        WHERE ${whereClause}
      `
    ).run(...values, ...whereValues);
  }
};

export const pullChanges = async (
  limit = 500,
  tables?: string[]
): Promise<{ applied: number; newCursor: number }> => {
  const tenantId = getTenantId();
  if (!tenantId) {
    throw new Error("Missing tenant_id in local_meta");
  }

  const deviceId = ensureDeviceId();
  const lastChangeId = getLastChangeId();

  const prisma = getPublicPrismaClient();
  const tableFilter =
    tables && tables.length > 0 ? tables.filter((table) => SYNC_TABLES.has(table)) : [];

  const whereClauses: string[] = ["tenant_id = $1", "change_id > $2"];
  const values: any[] = [tenantId, lastChangeId];

  if (tableFilter.length > 0) {
    whereClauses.push(`table_name = ANY($3)`);
    values.push(tableFilter);
  }

  const changeRows = (await prisma.$queryRawUnsafe(
    `
      SELECT change_id,
             tenant_id,
             table_name,
             row_id,
             op,
             version,
             changed_at,
             source_device_id,
             outbox_id,
             payload
      FROM public.sync_change_log
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY change_id ASC
      LIMIT ${tableFilter.length > 0 ? "$4" : "$3"}
    `,
    ...values,
    limit
  )) as SyncChangeRow[];

  if (changeRows.length === 0) {
    return { applied: 0, newCursor: lastChangeId };
  }

  const db = getLocalDb();
  const applyTransaction = db.transaction((rows: SyncChangeRow[]) => {
    for (const change of rows) {
      applyLocalChange(change);
    }
  });

  applyTransaction(changeRows);

  const newCursor = changeRows[changeRows.length - 1].change_id;
  setLastChangeId(newCursor);

  await upsertCursor(tenantId, deviceId, newCursor);
  await recordDeviceSeen(tenantId, deviceId);

  return { applied: changeRows.length, newCursor };
};

export const syncNow = async (): Promise<{
  pushed: number;
  pushConflicts: number;
  pulled: number;
  newCursor: number;
}> => {
  const tenantId = getTenantId();
  if (!tenantId) {
    throw new Error("Missing tenant_id in local_meta");
  }

  const tenantSchema = await resolveTenantSchema(tenantId);
  await ensureTenantSchemaSyncColumns(tenantSchema);
  await bootstrapLocalIfNeeded();
  const pushResult = await pushOutbox();
  const pullResult = await pullChanges();

  return {
    pushed: pushResult.acked,
    pushConflicts: pushResult.conflicts,
    pulled: pullResult.applied,
    newCursor: pullResult.newCursor
  };
};

const isLocalBootstrapComplete = (): boolean => {
  const db = getLocalDb();
  const row = db
    .prepare("SELECT value FROM local_meta WHERE key = ?")
    .get("bootstrap_complete");
  return Boolean(row?.value);
};

const markBootstrapComplete = (): void => {
  const db = getLocalDb();
  db.prepare(
    `
      INSERT INTO local_meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
  ).run("bootstrap_complete", nowIso());
};

export const bootstrapLocalFromServer = async (): Promise<{
  tables: number;
  rows: number;
  lastChangeId: number;
}> => {
  await ensureSyncInfrastructure();
  const tenantId = getTenantId();
  if (!tenantId) {
    throw new Error("Missing tenant_id in local_meta");
  }

  const tenantSchema = await resolveTenantSchema(tenantId);
  await ensureTenantSchemaSyncColumns(tenantSchema);
  const tenantPrisma = getTenantPrismaClient(tenantSchema);
  const db = getLocalDb();

  let totalRows = 0;
  const tableNames = Array.from(SYNC_TABLES);

const insertStatementCache = new Map<string, { sql: string; columns: string[] }>();
const localColumnCache = new Map<string, string[]>();

  const snakeToCamel = (value: string): string => {
    return value.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
  };

  const getLocalColumns = (tableName: string): string[] => {
    const cached = localColumnCache.get(tableName);
    if (cached) {
      return cached;
    }

    const columns = db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((row: any) => row.name as string);

    localColumnCache.set(tableName, columns);
    return columns;
  };

  const buildInsert = (tableName: string, columns: string[]) => {
    const placeholders = columns.map(() => "?").join(", ");
    const sql = `INSERT OR REPLACE INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`;
    return { sql, columns };
  };

  for (const tableName of tableNames) {
    ensureAllowedTable(tableName);
    db.prepare(`DELETE FROM ${tableName}`).run();

    const rows = (await tenantPrisma.$queryRawUnsafe(
      `SELECT * FROM ${quoteIdentifier(tenantSchema)}.${quoteIdentifier(tableName)}`
    )) as Record<string, any>[];

    if (rows.length === 0) {
      continue;
    }

    const localColumns = getLocalColumns(tableName);

    for (const row of rows) {
      let stmt = insertStatementCache.get(tableName);
      if (!stmt) {
        stmt = buildInsert(tableName, localColumns);
        insertStatementCache.set(tableName, stmt);
      }
      const values = stmt.columns.map((col) => {
        let value: any = null;
        if (Object.prototype.hasOwnProperty.call(row, col)) {
          value = row[col];
        } else {
          const camelKey = snakeToCamel(col);
          if (Object.prototype.hasOwnProperty.call(row, camelKey)) {
            value = row[camelKey];
          }
        }

        if ((col === "updated_at" || col === "created_at") && (value === null || value === undefined)) {
          const fallbackCamel = col === "updated_at" ? "updatedAt" : "createdAt";
          const fallbackSnake = col;
          value =
            row[fallbackCamel] ??
            row[fallbackSnake] ??
            row["updatedAt"] ??
            row["createdAt"] ??
            row["updated_at"] ??
            row["created_at"] ??
            nowIso();
        }

        if (value instanceof Date) {
          return value.toISOString();
        }

        if (typeof value === "boolean") {
          return value ? 1 : 0;
        }

        if (Buffer.isBuffer(value)) {
          return value;
        }

        if (typeof value === "bigint") {
          return value;
        }

        if (value && typeof value === "object") {
          if (typeof (value as { toString?: () => string }).toString === "function") {
            return (value as { toString: () => string }).toString();
          }
          return JSON.stringify(value);
        }

        return value ?? null;
      });
      db.prepare(stmt.sql).run(...values);
      totalRows += 1;
    }
  }

  const prisma = getPublicPrismaClient();
  const cursorRows = (await prisma.$queryRawUnsafe(
    `
      SELECT COALESCE(MAX(change_id), 0) AS max_id
      FROM public.sync_change_log
      WHERE tenant_id = $1
    `,
    tenantId
  )) as { max_id: number }[];
  const lastChangeId = Number(cursorRows[0]?.max_id ?? 0);
  setLastChangeId(lastChangeId);

  markBootstrapComplete();

  return {
    tables: tableNames.length,
    rows: totalRows,
    lastChangeId
  };
};

export const bootstrapLocalIfNeeded = async (): Promise<boolean> => {
  if (isLocalBootstrapComplete()) {
    return false;
  }

  const db = getLocalDb();
  const row = db.prepare("SELECT COUNT(1) AS count FROM products").get() as { count: number };
  if (row?.count && Number(row.count) > 0) {
    markBootstrapComplete();
    return false;
  }

  await bootstrapLocalFromServer();
  return true;
};
