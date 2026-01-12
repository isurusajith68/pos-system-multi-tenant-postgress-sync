import { randomUUID } from "crypto";
import { getActiveSchema, getPrismaClient, getTenantPrismaClient } from "./prisma";
import * as bcrypt from "bcrypt";
import { validateAndFormatQuantity } from "./quantityValidation";
import { getLocalDb } from "./local-sqlite";
import { ensureDeviceId, getTenantId } from "./sync";

type PaginationOptions = {
  skip?: number;
  take?: number;
};

type FindManyOptions = {
  pagination?: PaginationOptions;
  select?: Record<string, unknown>;
};

type ProductFilters = {
  searchTerm?: string;
  code?: string;
  categoryId?: string;
  stockFilter?: "all" | "inStock" | "outOfStock";
  minPrice?: number;
  maxPrice?: number;
};

type ProductSort = {
  field?: "name" | "price" | "category" | "stock" | "createdAt";
  direction?: "asc" | "desc";
};

type ProductFindManyOptions = FindManyOptions & {
  filters?: ProductFilters;
  sort?: ProductSort;
  bypassCache?: boolean;
};

type InventoryFilters = {
  searchTerm?: string;
  productId?: string;
  lowStock?: boolean;
  expiringSoon?: boolean;
};

type StockTransactionFilters = {
  searchTerm?: string;
  productId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  reason?: string;
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);

  return `{${entries.join(",")}}`;
};

type ProductCacheEntry = {
  data: any[];
  expiresAt: number;
};

const productCache = new Map<string, ProductCacheEntry>();
const productCacheInFlight = new Map<string, Promise<any[]>>();

const resolveProductCacheKey = (options?: ProductFindManyOptions): string => {
  const schemaKey = getActiveSchema() ?? "__public__";
  return `${schemaKey}::${stableStringify(options ?? {})}`;
};

const clearProductCache = (schemaName?: string): void => {
  const schemaKey = schemaName ?? getActiveSchema() ?? "__public__";
  const prefix = `${schemaKey}::`;

  for (const key of productCache.keys()) {
    if (key.startsWith(prefix)) {
      productCache.delete(key);
      productCacheInFlight.delete(key);
    }
  }
};

const mapCategoryRowFromDb = (row: any): any => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: row.category_id,
    parentCategoryId: row.parent_category_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
};

const mapProductImageRowFromDb = (row: any): any => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: row.image_id,
    productId: row.product_id,
    altText: row.alt_text,
    isPrimary: Boolean(row.is_primary),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
};

const mapProductTagRowFromDb = (row: any): any => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: row.tag_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
};

const mapProductTagMapRowFromDb = (row: any): any => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    productId: row.product_id,
    tagId: row.tag_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    tag: row.tag ? mapProductTagRowFromDb(row.tag) : null
  };
};

const mapProductRowFromDb = (
  row: any,
  related?: { category?: any; images?: any[]; productTags?: any[] }
): any => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: row.product_id,
    englishName: row.english_name,
    categoryId: row.category_id,
    costPrice: row.cost_price,
    discountedPrice: row.discounted_price,
    taxInclusivePrice: row.tax_inclusive_price,
    taxRate: row.tax_rate,
    unitSize: row.unit_size,
    unitType: row.unit_type,
    stockLevel: Number(row.stock_level ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    category: related?.category ? mapCategoryRowFromDb(related.category) : null,
    images: (related?.images ?? []).map(mapProductImageRowFromDb),
    productTags: (related?.productTags ?? []).map(mapProductTagMapRowFromDb)
  };
};

const mapEmployeeRowFromDb = (row: any): any => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    employeeId: row.employee_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
};

const mapCustomerRowFromDb = (row: any): any => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: row.customer_id,
    loyaltyPoints: row.loyalty_points,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
};

const mapPaymentRowFromDb = (row: any): any => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: row.payment_id,
    invoiceId: row.invoice_id,
    paymentMode: row.payment_mode,
    employeeId: row.employee_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
};

const mapInventoryRowFromDb = (row: any, related?: { product?: any; category?: any }): any => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: row.inventory_id,
    productId: row.product_id,
    reorderLevel: row.reorder_level,
    batchNumber: row.batch_number,
    expiryDate: row.expiry_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    product: related?.product
      ? mapProductRowFromDb(related.product, { category: related?.category })
      : null
  };
};

const mapStockTransactionRowFromDb = (
  row: any,
  related?: { product?: any; category?: any }
): any => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: row.transaction_id,
    productId: row.product_id,
    changeQty: row.change_qty,
    relatedInvoiceId: row.related_invoice_id,
    transactionDate: row.transaction_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    product: related?.product
      ? mapProductRowFromDb(related.product, { category: related?.category })
      : null
  };
};

const mapSupplierRowFromDb = (row: any, related?: { purchaseOrders?: any[] }): any => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: row.supplier_id,
    contactName: row.contact_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    purchaseOrders: related?.purchaseOrders ?? []
  };
};

const mapRoleRowFromDb = (row: any): any => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: row.role_id,
    isSystem: Boolean(row.is_system),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
};

const mapPermissionRowFromDb = (row: any): any => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: row.permission_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
};

const mapPurchaseOrderItemRowFromDb = (
  row: any,
  related?: { product?: any; category?: any }
): any => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: row.po_item_id,
    poId: row.po_id,
    productId: row.product_id,
    unitPrice: row.unit_price,
    receivedDate: row.received_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    product: related?.product
      ? mapProductRowFromDb(related.product, { category: related?.category })
      : null
  };
};

const mapPurchaseOrderRowFromDb = (row: any, related?: { supplier?: any; items?: any[] }): any => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: row.po_id,
    supplierId: row.supplier_id,
    orderDate: row.order_date,
    totalAmount: row.total_amount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    supplier: related?.supplier ? mapSupplierRowFromDb(related.supplier) : null,
    items: related?.items ?? []
  };
};

const mapSalesDetailRowFromDb = (
  row: any,
  related?: { product?: any; customProduct?: any }
): any => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: row.sales_detail_id,
    invoiceId: row.invoice_id,
    productId: row.product_id,
    customProductId: row.custom_product_id,
    unitPrice: row.unit_price,
    taxRate: row.tax_rate,
    originalPrice: row.original_price,
    costPrice: row.cost_price,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    product: related?.product ?? null,
    customProduct: related?.customProduct ?? null
  };
};

const mapSalesInvoiceRowFromDb = (
  row: any,
  related?: {
    customer?: any;
    employee?: any;
    payments?: any[];
    salesDetails?: any[];
  }
): any => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: row.invoice_id,
    customerId: row.customer_id,
    employeeId: row.employee_id,
    subTotal: row.sub_total,
    totalAmount: row.total_amount,
    paymentMode: row.payment_mode,
    taxAmount: row.tax_amount,
    discountAmount: row.discount_amount,
    amountReceived: row.amount_received,
    outstandingBalance: row.outstanding_balance,
    paymentStatus: row.payment_status,
    refundInvoiceId: row.refund_invoice_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    customer: related?.customer ?? null,
    employee: related?.employee ?? null,
    payments: related?.payments ?? [],
    salesDetails: related?.salesDetails ?? []
  };
};

const SETTINGS_CACHE_TTL_MS = 30000;

type SettingsCacheEntry = {
  data: any[];
  expiresAt: number;
};

type SettingsRow = {
  key: string;
  value: string;
  type: string;
  category: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
};

let settingsCache: SettingsCacheEntry | null = null;

const clearSettingsCache = (): void => {
  settingsCache = null;
};

const getSettingsCached = async (): Promise<any[]> => {
  const now = Date.now();
  if (settingsCache && settingsCache.expiresAt > now) {
    return settingsCache.data;
  }

  const db = getLocalDb();
  const rows = db
    .prepare("SELECT * FROM settings WHERE deleted_at IS NULL ORDER BY key ASC")
    .all() as any[];

  const mapped = rows.map((row) => ({
    key: row.key,
    value: row.value,
    type: row.type,
    category: row.category,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  settingsCache = {
    data: mapped,
    expiresAt: now + SETTINGS_CACHE_TTL_MS
  };

  return mapped;
};

const nowIso = (): string => new Date().toISOString();

const requireTenantId = (): string => {
  const tenantId = getTenantId();
  if (!tenantId) {
    throw new Error("Missing tenant_id in local_meta");
  }
  return tenantId;
};

const enqueueOutbox = (
  tableName: string,
  rowId: string,
  op: "insert" | "update" | "delete",
  version: number,
  payload: Record<string, unknown>
): void => {
  const tenantId = requireTenantId();
  const deviceId = ensureDeviceId();
  const db = getLocalDb();

  db.prepare(
    `
      INSERT INTO sync_outbox (
        outbox_id,
        batch_id,
        tenant_id,
        device_id,
        table_name,
        row_id,
        op,
        version,
        payload,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    randomUUID(),
    null,
    tenantId,
    deviceId,
    tableName,
    rowId,
    op,
    version,
    JSON.stringify(payload),
    nowIso()
  );
};

const buildCompositeRowId = (parts: Record<string, string>): string => {
  return JSON.stringify(parts);
};

const updateLocalProductStockLevel = (productId: string, newStockLevel: number): void => {
  const db = getLocalDb();
  db.prepare(
    `
      UPDATE products
      SET stock_level = ?, updated_at = ?
      WHERE product_id = ?
    `
  ).run(newStockLevel, nowIso(), productId);
};

// Centralized stock level update utility
export const updateProductStockLevel = async (
  productId: string,
  newStockLevel: number
): Promise<{ id: string; name: string; stockLevel: number }> => {
  const db = getLocalDb();
  const formattedStockLevel = validateAndFormatQuantity(newStockLevel);
  const existing = db
    .prepare("SELECT product_id, name FROM products WHERE product_id = ? AND deleted_at IS NULL")
    .get(productId);

  if (!existing) {
    throw new Error("Product not found");
  }

  updateLocalProductStockLevel(productId, formattedStockLevel);
  clearProductCache();
  return {
    id: existing.product_id,
    name: existing.name,
    stockLevel: formattedStockLevel
  };
};

// Sync product stock level with total inventory
export const syncProductStockWithInventory = async (
  productId: string
): Promise<{ id: string; name: string; stockLevel: number }> => {
  const db = getLocalDb();
  const totalInventory = db
    .prepare(
      `
        SELECT COALESCE(SUM(quantity), 0) AS total_quantity
        FROM inventory
        WHERE product_id = ? AND deleted_at IS NULL
      `
    )
    .get(productId) as { total_quantity?: number };

  const newStockLevel = Number(totalInventory?.total_quantity ?? 0);
  return await updateProductStockLevel(productId, newStockLevel);
};

export const categoryService = {
  findMany: async (options?: FindManyOptions) => {
    const db = getLocalDb();
    const selectKeys =
      options?.select && Object.keys(options.select).filter((key) => options.select?.[key]);
    const columns = selectKeys && selectKeys.length > 0 ? selectKeys.join(", ") : "*";

    let sql = `SELECT ${columns} FROM categories WHERE deleted_at IS NULL ORDER BY created_at DESC`;
    const params: Array<string | number> = [];
    if (options?.pagination?.take) {
      sql += " LIMIT ?";
      params.push(options.pagination.take);
    }
    if (options?.pagination?.skip) {
      sql += " OFFSET ?";
      params.push(options.pagination.skip);
    }

    const rows = db.prepare(sql).all(...params);
    if (options?.select) {
      return rows;
    }

    const parentIds = rows
      .map((row: any) => row.parent_category_id)
      .filter((value: string | null) => Boolean(value));
    const parentMap = new Map<string, any>();
    if (parentIds.length > 0) {
      const placeholders = parentIds.map(() => "?").join(", ");
      const parents = db
        .prepare(
          `SELECT * FROM categories WHERE category_id IN (${placeholders}) AND deleted_at IS NULL`
        )
        .all(...parentIds);
      for (const parent of parents) {
        parentMap.set(parent.category_id, parent);
      }
    }

    const subRows = db
      .prepare(
        "SELECT * FROM categories WHERE deleted_at IS NULL AND parent_category_id IS NOT NULL"
      )
      .all();
    const subMap = new Map<string, any[]>();
    for (const sub of subRows) {
      const list = subMap.get(sub.parent_category_id) ?? [];
      list.push(sub);
      subMap.set(sub.parent_category_id, list);
    }

    const mapCategoryRow = (row: any) => ({
      ...row,
      id: row.category_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      parentCategory: row.parent_category_id
        ? {
            ...parentMap.get(row.parent_category_id),
            id: row.parent_category_id,
            createdAt: parentMap.get(row.parent_category_id)?.created_at,
            updatedAt: parentMap.get(row.parent_category_id)?.updated_at,
            deletedAt: parentMap.get(row.parent_category_id)?.deleted_at
          }
        : null,
      subCategories: (subMap.get(row.category_id) ?? []).map((subRow: any) => ({
        ...subRow,
        id: subRow.category_id,
        createdAt: subRow.created_at,
        updatedAt: subRow.updated_at,
        deletedAt: subRow.deleted_at
      }))
    });

    return rows.map((row: any) => mapCategoryRow(row));
  },

  create: async (data: { name: string; parentCategoryId?: string }) => {
    const db = getLocalDb();

    const existingCategories = db
      .prepare(
        `
          SELECT name
          FROM categories
          WHERE deleted_at IS NULL AND LOWER(name) = LOWER(?)
        `
      )
      .all(data.name);

    if (existingCategories.length > 0) {
      throw new Error(`Category with name "${data.name}" already exists`);
    }

    const categoryId = randomUUID();
    const deviceId = ensureDeviceId();
    const timestamp = nowIso();
    const row = {
      category_id: categoryId,
      name: data.name,
      parent_category_id: data.parentCategoryId ?? null,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        INSERT INTO categories (
          category_id,
          name,
          parent_category_id,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      row.category_id,
      row.name,
      row.parent_category_id,
      row.version,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.last_modified_by_device_id
    );

    enqueueOutbox("categories", row.category_id, "insert", row.version, row);
    clearProductCache();

    const parent = row.parent_category_id
      ? db
          .prepare("SELECT * FROM categories WHERE category_id = ? AND deleted_at IS NULL")
          .get(row.parent_category_id)
      : null;

    return {
      ...row,
      parentCategory: parent ?? null,
      subCategories: []
    };
  },

  update: async (id: string, data: { name: string; parentCategoryId?: string }) => {
    const db = getLocalDb();

    const duplicate = db
      .prepare(
        `
          SELECT category_id
          FROM categories
          WHERE deleted_at IS NULL
            AND LOWER(name) = LOWER(?)
            AND category_id != ?
        `
      )
      .get(data.name, id);

    if (duplicate) {
      throw new Error(`Category with name "${data.name}" already exists`);
    }

    const existing = db
      .prepare("SELECT * FROM categories WHERE category_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Category not found");
    }

    const deviceId = ensureDeviceId();
    const updatedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const row = {
      ...existing,
      name: data.name ?? existing.name,
      parent_category_id:
        data.parentCategoryId !== undefined ? data.parentCategoryId : existing.parent_category_id,
      version,
      updated_at: updatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE categories
        SET name = ?, parent_category_id = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE category_id = ?
      `
    ).run(
      row.name,
      row.parent_category_id,
      row.version,
      row.updated_at,
      row.last_modified_by_device_id,
      id
    );

    enqueueOutbox("categories", id, "update", row.version, row);
    clearProductCache();

    const parent = row.parent_category_id
      ? db
          .prepare("SELECT * FROM categories WHERE category_id = ? AND deleted_at IS NULL")
          .get(row.parent_category_id)
      : null;
    const subCategories = db
      .prepare("SELECT * FROM categories WHERE parent_category_id = ? AND deleted_at IS NULL")
      .all(row.category_id);

    return {
      ...row,
      parentCategory: parent ?? null,
      subCategories
    };
  },

  delete: async (id: string) => {
    const db = getLocalDb();
    console.log(id, "id_category");
    const existing = db
      .prepare("SELECT * FROM categories WHERE category_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Category not found");
    }

    const deviceId = ensureDeviceId();
    const deletedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;

    db.prepare(
      `
        UPDATE categories
        SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE category_id = ?
      `
    ).run(deletedAt, version, deletedAt, deviceId, id);

    const payload = {
      ...existing,
      deleted_at: deletedAt,
      version,
      updated_at: deletedAt,
      last_modified_by_device_id: deviceId
    };
    enqueueOutbox("categories", id, "delete", version, payload);
    clearProductCache();

    return payload;
  }
};

export const productService = {
  findMany: async (options?: ProductFindManyOptions) => {
    const fetchProductsFromDb = async (): Promise<any[]> => {
      const db = getLocalDb();
      const rawRows = db.prepare("SELECT * FROM products WHERE deleted_at IS NULL").all() as any[];

      const applyFilters = (rows: any[]): any[] => {
        let filtered = rows;
        const filters = options?.filters;

        if (filters?.searchTerm) {
          const term = filters.searchTerm.trim().toLowerCase();
          if (term) {
            filtered = filtered.filter((row) =>
              [row.name, row.english_name, row.sku, row.barcode, row.brand, row.description]
                .filter(Boolean)
                .some((value: string) => value.toLowerCase().includes(term))
            );
          }
        }

        if (filters?.code) {
          const code = filters.code.trim();
          if (code) {
            filtered = filtered.filter((row) => row.barcode === code || row.sku === code);
          }
        }

        if (filters?.categoryId) {
          filtered = filtered.filter((row) => row.category_id === filters.categoryId);
        }

        if (filters?.stockFilter === "inStock") {
          filtered = filtered.filter((row) => Number(row.stock_level) > 0);
        } else if (filters?.stockFilter === "outOfStock") {
          filtered = filtered.filter((row) => Number(row.stock_level) === 0);
        }

        if (filters?.minPrice !== undefined || filters?.maxPrice !== undefined) {
          filtered = filtered.filter((row) => {
            const price = Number(row.price);
            if (filters.minPrice !== undefined && price < filters.minPrice) {
              return false;
            }
            if (filters.maxPrice !== undefined && price > filters.maxPrice) {
              return false;
            }
            return true;
          });
        }

        return filtered;
      };

      const applySort = (rows: any[]): any[] => {
        const field = options?.sort?.field ?? "createdAt";
        const direction = options?.sort?.direction ?? "desc";
        const multiplier = direction === "asc" ? 1 : -1;

        return [...rows].sort((a, b) => {
          switch (field) {
            case "name":
              return a.name.localeCompare(b.name) * multiplier;
            case "price":
              return (Number(a.price) - Number(b.price)) * multiplier;
            case "category":
              return a.category_id.localeCompare(b.category_id) * multiplier;
            case "stock":
              return (Number(a.stock_level) - Number(b.stock_level)) * multiplier;
            case "createdAt":
            default:
              return String(a.created_at).localeCompare(String(b.created_at)) * multiplier;
          }
        });
      };

      let rows = applyFilters(rawRows);
      rows = applySort(rows);

      if (options?.pagination?.skip) {
        rows = rows.slice(options.pagination.skip);
      }
      if (options?.pagination?.take) {
        rows = rows.slice(0, options.pagination.take);
      }

      if (options?.select) {
        const selectKeys = Object.keys(options.select).filter((key) => options.select?.[key]);
        return rows.map((row) => {
          const selected: Record<string, any> = {};
          for (const key of selectKeys) {
            selected[key] = row[key];
          }
          return selected;
        });
      }

      const productIds = rows.map((row) => row.product_id);
      const categories = db.prepare("SELECT * FROM categories WHERE deleted_at IS NULL").all();
      const categoryMap = new Map(categories.map((cat: any) => [cat.category_id, cat]));

      const images = productIds.length
        ? db
            .prepare(
              `SELECT * FROM product_images WHERE deleted_at IS NULL AND product_id IN (${productIds
                .map(() => "?")
                .join(", ")})`
            )
            .all(...productIds)
        : [];
      const imagesMap = new Map<string, any[]>();
      for (const image of images) {
        const list = imagesMap.get(image.product_id) ?? [];
        list.push(image);
        imagesMap.set(image.product_id, list);
      }

      const tagMaps = productIds.length
        ? db
            .prepare(
              `SELECT * FROM product_tag_map WHERE deleted_at IS NULL AND product_id IN (${productIds
                .map(() => "?")
                .join(", ")})`
            )
            .all(...productIds)
        : [];
      const tagIds = tagMaps.map((row: any) => row.tag_id);
      const tags = tagIds.length
        ? db
            .prepare(
              `SELECT * FROM product_tags WHERE deleted_at IS NULL AND tag_id IN (${tagIds
                .map(() => "?")
                .join(", ")})`
            )
            .all(...tagIds)
        : [];
      const tagMap = new Map(tags.map((tag: any) => [tag.tag_id, tag]));
      const productTagMap = new Map<string, any[]>();
      for (const mapping of tagMaps) {
        const list = productTagMap.get(mapping.product_id) ?? [];
        list.push({
          ...mapping,
          tag: tagMap.get(mapping.tag_id) ?? null
        });
        productTagMap.set(mapping.product_id, list);
      }

      return rows.map((row) =>
        mapProductRowFromDb(row, {
          category: categoryMap.get(row.category_id) ?? null,
          images: imagesMap.get(row.product_id) ?? [],
          productTags: productTagMap.get(row.product_id) ?? []
        })
      );
    };

    if (options?.bypassCache) {
      return await fetchProductsFromDb();
    }

    // console.log("new request")
    const cacheKey = resolveProductCacheKey(options);
    const now = Date.now();
    const cached = productCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      // console.log("[productService.findMany] cache hit", { cacheKey, options });
      return cached.data;
    }
    if (cached) {
      productCache.delete(cacheKey);
      // console.log("[productService.findMany] cache expired, removed", { cacheKey });
    }

    const inFlight = productCacheInFlight.get(cacheKey);
    if (inFlight) {
      // console.log("[productService.findMany] awaiting in-flight request", { cacheKey });
      return inFlight;
    }

    const promise = fetchProductsFromDb();

    productCacheInFlight.set(cacheKey, promise);
    return promise.catch((error) => {
      // console.error("[productService.findMany] query failed", { cacheKey, error });
      productCacheInFlight.delete(cacheKey);
      throw error;
    });
  },
  count: async (filters?: ProductFilters) => {
    const db = getLocalDb();
    const rows = db.prepare("SELECT * FROM products WHERE deleted_at IS NULL").all() as any[];
    const filtered = rows.filter((row) => {
      if (filters?.searchTerm) {
        const term = filters.searchTerm.trim().toLowerCase();
        if (
          ![row.name, row.english_name, row.sku, row.barcode, row.brand, row.description]
            .filter(Boolean)
            .some((value: string) => value.toLowerCase().includes(term))
        ) {
          return false;
        }
      }
      if (filters?.code) {
        const code = filters.code.trim();
        if (code && row.barcode !== code && row.sku !== code) {
          return false;
        }
      }
      if (filters?.categoryId && row.category_id !== filters.categoryId) {
        return false;
      }
      if (filters?.stockFilter === "inStock" && Number(row.stock_level) <= 0) {
        return false;
      }
      if (filters?.stockFilter === "outOfStock" && Number(row.stock_level) !== 0) {
        return false;
      }
      if (filters?.minPrice !== undefined && Number(row.price) < filters.minPrice) {
        return false;
      }
      if (filters?.maxPrice !== undefined && Number(row.price) > filters.maxPrice) {
        return false;
      }
      return true;
    });
    return filtered.length;
  },

  create: async (data: {
    sku?: string;
    barcode?: string;
    name: string;
    englishName?: string;
    description?: string;
    brand?: string;
    categoryId: string;
    price: number;
    costPrice?: number;
    discountedPrice?: number;
    wholesale?: number;
    taxInclusivePrice?: number;
    taxRate?: number;
    unitSize?: string;
    unitType?: string;
    unit?: string;
    stockLevel?: number;
  }) => {
    const db = getLocalDb();
    const category = db
      .prepare("SELECT * FROM categories WHERE category_id = ? AND deleted_at IS NULL")
      .get(data.categoryId);
    if (!category) {
      throw new Error(`Category with ID "${data.categoryId}" does not exist`);
    }

    const productId = randomUUID();
    const deviceId = ensureDeviceId();
    const timestamp = nowIso();
    const row = {
      product_id: productId,
      sku: data.sku ?? null,
      barcode: data.barcode ?? null,
      name: data.name,
      english_name: data.englishName ?? null,
      description: data.description ?? null,
      brand: data.brand ?? null,
      category_id: data.categoryId,
      price: data.price,
      cost_price: data.costPrice ?? 0,
      discounted_price: data.discountedPrice ?? null,
      wholesale: data.wholesale ?? null,
      tax_inclusive_price: data.taxInclusivePrice ?? null,
      tax_rate: data.taxRate ?? null,
      unit_size: data.unitSize ?? null,
      unit_type: data.unitType ?? null,
      unit: data.unit ?? null,
      stock_level: data.stockLevel !== undefined ? validateAndFormatQuantity(data.stockLevel) : 0,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        INSERT INTO products (
          product_id,
          sku,
          barcode,
          name,
          english_name,
          description,
          brand,
          category_id,
          price,
          cost_price,
          discounted_price,
          wholesale,
          tax_inclusive_price,
          tax_rate,
          unit_size,
          unit_type,
          unit,
          stock_level,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      row.product_id,
      row.sku,
      row.barcode,
      row.name,
      row.english_name,
      row.description,
      row.brand,
      row.category_id,
      row.price,
      row.cost_price,
      row.discounted_price,
      row.wholesale,
      row.tax_inclusive_price,
      row.tax_rate,
      row.unit_size,
      row.unit_type,
      row.unit,
      row.stock_level,
      row.version,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.last_modified_by_device_id
    );

    enqueueOutbox("products", row.product_id, "insert", row.version, row);
    clearProductCache();

    return mapProductRowFromDb(row, {
      category,
      images: [],
      productTags: []
    });
  },

  update: async (
    id: string,
    data: {
      sku?: string;
      barcode?: string;
      name?: string;
      englishName?: string;
      description?: string;
      brand?: string;
      categoryId?: string;
      price?: number;
      costPrice?: number;
      discountedPrice?: number;
      wholesale?: number;
      taxInclusivePrice?: number;
      taxRate?: number;
      unitSize?: string;
      unitType?: string;
      unit?: string;
      stockLevel?: number;
    }
  ) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM products WHERE product_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Product not found");
    }

    if (data.categoryId) {
      const categoryExists = db
        .prepare("SELECT category_id FROM categories WHERE category_id = ? AND deleted_at IS NULL")
        .get(data.categoryId);
      if (!categoryExists) {
        throw new Error(`Category with ID "${data.categoryId}" does not exist`);
      }
    }

    const deviceId = ensureDeviceId();
    const updatedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const row = {
      ...existing,
      sku: data.sku ?? existing.sku,
      barcode: data.barcode ?? existing.barcode,
      name: data.name ?? existing.name,
      english_name: data.englishName ?? existing.english_name,
      description: data.description ?? existing.description,
      brand: data.brand ?? existing.brand,
      category_id: data.categoryId ?? existing.category_id,
      price: data.price ?? existing.price,
      cost_price: data.costPrice ?? existing.cost_price,
      discounted_price: data.discountedPrice ?? existing.discounted_price,
      wholesale: data.wholesale ?? existing.wholesale,
      tax_inclusive_price: data.taxInclusivePrice ?? existing.tax_inclusive_price,
      tax_rate: data.taxRate ?? existing.tax_rate,
      unit_size: data.unitSize ?? existing.unit_size,
      unit_type: data.unitType ?? existing.unit_type,
      unit: data.unit ?? existing.unit,
      stock_level:
        data.stockLevel !== undefined
          ? validateAndFormatQuantity(data.stockLevel)
          : existing.stock_level,
      version,
      updated_at: updatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE products
        SET sku = ?,
            barcode = ?,
            name = ?,
            english_name = ?,
            description = ?,
            brand = ?,
            category_id = ?,
            price = ?,
            cost_price = ?,
            discounted_price = ?,
            wholesale = ?,
            tax_inclusive_price = ?,
            tax_rate = ?,
            unit_size = ?,
            unit_type = ?,
            unit = ?,
            stock_level = ?,
            version = ?,
            updated_at = ?,
            last_modified_by_device_id = ?
        WHERE product_id = ?
      `
    ).run(
      row.sku,
      row.barcode,
      row.name,
      row.english_name,
      row.description,
      row.brand,
      row.category_id,
      row.price,
      row.cost_price,
      row.discounted_price,
      row.wholesale,
      row.tax_inclusive_price,
      row.tax_rate,
      row.unit_size,
      row.unit_type,
      row.unit,
      row.stock_level,
      row.version,
      row.updated_at,
      row.last_modified_by_device_id,
      id
    );

    enqueueOutbox("products", id, "update", row.version, row);
    clearProductCache();

    const category = db
      .prepare("SELECT * FROM categories WHERE category_id = ? AND deleted_at IS NULL")
      .get(row.category_id);
    const images = db
      .prepare("SELECT * FROM product_images WHERE product_id = ? AND deleted_at IS NULL")
      .all(id);
    const tagMaps = db
      .prepare("SELECT * FROM product_tag_map WHERE product_id = ? AND deleted_at IS NULL")
      .all(id);
    const tagIds = tagMaps.map((tag: any) => tag.tag_id);
    const tags = tagIds.length
      ? db
          .prepare(
            `SELECT * FROM product_tags WHERE deleted_at IS NULL AND tag_id IN (${tagIds
              .map(() => "?")
              .join(", ")})`
          )
          .all(...tagIds)
      : [];
    const tagMap = new Map(tags.map((tag: any) => [tag.tag_id, tag]));

    return mapProductRowFromDb(row, {
      category,
      images,
      productTags: tagMaps.map((mapping: any) => ({
        ...mapping,
        tag: tagMap.get(mapping.tag_id) ?? null
      }))
    });
  },

  delete: async (id: string) => {
    const db = getLocalDb();
    const product = db
      .prepare("SELECT * FROM products WHERE product_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!product) {
      throw new Error("Product not found");
    }

    const salesCount = db
      .prepare(
        "SELECT COUNT(1) AS count FROM sales_details WHERE product_id = ? AND deleted_at IS NULL"
      )
      .get(id);
    if (Number(salesCount?.count ?? 0) > 0) {
      throw new Error(
        "Cannot delete product that has been used in sales transactions. " +
          "This would compromise transaction history integrity."
      );
    }

    const poCount = db
      .prepare(
        "SELECT COUNT(1) AS count FROM purchase_order_items WHERE product_id = ? AND deleted_at IS NULL"
      )
      .get(id);
    if (Number(poCount?.count ?? 0) > 0) {
      throw new Error(
        "Cannot delete product that has been used in purchase orders. " +
          "This would compromise purchase history integrity."
      );
    }

    const deviceId = ensureDeviceId();
    const deletedAt = nowIso();
    const version = Number(product.version ?? 1) + 1;

    const inventoryRows = db
      .prepare("SELECT * FROM inventory WHERE product_id = ? AND deleted_at IS NULL")
      .all(id);
    for (const inventory of inventoryRows) {
      const invVersion = Number(inventory.version ?? 1) + 1;
      const invRow = {
        ...inventory,
        deleted_at: deletedAt,
        version: invVersion,
        updated_at: deletedAt,
        last_modified_by_device_id: deviceId
      };
      db.prepare(
        `
          UPDATE inventory
          SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
          WHERE inventory_id = ?
        `
      ).run(
        invRow.deleted_at,
        invRow.version,
        invRow.updated_at,
        invRow.last_modified_by_device_id,
        invRow.inventory_id
      );
      enqueueOutbox("inventory", invRow.inventory_id, "delete", invRow.version, invRow);
    }

    const stockTransactions = db
      .prepare("SELECT * FROM stock_transactions WHERE product_id = ? AND deleted_at IS NULL")
      .all(id);
    for (const transaction of stockTransactions) {
      const txVersion = Number(transaction.version ?? 1) + 1;
      const txRow = {
        ...transaction,
        deleted_at: deletedAt,
        version: txVersion,
        updated_at: deletedAt,
        last_modified_by_device_id: deviceId
      };
      db.prepare(
        `
          UPDATE stock_transactions
          SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
          WHERE transaction_id = ?
        `
      ).run(
        txRow.deleted_at,
        txRow.version,
        txRow.updated_at,
        txRow.last_modified_by_device_id,
        txRow.transaction_id
      );
      enqueueOutbox("stock_transactions", txRow.transaction_id, "delete", txRow.version, txRow);
    }

    const images = db
      .prepare("SELECT * FROM product_images WHERE product_id = ? AND deleted_at IS NULL")
      .all(id);
    for (const image of images) {
      const imgVersion = Number(image.version ?? 1) + 1;
      const imgRow = {
        ...image,
        deleted_at: deletedAt,
        version: imgVersion,
        updated_at: deletedAt,
        last_modified_by_device_id: deviceId
      };
      db.prepare(
        `
          UPDATE product_images
          SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
          WHERE image_id = ?
        `
      ).run(
        imgRow.deleted_at,
        imgRow.version,
        imgRow.updated_at,
        imgRow.last_modified_by_device_id,
        imgRow.image_id
      );
      enqueueOutbox("product_images", imgRow.image_id, "delete", imgRow.version, imgRow);
    }

    const tagMaps = db
      .prepare("SELECT * FROM product_tag_map WHERE product_id = ? AND deleted_at IS NULL")
      .all(id);
    for (const mapping of tagMaps) {
      const mapVersion = Number(mapping.version ?? 1) + 1;
      const mapRow = {
        ...mapping,
        deleted_at: deletedAt,
        version: mapVersion,
        updated_at: deletedAt,
        last_modified_by_device_id: deviceId
      };
      db.prepare(
        `
          UPDATE product_tag_map
          SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
          WHERE product_id = ? AND tag_id = ?
        `
      ).run(
        mapRow.deleted_at,
        mapRow.version,
        mapRow.updated_at,
        mapRow.last_modified_by_device_id,
        mapRow.product_id,
        mapRow.tag_id
      );
      enqueueOutbox(
        "product_tag_map",
        buildCompositeRowId({ product_id: mapRow.product_id, tag_id: mapRow.tag_id }),
        "delete",
        mapRow.version,
        mapRow
      );
    }

    db.prepare(
      `
        UPDATE products
        SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE product_id = ?
      `
    ).run(deletedAt, version, deletedAt, deviceId, id);

    const payload = {
      ...product,
      deleted_at: deletedAt,
      version,
      updated_at: deletedAt,
      last_modified_by_device_id: deviceId
    };
    enqueueOutbox("products", id, "delete", version, payload);

    clearProductCache();
    return payload;
  }
};

export const employeeService = {
  findMany: async (options?: FindManyOptions) => {
    const db = getLocalDb();
    const selectKeys =
      options?.select && Object.keys(options.select).filter((key) => options.select?.[key]);
    const columns = selectKeys && selectKeys.length > 0 ? selectKeys.join(", ") : "*";

    let sql = `SELECT ${columns} FROM employee WHERE deleted_at IS NULL ORDER BY created_at DESC`;
    const params: Array<string | number> = [];
    if (options?.pagination?.take) {
      sql += " LIMIT ?";
      params.push(options.pagination.take);
    }
    if (options?.pagination?.skip) {
      sql += " OFFSET ?";
      params.push(options.pagination.skip);
    }

    const rows = db.prepare(sql).all(...params);
    if (options?.select) {
      return rows;
    }

    const employeeIds = rows.map((row: any) => row.id);
    const roleRows =
      employeeIds.length > 0
        ? db
            .prepare(
              `SELECT er.employee_id, er.role_id, r.role_id AS roleId, r.name, r.description, r.is_system
               FROM employee_roles er
               JOIN roles r ON r.role_id = er.role_id
               WHERE er.deleted_at IS NULL AND r.deleted_at IS NULL AND er.employee_id IN (${employeeIds
                 .map(() => "?")
                 .join(", ")})`
            )
            .all(...employeeIds)
        : [];

    const roleMap = new Map<string, any[]>();
    for (const row of roleRows) {
      const list = roleMap.get(row.employee_id) ?? [];
      list.push({
        role: {
          id: row.role_id,
          name: row.name,
          description: row.description,
          isSystem: Boolean(row.is_system)
        }
      });
      roleMap.set(row.employee_id, list);
    }

    return rows.map((row: any) => ({
      ...row,
      employeeRoles: roleMap.get(row.id) ?? []
    }));
  },

  create: async (data: {
    employee_id: string;
    name: string;
    role: string; // Keep for backwards compatibility
    email: string;
    address?: string;
    password_hash: string;
  }) => {
    const db = getLocalDb();
    const existing = db.prepare("SELECT * FROM employee WHERE email = ?").get(data.email);
    if (existing) {
      if (!existing.deleted_at) {
        throw new Error(`Employee with email "${data.email}" already exists`);
      }

      const deviceId = ensureDeviceId();
      const updatedAt = nowIso();
      const version = Number(existing.version ?? 1) + 1;
      const row = {
        ...existing,
        employee_id: data.employee_id,
        name: data.name,
        role: data.role,
        address: data.address ?? null,
        password_hash: data.password_hash,
        version,
        updated_at: updatedAt,
        deleted_at: null,
        last_modified_by_device_id: deviceId
      };

      db.prepare(
        `
          UPDATE employee
          SET employee_id = ?, name = ?, role = ?, address = ?, password_hash = ?,
              version = ?, updated_at = ?, deleted_at = ?, last_modified_by_device_id = ?
          WHERE id = ?
        `
      ).run(
        row.employee_id,
        row.name,
        row.role,
        row.address,
        row.password_hash,
        row.version,
        row.updated_at,
        row.deleted_at,
        row.last_modified_by_device_id,
        row.id
      );

      enqueueOutbox("employee", row.id, "update", row.version, row);
      return {
        ...row,
        employeeRoles: []
      };
    }

    const employeeId = randomUUID();
    const deviceId = ensureDeviceId();
    const timestamp = nowIso();
    const row = {
      id: employeeId,
      employee_id: data.employee_id,
      name: data.name,
      role: data.role,
      email: data.email,
      address: data.address ?? null,
      password_hash: data.password_hash,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        INSERT INTO employee (
          id,
          employee_id,
          name,
          role,
          email,
          address,
          password_hash,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      row.id,
      row.employee_id,
      row.name,
      row.role,
      row.email,
      row.address,
      row.password_hash,
      row.version,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.last_modified_by_device_id
    );

    enqueueOutbox("employee", row.id, "insert", row.version, row);

    return {
      ...row,
      employeeRoles: []
    };
  },

  // New method for creating employee with role ID
  createWithRole: async (data: {
    employee_id: string;
    name: string;
    email: string;
    address?: string;
    password_hash: string;
    roleId?: string;
    tenantId?: string;
  }) => {
    const db = getLocalDb();
    const roleRecord = data.roleId
      ? db
          .prepare(
            "SELECT role_id, name, description, is_system FROM roles WHERE role_id = ? AND deleted_at IS NULL"
          )
          .get(data.roleId)
      : null;
    if (data.roleId && !roleRecord) {
      throw new Error(`Role not found for id "${data.roleId}"`);
    }
    const assignedRoleName = roleRecord?.name ?? "";

    const employee = await employeeService.create({
      employee_id: data.employee_id,
      name: data.name,
      role: assignedRoleName,
      email: data.email,
      address: data.address,
      password_hash: data.password_hash
    });

    let employeeRoles: any[] = [];
    if (data.roleId) {
      const existingRole = db
        .prepare("SELECT * FROM employee_roles WHERE employee_id = ? AND role_id = ?")
        .get(employee.id, data.roleId);

      if (existingRole) {
        if (existingRole.deleted_at) {
          const updatedAt = nowIso();
          const version = Number(existingRole.version ?? 1) + 1;
          const row = {
            ...existingRole,
            deleted_at: null,
            version,
            updated_at: updatedAt,
            last_modified_by_device_id: ensureDeviceId()
          };
          db.prepare(
            `
              UPDATE employee_roles
              SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
              WHERE employee_id = ? AND role_id = ?
            `
          ).run(
            row.deleted_at,
            row.version,
            row.updated_at,
            row.last_modified_by_device_id,
            row.employee_id,
            row.role_id
          );
          enqueueOutbox(
            "employee_roles",
            buildCompositeRowId({ employee_id: row.employee_id, role_id: row.role_id }),
            "update",
            row.version,
            row
          );
        }
      } else {
        const timestamp = nowIso();
        const row = {
          employee_id: employee.id,
          role_id: data.roleId,
          assigned_at: timestamp,
          assigned_by: null,
          version: 1,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null,
          last_modified_by_device_id: ensureDeviceId()
        };
        db.prepare(
          `
            INSERT INTO employee_roles (
              employee_id,
              role_id,
              assigned_at,
              assigned_by,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_modified_by_device_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        ).run(
          row.employee_id,
          row.role_id,
          row.assigned_at,
          row.assigned_by,
          row.version,
          row.created_at,
          row.updated_at,
          row.deleted_at,
          row.last_modified_by_device_id
        );

        enqueueOutbox(
          "employee_roles",
          buildCompositeRowId({ employee_id: row.employee_id, role_id: row.role_id }),
          "insert",
          row.version,
          row
        );
      }

      employeeRoles = [
        {
          role: {
            id: roleRecord.role_id,
            name: roleRecord.name,
            description: roleRecord.description,
            isSystem: Boolean(roleRecord.is_system)
          }
        }
      ];
    }

    await upsertTenantUser({
      tenantId: data.tenantId,
      email: data.email,
      passwordHash: data.password_hash
    });

    return {
      ...employee,
      employeeRoles
    };
  },

  update: async (
    id: string,
    data: {
      employee_id?: string;
      name?: string;
      role?: string;
      email?: string;
      address?: string;
      password_hash?: string;
    }
  ) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM employee WHERE id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Employee not found");
    }

    if (data.email) {
      const duplicate = db
        .prepare("SELECT id FROM employee WHERE email = ? AND id != ? AND deleted_at IS NULL")
        .get(data.email, id);
      if (duplicate) {
        throw new Error(`Employee with email "${data.email}" already exists`);
      }
    }

    const deviceId = ensureDeviceId();
    const updatedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const row = {
      ...existing,
      employee_id: data.employee_id ?? existing.employee_id,
      name: data.name ?? existing.name,
      role: data.role ?? existing.role,
      email: data.email ?? existing.email,
      address: data.address ?? existing.address,
      password_hash: data.password_hash ?? existing.password_hash,
      version,
      updated_at: updatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE employee
        SET employee_id = ?,
            name = ?,
            role = ?,
            email = ?,
            address = ?,
            password_hash = ?,
            version = ?,
            updated_at = ?,
            last_modified_by_device_id = ?
        WHERE id = ?
      `
    ).run(
      row.employee_id,
      row.name,
      row.role,
      row.email,
      row.address,
      row.password_hash,
      row.version,
      row.updated_at,
      row.last_modified_by_device_id,
      id
    );

    enqueueOutbox("employee", id, "update", row.version, row);

    const roleRows = db
      .prepare(
        `SELECT er.employee_id, er.role_id, r.name, r.description, r.is_system
         FROM employee_roles er
         JOIN roles r ON r.role_id = er.role_id
         WHERE er.deleted_at IS NULL AND r.deleted_at IS NULL AND er.employee_id = ?`
      )
      .all(id);

    return {
      ...row,
      employeeRoles: roleRows.map((row: any) => ({
        role: {
          id: row.role_id,
          name: row.name,
          description: row.description,
          isSystem: Boolean(row.is_system)
        }
      }))
    };
  },

  // New method for updating employee with role ID
  updateWithRole: async (
    id: string,
    data: {
      employee_id?: string;
      name?: string;
      email?: string;
      address?: string;
      password_hash?: string;
      roleId?: string | null;
      tenantId?: string;
      previousEmail?: string;
    }
  ) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM employee WHERE id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Employee not found");
    }

    if (data.email) {
      const duplicate = db
        .prepare("SELECT id FROM employee WHERE email = ? AND id != ? AND deleted_at IS NULL")
        .get(data.email, id);
      if (duplicate) {
        throw new Error(`Employee with email "${data.email}" already exists`);
      }
    }

    let assignedRoleName = existing.role;
    if (data.roleId !== undefined) {
      if (data.roleId) {
        const roleRecord = db
          .prepare("SELECT name FROM roles WHERE role_id = ? AND deleted_at IS NULL")
          .get(data.roleId);
        if (!roleRecord) {
          throw new Error(`Role not found for id "${data.roleId}"`);
        }
        assignedRoleName = roleRecord.name ?? "";
      } else {
        assignedRoleName = "";
      }
    }

    const deviceId = ensureDeviceId();
    const updatedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const row = {
      ...existing,
      employee_id: data.employee_id ?? existing.employee_id,
      name: data.name ?? existing.name,
      role: assignedRoleName,
      email: data.email ?? existing.email,
      address: data.address ?? existing.address,
      password_hash: data.password_hash ?? existing.password_hash,
      version,
      updated_at: updatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE employee
        SET employee_id = ?, name = ?, role = ?, email = ?, address = ?, password_hash = ?,
            version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE id = ?
      `
    ).run(
      row.employee_id,
      row.name,
      row.role,
      row.email,
      row.address,
      row.password_hash,
      row.version,
      row.updated_at,
      row.last_modified_by_device_id,
      id
    );

    enqueueOutbox("employee", id, "update", row.version, row);

    if (data.roleId !== undefined) {
      const existingRoles = db
        .prepare("SELECT * FROM employee_roles WHERE employee_id = ? AND deleted_at IS NULL")
        .all(id);
      for (const roleRow of existingRoles) {
        const deletedAt = nowIso();
        const roleVersion = Number(roleRow.version ?? 1) + 1;
        db.prepare(
          `
            UPDATE employee_roles
            SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
            WHERE employee_id = ? AND role_id = ?
          `
        ).run(deletedAt, roleVersion, deletedAt, deviceId, roleRow.employee_id, roleRow.role_id);

        const payload = {
          ...roleRow,
          deleted_at: deletedAt,
          version: roleVersion,
          updated_at: deletedAt,
          last_modified_by_device_id: deviceId
        };
        enqueueOutbox(
          "employee_roles",
          buildCompositeRowId({ employee_id: roleRow.employee_id, role_id: roleRow.role_id }),
          "delete",
          roleVersion,
          payload
        );
      }

      if (data.roleId) {
        const existingRole = db
          .prepare("SELECT * FROM employee_roles WHERE employee_id = ? AND role_id = ?")
          .get(id, data.roleId);

        if (existingRole) {
          const updatedAt = nowIso();
          const roleVersion = Number(existingRole.version ?? 1) + 1;
          const payload = {
            ...existingRole,
            deleted_at: null,
            version: roleVersion,
            updated_at: updatedAt,
            last_modified_by_device_id: deviceId
          };
          db.prepare(
            `
              UPDATE employee_roles
              SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
              WHERE employee_id = ? AND role_id = ?
            `
          ).run(
            payload.deleted_at,
            payload.version,
            payload.updated_at,
            payload.last_modified_by_device_id,
            payload.employee_id,
            payload.role_id
          );

          enqueueOutbox(
            "employee_roles",
            buildCompositeRowId({ employee_id: payload.employee_id, role_id: payload.role_id }),
            "update",
            payload.version,
            payload
          );
        } else {
          const timestamp = nowIso();
          const roleInsert = {
            employee_id: id,
            role_id: data.roleId,
            assigned_at: timestamp,
            assigned_by: null,
            version: 1,
            created_at: timestamp,
            updated_at: timestamp,
            deleted_at: null,
            last_modified_by_device_id: deviceId
          };
          db.prepare(
            `
              INSERT INTO employee_roles (
                employee_id,
                role_id,
                assigned_at,
                assigned_by,
                version,
                created_at,
                updated_at,
                deleted_at,
                last_modified_by_device_id
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
          ).run(
            roleInsert.employee_id,
            roleInsert.role_id,
            roleInsert.assigned_at,
            roleInsert.assigned_by,
            roleInsert.version,
            roleInsert.created_at,
            roleInsert.updated_at,
            roleInsert.deleted_at,
            roleInsert.last_modified_by_device_id
          );

          enqueueOutbox(
            "employee_roles",
            buildCompositeRowId({
              employee_id: roleInsert.employee_id,
              role_id: roleInsert.role_id
            }),
            "insert",
            roleInsert.version,
            roleInsert
          );
        }
      }
    }

    await upsertTenantUser({
      tenantId: data.tenantId,
      email: data.email,
      passwordHash: data.password_hash ?? existing.password_hash,
      previousEmail: data.previousEmail
    });

    const roles = db
      .prepare(
        `
          SELECT er.employee_id, er.role_id, r.name, r.description, r.is_system
          FROM employee_roles er
          JOIN roles r ON r.role_id = er.role_id
          WHERE er.employee_id = ? AND er.deleted_at IS NULL AND r.deleted_at IS NULL
        `
      )
      .all(id);

    return {
      ...row,
      employeeRoles: roles.map((role: any) => ({
        role: {
          id: role.role_id,
          name: role.name,
          description: role.description,
          isSystem: Boolean(role.is_system)
        }
      }))
    };
  },

  // Assign role to employee
  assignRole: async (employeeId: string, roleId: string) => {
    return await employeeService.updateWithRole(employeeId, { roleId });
  },

  // Remove role from employee
  removeRole: async (employeeId: string, roleId: string) => {
    const updated = await employeeService.updateWithRole(employeeId, { roleId: null });
    const deleted = {
      employeeId,
      roleId
    };
    return {
      ...deleted,
      employee: updated,
      role: updated.employeeRoles?.[0]?.role ?? null
    };
  },

  // Get employee's role
  getEmployeeRole: async (employeeId: string) => {
    const db = getLocalDb();
    const role = db
      .prepare(
        `
          SELECT r.role_id, r.name, r.description, r.is_system
          FROM employee_roles er
          JOIN roles r ON r.role_id = er.role_id
          WHERE er.employee_id = ? AND er.deleted_at IS NULL AND r.deleted_at IS NULL
          LIMIT 1
        `
      )
      .get(employeeId);
    if (!role) {
      return null;
    }
    return {
      id: role.role_id,
      name: role.name,
      description: role.description,
      isSystem: Boolean(role.is_system)
    };
  },

  delete: async (id: string) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM employee WHERE id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Employee not found");
    }

    const deletedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const deviceId = ensureDeviceId();
    db.prepare(
      `
        UPDATE employee
        SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE id = ?
      `
    ).run(deletedAt, version, deletedAt, deviceId, id);

    const payload = {
      ...existing,
      deleted_at: deletedAt,
      version,
      updated_at: deletedAt,
      last_modified_by_device_id: deviceId
    };
    enqueueOutbox("employee", id, "delete", version, payload);

    return payload;
  },

  findByEmail: async (email: string) => {
    const db = getLocalDb();
    return db.prepare("SELECT * FROM employee WHERE email = ? AND deleted_at IS NULL").get(email);
  },

  findByEmailOnline: async (email: string, schemaName: string) => {
    const normalizedSchema = schemaName?.trim();
    if (!normalizedSchema) {
      throw new Error("Missing schemaName for online lookup");
    }

    const prisma = getTenantPrismaClient(normalizedSchema);
    const rows = (await prisma.$queryRawUnsafe(
      `
        SELECT *
        FROM employee
        WHERE email = $1
          AND deleted_at IS NULL
        LIMIT 1
      `,
      email
    )) as any[];

    return rows[0] ?? null;
  },

  findByEmployeeId: async (employee_id: string) => {
    const db = getLocalDb();
    return db
      .prepare("SELECT * FROM employee WHERE employee_id = ? AND deleted_at IS NULL")
      .get(employee_id);
  },

  verifyPassword: async (password: string, hash: string): Promise<boolean> => {
    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      console.error("Error verifying password:", error);
      return false;
    }
  },

  hashPassword: async (password: string): Promise<string> => {
    try {
      const saltRounds = 12;
      return await bcrypt.hash(password, saltRounds);
    } catch (error) {
      console.error("Error hashing password:", error);
      throw new Error("Failed to hash password");
    }
  }
};

export const credentialCacheService = {
  findByEmail: async (email: string) => {
    const db = getLocalDb();
    return (
      db.prepare("SELECT * FROM credential_cache WHERE LOWER(email) = LOWER(?)").get(email) ?? null
    );
  },

  upsert: async (data: {
    userId: string;
    email: string;
    passwordHash: string;
    roles?: string | null;
    lastVerifiedAt: string;
    expiresAt: string;
  }) => {
    const db = getLocalDb();
    const normalizedEmail = data.email.trim().toLowerCase();
    const existingByUserId = db
      .prepare("SELECT user_id FROM credential_cache WHERE user_id = ?")
      .get(data.userId);
    if (existingByUserId) {
      db.prepare(
        `
          UPDATE credential_cache
          SET email = ?, password_hash = ?, roles = ?, last_verified_at = ?, expires_at = ?, failed_attempts = 0
          WHERE user_id = ?
        `
      ).run(
        normalizedEmail,
        data.passwordHash,
        data.roles ?? null,
        data.lastVerifiedAt,
        data.expiresAt,
        data.userId
      );
      return;
    }

    const existingByEmail = db
      .prepare("SELECT user_id FROM credential_cache WHERE LOWER(email) = LOWER(?)")
      .get(normalizedEmail);
    if (existingByEmail) {
      db.prepare(
        `
          UPDATE credential_cache
          SET user_id = ?, password_hash = ?, roles = ?, last_verified_at = ?, expires_at = ?, failed_attempts = 0
          WHERE LOWER(email) = LOWER(?)
        `
      ).run(
        data.userId,
        data.passwordHash,
        data.roles ?? null,
        data.lastVerifiedAt,
        data.expiresAt,
        normalizedEmail
      );
      return;
    }

    db.prepare(
      `
        INSERT INTO credential_cache (
          user_id,
          email,
          password_hash,
          roles,
          last_verified_at,
          expires_at,
          failed_attempts
        )
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `
    ).run(
      data.userId,
      normalizedEmail,
      data.passwordHash,
      data.roles ?? null,
      data.lastVerifiedAt,
      data.expiresAt
    );
  },

  recordFailedAttempt: async (email: string) => {
    const db = getLocalDb();
    db.prepare(
      `
        UPDATE credential_cache
        SET failed_attempts = failed_attempts + 1
        WHERE LOWER(email) = LOWER(?)
      `
    ).run(email);
  },

  resetFailedAttempts: async (email: string) => {
    const db = getLocalDb();
    db.prepare(
      `
        UPDATE credential_cache
        SET failed_attempts = 0
        WHERE LOWER(email) = LOWER(?)
      `
    ).run(email);
  },

  deleteByEmail: async (email: string) => {
    const db = getLocalDb();
    db.prepare("DELETE FROM credential_cache WHERE LOWER(email) = LOWER(?)").run(email);
  }
};

export const localMetaService = {
  get: async (key: string): Promise<string | null> => {
    // console.log(key, "key");
    const db = getLocalDb();
    const row = db.prepare("SELECT value FROM local_meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    // console.log(row);
    return row?.value ?? null;
  },

  set: async (key: string, value: string): Promise<void> => {
    const db = getLocalDb();
    db.prepare(
      `
        INSERT INTO local_meta (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `
    ).run(key, value);
  },

  delete: async (key: string): Promise<void> => {
    const db = getLocalDb();
    db.prepare("DELETE FROM local_meta WHERE key = ?").run(key);
  }
};

export const salesInvoiceService = {
  getFiltered: async (
    filters?: {
      dateFrom?: string;
      dateTo?: string;
      employeeId?: string;
      customerId?: string;
      paymentMode?: string;
    },
    options?: FindManyOptions
  ) => {
    const db = getLocalDb();
    let rows = db
      .prepare("SELECT * FROM sales_invoices WHERE deleted_at IS NULL ORDER BY date DESC")
      .all() as any[];

    if (filters?.dateFrom || filters?.dateTo) {
      const from = filters?.dateFrom ? new Date(filters.dateFrom + "T00:00:00") : null;
      const to = filters?.dateTo ? new Date(filters.dateTo + "T23:59:59.999") : null;
      rows = rows.filter((row) => {
        const date = new Date(row.date);
        if (from && date < from) return false;
        if (to && date > to) return false;
        return true;
      });
    }

    if (filters?.employeeId && filters.employeeId !== "all") {
      rows = rows.filter((row) => row.employee_id === filters.employeeId);
    }

    if (filters?.customerId && filters.customerId !== "all") {
      rows = rows.filter((row) => row.customer_id === filters.customerId);
    }

    if (filters?.paymentMode && filters.paymentMode !== "all") {
      rows = rows.filter((row) => row.payment_mode === filters.paymentMode);
    }

    if (options?.pagination?.skip) {
      rows = rows.slice(options.pagination.skip);
    }
    if (options?.pagination?.take) {
      rows = rows.slice(0, options.pagination.take);
    }

    if (options?.select) {
      const selectKeys = Object.keys(options.select).filter((key) => options.select?.[key]);
      return rows.map((row) => {
        const selected: Record<string, any> = {};
        for (const key of selectKeys) {
          selected[key] = row[key];
        }
        return selected;
      });
    }

    const customerIds = rows.map((row) => row.customer_id).filter(Boolean);
    const employeeIds = rows.map((row) => row.employee_id).filter(Boolean);
    const customers = customerIds.length
      ? (db
          .prepare(
            `SELECT * FROM customers WHERE customer_id IN (${customerIds.map(() => "?").join(", ")}) AND deleted_at IS NULL`
          )
          .all(...customerIds) as any[])
      : ([] as any[]);
    const employees = employeeIds.length
      ? (db
          .prepare(
            `SELECT * FROM employee WHERE id IN (${employeeIds.map(() => "?").join(", ")}) AND deleted_at IS NULL`
          )
          .all(...employeeIds) as any[])
      : ([] as any[]);
    const customerMap = new Map<string, any>(customers.map((row: any) => [row.customer_id, row]));
    const employeeMap = new Map<string, any>(employees.map((row: any) => [row.id, row]));

    const invoiceIds = rows.map((row) => row.invoice_id);
    const payments = invoiceIds.length
      ? db
          .prepare(
            `SELECT * FROM payments WHERE invoice_id IN (${invoiceIds.map(() => "?").join(", ")}) AND deleted_at IS NULL ORDER BY created_at DESC`
          )
          .all(...invoiceIds)
      : [];
    const paymentMap = new Map();
    for (const payment of payments) {
      const list = paymentMap.get(payment.invoice_id) ?? [];
      list.push(payment);
      paymentMap.set(payment.invoice_id, list);
    }

    const salesDetails = invoiceIds.length
      ? db
          .prepare(
            `SELECT * FROM sales_details WHERE invoice_id IN (${invoiceIds.map(() => "?").join(", ")}) AND deleted_at IS NULL`
          )
          .all(...invoiceIds)
      : [];
    const detailMap = new Map();
    for (const detail of salesDetails) {
      const list = detailMap.get(detail.invoice_id) ?? [];
      list.push(detail);
      detailMap.set(detail.invoice_id, list);
    }

    const productIds = salesDetails.map((row) => row.product_id).filter(Boolean);
    const products = productIds.length
      ? (db
          .prepare(
            `SELECT * FROM products WHERE product_id IN (${productIds.map(() => "?").join(", ")}) AND deleted_at IS NULL`
          )
          .all(...productIds) as any[])
      : ([] as any[]);
    const categories = db
      .prepare("SELECT * FROM categories WHERE deleted_at IS NULL")
      .all() as any[];
    const productMap = new Map<string, any>(products.map((row: any) => [row.product_id, row]));
    const categoryMap = new Map<string, any>(categories.map((row: any) => [row.category_id, row]));

    const customProductIds = salesDetails.map((row) => row.custom_product_id).filter(Boolean);
    const customProducts = customProductIds.length
      ? (db
          .prepare(
            `SELECT * FROM custom_products WHERE custom_product_id IN (${customProductIds.map(() => "?").join(", ")}) AND deleted_at IS NULL`
          )
          .all(...customProductIds) as any[])
      : ([] as any[]);
    const customProductMap = new Map<string, any>(
      customProducts.map((row: any) => [row.custom_product_id, row])
    );

    return rows.map((invoice) => {
      const paymentsForInvoice = paymentMap.get(invoice.invoice_id) ?? [];
      const totalPaid = paymentsForInvoice.reduce(
        (sum: number, payment: any) => sum + Number(payment.amount),
        0
      );
      const outstandingBalance = Number(invoice.total_amount) - totalPaid;
      let paymentStatus = "paid";
      if (outstandingBalance > 0) {
        paymentStatus = totalPaid > 0 ? "partial" : "unpaid";
      }

      const invoiceRow = {
        ...invoice,
        outstanding_balance: outstandingBalance,
        payment_status: paymentStatus
      };

      return mapSalesInvoiceRowFromDb(invoiceRow, {
        customer: invoice.customer_id
          ? mapCustomerRowFromDb(customerMap.get(invoice.customer_id))
          : null,
        employee: invoice.employee_id
          ? mapEmployeeRowFromDb(employeeMap.get(invoice.employee_id))
          : null,
        payments: paymentsForInvoice.map((payment: any) =>
          mapPaymentRowFromDb({
            ...payment,
            employee: payment.employee_id
              ? mapEmployeeRowFromDb(employeeMap.get(payment.employee_id))
              : null
          })
        ),
        salesDetails: (detailMap.get(invoice.invoice_id) ?? []).map((detail: any) =>
          mapSalesDetailRowFromDb(detail, {
            product: detail.product_id
              ? mapProductRowFromDb(
                  {
                    ...productMap.get(detail.product_id),
                    category:
                      categoryMap.get(productMap.get(detail.product_id)?.category_id) ?? null
                  },
                  {
                    category:
                      categoryMap.get(productMap.get(detail.product_id)?.category_id) ?? null
                  }
                )
              : null,
            customProduct: detail.custom_product_id
              ? (customProductMap.get(detail.custom_product_id) ?? null)
              : null
          })
        )
      });
    });
  },

  findById: async (id: string) => {
    const rows = await salesInvoiceService.getFiltered(undefined, undefined);
    return (rows as any[]).find((row) => row.invoice_id === id) ?? null;
  },

  create: async (data: {
    customerId?: string;
    employeeId: string;
    subTotal: number;
    totalAmount: number;
    paymentMode: string;
    taxAmount?: number;
    discountAmount?: number;
    amountReceived: number;
    outstandingBalance?: number;
    paymentStatus?: string;
    salesDetails: Array<{
      productId?: string;
      customProductId?: string;
      quantity: number;
      unitPrice: number;
      taxRate?: number;
      originalPrice: number;
      unit?: string;
    }>;
  }) => {
    const db = getLocalDb();
    const deviceId = ensureDeviceId();

    let validEmployeeId = data.employeeId;
    const employeeExists = db
      .prepare("SELECT id FROM employee WHERE id = ? AND deleted_at IS NULL")
      .get(data.employeeId);

    if (!employeeExists) {
      const defaultAdmin = db
        .prepare("SELECT id FROM employee WHERE employee_id = 'ADMIN001' AND deleted_at IS NULL")
        .get();
      if (defaultAdmin) {
        validEmployeeId = defaultAdmin.id;
      } else {
        const anyEmployee = db
          .prepare("SELECT id FROM employee WHERE deleted_at IS NULL LIMIT 1")
          .get();
        if (anyEmployee) {
          validEmployeeId = anyEmployee.id;
        } else {
          throw new Error("No employees found in the system. Please create an employee first.");
        }
      }
    }

    if (data.customerId) {
      const customerExists = db
        .prepare("SELECT customer_id FROM customers WHERE customer_id = ? AND deleted_at IS NULL")
        .get(data.customerId);
      if (!customerExists) {
        data.customerId = undefined;
      }
    }

    const maxRow = db
      .prepare(
        `
          SELECT MAX(CAST(SUBSTR(invoice_id, 5) AS INTEGER)) AS max_id
          FROM sales_invoices
          WHERE invoice_id LIKE 'INV-%'
        `
      )
      .get() as { max_id?: number };
    const nextInvoiceNumber = Number(maxRow?.max_id ?? 999) + 1;
    const invoiceNumber = `INV-${nextInvoiceNumber}`;
    const timestamp = nowIso();
    const invoiceRow = {
      invoice_id: invoiceNumber,
      date: timestamp,
      customer_id: data.customerId ?? null,
      employee_id: validEmployeeId,
      sub_total: data.subTotal,
      total_amount: data.totalAmount,
      payment_mode: data.paymentMode,
      tax_amount: data.taxAmount ?? 0,
      discount_amount: data.discountAmount ?? 0,
      amount_received: data.amountReceived,
      outstanding_balance: data.outstandingBalance ?? 0,
      payment_status: data.paymentStatus ?? "paid",
      refund_invoice_id: null,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        INSERT INTO sales_invoices (
          invoice_id,
          date,
          customer_id,
          employee_id,
          sub_total,
          total_amount,
          payment_mode,
          tax_amount,
          discount_amount,
          amount_received,
          outstanding_balance,
          payment_status,
          refund_invoice_id,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      invoiceRow.invoice_id,
      invoiceRow.date,
      invoiceRow.customer_id,
      invoiceRow.employee_id,
      invoiceRow.sub_total,
      invoiceRow.total_amount,
      invoiceRow.payment_mode,
      invoiceRow.tax_amount,
      invoiceRow.discount_amount,
      invoiceRow.amount_received,
      invoiceRow.outstanding_balance,
      invoiceRow.payment_status,
      invoiceRow.refund_invoice_id,
      invoiceRow.version,
      invoiceRow.created_at,
      invoiceRow.updated_at,
      invoiceRow.deleted_at,
      invoiceRow.last_modified_by_device_id
    );

    enqueueOutbox(
      "sales_invoices",
      invoiceRow.invoice_id,
      "insert",
      invoiceRow.version,
      invoiceRow
    );

    const productIds = Array.from(
      new Set(
        data.salesDetails
          .filter((detail) => detail.productId)
          .map((detail) => detail.productId as string)
      )
    );

    const productRows = productIds.length
      ? (db
          .prepare(
            `SELECT * FROM products WHERE product_id IN (${productIds.map(() => "?").join(", ")}) AND deleted_at IS NULL`
          )
          .all(...productIds) as any[])
      : ([] as any[]);
    const productMap = new Map<string, any>(productRows.map((row: any) => [row.product_id, row]));

    for (const detail of data.salesDetails) {
      const detailId = randomUUID();
      const detailQuantity = validateAndFormatQuantity(detail.quantity);
      const productRow = detail.productId ? productMap.get(detail.productId) : null;
      const costPrice = productRow?.cost_price ?? 0;

      const detailRow = {
        sales_detail_id: detailId,
        invoice_id: invoiceRow.invoice_id,
        product_id: detail.productId ?? null,
        custom_product_id: detail.customProductId ?? null,
        unit: detail.unit ?? "pcs",
        original_price: detail.originalPrice,
        cost_price: costPrice,
        quantity: detailQuantity,
        unit_price: detail.unitPrice,
        tax_rate: detail.taxRate ?? 0,
        version: 1,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        last_modified_by_device_id: deviceId
      };

      db.prepare(
        `
          INSERT INTO sales_details (
            sales_detail_id,
            invoice_id,
            product_id,
            custom_product_id,
            unit,
            original_price,
            cost_price,
            quantity,
            unit_price,
            tax_rate,
            version,
            created_at,
            updated_at,
            deleted_at,
            last_modified_by_device_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        detailRow.sales_detail_id,
        detailRow.invoice_id,
        detailRow.product_id,
        detailRow.custom_product_id,
        detailRow.unit,
        detailRow.original_price,
        detailRow.cost_price,
        detailRow.quantity,
        detailRow.unit_price,
        detailRow.tax_rate,
        detailRow.version,
        detailRow.created_at,
        detailRow.updated_at,
        detailRow.deleted_at,
        detailRow.last_modified_by_device_id
      );

      enqueueOutbox(
        "sales_details",
        detailRow.sales_detail_id,
        "insert",
        detailRow.version,
        detailRow
      );

      if (!detail.productId) {
        continue;
      }

      const inventory = db
        .prepare("SELECT * FROM inventory WHERE product_id = ? AND deleted_at IS NULL")
        .get(detail.productId);

      if (inventory) {
        const newQuantity = Number(inventory.quantity) - detailQuantity;
        const invUpdatedAt = nowIso();
        const invVersion = Number(inventory.version ?? 1) + 1;
        const invRow = {
          ...inventory,
          quantity: newQuantity,
          version: invVersion,
          updated_at: invUpdatedAt,
          last_modified_by_device_id: deviceId
        };
        db.prepare(
          `
            UPDATE inventory
            SET quantity = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
            WHERE inventory_id = ?
          `
        ).run(
          invRow.quantity,
          invRow.version,
          invRow.updated_at,
          invRow.last_modified_by_device_id,
          invRow.inventory_id
        );
        enqueueOutbox("inventory", invRow.inventory_id, "update", invRow.version, invRow);
        updateLocalProductStockLevel(detail.productId, invRow.quantity);
      } else {
        const invRow = {
          inventory_id: randomUUID(),
          product_id: detail.productId,
          quantity: Math.max(0, -detailQuantity),
          reorder_level: 5,
          batch_number: null,
          expiry_date: null,
          version: 1,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null,
          last_modified_by_device_id: deviceId
        };
        db.prepare(
          `
            INSERT INTO inventory (
              inventory_id,
              product_id,
              quantity,
              reorder_level,
              batch_number,
              expiry_date,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_modified_by_device_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        ).run(
          invRow.inventory_id,
          invRow.product_id,
          invRow.quantity,
          invRow.reorder_level,
          invRow.batch_number,
          invRow.expiry_date,
          invRow.version,
          invRow.created_at,
          invRow.updated_at,
          invRow.deleted_at,
          invRow.last_modified_by_device_id
        );
        enqueueOutbox("inventory", invRow.inventory_id, "insert", invRow.version, invRow);
        updateLocalProductStockLevel(detail.productId, invRow.quantity);
      }

      const txRow = {
        transaction_id: randomUUID(),
        product_id: detail.productId,
        type: "OUT",
        change_qty: -detailQuantity,
        reason: "Sale",
        transaction_date: timestamp,
        related_invoice_id: invoiceRow.invoice_id,
        version: 1,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        last_modified_by_device_id: deviceId
      };

      db.prepare(
        `
          INSERT INTO stock_transactions (
            transaction_id,
            product_id,
            type,
            change_qty,
            reason,
            transaction_date,
            related_invoice_id,
            version,
            created_at,
            updated_at,
            deleted_at,
            last_modified_by_device_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        txRow.transaction_id,
        txRow.product_id,
        txRow.type,
        txRow.change_qty,
        txRow.reason,
        txRow.transaction_date,
        txRow.related_invoice_id,
        txRow.version,
        txRow.created_at,
        txRow.updated_at,
        txRow.deleted_at,
        txRow.last_modified_by_device_id
      );

      enqueueOutbox("stock_transactions", txRow.transaction_id, "insert", txRow.version, txRow);
    }

    if (data.customerId) {
      const customer = db
        .prepare("SELECT * FROM customers WHERE customer_id = ? AND deleted_at IS NULL")
        .get(data.customerId);
      if (customer) {
        const pointsToAdd = Math.floor(data.totalAmount / 10);
        const updatedAt = nowIso();
        const version = Number(customer.version ?? 1) + 1;
        const customerRow = {
          ...customer,
          loyalty_points: Number(customer.loyalty_points) + pointsToAdd,
          version,
          updated_at: updatedAt,
          last_modified_by_device_id: deviceId
        };
        db.prepare(
          `
            UPDATE customers
            SET loyalty_points = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
            WHERE customer_id = ?
          `
        ).run(
          customerRow.loyalty_points,
          customerRow.version,
          customerRow.updated_at,
          customerRow.last_modified_by_device_id,
          customerRow.customer_id
        );
        enqueueOutbox(
          "customers",
          customerRow.customer_id,
          "update",
          customerRow.version,
          customerRow
        );

        const ctRow = {
          customer_id: data.customerId,
          invoice_id: invoiceRow.invoice_id,
          points_earned: pointsToAdd,
          points_redeemed: 0,
          version: 1,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null,
          last_modified_by_device_id: deviceId
        };
        db.prepare(
          `
            INSERT INTO customer_transactions (
              customer_id,
              invoice_id,
              points_earned,
              points_redeemed,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_modified_by_device_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        ).run(
          ctRow.customer_id,
          ctRow.invoice_id,
          ctRow.points_earned,
          ctRow.points_redeemed,
          ctRow.version,
          ctRow.created_at,
          ctRow.updated_at,
          ctRow.deleted_at,
          ctRow.last_modified_by_device_id
        );
        enqueueOutbox(
          "customer_transactions",
          buildCompositeRowId({ customer_id: ctRow.customer_id, invoice_id: ctRow.invoice_id }),
          "insert",
          ctRow.version,
          ctRow
        );
      }
    }

    return await salesInvoiceService.findById(invoiceRow.invoice_id);
  },

  delete: async (id: string) => {
    const db = getLocalDb();
    const invoice = db
      .prepare("SELECT * FROM sales_invoices WHERE invoice_id = ? AND deleted_at IS NULL")
      .get(id);

    if (!invoice) {
      throw new Error("Invoice not found");
    }

    const deviceId = ensureDeviceId();
    const details = db
      .prepare("SELECT * FROM sales_details WHERE invoice_id = ? AND deleted_at IS NULL")
      .all(id);

    for (const detail of details) {
      if (detail.product_id) {
        const inventory = db
          .prepare("SELECT * FROM inventory WHERE product_id = ? AND deleted_at IS NULL")
          .get(detail.product_id);
        if (inventory) {
          const newQuantity = Number(inventory.quantity) + Number(detail.quantity);
          const updatedAt = nowIso();
          const version = Number(inventory.version ?? 1) + 1;
          const invRow = {
            ...inventory,
            quantity: newQuantity,
            version,
            updated_at: updatedAt,
            last_modified_by_device_id: deviceId
          };
          db.prepare(
            `
              UPDATE inventory
              SET quantity = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
              WHERE inventory_id = ?
            `
          ).run(
            invRow.quantity,
            invRow.version,
            invRow.updated_at,
            invRow.last_modified_by_device_id,
            invRow.inventory_id
          );
          enqueueOutbox("inventory", invRow.inventory_id, "update", invRow.version, invRow);
          updateLocalProductStockLevel(detail.product_id, invRow.quantity);
        }

        const txRow = {
          transaction_id: randomUUID(),
          product_id: detail.product_id,
          type: "IN",
          change_qty: Number(detail.quantity),
          reason: "Invoice Deletion",
          transaction_date: nowIso(),
          related_invoice_id: invoice.invoice_id,
          version: 1,
          created_at: nowIso(),
          updated_at: nowIso(),
          deleted_at: null,
          last_modified_by_device_id: deviceId
        };
        db.prepare(
          `
            INSERT INTO stock_transactions (
              transaction_id,
              product_id,
              type,
              change_qty,
              reason,
              transaction_date,
              related_invoice_id,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_modified_by_device_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        ).run(
          txRow.transaction_id,
          txRow.product_id,
          txRow.type,
          txRow.change_qty,
          txRow.reason,
          txRow.transaction_date,
          txRow.related_invoice_id,
          txRow.version,
          txRow.created_at,
          txRow.updated_at,
          txRow.deleted_at,
          txRow.last_modified_by_device_id
        );
        enqueueOutbox("stock_transactions", txRow.transaction_id, "insert", txRow.version, txRow);
      }

      const detailDeletedAt = nowIso();
      const detailVersion = Number(detail.version ?? 1) + 1;
      const detailRow = {
        ...detail,
        deleted_at: detailDeletedAt,
        version: detailVersion,
        updated_at: detailDeletedAt,
        last_modified_by_device_id: deviceId
      };
      db.prepare(
        `
          UPDATE sales_details
          SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
          WHERE sales_detail_id = ?
        `
      ).run(
        detailRow.deleted_at,
        detailRow.version,
        detailRow.updated_at,
        detailRow.last_modified_by_device_id,
        detailRow.sales_detail_id
      );
      enqueueOutbox(
        "sales_details",
        detailRow.sales_detail_id,
        "delete",
        detailRow.version,
        detailRow
      );
    }

    const customerTransactions = db
      .prepare("SELECT * FROM customer_transactions WHERE invoice_id = ? AND deleted_at IS NULL")
      .all(id);
    for (const ct of customerTransactions) {
      const ctDeletedAt = nowIso();
      const ctVersion = Number(ct.version ?? 1) + 1;
      const ctRow = {
        ...ct,
        deleted_at: ctDeletedAt,
        version: ctVersion,
        updated_at: ctDeletedAt,
        last_modified_by_device_id: deviceId
      };
      db.prepare(
        `
          UPDATE customer_transactions
          SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
          WHERE customer_id = ? AND invoice_id = ?
        `
      ).run(
        ctRow.deleted_at,
        ctRow.version,
        ctRow.updated_at,
        ctRow.last_modified_by_device_id,
        ctRow.customer_id,
        ctRow.invoice_id
      );
      enqueueOutbox(
        "customer_transactions",
        buildCompositeRowId({ customer_id: ctRow.customer_id, invoice_id: ctRow.invoice_id }),
        "delete",
        ctRow.version,
        ctRow
      );
    }

    const payments = db
      .prepare("SELECT * FROM payments WHERE invoice_id = ? AND deleted_at IS NULL")
      .all(id);
    for (const payment of payments) {
      const deletedAt = nowIso();
      const version = Number(payment.version ?? 1) + 1;
      const row = {
        ...payment,
        deleted_at: deletedAt,
        version,
        updated_at: deletedAt,
        last_modified_by_device_id: deviceId
      };
      db.prepare(
        `
          UPDATE payments
          SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
          WHERE payment_id = ?
        `
      ).run(
        row.deleted_at,
        row.version,
        row.updated_at,
        row.last_modified_by_device_id,
        row.payment_id
      );
      enqueueOutbox("payments", row.payment_id, "delete", row.version, row);
    }

    const deletedAt = nowIso();
    const version = Number(invoice.version ?? 1) + 1;
    const invoiceRow = {
      ...invoice,
      deleted_at: deletedAt,
      version,
      updated_at: deletedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE sales_invoices
        SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE invoice_id = ?
      `
    ).run(
      invoiceRow.deleted_at,
      invoiceRow.version,
      invoiceRow.updated_at,
      invoiceRow.last_modified_by_device_id,
      invoiceRow.invoice_id
    );

    enqueueOutbox(
      "sales_invoices",
      invoiceRow.invoice_id,
      "delete",
      invoiceRow.version,
      invoiceRow
    );
    clearProductCache();
    return invoiceRow;
  },

  getStats: async (filters?: { dateFrom?: string; dateTo?: string }) => {
    const rows = await salesInvoiceService.getFiltered(filters);
    const totalRevenue = rows.reduce(
      (sum: number, invoice: any) => sum + Number(invoice.total_amount),
      0
    );
    const totalDiscount = rows.reduce(
      (sum: number, invoice: any) => sum + Number(invoice.discount_amount),
      0
    );
    const totalTax = rows.reduce(
      (sum: number, invoice: any) => sum + Number(invoice.tax_amount),
      0
    );
    const totalInvoices = rows.length;
    const averageOrderValue = totalInvoices > 0 ? totalRevenue / totalInvoices : 0;

    return {
      totalRevenue,
      totalDiscount,
      totalTax,
      totalInvoices,
      averageOrderValue
    };
  },

  refund: async (originalInvoiceId: string, options?: { employeeId?: string; reason?: string }) => {
    const db = getLocalDb();
    const deviceId = ensureDeviceId();

    const original = db
      .prepare("SELECT * FROM sales_invoices WHERE invoice_id = ? AND deleted_at IS NULL")
      .get(originalInvoiceId);
    if (!original) {
      throw new Error("Original invoice not found");
    }

    if (original.refund_invoice_id) {
      throw new Error("This invoice has already been refunded");
    }

    const details = db
      .prepare("SELECT * FROM sales_details WHERE invoice_id = ? AND deleted_at IS NULL")
      .all(originalInvoiceId);

    const lastInvoice = db
      .prepare(
        "SELECT invoice_id FROM sales_invoices WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1"
      )
      .get();

    let nextInvoiceNumber = 1000;
    if (lastInvoice) {
      const match = String(lastInvoice.invoice_id ?? "").match(/^INV-(\d+)$/);
      if (match) {
        nextInvoiceNumber = Number(match[1]) + 1;
      }
    }

    const refundInvoiceId = `INV-${nextInvoiceNumber}`;
    const timestamp = nowIso();
    const refundRow = {
      invoice_id: refundInvoiceId,
      date: timestamp,
      customer_id: original.customer_id,
      employee_id: options?.employeeId ?? original.employee_id,
      sub_total: -Number(original.sub_total),
      total_amount: -Number(original.total_amount),
      payment_mode: original.payment_mode,
      tax_amount: -Number(original.tax_amount),
      discount_amount: -Number(original.discount_amount),
      amount_received: -Number(original.amount_received),
      outstanding_balance: 0,
      payment_status: "paid",
      refund_invoice_id: null,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        INSERT INTO sales_invoices (
          invoice_id,
          date,
          customer_id,
          employee_id,
          sub_total,
          total_amount,
          payment_mode,
          tax_amount,
          discount_amount,
          amount_received,
          outstanding_balance,
          payment_status,
          refund_invoice_id,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      refundRow.invoice_id,
      refundRow.date,
      refundRow.customer_id,
      refundRow.employee_id,
      refundRow.sub_total,
      refundRow.total_amount,
      refundRow.payment_mode,
      refundRow.tax_amount,
      refundRow.discount_amount,
      refundRow.amount_received,
      refundRow.outstanding_balance,
      refundRow.payment_status,
      refundRow.refund_invoice_id,
      refundRow.version,
      refundRow.created_at,
      refundRow.updated_at,
      refundRow.deleted_at,
      refundRow.last_modified_by_device_id
    );

    enqueueOutbox("sales_invoices", refundRow.invoice_id, "insert", refundRow.version, refundRow);

    for (const detail of details) {
      const detailRow = {
        sales_detail_id: randomUUID(),
        invoice_id: refundRow.invoice_id,
        product_id: detail.product_id,
        custom_product_id: detail.custom_product_id,
        unit: detail.unit,
        original_price: detail.original_price,
        cost_price: detail.cost_price,
        quantity: detail.quantity,
        unit_price: detail.unit_price,
        tax_rate: detail.tax_rate,
        version: 1,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        last_modified_by_device_id: deviceId
      };

      db.prepare(
        `
          INSERT INTO sales_details (
            sales_detail_id,
            invoice_id,
            product_id,
            custom_product_id,
            unit,
            original_price,
            cost_price,
            quantity,
            unit_price,
            tax_rate,
            version,
            created_at,
            updated_at,
            deleted_at,
            last_modified_by_device_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        detailRow.sales_detail_id,
        detailRow.invoice_id,
        detailRow.product_id,
        detailRow.custom_product_id,
        detailRow.unit,
        detailRow.original_price,
        detailRow.cost_price,
        detailRow.quantity,
        detailRow.unit_price,
        detailRow.tax_rate,
        detailRow.version,
        detailRow.created_at,
        detailRow.updated_at,
        detailRow.deleted_at,
        detailRow.last_modified_by_device_id
      );

      enqueueOutbox(
        "sales_details",
        detailRow.sales_detail_id,
        "insert",
        detailRow.version,
        detailRow
      );

      if (detail.product_id) {
        const inventory = db
          .prepare("SELECT * FROM inventory WHERE product_id = ? AND deleted_at IS NULL")
          .get(detail.product_id);
        if (inventory) {
          const newQuantity = Number(inventory.quantity) + Number(detail.quantity);
          const updatedAt = nowIso();
          const version = Number(inventory.version ?? 1) + 1;
          const invRow = {
            ...inventory,
            quantity: newQuantity,
            version,
            updated_at: updatedAt,
            last_modified_by_device_id: deviceId
          };
          db.prepare(
            `
              UPDATE inventory
              SET quantity = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
              WHERE inventory_id = ?
            `
          ).run(
            invRow.quantity,
            invRow.version,
            invRow.updated_at,
            invRow.last_modified_by_device_id,
            invRow.inventory_id
          );
          enqueueOutbox("inventory", invRow.inventory_id, "update", invRow.version, invRow);
          updateLocalProductStockLevel(detail.product_id, invRow.quantity);
        }

        const txRow = {
          transaction_id: randomUUID(),
          product_id: detail.product_id,
          type: "IN",
          change_qty: Number(detail.quantity),
          reason: options?.reason ?? "Refund",
          transaction_date: nowIso(),
          related_invoice_id: original.invoice_id,
          version: 1,
          created_at: nowIso(),
          updated_at: nowIso(),
          deleted_at: null,
          last_modified_by_device_id: deviceId
        };
        db.prepare(
          `
            INSERT INTO stock_transactions (
              transaction_id,
              product_id,
              type,
              change_qty,
              reason,
              transaction_date,
              related_invoice_id,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_modified_by_device_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        ).run(
          txRow.transaction_id,
          txRow.product_id,
          txRow.type,
          txRow.change_qty,
          txRow.reason,
          txRow.transaction_date,
          txRow.related_invoice_id,
          txRow.version,
          txRow.created_at,
          txRow.updated_at,
          txRow.deleted_at,
          txRow.last_modified_by_device_id
        );
        enqueueOutbox("stock_transactions", txRow.transaction_id, "insert", txRow.version, txRow);
      }
    }

    if (original.customer_id) {
      const customer = db
        .prepare("SELECT * FROM customers WHERE customer_id = ? AND deleted_at IS NULL")
        .get(original.customer_id);
      if (customer) {
        const pointsToRemove = Math.floor(Number(original.total_amount) / 10);
        const updatedAt = nowIso();
        const version = Number(customer.version ?? 1) + 1;
        const customerRow = {
          ...customer,
          loyalty_points: Number(customer.loyalty_points) - pointsToRemove,
          version,
          updated_at: updatedAt,
          last_modified_by_device_id: deviceId
        };
        db.prepare(
          `
            UPDATE customers
            SET loyalty_points = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
            WHERE customer_id = ?
          `
        ).run(
          customerRow.loyalty_points,
          customerRow.version,
          customerRow.updated_at,
          customerRow.last_modified_by_device_id,
          customerRow.customer_id
        );
        enqueueOutbox(
          "customers",
          customerRow.customer_id,
          "update",
          customerRow.version,
          customerRow
        );

        const existingTx = db
          .prepare(
            "SELECT * FROM customer_transactions WHERE customer_id = ? AND invoice_id = ? AND deleted_at IS NULL"
          )
          .get(original.customer_id, original.invoice_id);
        if (existingTx) {
          const ctUpdatedAt = nowIso();
          const ctVersion = Number(existingTx.version ?? 1) + 1;
          const ctRow = {
            ...existingTx,
            points_redeemed: Number(existingTx.points_redeemed) + pointsToRemove,
            version: ctVersion,
            updated_at: ctUpdatedAt,
            last_modified_by_device_id: deviceId
          };
          db.prepare(
            `
              UPDATE customer_transactions
              SET points_redeemed = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
              WHERE customer_id = ? AND invoice_id = ?
            `
          ).run(
            ctRow.points_redeemed,
            ctRow.version,
            ctRow.updated_at,
            ctRow.last_modified_by_device_id,
            ctRow.customer_id,
            ctRow.invoice_id
          );
          enqueueOutbox(
            "customer_transactions",
            buildCompositeRowId({ customer_id: ctRow.customer_id, invoice_id: ctRow.invoice_id }),
            "update",
            ctRow.version,
            ctRow
          );
        }
      }
    }

    const originalUpdatedAt = nowIso();
    const originalVersion = Number(original.version ?? 1) + 1;
    const originalRow = {
      ...original,
      refund_invoice_id: refundRow.invoice_id,
      version: originalVersion,
      updated_at: originalUpdatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE sales_invoices
        SET refund_invoice_id = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE invoice_id = ?
      `
    ).run(
      originalRow.refund_invoice_id,
      originalRow.version,
      originalRow.updated_at,
      originalRow.last_modified_by_device_id,
      originalRow.invoice_id
    );

    enqueueOutbox(
      "sales_invoices",
      originalRow.invoice_id,
      "update",
      originalRow.version,
      originalRow
    );
    clearProductCache();
    return {
      originalInvoiceId: originalRow.invoice_id,
      refundInvoice: mapSalesInvoiceRowFromDb(refundRow)
    };
  }
};

export const customerService = {
  findMany: async (options?: FindManyOptions) => {
    const db = getLocalDb();
    const selectKeys =
      options?.select && Object.keys(options.select).filter((key) => options.select?.[key]);
    const columns = selectKeys && selectKeys.length > 0 ? selectKeys.join(", ") : "*";

    let sql = `SELECT ${columns} FROM customers WHERE deleted_at IS NULL ORDER BY created_at DESC`;
    const params: Array<string | number> = [];
    if (options?.pagination?.take) {
      sql += " LIMIT ?";
      params.push(options.pagination.take);
    }
    if (options?.pagination?.skip) {
      sql += " OFFSET ?";
      params.push(options.pagination.skip);
    }

    const rows = db.prepare(sql).all(...params) as any[];
    if (options?.select) {
      return rows;
    }

    return rows.map(mapCustomerRowFromDb);
  },

  create: async (data: { name: string; email?: string; phone?: string; preferences?: string }) => {
    const db = getLocalDb();
    if (data.email) {
      const existing = db
        .prepare("SELECT customer_id FROM customers WHERE email = ? AND deleted_at IS NULL")
        .get(data.email);
      if (existing) {
        throw new Error(`Customer with email "${data.email}" already exists`);
      }
    }

    const customerId = randomUUID();
    const deviceId = ensureDeviceId();
    const timestamp = nowIso();
    const row = {
      customer_id: customerId,
      name: data.name,
      email: data.email ?? null,
      phone: data.phone ?? null,
      address: null,
      loyalty_points: 0,
      preferences: data.preferences ?? null,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        INSERT INTO customers (
          customer_id,
          name,
          email,
          phone,
          address,
          loyalty_points,
          preferences,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      row.customer_id,
      row.name,
      row.email,
      row.phone,
      row.address,
      row.loyalty_points,
      row.preferences,
      row.version,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.last_modified_by_device_id
    );

    enqueueOutbox("customers", row.customer_id, "insert", row.version, row);
    return mapCustomerRowFromDb(row);
  },

  update: async (
    id: string,
    data: {
      name?: string;
      email?: string;
      phone?: string;
      preferences?: string;
      loyaltyPoints?: number;
    }
  ) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM customers WHERE customer_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Customer not found");
    }

    if (data.email) {
      const duplicate = db
        .prepare(
          "SELECT customer_id FROM customers WHERE email = ? AND customer_id != ? AND deleted_at IS NULL"
        )
        .get(data.email, id);
      if (duplicate) {
        throw new Error(`Customer with email "${data.email}" already exists`);
      }
    }

    const deviceId = ensureDeviceId();
    const updatedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const row = {
      ...existing,
      name: data.name ?? existing.name,
      email: data.email ?? existing.email,
      phone: data.phone ?? existing.phone,
      preferences: data.preferences ?? existing.preferences,
      loyalty_points: data.loyaltyPoints ?? existing.loyalty_points,
      version,
      updated_at: updatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE customers
        SET name = ?, email = ?, phone = ?, preferences = ?, loyalty_points = ?,
            version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE customer_id = ?
      `
    ).run(
      row.name,
      row.email,
      row.phone,
      row.preferences,
      row.loyalty_points,
      row.version,
      row.updated_at,
      row.last_modified_by_device_id,
      id
    );

    enqueueOutbox("customers", id, "update", row.version, row);
    return mapCustomerRowFromDb(row);
  },

  delete: async (id: string) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM customers WHERE customer_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Customer not found");
    }

    const deletedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const deviceId = ensureDeviceId();
    db.prepare(
      `
        UPDATE customers
        SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE customer_id = ?
      `
    ).run(deletedAt, version, deletedAt, deviceId, id);

    const payload = {
      ...existing,
      deleted_at: deletedAt,
      version,
      updated_at: deletedAt,
      last_modified_by_device_id: deviceId
    };
    enqueueOutbox("customers", id, "delete", version, payload);
    return mapCustomerRowFromDb(payload);
  },

  findByEmail: async (email: string) => {
    const db = getLocalDb();
    const row = db
      .prepare("SELECT * FROM customers WHERE email = ? AND deleted_at IS NULL")
      .get(email);
    return mapCustomerRowFromDb(row);
  },

  findByPhone: async (phone: string) => {
    const db = getLocalDb();
    const row = db
      .prepare("SELECT * FROM customers WHERE phone = ? AND deleted_at IS NULL")
      .get(phone);
    return mapCustomerRowFromDb(row);
  }
};

// Inventory Service
export const inventoryService = {
  findMany: async (filters?: InventoryFilters, options?: FindManyOptions) => {
    const db = getLocalDb();
    const selectKeys =
      options?.select && Object.keys(options.select).filter((key) => options.select?.[key]);
    const columns = selectKeys && selectKeys.length > 0 ? selectKeys.join(", ") : "*";

    let rows = db
      .prepare(`SELECT ${columns} FROM inventory WHERE deleted_at IS NULL`)
      .all() as any[];

    if (filters?.productId) {
      rows = rows.filter((row) => row.product_id === filters.productId);
    }

    const products = db.prepare("SELECT * FROM products WHERE deleted_at IS NULL").all() as any[];
    const productMap = new Map<string, any>(
      products.map((product: any) => [product.product_id, product])
    );
    const categories = db
      .prepare("SELECT * FROM categories WHERE deleted_at IS NULL")
      .all() as any[];
    const categoryMap = new Map<string, any>(categories.map((cat: any) => [cat.category_id, cat]));

    if (filters?.searchTerm) {
      const term = filters.searchTerm.trim().toLowerCase();
      if (term) {
        rows = rows.filter((row) => {
          const product = productMap.get(row.product_id);
          return (
            String(row.batch_number ?? "")
              .toLowerCase()
              .includes(term) ||
            String(product?.name ?? "")
              .toLowerCase()
              .includes(term) ||
            String(product?.english_name ?? "")
              .toLowerCase()
              .includes(term) ||
            String(product?.sku ?? "")
              .toLowerCase()
              .includes(term) ||
            String(product?.barcode ?? "")
              .toLowerCase()
              .includes(term)
          );
        });
      }
    }

    if (filters?.expiringSoon) {
      const threshold = new Date();
      threshold.setDate(threshold.getDate() + 7);
      rows = rows.filter((row) => {
        if (!row.expiry_date) {
          return false;
        }
        return new Date(row.expiry_date) <= threshold;
      });
    }

    if (filters?.lowStock) {
      rows = rows.filter((row) => Number(row.quantity) <= Number(row.reorder_level));
    }

    rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));

    if (options?.pagination?.skip) {
      rows = rows.slice(options.pagination.skip);
    }
    if (options?.pagination?.take) {
      rows = rows.slice(0, options.pagination.take);
    }

    if (options?.select) {
      return rows;
    }

    return rows.map((row) => {
      const product = productMap.get(row.product_id);
      const category = product?.category_id ? (categoryMap.get(product.category_id) ?? null) : null;
      return mapInventoryRowFromDb(row, { product, category });
    });
  },
  count: async (filters?: InventoryFilters) => {
    const rows = await inventoryService.findMany(filters);
    return rows.length;
  },

  create: async (data: {
    productId: string;
    quantity: number;
    reorderLevel: number;
    batchNumber?: string;
    expiryDate?: Date;
  }) => {
    const db = getLocalDb();
    const product = db
      .prepare("SELECT * FROM products WHERE product_id = ? AND deleted_at IS NULL")
      .get(data.productId);
    if (!product) {
      throw new Error(`Product with ID "${data.productId}" does not exist`);
    }

    const existing = db
      .prepare("SELECT inventory_id FROM inventory WHERE product_id = ? AND deleted_at IS NULL")
      .get(data.productId);
    if (existing) {
      throw new Error(
        "Inventory record already exists for this product. Use update or adjust stock instead."
      );
    }

    const inventoryId = randomUUID();
    const deviceId = ensureDeviceId();
    const timestamp = nowIso();
    const formattedQuantity = validateAndFormatQuantity(data.quantity);
    const row = {
      inventory_id: inventoryId,
      product_id: data.productId,
      quantity: formattedQuantity,
      reorder_level: data.reorderLevel,
      batch_number: data.batchNumber ?? null,
      expiry_date: data.expiryDate ? new Date(data.expiryDate).toISOString() : null,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        INSERT INTO inventory (
          inventory_id,
          product_id,
          quantity,
          reorder_level,
          batch_number,
          expiry_date,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      row.inventory_id,
      row.product_id,
      row.quantity,
      row.reorder_level,
      row.batch_number,
      row.expiry_date,
      row.version,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.last_modified_by_device_id
    );

    enqueueOutbox("inventory", row.inventory_id, "insert", row.version, row);
    updateLocalProductStockLevel(data.productId, formattedQuantity);
    clearProductCache();

    const category = product.category_id
      ? db
          .prepare("SELECT * FROM categories WHERE category_id = ? AND deleted_at IS NULL")
          .get(product.category_id)
      : null;

    return mapInventoryRowFromDb(row, { product, category });
  },

  // Upsert method: create if doesn't exist, update if exists
  upsert: async (data: {
    productId: string;
    quantity: number;
    reorderLevel: number;
    batchNumber?: string;
    expiryDate?: Date;
  }) => {
    const db = getLocalDb();
    const product = db
      .prepare("SELECT * FROM products WHERE product_id = ? AND deleted_at IS NULL")
      .get(data.productId);
    if (!product) {
      throw new Error(`Product with ID "${data.productId}" does not exist`);
    }

    const existing = db
      .prepare("SELECT * FROM inventory WHERE product_id = ? AND deleted_at IS NULL")
      .get(data.productId);

    const formattedQuantity = validateAndFormatQuantity(data.quantity);
    const deviceId = ensureDeviceId();
    const updatedAt = nowIso();

    let row: any;
    if (existing) {
      const version = Number(existing.version ?? 1) + 1;
      row = {
        ...existing,
        quantity: formattedQuantity,
        reorder_level: data.reorderLevel,
        batch_number: data.batchNumber ?? null,
        expiry_date: data.expiryDate ? new Date(data.expiryDate).toISOString() : null,
        version,
        updated_at: updatedAt,
        last_modified_by_device_id: deviceId
      };
      db.prepare(
        `
          UPDATE inventory
          SET quantity = ?, reorder_level = ?, batch_number = ?, expiry_date = ?,
              version = ?, updated_at = ?, last_modified_by_device_id = ?
          WHERE inventory_id = ?
        `
      ).run(
        row.quantity,
        row.reorder_level,
        row.batch_number,
        row.expiry_date,
        row.version,
        row.updated_at,
        row.last_modified_by_device_id,
        row.inventory_id
      );
      enqueueOutbox("inventory", row.inventory_id, "update", row.version, row);
    } else {
      const timestamp = nowIso();
      row = {
        inventory_id: randomUUID(),
        product_id: data.productId,
        quantity: formattedQuantity,
        reorder_level: data.reorderLevel,
        batch_number: data.batchNumber ?? null,
        expiry_date: data.expiryDate ? new Date(data.expiryDate).toISOString() : null,
        version: 1,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        last_modified_by_device_id: deviceId
      };
      db.prepare(
        `
          INSERT INTO inventory (
            inventory_id,
            product_id,
            quantity,
            reorder_level,
            batch_number,
            expiry_date,
            version,
            created_at,
            updated_at,
            deleted_at,
            last_modified_by_device_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        row.inventory_id,
        row.product_id,
        row.quantity,
        row.reorder_level,
        row.batch_number,
        row.expiry_date,
        row.version,
        row.created_at,
        row.updated_at,
        row.deleted_at,
        row.last_modified_by_device_id
      );
      enqueueOutbox("inventory", row.inventory_id, "insert", row.version, row);
    }

    updateLocalProductStockLevel(data.productId, formattedQuantity);
    clearProductCache();

    const category = product.category_id
      ? db
          .prepare("SELECT * FROM categories WHERE category_id = ? AND deleted_at IS NULL")
          .get(product.category_id)
      : null;

    return mapInventoryRowFromDb(row, { product, category });
  },

  update: async (
    id: string,
    data: {
      quantity?: number;
      reorderLevel?: number;
      batchNumber?: string;
      expiryDate?: Date;
    }
  ) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM inventory WHERE inventory_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Inventory record not found");
    }

    const deviceId = ensureDeviceId();
    const updatedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const quantity =
      data.quantity !== undefined ? validateAndFormatQuantity(data.quantity) : existing.quantity;
    const row = {
      ...existing,
      quantity,
      reorder_level: data.reorderLevel ?? existing.reorder_level,
      batch_number: data.batchNumber ?? existing.batch_number,
      expiry_date: data.expiryDate ? new Date(data.expiryDate).toISOString() : existing.expiry_date,
      version,
      updated_at: updatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE inventory
        SET quantity = ?, reorder_level = ?, batch_number = ?, expiry_date = ?,
            version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE inventory_id = ?
      `
    ).run(
      row.quantity,
      row.reorder_level,
      row.batch_number,
      row.expiry_date,
      row.version,
      row.updated_at,
      row.last_modified_by_device_id,
      id
    );

    enqueueOutbox("inventory", id, "update", row.version, row);
    updateLocalProductStockLevel(existing.product_id, row.quantity);
    clearProductCache();

    const product = db
      .prepare("SELECT * FROM products WHERE product_id = ? AND deleted_at IS NULL")
      .get(existing.product_id);
    const category = product?.category_id
      ? db
          .prepare("SELECT * FROM categories WHERE category_id = ? AND deleted_at IS NULL")
          .get(product.category_id)
      : null;

    return mapInventoryRowFromDb(row, { product, category });
  },

  delete: async (id: string) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM inventory WHERE inventory_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Inventory record not found");
    }

    const deletedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const deviceId = ensureDeviceId();
    db.prepare(
      `
        UPDATE inventory
        SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE inventory_id = ?
      `
    ).run(deletedAt, version, deletedAt, deviceId, id);

    const payload = {
      ...existing,
      deleted_at: deletedAt,
      version,
      updated_at: deletedAt,
      last_modified_by_device_id: deviceId
    };
    enqueueOutbox("inventory", id, "delete", version, payload);
    return payload;
  },

  findById: async (id: string) => {
    const db = getLocalDb();
    const row = db
      .prepare("SELECT * FROM inventory WHERE inventory_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!row) {
      return null;
    }

    const product = db
      .prepare("SELECT * FROM products WHERE product_id = ? AND deleted_at IS NULL")
      .get(row.product_id);
    const category = product?.category_id
      ? db
          .prepare("SELECT * FROM categories WHERE category_id = ? AND deleted_at IS NULL")
          .get(product.category_id)
      : null;

    return mapInventoryRowFromDb(row, { product, category });
  },

  // Quick adjust method for updating stock with reason tracking
  quickAdjust: async (id: string, newQuantity: number, reason: string) => {
    const db = getLocalDb();
    const inventory = db
      .prepare("SELECT * FROM inventory WHERE inventory_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!inventory) {
      throw new Error("Inventory item not found");
    }

    const formattedQuantity = validateAndFormatQuantity(newQuantity);
    const changeQty = formattedQuantity - Number(inventory.quantity);
    const deviceId = ensureDeviceId();
    const updatedAt = nowIso();
    const version = Number(inventory.version ?? 1) + 1;
    const row = {
      ...inventory,
      quantity: formattedQuantity,
      version,
      updated_at: updatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE inventory
        SET quantity = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE inventory_id = ?
      `
    ).run(row.quantity, row.version, row.updated_at, row.last_modified_by_device_id, id);

    enqueueOutbox("inventory", id, "update", row.version, row);

    if (changeQty != 0) {
      const transactionId = randomUUID();
      const timestamp = nowIso();
      const txRow = {
        transaction_id: transactionId,
        product_id: inventory.product_id,
        type: changeQty >= 0 ? "IN" : "OUT",
        change_qty: changeQty,
        reason,
        transaction_date: timestamp,
        related_invoice_id: null,
        version: 1,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        last_modified_by_device_id: deviceId
      };
      db.prepare(
        `
          INSERT INTO stock_transactions (
            transaction_id,
            product_id,
            type,
            change_qty,
            reason,
            transaction_date,
            related_invoice_id,
            version,
            created_at,
            updated_at,
            deleted_at,
            last_modified_by_device_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        txRow.transaction_id,
        txRow.product_id,
        txRow.type,
        txRow.change_qty,
        txRow.reason,
        txRow.transaction_date,
        txRow.related_invoice_id,
        txRow.version,
        txRow.created_at,
        txRow.updated_at,
        txRow.deleted_at,
        txRow.last_modified_by_device_id
      );

      enqueueOutbox("stock_transactions", txRow.transaction_id, "insert", txRow.version, txRow);
      updateLocalProductStockLevel(inventory.product_id, formattedQuantity);
    }

    clearProductCache();
    const product = db
      .prepare("SELECT * FROM products WHERE product_id = ? AND deleted_at IS NULL")
      .get(inventory.product_id);
    const category = product?.category_id
      ? db
          .prepare("SELECT * FROM categories WHERE category_id = ? AND deleted_at IS NULL")
          .get(product.category_id)
      : null;

    return mapInventoryRowFromDb(row, { product, category });
  },

  getLowStockItems: async () => {
    const rows = await inventoryService.findMany();
    return rows.filter((item: any) => Number(item.quantity) <= Number(item.reorderLevel));
  },

  adjustStock: async (
    id: string,
    newQuantity: number,
    reason: string,
    relatedInvoiceId?: string
  ) => {
    const db = getLocalDb();
    const inventory = db
      .prepare("SELECT * FROM inventory WHERE inventory_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!inventory) {
      throw new Error("Inventory record not found");
    }

    const formattedQuantity = validateAndFormatQuantity(newQuantity);
    const changeQty = formattedQuantity - Number(inventory.quantity);
    const deviceId = ensureDeviceId();
    const updatedAt = nowIso();
    const version = Number(inventory.version ?? 1) + 1;
    const row = {
      ...inventory,
      quantity: formattedQuantity,
      version,
      updated_at: updatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE inventory
        SET quantity = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE inventory_id = ?
      `
    ).run(row.quantity, row.version, row.updated_at, row.last_modified_by_device_id, id);

    enqueueOutbox("inventory", id, "update", row.version, row);

    const transactionId = randomUUID();
    const timestamp = nowIso();
    const txRow = {
      transaction_id: transactionId,
      product_id: inventory.product_id,
      type: changeQty >= 0 ? "IN" : "OUT",
      change_qty: changeQty,
      reason,
      transaction_date: timestamp,
      related_invoice_id: relatedInvoiceId ?? null,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };
    db.prepare(
      `
        INSERT INTO stock_transactions (
          transaction_id,
          product_id,
          type,
          change_qty,
          reason,
          transaction_date,
          related_invoice_id,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      txRow.transaction_id,
      txRow.product_id,
      txRow.type,
      txRow.change_qty,
      txRow.reason,
      txRow.transaction_date,
      txRow.related_invoice_id,
      txRow.version,
      txRow.created_at,
      txRow.updated_at,
      txRow.deleted_at,
      txRow.last_modified_by_device_id
    );

    enqueueOutbox("stock_transactions", txRow.transaction_id, "insert", txRow.version, txRow);
    updateLocalProductStockLevel(inventory.product_id, formattedQuantity);
    clearProductCache();

    const product = db
      .prepare("SELECT * FROM products WHERE product_id = ? AND deleted_at IS NULL")
      .get(inventory.product_id);
    const category = product?.category_id
      ? db
          .prepare("SELECT * FROM categories WHERE category_id = ? AND deleted_at IS NULL")
          .get(product.category_id)
      : null;

    return mapInventoryRowFromDb(row, { product, category });
  }
};

export const stockSyncService = {
  // Sync a single product's stock level from its inventories
  syncProductStockFromInventory: async (productId: string) => {
    const db = getLocalDb();
    const rows = db
      .prepare("SELECT quantity FROM inventory WHERE product_id = ? AND deleted_at IS NULL")
      .all(productId) as { quantity: number }[];

    const newStockLevel = rows.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);

    updateLocalProductStockLevel(productId, newStockLevel);
    clearProductCache();
    return newStockLevel;
  },

  // Sync all products' stock levels from their inventories
  syncAllProductsStockFromInventory: async () => {
    const db = getLocalDb();
    const productIds = db
      .prepare("SELECT product_id FROM products WHERE deleted_at IS NULL")
      .all() as { product_id: string }[];

    const totals = new Map<string, number>();
    const inventoryRows = db
      .prepare("SELECT product_id, quantity FROM inventory WHERE deleted_at IS NULL")
      .all() as { product_id: string; quantity: number }[];

    for (const row of inventoryRows) {
      const current = totals.get(row.product_id) ?? 0;
      totals.set(row.product_id, current + Number(row.quantity ?? 0));
    }

    for (const product of productIds) {
      const newStockLevel = totals.get(product.product_id) ?? 0;
      updateLocalProductStockLevel(product.product_id, newStockLevel);
    }

    clearProductCache();
    return productIds.length;
  }
};

// Stock Transaction Service
export const stockTransactionService = {
  findMany: async (filters?: StockTransactionFilters, options?: FindManyOptions) => {
    const db = getLocalDb();
    const selectKeys =
      options?.select && Object.keys(options.select).filter((key) => options.select?.[key]);
    const columns = selectKeys && selectKeys.length > 0 ? selectKeys.join(", ") : "*";

    let rows = db
      .prepare(`SELECT ${columns} FROM stock_transactions WHERE deleted_at IS NULL`)
      .all() as any[];

    if (filters?.productId) {
      rows = rows.filter((row) => row.product_id === filters.productId);
    }

    if (filters?.reason) {
      const reason = filters.reason.toLowerCase();
      rows = rows.filter((row) =>
        String(row.reason ?? "")
          .toLowerCase()
          .includes(reason)
      );
    }

    if (filters?.dateFrom || filters?.dateTo) {
      const from = filters.dateFrom ? new Date(filters.dateFrom) : null;
      const to = filters.dateTo ? new Date(filters.dateTo) : null;
      rows = rows.filter((row) => {
        const date = new Date(row.transaction_date);
        if (from && date < from) {
          return false;
        }
        if (to && date > to) {
          return false;
        }
        return true;
      });
    }

    const products = db.prepare("SELECT * FROM products WHERE deleted_at IS NULL").all() as any[];
    const productMap = new Map<string, any>(
      products.map((product: any) => [product.product_id, product])
    );
    const categories = db
      .prepare("SELECT * FROM categories WHERE deleted_at IS NULL")
      .all() as any[];
    const categoryMap = new Map<string, any>(categories.map((cat: any) => [cat.category_id, cat]));

    if (filters?.searchTerm) {
      const term = filters.searchTerm.trim().toLowerCase();
      if (term) {
        rows = rows.filter((row) => {
          const product = productMap.get(row.product_id);
          return (
            String(row.reason ?? "")
              .toLowerCase()
              .includes(term) ||
            String(product?.name ?? "")
              .toLowerCase()
              .includes(term) ||
            String(product?.english_name ?? "")
              .toLowerCase()
              .includes(term) ||
            String(product?.sku ?? "")
              .toLowerCase()
              .includes(term)
          );
        });
      }
    }

    rows.sort((a, b) => String(b.transaction_date).localeCompare(String(a.transaction_date)));

    if (options?.pagination?.skip) {
      rows = rows.slice(options.pagination.skip);
    }
    if (options?.pagination?.take) {
      rows = rows.slice(0, options.pagination.take);
    }

    if (options?.select) {
      return rows;
    }

    return rows.map((row) => {
      const product = productMap.get(row.product_id);
      const category = product?.category_id ? (categoryMap.get(product.category_id) ?? null) : null;
      return mapStockTransactionRowFromDb(row, { product, category });
    });
  },
  count: async (filters?: StockTransactionFilters) => {
    const rows = await stockTransactionService.findMany(filters);
    return rows.length;
  },

  create: async (data: {
    productId: string;
    type: string;
    changeQty: number;
    reason: string;
    relatedInvoiceId?: string;
  }) => {
    const db = getLocalDb();
    const product = db
      .prepare("SELECT * FROM products WHERE product_id = ? AND deleted_at IS NULL")
      .get(data.productId);
    if (!product) {
      throw new Error(`Product with ID ${data.productId} not found`);
    }

    const formattedChangeQty = validateAndFormatQuantity(data.changeQty);
    const deviceId = ensureDeviceId();

    let inventory = db
      .prepare("SELECT * FROM inventory WHERE product_id = ? AND deleted_at IS NULL")
      .get(data.productId);

    if (!inventory) {
      const timestamp = nowIso();
      const initialQuantity = Math.max(0, formattedChangeQty);
      const inventoryRow = {
        inventory_id: randomUUID(),
        product_id: data.productId,
        quantity: initialQuantity,
        reorder_level: 5,
        batch_number: null,
        expiry_date: null,
        version: 1,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        last_modified_by_device_id: deviceId
      };
      db.prepare(
        `
          INSERT INTO inventory (
            inventory_id,
            product_id,
            quantity,
            reorder_level,
            batch_number,
            expiry_date,
            version,
            created_at,
            updated_at,
            deleted_at,
            last_modified_by_device_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        inventoryRow.inventory_id,
        inventoryRow.product_id,
        inventoryRow.quantity,
        inventoryRow.reorder_level,
        inventoryRow.batch_number,
        inventoryRow.expiry_date,
        inventoryRow.version,
        inventoryRow.created_at,
        inventoryRow.updated_at,
        inventoryRow.deleted_at,
        inventoryRow.last_modified_by_device_id
      );
      enqueueOutbox(
        "inventory",
        inventoryRow.inventory_id,
        "insert",
        inventoryRow.version,
        inventoryRow
      );
      inventory = inventoryRow;
    } else {
      const newQuantity = Math.max(0, Number(inventory.quantity) + formattedChangeQty);
      if (newQuantity < 0 && formattedChangeQty < 0) {
        throw new Error(
          `Insufficient stock. Current: ${inventory.quantity}, Requested change: ${formattedChangeQty}`
        );
      }
      const updatedAt = nowIso();
      const version = Number(inventory.version ?? 1) + 1;
      const updatedInventory = {
        ...inventory,
        quantity: newQuantity,
        version,
        updated_at: updatedAt,
        last_modified_by_device_id: deviceId
      };
      db.prepare(
        `
          UPDATE inventory
          SET quantity = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
          WHERE inventory_id = ?
        `
      ).run(
        updatedInventory.quantity,
        updatedInventory.version,
        updatedInventory.updated_at,
        updatedInventory.last_modified_by_device_id,
        updatedInventory.inventory_id
      );
      enqueueOutbox(
        "inventory",
        inventory.inventory_id,
        "update",
        updatedInventory.version,
        updatedInventory
      );
      inventory = updatedInventory;
    }

    const timestamp = nowIso();
    const transactionRow = {
      transaction_id: randomUUID(),
      product_id: data.productId,
      type: data.type,
      change_qty: formattedChangeQty,
      reason: data.reason,
      transaction_date: timestamp,
      related_invoice_id: data.relatedInvoiceId ?? null,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        INSERT INTO stock_transactions (
          transaction_id,
          product_id,
          type,
          change_qty,
          reason,
          transaction_date,
          related_invoice_id,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      transactionRow.transaction_id,
      transactionRow.product_id,
      transactionRow.type,
      transactionRow.change_qty,
      transactionRow.reason,
      transactionRow.transaction_date,
      transactionRow.related_invoice_id,
      transactionRow.version,
      transactionRow.created_at,
      transactionRow.updated_at,
      transactionRow.deleted_at,
      transactionRow.last_modified_by_device_id
    );

    enqueueOutbox(
      "stock_transactions",
      transactionRow.transaction_id,
      "insert",
      transactionRow.version,
      transactionRow
    );
    updateLocalProductStockLevel(data.productId, Number(inventory.quantity));
    clearProductCache();

    return mapStockTransactionRowFromDb(transactionRow, { product });
  },

  update: async (
    id: string,
    data: {
      type?: string;
      changeQty?: number;
      reason?: string;
      relatedInvoiceId?: string;
    }
  ) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM stock_transactions WHERE transaction_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Stock transaction not found");
    }

    const deviceId = ensureDeviceId();
    const updatedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const changeQty =
      data.changeQty !== undefined
        ? validateAndFormatQuantity(data.changeQty)
        : Number(existing.change_qty);

    if (data.changeQty !== undefined && changeQty != Number(existing.change_qty)) {
      const inventory = db
        .prepare("SELECT * FROM inventory WHERE product_id = ? AND deleted_at IS NULL")
        .get(existing.product_id);
      if (inventory) {
        const quantityDifference = changeQty - Number(existing.change_qty);
        const newQuantity = Math.max(0, Number(inventory.quantity) + quantityDifference);
        const invUpdatedAt = nowIso();
        const invVersion = Number(inventory.version ?? 1) + 1;
        const updatedInventory = {
          ...inventory,
          quantity: newQuantity,
          version: invVersion,
          updated_at: invUpdatedAt,
          last_modified_by_device_id: deviceId
        };
        db.prepare(
          `
            UPDATE inventory
            SET quantity = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
            WHERE inventory_id = ?
          `
        ).run(
          updatedInventory.quantity,
          updatedInventory.version,
          updatedInventory.updated_at,
          updatedInventory.last_modified_by_device_id,
          updatedInventory.inventory_id
        );
        enqueueOutbox(
          "inventory",
          updatedInventory.inventory_id,
          "update",
          updatedInventory.version,
          updatedInventory
        );
        updateLocalProductStockLevel(existing.product_id, updatedInventory.quantity);
      }
    }

    const row = {
      ...existing,
      type: data.type ?? existing.type,
      change_qty: changeQty,
      reason: data.reason ?? existing.reason,
      related_invoice_id: data.relatedInvoiceId ?? existing.related_invoice_id,
      version,
      updated_at: updatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE stock_transactions
        SET type = ?, change_qty = ?, reason = ?, related_invoice_id = ?,
            version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE transaction_id = ?
      `
    ).run(
      row.type,
      row.change_qty,
      row.reason,
      row.related_invoice_id,
      row.version,
      row.updated_at,
      row.last_modified_by_device_id,
      id
    );

    enqueueOutbox("stock_transactions", id, "update", row.version, row);
    clearProductCache();
    return mapStockTransactionRowFromDb(row);
  },

  delete: async (id: string) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM stock_transactions WHERE transaction_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Stock transaction not found");
    }

    const inventory = db
      .prepare("SELECT * FROM inventory WHERE product_id = ? AND deleted_at IS NULL")
      .get(existing.product_id);
    if (inventory) {
      const newQuantity = Math.max(0, Number(inventory.quantity) - Number(existing.change_qty));
      const invUpdatedAt = nowIso();
      const invVersion = Number(inventory.version ?? 1) + 1;
      const updatedInventory = {
        ...inventory,
        quantity: newQuantity,
        version: invVersion,
        updated_at: invUpdatedAt,
        last_modified_by_device_id: ensureDeviceId()
      };
      db.prepare(
        `
          UPDATE inventory
          SET quantity = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
          WHERE inventory_id = ?
        `
      ).run(
        updatedInventory.quantity,
        updatedInventory.version,
        updatedInventory.updated_at,
        updatedInventory.last_modified_by_device_id,
        updatedInventory.inventory_id
      );
      enqueueOutbox(
        "inventory",
        updatedInventory.inventory_id,
        "update",
        updatedInventory.version,
        updatedInventory
      );
      updateLocalProductStockLevel(existing.product_id, updatedInventory.quantity);
    }

    const deletedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const row = {
      ...existing,
      deleted_at: deletedAt,
      version,
      updated_at: deletedAt,
      last_modified_by_device_id: ensureDeviceId()
    };

    db.prepare(
      `
        UPDATE stock_transactions
        SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE transaction_id = ?
      `
    ).run(row.deleted_at, row.version, row.updated_at, row.last_modified_by_device_id, id);

    enqueueOutbox("stock_transactions", id, "delete", row.version, row);
    clearProductCache();
    return mapStockTransactionRowFromDb(row);
  },

  getStockMovementAnalytics: async (filters?: {
    productId?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }) => {
    const rows = await stockTransactionService.findMany({
      productId: filters?.productId,
      dateFrom: filters?.dateFrom,
      dateTo: filters?.dateTo
    });

    const analytics = {
      totalTransactions: rows.length,
      totalStockIn: rows
        .filter((t: any) => Number(t.changeQty) > 0)
        .reduce((sum: number, t: any) => sum + Number(t.changeQty), 0),
      totalStockOut: rows
        .filter((t: any) => Number(t.changeQty) < 0)
        .reduce((sum: number, t: any) => sum + Math.abs(Number(t.changeQty)), 0),
      netChange: rows.reduce((sum: number, t: any) => sum + Number(t.changeQty), 0),
      reasonBreakdown: rows.reduce((acc: Record<string, number>, t: any) => {
        const key = t.reason ?? "unknown";
        acc[key] = (acc[key] || 0) + Math.abs(Number(t.changeQty));
        return acc;
      }, {}),
      typeBreakdown: rows.reduce(
        (acc: Record<string, { count: number; totalQuantity: number }>, t: any) => {
          const key = t.type ?? "unknown";
          if (!acc[key]) {
            acc[key] = { count: 0, totalQuantity: 0 };
          }
          acc[key].count += 1;
          acc[key].totalQuantity += Math.abs(Number(t.changeQty));
          return acc;
        },
        {}
      )
    };

    return { transactions: rows, analytics };
  },

  findById: async (id: string) => {
    const db = getLocalDb();
    const row = db
      .prepare("SELECT * FROM stock_transactions WHERE transaction_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!row) {
      return null;
    }

    const product = db
      .prepare("SELECT * FROM products WHERE product_id = ? AND deleted_at IS NULL")
      .get(row.product_id);
    const category = product?.category_id
      ? db
          .prepare("SELECT * FROM categories WHERE category_id = ? AND deleted_at IS NULL")
          .get(product.category_id)
      : null;

    return mapStockTransactionRowFromDb(row, { product, category });
  }
};

// Supplier Service
export const supplierService = {
  findMany: async () => {
    const db = getLocalDb();
    const suppliers = db
      .prepare("SELECT * FROM suppliers WHERE deleted_at IS NULL ORDER BY created_at DESC")
      .all() as any[];

    const supplierIds = suppliers.map((row) => row.supplier_id);
    const purchaseOrders = supplierIds.length
      ? db
          .prepare(
            `
              SELECT * FROM purchase_orders
              WHERE deleted_at IS NULL AND supplier_id IN (${supplierIds.map(() => "?").join(", ")})
            `
          )
          .all(...supplierIds)
      : [];

    const poMap = new Map();
    for (const po of purchaseOrders) {
      const list = poMap.get(po.supplier_id) ?? [];
      list.push(po);
      poMap.set(po.supplier_id, list);
    }

    return suppliers.map((supplier) =>
      mapSupplierRowFromDb(supplier, {
        purchaseOrders: poMap.get(supplier.supplier_id) ?? []
      })
    );
  },

  create: async (data: {
    name: string;
    contactName?: string;
    phone?: string;
    email?: string;
    address?: string;
  }) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT supplier_id FROM suppliers WHERE name = ? AND deleted_at IS NULL")
      .get(data.name);

    if (existing) {
      throw new Error(`Supplier with name "${data.name}" already exists`);
    }

    const supplierId = randomUUID();
    const deviceId = ensureDeviceId();
    const timestamp = nowIso();
    const row = {
      supplier_id: supplierId,
      name: data.name,
      contact_name: data.contactName ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      address: data.address ?? null,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        INSERT INTO suppliers (
          supplier_id,
          name,
          contact_name,
          phone,
          email,
          address,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      row.supplier_id,
      row.name,
      row.contact_name,
      row.phone,
      row.email,
      row.address,
      row.version,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.last_modified_by_device_id
    );

    enqueueOutbox("suppliers", row.supplier_id, "insert", row.version, row);
    return mapSupplierRowFromDb(row, { purchaseOrders: [] });
  },

  update: async (
    id: string,
    data: {
      name?: string;
      contactName?: string;
      phone?: string;
      email?: string;
      address?: string;
    }
  ) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM suppliers WHERE supplier_id = ? AND deleted_at IS NULL")
      .get(id);

    if (!existing) {
      throw new Error("Supplier not found");
    }

    if (data.name) {
      const duplicate = db
        .prepare(
          "SELECT supplier_id FROM suppliers WHERE name = ? AND supplier_id != ? AND deleted_at IS NULL"
        )
        .get(data.name, id);
      if (duplicate) {
        throw new Error(`Supplier with name "${data.name}" already exists`);
      }
    }

    const deviceId = ensureDeviceId();
    const updatedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const row = {
      ...existing,
      name: data.name ?? existing.name,
      contact_name: data.contactName ?? existing.contact_name,
      phone: data.phone ?? existing.phone,
      email: data.email ?? existing.email,
      address: data.address ?? existing.address,
      version,
      updated_at: updatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE suppliers
        SET name = ?, contact_name = ?, phone = ?, email = ?, address = ?,
            version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE supplier_id = ?
      `
    ).run(
      row.name,
      row.contact_name,
      row.phone,
      row.email,
      row.address,
      row.version,
      row.updated_at,
      row.last_modified_by_device_id,
      id
    );

    enqueueOutbox("suppliers", id, "update", row.version, row);

    const purchaseOrders = db
      .prepare("SELECT * FROM purchase_orders WHERE supplier_id = ? AND deleted_at IS NULL")
      .all(id);

    return mapSupplierRowFromDb(row, { purchaseOrders });
  },

  delete: async (id: string) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM suppliers WHERE supplier_id = ? AND deleted_at IS NULL")
      .get(id);

    if (!existing) {
      throw new Error("Supplier not found");
    }

    const deletedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const deviceId = ensureDeviceId();
    const row = {
      ...existing,
      deleted_at: deletedAt,
      version,
      updated_at: deletedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE suppliers
        SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE supplier_id = ?
      `
    ).run(row.deleted_at, row.version, row.updated_at, row.last_modified_by_device_id, id);

    enqueueOutbox("suppliers", id, "delete", row.version, row);
    return mapSupplierRowFromDb(row);
  },

  findById: async (id: string) => {
    const db = getLocalDb();
    const supplier = db
      .prepare("SELECT * FROM suppliers WHERE supplier_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!supplier) {
      return null;
    }

    const purchaseOrders = db
      .prepare(
        "SELECT * FROM purchase_orders WHERE supplier_id = ? AND deleted_at IS NULL ORDER BY order_date DESC"
      )
      .all(id);

    const poIds = purchaseOrders.map((po) => po.po_id);
    const items = poIds.length
      ? db
          .prepare(
            `SELECT * FROM purchase_order_items WHERE po_id IN (${poIds.map(() => "?").join(", ")}) AND deleted_at IS NULL`
          )
          .all(...poIds)
      : [];

    const itemMap = new Map();
    for (const item of items) {
      const list = itemMap.get(item.po_id) ?? [];
      list.push(item);
      itemMap.set(item.po_id, list);
    }

    const products = db.prepare("SELECT * FROM products WHERE deleted_at IS NULL").all() as any[];
    const productMap = new Map<string, any>(
      products.map((product: any) => [product.product_id, product])
    );

    return mapSupplierRowFromDb(supplier, {
      purchaseOrders: purchaseOrders.map((po) => ({
        ...po,
        items: (itemMap.get(po.po_id) ?? []).map((item) => ({
          ...item,
          product: productMap.get(item.product_id) ?? null
        }))
      }))
    });
  }
};

// Purchase Order Service
export const purchaseOrderService = {
  findMany: async (filters?: { supplierId?: string; status?: string }) => {
    const db = getLocalDb();
    let rows = db
      .prepare("SELECT * FROM purchase_orders WHERE deleted_at IS NULL ORDER BY order_date DESC")
      .all() as any[];

    if (filters?.supplierId) {
      rows = rows.filter((row) => row.supplier_id == filters.supplierId);
    }

    if (filters?.status) {
      rows = rows.filter((row) => row.status == filters.status);
    }

    const supplierIds = rows.map((row) => row.supplier_id);
    const suppliers = supplierIds.length
      ? (db
          .prepare(
            `SELECT * FROM suppliers WHERE supplier_id IN (${supplierIds.map(() => "?").join(", ")}) AND deleted_at IS NULL`
          )
          .all(...supplierIds) as any[])
      : ([] as any[]);
    const supplierMap = new Map<string, any>(
      suppliers.map((supplier: any) => [supplier.supplier_id, supplier])
    );

    const poIds = rows.map((row) => row.po_id);
    const items = poIds.length
      ? (db
          .prepare(
            `SELECT * FROM purchase_order_items WHERE po_id IN (${poIds.map(() => "?").join(", ")}) AND deleted_at IS NULL`
          )
          .all(...poIds) as any[])
      : ([] as any[]);

    const itemMap = new Map();
    for (const item of items) {
      const list = itemMap.get(item.po_id) ?? [];
      list.push(item);
      itemMap.set(item.po_id, list);
    }

    const products = db.prepare("SELECT * FROM products WHERE deleted_at IS NULL").all() as any[];
    const categories = db
      .prepare("SELECT * FROM categories WHERE deleted_at IS NULL")
      .all() as any[];
    const productMap = new Map<string, any>(
      products.map((product: any) => [product.product_id, product])
    );
    const categoryMap = new Map<string, any>(categories.map((cat: any) => [cat.category_id, cat]));

    return rows.map((row) => {
      const supplier = supplierMap.get(row.supplier_id) ?? null;
      const items = (itemMap.get(row.po_id) ?? []).map((item) => {
        const product = item.product_id ? productMap.get(item.product_id) : null;
        const category = product?.category_id
          ? (categoryMap.get(product.category_id) ?? null)
          : null;
        return mapPurchaseOrderItemRowFromDb(item, { product, category });
      });
      return mapPurchaseOrderRowFromDb(row, {
        supplier,
        items
      });
    });
  },

  create: async (data: {
    supplierId: string;
    orderDate: Date;
    status: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
    }>;
  }) => {
    const db = getLocalDb();
    const supplier = db
      .prepare("SELECT * FROM suppliers WHERE supplier_id = ? AND deleted_at IS NULL")
      .get(data.supplierId);
    if (!supplier) {
      throw new Error("Supplier not found");
    }

    const totalAmount = data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const poId = randomUUID();
    const deviceId = ensureDeviceId();
    const timestamp = nowIso();
    const poRow = {
      po_id: poId,
      supplier_id: data.supplierId,
      order_date: data.orderDate.toISOString(),
      status: data.status,
      total_amount: totalAmount,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        INSERT INTO purchase_orders (
          po_id,
          supplier_id,
          order_date,
          status,
          total_amount,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      poRow.po_id,
      poRow.supplier_id,
      poRow.order_date,
      poRow.status,
      poRow.total_amount,
      poRow.version,
      poRow.created_at,
      poRow.updated_at,
      poRow.deleted_at,
      poRow.last_modified_by_device_id
    );

    enqueueOutbox("purchase_orders", poRow.po_id, "insert", poRow.version, poRow);

    const items: any[] = [];
    for (const item of data.items) {
      const itemRow = {
        po_item_id: randomUUID(),
        po_id: poId,
        product_id: item.productId,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        received_date: null,
        version: 1,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        last_modified_by_device_id: deviceId
      };
      db.prepare(
        `
          INSERT INTO purchase_order_items (
            po_item_id,
            po_id,
            product_id,
            quantity,
            unit_price,
            received_date,
            version,
            created_at,
            updated_at,
            deleted_at,
            last_modified_by_device_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        itemRow.po_item_id,
        itemRow.po_id,
        itemRow.product_id,
        itemRow.quantity,
        itemRow.unit_price,
        itemRow.received_date,
        itemRow.version,
        itemRow.created_at,
        itemRow.updated_at,
        itemRow.deleted_at,
        itemRow.last_modified_by_device_id
      );

      enqueueOutbox("purchase_order_items", itemRow.po_item_id, "insert", itemRow.version, itemRow);
      items.push(itemRow);
    }

    return mapPurchaseOrderRowFromDb(poRow, {
      supplier,
      items: items.map((item) => mapPurchaseOrderItemRowFromDb(item))
    });
  },

  update: async (
    id: string,
    data: {
      status?: string;
      orderDate?: Date;
    }
  ) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM purchase_orders WHERE po_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Purchase order not found");
    }

    const deviceId = ensureDeviceId();
    const updatedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const row = {
      ...existing,
      status: data.status ?? existing.status,
      order_date: data.orderDate ? data.orderDate.toISOString() : existing.order_date,
      version,
      updated_at: updatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE purchase_orders
        SET status = ?, order_date = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE po_id = ?
      `
    ).run(
      row.status,
      row.order_date,
      row.version,
      row.updated_at,
      row.last_modified_by_device_id,
      id
    );

    enqueueOutbox("purchase_orders", id, "update", row.version, row);

    const supplier = db
      .prepare("SELECT * FROM suppliers WHERE supplier_id = ? AND deleted_at IS NULL")
      .get(row.supplier_id);
    const items = db
      .prepare("SELECT * FROM purchase_order_items WHERE po_id = ? AND deleted_at IS NULL")
      .all(id);

    const products = db.prepare("SELECT * FROM products WHERE deleted_at IS NULL").all() as any[];
    const categories = db
      .prepare("SELECT * FROM categories WHERE deleted_at IS NULL")
      .all() as any[];
    const productMap = new Map<string, any>(
      products.map((product: any) => [product.product_id, product])
    );
    const categoryMap = new Map<string, any>(categories.map((cat: any) => [cat.category_id, cat]));

    return mapPurchaseOrderRowFromDb(row, {
      supplier,
      items: items.map((item) => {
        const product = item.product_id ? productMap.get(item.product_id) : null;
        const category = product?.category_id
          ? (categoryMap.get(product.category_id) ?? null)
          : null;
        return mapPurchaseOrderItemRowFromDb(item, { product, category });
      })
    });
  },

  delete: async (id: string) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM purchase_orders WHERE po_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Purchase order not found");
    }

    const deletedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const deviceId = ensureDeviceId();
    const row = {
      ...existing,
      deleted_at: deletedAt,
      version,
      updated_at: deletedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE purchase_orders
        SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE po_id = ?
      `
    ).run(row.deleted_at, row.version, row.updated_at, row.last_modified_by_device_id, id);

    enqueueOutbox("purchase_orders", id, "delete", row.version, row);

    const items = db
      .prepare("SELECT * FROM purchase_order_items WHERE po_id = ? AND deleted_at IS NULL")
      .all(id);
    for (const item of items) {
      const itemDeletedAt = nowIso();
      const itemVersion = Number(item.version ?? 1) + 1;
      const itemRow = {
        ...item,
        deleted_at: itemDeletedAt,
        version: itemVersion,
        updated_at: itemDeletedAt,
        last_modified_by_device_id: deviceId
      };
      db.prepare(
        `
          UPDATE purchase_order_items
          SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
          WHERE po_item_id = ?
        `
      ).run(
        itemRow.deleted_at,
        itemRow.version,
        itemRow.updated_at,
        itemRow.last_modified_by_device_id,
        itemRow.po_item_id
      );
      enqueueOutbox("purchase_order_items", itemRow.po_item_id, "delete", itemRow.version, itemRow);
    }

    return mapPurchaseOrderRowFromDb(row);
  },

  findById: async (id: string) => {
    const db = getLocalDb();
    const po = db
      .prepare("SELECT * FROM purchase_orders WHERE po_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!po) {
      return null;
    }

    const supplier = db
      .prepare("SELECT * FROM suppliers WHERE supplier_id = ? AND deleted_at IS NULL")
      .get(po.supplier_id);

    const items = db
      .prepare("SELECT * FROM purchase_order_items WHERE po_id = ? AND deleted_at IS NULL")
      .all(id);

    const products = db.prepare("SELECT * FROM products WHERE deleted_at IS NULL").all() as any[];
    const categories = db
      .prepare("SELECT * FROM categories WHERE deleted_at IS NULL")
      .all() as any[];
    const productMap = new Map<string, any>(
      products.map((product: any) => [product.product_id, product])
    );
    const categoryMap = new Map<string, any>(categories.map((cat: any) => [cat.category_id, cat]));

    return mapPurchaseOrderRowFromDb(po, {
      supplier,
      items: items.map((item) => {
        const product = item.product_id ? productMap.get(item.product_id) : null;
        const category = product?.category_id
          ? (categoryMap.get(product.category_id) ?? null)
          : null;
        return mapPurchaseOrderItemRowFromDb(item, { product, category });
      })
    });
  },

  receiveItems: async (
    id: string,
    receivedItems: Array<{ itemId: string; receivedDate: Date }>
  ) => {
    const db = getLocalDb();
    const deviceId = ensureDeviceId();

    for (const item of receivedItems) {
      const existing = db
        .prepare("SELECT * FROM purchase_order_items WHERE po_item_id = ? AND deleted_at IS NULL")
        .get(item.itemId);
      if (!existing) {
        continue;
      }

      const updatedAt = nowIso();
      const version = Number(existing.version ?? 1) + 1;
      const row = {
        ...existing,
        received_date: item.receivedDate.toISOString(),
        version,
        updated_at: updatedAt,
        last_modified_by_device_id: deviceId
      };

      db.prepare(
        `
          UPDATE purchase_order_items
          SET received_date = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
          WHERE po_item_id = ?
        `
      ).run(
        row.received_date,
        row.version,
        row.updated_at,
        row.last_modified_by_device_id,
        row.po_item_id
      );

      enqueueOutbox("purchase_order_items", row.po_item_id, "update", row.version, row);
    }

    const items = db
      .prepare("SELECT * FROM purchase_order_items WHERE po_id = ? AND deleted_at IS NULL")
      .all(id);

    const allReceived = items.length > 0 && items.every((item: any) => item.received_date);

    if (allReceived) {
      const po = db
        .prepare("SELECT * FROM purchase_orders WHERE po_id = ? AND deleted_at IS NULL")
        .get(id);
      if (po) {
        const updatedAt = nowIso();
        const version = Number(po.version ?? 1) + 1;
        const row = {
          ...po,
          status: "completed",
          version,
          updated_at: updatedAt,
          last_modified_by_device_id: deviceId
        };
        db.prepare(
          `
            UPDATE purchase_orders
            SET status = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
            WHERE po_id = ?
          `
        ).run(row.status, row.version, row.updated_at, row.last_modified_by_device_id, id);
        enqueueOutbox("purchase_orders", id, "update", row.version, row);
      }
    }

    return await purchaseOrderService.findById(id);
  }
};

export const paymentService = {
  findMany: async (filters?: {
    invoiceId?: string;
    customerId?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }) => {
    const db = getLocalDb();
    let rows = db
      .prepare("SELECT * FROM payments WHERE deleted_at IS NULL ORDER BY created_at DESC")
      .all() as any[];

    if (filters?.invoiceId) {
      rows = rows.filter((row) => row.invoice_id === filters.invoiceId);
    }

    if (filters?.dateFrom || filters?.dateTo) {
      const from = filters.dateFrom ? new Date(filters.dateFrom) : null;
      const to = filters.dateTo ? new Date(filters.dateTo) : null;
      rows = rows.filter((row) => {
        const date = new Date(row.created_at);
        if (from && date < from) {
          return false;
        }
        if (to && date > to) {
          return false;
        }
        return true;
      });
    }

    const invoiceIds = rows.map((row) => row.invoice_id);
    const invoices = invoiceIds.length
      ? (db
          .prepare(
            `SELECT * FROM sales_invoices WHERE invoice_id IN (${invoiceIds.map(() => "?").join(", ")}) AND deleted_at IS NULL`
          )
          .all(...invoiceIds) as any[])
      : ([] as any[]);
    const invoiceMap = new Map<string, any>(
      invoices.map((invoice: any) => [invoice.invoice_id, invoice])
    );

    if (filters?.customerId) {
      rows = rows.filter((row) => {
        const invoice = invoiceMap.get(row.invoice_id);
        return invoice?.customer_id === filters.customerId;
      });
    }

    const employeeIds = invoices.map((invoice) => invoice.employee_id).filter(Boolean);
    const employees = employeeIds.length
      ? (db
          .prepare(
            `SELECT id, name, email FROM employee WHERE id IN (${employeeIds.map(() => "?").join(", ")}) AND deleted_at IS NULL`
          )
          .all(...employeeIds) as any[])
      : ([] as any[]);
    const employeeMap = new Map<string, any>(
      employees.map((employee: any) => [employee.id, employee])
    );

    const customerIds = invoices.map((invoice) => invoice.customer_id).filter(Boolean);
    const customers = customerIds.length
      ? (db
          .prepare(
            `SELECT customer_id, name, email FROM customers WHERE customer_id IN (${customerIds.map(() => "?").join(", ")}) AND deleted_at IS NULL`
          )
          .all(...customerIds) as any[])
      : ([] as any[]);
    const customerMap = new Map<string, any>(
      customers.map((customer: any) => [customer.customer_id, customer])
    );

    return rows.map((row) => {
      const invoice = invoiceMap.get(row.invoice_id);
      return {
        ...row,
        invoice: invoice
          ? {
              ...invoice,
              customer: invoice.customer_id ? (customerMap.get(invoice.customer_id) ?? null) : null,
              employee: invoice.employee_id ? (employeeMap.get(invoice.employee_id) ?? null) : null
            }
          : null
      };
    });
  },

  create: async (data: {
    invoiceId: string;
    amount: number;
    paymentMode: string;
    employeeId: string;
    notes?: string;
  }) => {
    const db = getLocalDb();
    const invoice = db
      .prepare("SELECT * FROM sales_invoices WHERE invoice_id = ? AND deleted_at IS NULL")
      .get(data.invoiceId);
    if (!invoice) {
      throw new Error("Invoice not found");
    }

    const paymentId = randomUUID();
    const deviceId = ensureDeviceId();
    const timestamp = nowIso();
    const row = {
      payment_id: paymentId,
      invoice_id: data.invoiceId,
      amount: data.amount,
      payment_mode: data.paymentMode,
      employee_id: data.employeeId,
      notes: data.notes ?? null,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        INSERT INTO payments (
          payment_id,
          invoice_id,
          amount,
          payment_mode,
          employee_id,
          notes,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      row.payment_id,
      row.invoice_id,
      row.amount,
      row.payment_mode,
      row.employee_id,
      row.notes,
      row.version,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.last_modified_by_device_id
    );

    enqueueOutbox("payments", row.payment_id, "insert", row.version, row);

    const payments = db
      .prepare("SELECT amount FROM payments WHERE invoice_id = ? AND deleted_at IS NULL")
      .all(data.invoiceId);
    const totalPaid = payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
    const outstandingBalance = Number(invoice.total_amount) - totalPaid;
    let paymentStatus = "paid";
    if (outstandingBalance > 0) {
      paymentStatus = totalPaid > 0 ? "partial" : "unpaid";
    }

    const invoiceUpdatedAt = nowIso();
    const invoiceVersion = Number(invoice.version ?? 1) + 1;
    const invoiceRow = {
      ...invoice,
      outstanding_balance: outstandingBalance,
      payment_status: paymentStatus,
      version: invoiceVersion,
      updated_at: invoiceUpdatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE sales_invoices
        SET outstanding_balance = ?, payment_status = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE invoice_id = ?
      `
    ).run(
      invoiceRow.outstanding_balance,
      invoiceRow.payment_status,
      invoiceRow.version,
      invoiceRow.updated_at,
      invoiceRow.last_modified_by_device_id,
      invoiceRow.invoice_id
    );

    enqueueOutbox(
      "sales_invoices",
      invoiceRow.invoice_id,
      "update",
      invoiceRow.version,
      invoiceRow
    );

    return row;
  },

  findById: async (id: string) => {
    const db = getLocalDb();
    return db.prepare("SELECT * FROM payments WHERE payment_id = ? AND deleted_at IS NULL").get(id);
  },

  update: async (
    id: string,
    data: {
      amount?: number;
      paymentMode?: string;
      notes?: string;
    }
  ) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM payments WHERE payment_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Payment not found");
    }

    const deviceId = ensureDeviceId();
    const updatedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const row = {
      ...existing,
      amount: data.amount ?? existing.amount,
      payment_mode: data.paymentMode ?? existing.payment_mode,
      notes: data.notes ?? existing.notes,
      version,
      updated_at: updatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE payments
        SET amount = ?, payment_mode = ?, notes = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE payment_id = ?
      `
    ).run(
      row.amount,
      row.payment_mode,
      row.notes,
      row.version,
      row.updated_at,
      row.last_modified_by_device_id,
      id
    );

    enqueueOutbox("payments", id, "update", row.version, row);
    return row;
  },

  delete: async (id: string) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM payments WHERE payment_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Payment not found");
    }

    const deletedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const deviceId = ensureDeviceId();
    const row = {
      ...existing,
      deleted_at: deletedAt,
      version,
      updated_at: deletedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE payments
        SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE payment_id = ?
      `
    ).run(row.deleted_at, row.version, row.updated_at, row.last_modified_by_device_id, id);

    enqueueOutbox("payments", id, "delete", row.version, row);
    return row;
  }
};

export const settingsService = {
  findMany: async () => {
    return await getSettingsCached();
  },

  findByKey: async (key: string) => {
    const db = getLocalDb();
    const row = db.prepare("SELECT * FROM settings WHERE key = ? AND deleted_at IS NULL").get(key);
    if (!row) {
      return null;
    }
    return {
      key: row.key,
      value: row.value,
      type: row.type,
      category: row.category,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  },

  upsert: async (
    key: string,
    value: string,
    type: string = "string",
    category: string = "general",
    description?: string
  ) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM settings WHERE key = ? AND deleted_at IS NULL")
      .get(key);
    const deviceId = ensureDeviceId();
    const timestamp = nowIso();

    if (existing) {
      const version = Number(existing.version ?? 1) + 1;
      const row = {
        ...existing,
        value,
        type,
        category,
        description: description ?? existing.description,
        version,
        updated_at: timestamp,
        last_modified_by_device_id: deviceId
      };
      db.prepare(
        `
          UPDATE settings
          SET value = ?, type = ?, category = ?, description = ?,
              version = ?, updated_at = ?, last_modified_by_device_id = ?
          WHERE key = ?
        `
      ).run(
        row.value,
        row.type,
        row.category,
        row.description,
        row.version,
        row.updated_at,
        row.last_modified_by_device_id,
        key
      );

      enqueueOutbox("settings", row.setting_id, "update", row.version, row);
      clearSettingsCache();
      return {
        key: row.key,
        value: row.value,
        type: row.type,
        category: row.category,
        description: row.description,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }

    const settingId = randomUUID();
    const row = {
      setting_id: settingId,
      key,
      value,
      type,
      category,
      description: description ?? null,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        INSERT INTO settings (
          setting_id,
          key,
          value,
          type,
          category,
          description,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      row.setting_id,
      row.key,
      row.value,
      row.type,
      row.category,
      row.description,
      row.version,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.last_modified_by_device_id
    );

    enqueueOutbox("settings", row.setting_id, "insert", row.version, row);
    clearSettingsCache();
    return {
      key: row.key,
      value: row.value,
      type: row.type,
      category: row.category,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  },

  updateBulk: async (
    settings: Array<{
      key: string;
      value: string;
      type?: string;
      category?: string;
      description?: string;
    }>
  ) => {
    const db = getLocalDb();
    const updatedSettings: SettingsRow[] = [];

    for (const setting of settings) {
      const existing = db.prepare("SELECT * FROM settings WHERE key = ?").get(setting.key);
      const deviceId = ensureDeviceId();
      const timestamp = nowIso();
      if (existing) {
        const version = Number(existing.version ?? 1) + 1;
        const row = {
          ...existing,
          value: setting.value,
          type: setting.type ?? existing.type ?? "string",
          category: setting.category ?? existing.category ?? "general",
          description: setting.description ?? existing.description,
          version,
          deleted_at: null,
          updated_at: timestamp,
          last_modified_by_device_id: deviceId
        };
        db.prepare(
          `
            UPDATE settings
            SET value = ?, type = ?, category = ?, description = ?,
                version = ?, deleted_at = ?, updated_at = ?, last_modified_by_device_id = ?
            WHERE key = ?
          `
        ).run(
          row.value,
          row.type,
          row.category,
          row.description,
          row.version,
          row.deleted_at,
          row.updated_at,
          row.last_modified_by_device_id,
          row.key
        );
        enqueueOutbox("settings", row.setting_id, "update", row.version, row);
        updatedSettings.push({
          key: row.key,
          value: row.value,
          type: row.type,
          category: row.category,
          description: row.description,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        });
      } else {
        const row = {
          setting_id: randomUUID(),
          key: setting.key,
          value: setting.value,
          type: setting.type ?? "string",
          category: setting.category ?? "general",
          description: setting.description ?? null,
          version: 1,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null,
          last_modified_by_device_id: deviceId
        };
        db.prepare(
          `
            INSERT INTO settings (
              setting_id,
              key,
              value,
              type,
              category,
              description,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_modified_by_device_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        ).run(
          row.setting_id,
          row.key,
          row.value,
          row.type,
          row.category,
          row.description,
          row.version,
          row.created_at,
          row.updated_at,
          row.deleted_at,
          row.last_modified_by_device_id
        );
        enqueueOutbox("settings", row.setting_id, "insert", row.version, row);
        updatedSettings.push({
          key: row.key,
          value: row.value,
          type: row.type,
          category: row.category,
          description: row.description,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        });
      }
    }

    clearSettingsCache();
    return updatedSettings;
  },

  delete: async (key: string) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM settings WHERE key = ? AND deleted_at IS NULL")
      .get(key);
    if (!existing) {
      return null;
    }

    const deletedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const deviceId = ensureDeviceId();
    db.prepare(
      `
        UPDATE settings
        SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE key = ?
      `
    ).run(deletedAt, version, deletedAt, deviceId, key);

    const payload = {
      ...existing,
      deleted_at: deletedAt,
      version,
      updated_at: deletedAt,
      last_modified_by_device_id: deviceId
    };
    enqueueOutbox("settings", payload.setting_id, "delete", payload.version, payload);
    clearSettingsCache();
    return payload;
  },

  getByCategory: async (category: string) => {
    const settings = await getSettingsCached();
    return settings
      .filter((setting) => setting.category === category)
      .sort((a, b) => a.key.localeCompare(b.key));
  }
};

// Role and Permission Services
export const roleService = {
  findMany: async () => {
    const db = getLocalDb();
    const roles = db
      .prepare("SELECT * FROM roles WHERE deleted_at IS NULL ORDER BY name ASC")
      .all() as any[];

    const roleIds = roles.map((role) => role.role_id);
    const rolePermissions = roleIds.length
      ? db
          .prepare(
            `
              SELECT rp.role_id, rp.permission_id, rp.granted, p.module, p.action, p.scope, p.description
              FROM role_permissions rp
              JOIN permissions p ON p.permission_id = rp.permission_id
              WHERE rp.deleted_at IS NULL AND p.deleted_at IS NULL AND rp.role_id IN (${roleIds
                .map(() => "?")
                .join(", ")})
            `
          )
          .all(...roleIds)
      : [];

    const employeeRoles = roleIds.length
      ? db
          .prepare(
            `
              SELECT er.role_id, er.employee_id, e.name, e.email
              FROM employee_roles er
              JOIN employee e ON e.id = er.employee_id
              WHERE er.deleted_at IS NULL AND e.deleted_at IS NULL AND er.role_id IN (${roleIds
                .map(() => "?")
                .join(", ")})
            `
          )
          .all(...roleIds)
      : [];

    const permissionMap = new Map();
    for (const row of rolePermissions) {
      const list = permissionMap.get(row.role_id) ?? [];
      list.push({
        permission: {
          id: row.permission_id,
          module: row.module,
          action: row.action,
          scope: row.scope,
          description: row.description
        },
        granted: Boolean(row.granted)
      });
      permissionMap.set(row.role_id, list);
    }

    const employeeMap = new Map();
    for (const row of employeeRoles) {
      const list = employeeMap.get(row.role_id) ?? [];
      list.push({
        employee: {
          id: row.employee_id,
          name: row.name,
          email: row.email
        }
      });
      employeeMap.set(row.role_id, list);
    }

    return roles.map((role) => ({
      ...mapRoleRowFromDb(role),
      rolePermissions: permissionMap.get(role.role_id) ?? [],
      employeeRoles: employeeMap.get(role.role_id) ?? []
    }));
  },

  create: async (data: { name: string; description?: string; isSystem?: boolean }) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT role_id FROM roles WHERE name = ? AND deleted_at IS NULL")
      .get(data.name);
    if (existing) {
      throw new Error(`Role with name "${data.name}" already exists`);
    }

    const roleId = randomUUID();
    const deviceId = ensureDeviceId();
    const timestamp = nowIso();
    const row = {
      role_id: roleId,
      name: data.name,
      description: data.description ?? null,
      is_system: data.isSystem ? 1 : 0,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        INSERT INTO roles (
          role_id,
          name,
          description,
          is_system,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      row.role_id,
      row.name,
      row.description,
      row.is_system,
      row.version,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.last_modified_by_device_id
    );

    enqueueOutbox("roles", row.role_id, "insert", row.version, row);
    return {
      ...mapRoleRowFromDb(row),
      rolePermissions: []
    };
  },

  update: async (
    id: string,
    data: {
      name?: string;
      description?: string;
    }
  ) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM roles WHERE role_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Role not found");
    }

    if (existing.is_system) {
      throw new Error("Cannot modify system roles");
    }

    if (data.name) {
      const duplicate = db
        .prepare("SELECT role_id FROM roles WHERE name = ? AND role_id != ? AND deleted_at IS NULL")
        .get(data.name, id);
      if (duplicate) {
        throw new Error(`Role with name "${data.name}" already exists`);
      }
    }

    const deviceId = ensureDeviceId();
    const updatedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const row = {
      ...existing,
      name: data.name ?? existing.name,
      description: data.description ?? existing.description,
      version,
      updated_at: updatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE roles
        SET name = ?, description = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE role_id = ?
      `
    ).run(
      row.name,
      row.description,
      row.version,
      row.updated_at,
      row.last_modified_by_device_id,
      id
    );

    enqueueOutbox("roles", id, "update", row.version, row);
    return {
      ...mapRoleRowFromDb(row),
      rolePermissions: []
    };
  },

  delete: async (id: string) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM roles WHERE role_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Role not found");
    }

    if (existing.is_system) {
      throw new Error("Cannot delete system roles");
    }

    const assignedEmployees = db
      .prepare("SELECT employee_id FROM employee_roles WHERE role_id = ? AND deleted_at IS NULL")
      .all(id);

    if (assignedEmployees.length > 0) {
      throw new Error("Cannot delete role assigned to employees");
    }

    const deletedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const deviceId = ensureDeviceId();
    const row = {
      ...existing,
      deleted_at: deletedAt,
      version,
      updated_at: deletedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE roles
        SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE role_id = ?
      `
    ).run(row.deleted_at, row.version, row.updated_at, row.last_modified_by_device_id, id);

    enqueueOutbox("roles", id, "delete", row.version, row);

    const rolePermissions = db
      .prepare("SELECT * FROM role_permissions WHERE role_id = ? AND deleted_at IS NULL")
      .all(id);
    for (const rp of rolePermissions) {
      const rpDeletedAt = nowIso();
      const rpVersion = Number(rp.version ?? 1) + 1;
      const rpRow = {
        ...rp,
        deleted_at: rpDeletedAt,
        version: rpVersion,
        updated_at: rpDeletedAt,
        last_modified_by_device_id: deviceId
      };
      db.prepare(
        `
          UPDATE role_permissions
          SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
          WHERE role_id = ? AND permission_id = ?
        `
      ).run(
        rpRow.deleted_at,
        rpRow.version,
        rpRow.updated_at,
        rpRow.last_modified_by_device_id,
        rpRow.role_id,
        rpRow.permission_id
      );
      enqueueOutbox(
        "role_permissions",
        buildCompositeRowId({ role_id: rpRow.role_id, permission_id: rpRow.permission_id }),
        "delete",
        rpRow.version,
        rpRow
      );
    }

    return mapRoleRowFromDb(row);
  },

  findById: async (id: string) => {
    const db = getLocalDb();
    const role = db.prepare("SELECT * FROM roles WHERE role_id = ? AND deleted_at IS NULL").get(id);
    if (!role) {
      return null;
    }

    const rolePermissions = db
      .prepare(
        `
          SELECT rp.permission_id, rp.granted, p.module, p.action, p.scope, p.description
          FROM role_permissions rp
          JOIN permissions p ON p.permission_id = rp.permission_id
          WHERE rp.deleted_at IS NULL AND p.deleted_at IS NULL AND rp.role_id = ?
        `
      )
      .all(id);

    const employeeRoles = db
      .prepare(
        `
          SELECT er.employee_id, e.name, e.email
          FROM employee_roles er
          JOIN employee e ON e.id = er.employee_id
          WHERE er.deleted_at IS NULL AND e.deleted_at IS NULL AND er.role_id = ?
        `
      )
      .all(id);

    return {
      ...mapRoleRowFromDb(role),
      rolePermissions: rolePermissions.map((row: any) => ({
        permission: {
          id: row.permission_id,
          module: row.module,
          action: row.action,
          scope: row.scope,
          description: row.description
        },
        granted: Boolean(row.granted)
      })),
      employeeRoles: employeeRoles.map((row: any) => ({
        employee: {
          id: row.employee_id,
          name: row.name,
          email: row.email
        }
      }))
    };
  },

  assignToEmployee: async (roleId: string, employeeId: string, assignedBy?: string) => {
    const db = getLocalDb();
    const existing = db
      .prepare(
        "SELECT * FROM employee_roles WHERE employee_id = ? AND role_id = ? AND deleted_at IS NULL"
      )
      .get(employeeId, roleId);

    if (existing) {
      throw new Error("Employee already has this role assigned");
    }

    const deviceId = ensureDeviceId();
    const timestamp = nowIso();
    const row = {
      employee_id: employeeId,
      role_id: roleId,
      assigned_at: timestamp,
      assigned_by: assignedBy ?? null,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        INSERT INTO employee_roles (
          employee_id,
          role_id,
          assigned_at,
          assigned_by,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      row.employee_id,
      row.role_id,
      row.assigned_at,
      row.assigned_by,
      row.version,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.last_modified_by_device_id
    );

    enqueueOutbox(
      "employee_roles",
      buildCompositeRowId({ employee_id: row.employee_id, role_id: row.role_id }),
      "insert",
      row.version,
      row
    );

    const role = db
      .prepare("SELECT role_id, name, description, is_system FROM roles WHERE role_id = ?")
      .get(roleId);
    const employee = db
      .prepare("SELECT id, name, email FROM employee WHERE id = ?")
      .get(employeeId);

    return {
      role: role
        ? {
            id: role.role_id,
            name: role.name,
            description: role.description,
            isSystem: Boolean(role.is_system)
          }
        : null,
      employee: employee ? { id: employee.id, name: employee.name, email: employee.email } : null
    };
  },

  removeFromEmployee: async (roleId: string, employeeId: string) => {
    const db = getLocalDb();
    const existing = db
      .prepare(
        "SELECT * FROM employee_roles WHERE employee_id = ? AND role_id = ? AND deleted_at IS NULL"
      )
      .get(employeeId, roleId);

    if (!existing) {
      throw new Error("Employee role assignment not found");
    }

    const deletedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const deviceId = ensureDeviceId();
    const row = {
      ...existing,
      deleted_at: deletedAt,
      version,
      updated_at: deletedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE employee_roles
        SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE employee_id = ? AND role_id = ?
      `
    ).run(
      row.deleted_at,
      row.version,
      row.updated_at,
      row.last_modified_by_device_id,
      employeeId,
      roleId
    );

    enqueueOutbox(
      "employee_roles",
      buildCompositeRowId({ employee_id: employeeId, role_id: roleId }),
      "delete",
      row.version,
      row
    );

    return row;
  },

  checkUsage: async (roleId: string) => {
    const db = getLocalDb();
    const countRow = db
      .prepare(
        "SELECT COUNT(1) AS count FROM employee_roles WHERE role_id = ? AND deleted_at IS NULL"
      )
      .get(roleId);

    return { count: Number(countRow?.count ?? 0) };
  }
};

export const permissionService = {
  findMany: async () => {
    const db = getLocalDb();
    const rows = db
      .prepare("SELECT * FROM permissions WHERE deleted_at IS NULL ORDER BY module, action, scope")
      .all();
    return rows.map(mapPermissionRowFromDb);
  },

  create: async (data: {
    module: string;
    action: string;
    scope?: string;
    description?: string;
  }) => {
    const db = getLocalDb();
    const existing = db
      .prepare(
        "SELECT permission_id FROM permissions WHERE module = ? AND action = ? AND scope IS ? AND deleted_at IS NULL"
      )
      .get(data.module, data.action, data.scope ?? null);
    if (existing) {
      throw new Error("Permission already exists");
    }

    const permissionId = randomUUID();
    const deviceId = ensureDeviceId();
    const timestamp = nowIso();
    const row = {
      permission_id: permissionId,
      module: data.module,
      action: data.action,
      scope: data.scope ?? null,
      description: data.description ?? null,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        INSERT INTO permissions (
          permission_id,
          module,
          action,
          scope,
          description,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      row.permission_id,
      row.module,
      row.action,
      row.scope,
      row.description,
      row.version,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.last_modified_by_device_id
    );

    enqueueOutbox("permissions", row.permission_id, "insert", row.version, row);
    return mapPermissionRowFromDb(row);
  },

  update: async (
    id: string,
    data: {
      description?: string;
    }
  ) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM permissions WHERE permission_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Permission not found");
    }

    const deviceId = ensureDeviceId();
    const updatedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const row = {
      ...existing,
      description: data.description ?? existing.description,
      version,
      updated_at: updatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE permissions
        SET description = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE permission_id = ?
      `
    ).run(row.description, row.version, row.updated_at, row.last_modified_by_device_id, id);

    enqueueOutbox("permissions", id, "update", row.version, row);
    return mapPermissionRowFromDb(row);
  },

  delete: async (id: string) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM permissions WHERE permission_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Permission not found");
    }

    const deletedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const deviceId = ensureDeviceId();
    const row = {
      ...existing,
      deleted_at: deletedAt,
      version,
      updated_at: deletedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE permissions
        SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE permission_id = ?
      `
    ).run(row.deleted_at, row.version, row.updated_at, row.last_modified_by_device_id, id);

    enqueueOutbox("permissions", id, "delete", row.version, row);
    return mapPermissionRowFromDb(row);
  },

  findById: async (id: string) => {
    const db = getLocalDb();
    const row = db
      .prepare("SELECT * FROM permissions WHERE permission_id = ? AND deleted_at IS NULL")
      .get(id);
    return mapPermissionRowFromDb(row);
  },

  findByModule: async (module: string) => {
    const db = getLocalDb();
    const rows = db
      .prepare(
        "SELECT * FROM permissions WHERE module = ? AND deleted_at IS NULL ORDER BY action ASC, scope ASC"
      )
      .all(module);
    return rows.map(mapPermissionRowFromDb);
  },

  bulkCreate: async (
    permissions: Array<{
      module: string;
      action: string;
      scope?: string;
      description?: string;
    }>
  ) => {
    const db = getLocalDb();
    const results: any[] = [];

    for (const perm of permissions) {
      const existing = db
        .prepare(
          "SELECT * FROM permissions WHERE module = ? AND action = ? AND scope IS ? AND deleted_at IS NULL"
        )
        .get(perm.module, perm.action, perm.scope ?? null);

      if (existing) {
        const deviceId = ensureDeviceId();
        const updatedAt = nowIso();
        const version = Number(existing.version ?? 1) + 1;
        const row = {
          ...existing,
          description: perm.description ?? existing.description,
          version,
          updated_at: updatedAt,
          last_modified_by_device_id: deviceId
        };
        db.prepare(
          `
            UPDATE permissions
            SET description = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
            WHERE permission_id = ?
          `
        ).run(
          row.description,
          row.version,
          row.updated_at,
          row.last_modified_by_device_id,
          row.permission_id
        );

        enqueueOutbox("permissions", row.permission_id, "update", row.version, row);
        results.push(mapPermissionRowFromDb(row));
      } else {
        const permissionId = randomUUID();
        const deviceId = ensureDeviceId();
        const timestamp = nowIso();
        const row = {
          permission_id: permissionId,
          module: perm.module,
          action: perm.action,
          scope: perm.scope ?? null,
          description: perm.description ?? null,
          version: 1,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null,
          last_modified_by_device_id: deviceId
        };
        db.prepare(
          `
            INSERT INTO permissions (
              permission_id,
              module,
              action,
              scope,
              description,
              version,
              created_at,
              updated_at,
              deleted_at,
              last_modified_by_device_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        ).run(
          row.permission_id,
          row.module,
          row.action,
          row.scope,
          row.description,
          row.version,
          row.created_at,
          row.updated_at,
          row.deleted_at,
          row.last_modified_by_device_id
        );

        enqueueOutbox("permissions", row.permission_id, "insert", row.version, row);
        results.push(mapPermissionRowFromDb(row));
      }
    }

    return results;
  }
};

export const rolePermissionService = {
  grantPermission: async (roleId: string, permissionId: string) => {
    const db = getLocalDb();
    const existing = db
      .prepare(
        "SELECT * FROM role_permissions WHERE role_id = ? AND permission_id = ? AND deleted_at IS NULL"
      )
      .get(roleId, permissionId);

    const deviceId = ensureDeviceId();
    const timestamp = nowIso();

    if (existing) {
      const version = Number(existing.version ?? 1) + 1;
      const row = {
        ...existing,
        granted: 1,
        version,
        updated_at: timestamp,
        last_modified_by_device_id: deviceId
      };
      db.prepare(
        `
          UPDATE role_permissions
          SET granted = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
          WHERE role_id = ? AND permission_id = ?
        `
      ).run(
        row.granted,
        row.version,
        row.updated_at,
        row.last_modified_by_device_id,
        roleId,
        permissionId
      );

      enqueueOutbox(
        "role_permissions",
        buildCompositeRowId({ role_id: roleId, permission_id: permissionId }),
        "update",
        row.version,
        row
      );
      return row;
    }

    const row = {
      role_id: roleId,
      permission_id: permissionId,
      granted: 1,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        INSERT INTO role_permissions (
          role_id,
          permission_id,
          granted,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      row.role_id,
      row.permission_id,
      row.granted,
      row.version,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.last_modified_by_device_id
    );

    enqueueOutbox(
      "role_permissions",
      buildCompositeRowId({ role_id: roleId, permission_id: permissionId }),
      "insert",
      row.version,
      row
    );

    return row;
  },

  revokePermission: async (roleId: string, permissionId: string) => {
    const db = getLocalDb();
    const existing = db
      .prepare(
        "SELECT * FROM role_permissions WHERE role_id = ? AND permission_id = ? AND deleted_at IS NULL"
      )
      .get(roleId, permissionId);

    if (!existing) {
      throw new Error("Role permission not found");
    }

    const deviceId = ensureDeviceId();
    const updatedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const row = {
      ...existing,
      granted: 0,
      version,
      updated_at: updatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE role_permissions
        SET granted = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE role_id = ? AND permission_id = ?
      `
    ).run(
      row.granted,
      row.version,
      row.updated_at,
      row.last_modified_by_device_id,
      roleId,
      permissionId
    );

    enqueueOutbox(
      "role_permissions",
      buildCompositeRowId({ role_id: roleId, permission_id: permissionId }),
      "update",
      row.version,
      row
    );

    return row;
  },

  removePermission: async (roleId: string, permissionId: string) => {
    const db = getLocalDb();
    const existing = db
      .prepare(
        "SELECT * FROM role_permissions WHERE role_id = ? AND permission_id = ? AND deleted_at IS NULL"
      )
      .get(roleId, permissionId);

    if (!existing) {
      throw new Error("Role permission not found");
    }

    const deletedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const deviceId = ensureDeviceId();
    const row = {
      ...existing,
      deleted_at: deletedAt,
      version,
      updated_at: deletedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE role_permissions
        SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE role_id = ? AND permission_id = ?
      `
    ).run(
      row.deleted_at,
      row.version,
      row.updated_at,
      row.last_modified_by_device_id,
      roleId,
      permissionId
    );

    enqueueOutbox(
      "role_permissions",
      buildCompositeRowId({ role_id: roleId, permission_id: permissionId }),
      "delete",
      row.version,
      row
    );

    return row;
  },

  getRolePermissions: async (roleId: string) => {
    const db = getLocalDb();
    const rows = db
      .prepare(
        `
          SELECT rp.role_id, rp.permission_id, rp.granted, p.module, p.action, p.scope, p.description
          FROM role_permissions rp
          JOIN permissions p ON p.permission_id = rp.permission_id
          WHERE rp.deleted_at IS NULL AND p.deleted_at IS NULL AND rp.role_id = ?
        `
      )
      .all(roleId) as any[];

    return rows.map((row) => ({
      roleId: row.role_id,
      permissionId: row.permission_id,
      granted: Boolean(row.granted),
      permission: mapPermissionRowFromDb({
        permission_id: row.permission_id,
        module: row.module,
        action: row.action,
        scope: row.scope,
        description: row.description
      })
    }));
  },

  getEmployeePermissions: async (employeeId: string) => {
    const db = getLocalDb();
    const rows = db
      .prepare(
        `
          SELECT p.permission_id, p.module, p.action, p.scope, p.description
          FROM employee_roles er
          JOIN role_permissions rp ON rp.role_id = er.role_id
          JOIN permissions p ON p.permission_id = rp.permission_id
          WHERE er.deleted_at IS NULL
            AND rp.deleted_at IS NULL
            AND p.deleted_at IS NULL
            AND er.employee_id = ?
            AND rp.granted = 1
        `
      )
      .all(employeeId);

    const seen = new Set();
    const uniqueRows = rows.filter((row: any) => {
      if (seen.has(row.permission_id)) {
        return false;
      }
      seen.add(row.permission_id);
      return true;
    });

    return uniqueRows.map((row: any) =>
      mapPermissionRowFromDb({
        permission_id: row.permission_id,
        module: row.module,
        action: row.action,
        scope: row.scope,
        description: row.description
      })
    );
  },

  checkEmployeePermission: async (
    employeeId: string,
    module: string,
    action: string,
    scope?: string
  ): Promise<boolean> => {
    const permissions = await rolePermissionService.getEmployeePermissions(employeeId);

    return permissions.some(
      (perm: any) =>
        perm.module === module &&
        perm.action === action &&
        (scope === undefined || perm.scope === scope || perm.scope === null)
    );
  }
};

export const customProductService = {
  findMany: async (options?: FindManyOptions) => {
    const db = getLocalDb();
    const selectKeys =
      options?.select && Object.keys(options.select).filter((key) => options.select?.[key]);
    const columns = selectKeys && selectKeys.length > 0 ? selectKeys.join(", ") : "*";

    let sql = `SELECT ${columns} FROM custom_products WHERE deleted_at IS NULL ORDER BY created_at DESC`;
    const params: Array<string | number> = [];
    if (options?.pagination?.take) {
      sql += " LIMIT ?";
      params.push(options.pagination.take);
    }
    if (options?.pagination?.skip) {
      sql += " OFFSET ?";
      params.push(options.pagination.skip);
    }

    return db.prepare(sql).all(...params);
  },

  create: async (data: { name: string; price: number }) => {
    const db = getLocalDb();
    const customProductId = randomUUID();
    const deviceId = ensureDeviceId();
    const timestamp = nowIso();
    const row = {
      custom_product_id: customProductId,
      name: data.name,
      price: data.price,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        INSERT INTO custom_products (
          custom_product_id,
          name,
          price,
          version,
          created_at,
          updated_at,
          deleted_at,
          last_modified_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      row.custom_product_id,
      row.name,
      row.price,
      row.version,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.last_modified_by_device_id
    );

    enqueueOutbox("custom_products", row.custom_product_id, "insert", row.version, row);
    return row;
  },

  findById: async (id: string) => {
    const db = getLocalDb();
    return db
      .prepare("SELECT * FROM custom_products WHERE custom_product_id = ? AND deleted_at IS NULL")
      .get(id);
  },

  update: async (id: string, data: { name?: string; price?: number }) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM custom_products WHERE custom_product_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Custom product not found");
    }

    const deviceId = ensureDeviceId();
    const updatedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const row = {
      ...existing,
      name: data.name ?? existing.name,
      price: data.price ?? existing.price,
      version,
      updated_at: updatedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE custom_products
        SET name = ?, price = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE custom_product_id = ?
      `
    ).run(row.name, row.price, row.version, row.updated_at, row.last_modified_by_device_id, id);

    enqueueOutbox("custom_products", id, "update", row.version, row);
    return row;
  },

  delete: async (id: string) => {
    const db = getLocalDb();
    const existing = db
      .prepare("SELECT * FROM custom_products WHERE custom_product_id = ? AND deleted_at IS NULL")
      .get(id);
    if (!existing) {
      throw new Error("Custom product not found");
    }

    const deletedAt = nowIso();
    const version = Number(existing.version ?? 1) + 1;
    const deviceId = ensureDeviceId();
    const row = {
      ...existing,
      deleted_at: deletedAt,
      version,
      updated_at: deletedAt,
      last_modified_by_device_id: deviceId
    };

    db.prepare(
      `
        UPDATE custom_products
        SET deleted_at = ?, version = ?, updated_at = ?, last_modified_by_device_id = ?
        WHERE custom_product_id = ?
      `
    ).run(row.deleted_at, row.version, row.updated_at, row.last_modified_by_device_id, id);

    enqueueOutbox("custom_products", id, "delete", row.version, row);
    return row;
  }
};

let tenantTablesEnsured = false;
let tenantTablesEnsuring: Promise<void> | null = null;

const ensureTenantTables = async (): Promise<void> => {
  if (tenantTablesEnsured) {
    return;
  }

  if (tenantTablesEnsuring) {
    await tenantTablesEnsuring;
    return;
  }

  tenantTablesEnsuring = (async () => {
    const prisma = getPrismaClient();
    const result = (await prisma.$queryRawUnsafe(
      "SELECT to_regclass('public.tenants')::text AS tenants, to_regclass('public.tenant_users')::text AS tenant_users, to_regclass('public.subscriptions')::text AS subscriptions"
    )) as {
      tenants?: string | null;
      tenant_users?: string | null;
      subscriptions?: string | null;
    }[];

    const status = result?.[0] ?? {};
    const hasTenants = Boolean(status.tenants);
    const hasTenantUsers = Boolean(status.tenant_users);
    const hasSubscriptions = Boolean(status.subscriptions);

    if (!hasTenants) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS public.tenants (
          id TEXT PRIMARY KEY,
          "schemaName" TEXT NOT NULL UNIQUE,
          "businessName" TEXT,
          "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
    }

    if (!hasTenantUsers) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS public.tenant_users (
          id TEXT PRIMARY KEY,
          "tenantId" TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
          email TEXT NOT NULL UNIQUE,
          "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
    }

    if (!hasSubscriptions) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS public.subscriptions (
          id TEXT PRIMARY KEY,
          "tenantId" TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
          "planName" TEXT NOT NULL,
          "joinedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
          status TEXT NOT NULL,
          "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
    }

    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_tenant_users_email ON public.tenant_users(email);"
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_id ON public.tenant_users("tenantId");'
    );
    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_id ON public.subscriptions("tenantId");'
    );
  })();

  try {
    await tenantTablesEnsuring;
    tenantTablesEnsured = true;
  } finally {
    tenantTablesEnsuring = null;
  }
};

export const tenantService = {
  findMany: async () => {
    await ensureTenantTables();
    const prisma = getPrismaClient();
    return await prisma.$queryRaw`
      SELECT * FROM public.tenants
      ORDER BY "createdAt" DESC
    `;
  },

  create: async (data: { id: string; schema_name: string; company_name?: string }) => {
    await ensureTenantTables();
    const prisma = getPrismaClient();
    return await prisma.$queryRaw`
      INSERT INTO public.tenants (id, "schemaName", "businessName", "createdAt", "updatedAt")
      VALUES (${data.id}, ${data.schema_name}, ${data.company_name || null}, NOW(), NOW())
      RETURNING *
    `;
  },

  findById: async (id: string) => {
    await ensureTenantTables();
    const prisma = getPrismaClient();
    const result = await prisma.$queryRaw`
      SELECT * FROM public.tenants WHERE id = ${id}
    `;
    return (result as any[])[0] || null;
  },

  findBySchemaName: async (schemaName: string) => {
    await ensureTenantTables();
    const prisma = getPrismaClient();
    const result = await prisma.$queryRaw`
      SELECT * FROM public.tenants WHERE "schemaName" = ${schemaName}
    `;
    return (result as any[])[0] || null;
  },

  update: async (id: string, data: { schema_name?: string; company_name?: string }) => {
    await ensureTenantTables();
    const prisma = getPrismaClient();

    if (data.schema_name !== undefined && data.company_name !== undefined) {
      return await prisma.$queryRaw`
        UPDATE public.tenants
        SET "schemaName" = ${data.schema_name}, "businessName" = ${data.company_name}, "updatedAt" = NOW()
        WHERE id = ${id}
        RETURNING *
      `;
    } else if (data.schema_name !== undefined) {
      return await prisma.$queryRaw`
        UPDATE public.tenants
        SET "schemaName" = ${data.schema_name}, "updatedAt" = NOW()
        WHERE id = ${id}
        RETURNING *
      `;
    } else if (data.company_name !== undefined) {
      return await prisma.$queryRaw`
        UPDATE public.tenants
        SET "businessName" = ${data.company_name}, "updatedAt" = NOW()
        WHERE id = ${id}
        RETURNING *
      `;
    }

    return null;
  },

  delete: async (id: string) => {
    await ensureTenantTables();
    const prisma = getPrismaClient();
    return await prisma.$queryRaw`
      DELETE FROM public.tenants WHERE id = ${id}
      RETURNING *
    `;
  }
};

export const subscriptionService = {
  findMany: async () => {
    await ensureTenantTables();
    const prisma = getPrismaClient();
    return await prisma.$queryRaw`
      SELECT * FROM public.subscriptions
      ORDER BY "createdAt" DESC
    `;
  },

  create: async (data: {
    tenantId: string;
    planName: string;
    joinedAt?: Date;
    expiresAt: Date;
    status: string;
  }) => {
    await ensureTenantTables();
    const prisma = getPrismaClient();
    const joinedAt = data.joinedAt || new Date();

    return await prisma.$queryRaw`
      INSERT INTO public.subscriptions ("tenantId", "planName", "joinedAt", "expiresAt", status, "createdAt", "updatedAt")
      VALUES (${data.tenantId}, ${data.planName}, ${joinedAt}, ${data.expiresAt}, ${data.status}, NOW(), NOW())
      RETURNING *
    `;
  },

  findByTenantId: async (tenantId: string) => {
    await ensureTenantTables();
    const prisma = getPrismaClient();
    const result = await prisma.$queryRaw`
      SELECT * FROM public.subscriptions
      WHERE "tenantId" = ${tenantId}
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;
    return (result as any[])[0] || null;
  },

  findById: async (id: string) => {
    await ensureTenantTables();
    const prisma = getPrismaClient();
    const result = await prisma.$queryRaw`
      SELECT * FROM public.subscriptions WHERE id = ${id}
    `;
    return (result as any[])[0] || null;
  },

  update: async (
    id: string,
    data: {
      planName?: string;
      expiresAt?: Date;
      status?: string;
    }
  ) => {
    await ensureTenantTables();
    const prisma = getPrismaClient();

    const updateFields: string[] = [];
    const values: (string | Date)[] = [];

    if (data.planName !== undefined) {
      updateFields.push(`"planName" = $${values.length + 1}`);
      values.push(data.planName);
    }

    if (data.expiresAt !== undefined) {
      updateFields.push(`"expiresAt" = $${values.length + 1}`);
      values.push(data.expiresAt);
    }

    if (data.status !== undefined) {
      updateFields.push(`status = $${values.length + 1}`);
      values.push(data.status);
    }

    if (updateFields.length === 0) return null;

    updateFields.push(`"updatedAt" = NOW()`);
    values.push(id);

    const query = `
      UPDATE public.subscriptions
      SET ${updateFields.join(", ")}
      WHERE id = $${values.length}
      RETURNING *
    `;

    return await prisma.$queryRawUnsafe(query, ...values);
  },

  delete: async (id: string) => {
    await ensureTenantTables();
    const prisma = getPrismaClient();
    return await prisma.$queryRaw`
      DELETE FROM public.subscriptions WHERE id = ${id}
      RETURNING *
    `;
  }
};

export const tenantUserService = {
  findMany: async () => {
    await ensureTenantTables();
    const prisma = getPrismaClient();
    return await prisma.$queryRaw`
      SELECT tu.*, tu."tenantId" AS "tenantId", t."schemaName" AS "schemaName", t."businessName" AS "businessName"
      FROM public.tenant_users tu
      JOIN public.tenants t ON tu."tenantId" = t.id
      ORDER BY tu."createdAt" DESC
    `;
  },

  create: async (data: { id: string; tenant_id?: string; tenantId?: string; email: string }) => {
    await ensureTenantTables();
    const prisma = getPrismaClient();
    const tenantId = data.tenant_id ?? data.tenantId;
    if (!tenantId) {
      throw new Error("Missing tenantId for tenant user");
    }

    return await prisma.$queryRaw`
      INSERT INTO public.tenant_users (id, "tenantId", email, "createdAt", "updatedAt")
      VALUES (${data.id}, ${tenantId}, ${data.email}, NOW(), NOW())
      RETURNING *
    `;
  },

  findByEmail: async (email: string) => {
    await ensureTenantTables();
    const prisma = getPrismaClient();
    const result = await prisma.$queryRaw`
      SELECT tu.*, tu."tenantId" AS "tenantId", t."schemaName" AS "schemaName", t."businessName" AS "businessName"
      FROM public.tenant_users tu
      JOIN public.tenants t ON tu."tenantId" = t.id
      WHERE tu.email = ${email}
    `;
    return (result as any[])[0] || null;
  },

  findById: async (id: string) => {
    await ensureTenantTables();
    const prisma = getPrismaClient();
    const result = await prisma.$queryRaw`
      SELECT tu.*, tu."tenantId" AS "tenantId", t."schemaName" AS "schemaName", t."businessName" AS "businessName"
      FROM public.tenant_users tu
      JOIN public.tenants t ON tu."tenantId" = t.id
      WHERE tu.id = ${id}
    `;
    return (result as any[])[0] || null;
  },

  update: async (id: string, data: { email?: string }) => {
    await ensureTenantTables();
    const prisma = getPrismaClient();
    if (!data.email) return null;

    return await prisma.$queryRaw`
      UPDATE public.tenant_users
      SET email = ${data.email}, "updatedAt" = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
  },

  delete: async (id: string) => {
    await ensureTenantTables();
    const prisma = getPrismaClient();
    return await prisma.$queryRaw`
      DELETE FROM public.tenant_users WHERE id = ${id}
      RETURNING *
    `;
  },

  findByTenantId: async (tenantId: string) => {
    await ensureTenantTables();
    const prisma = getPrismaClient();
    return await prisma.$queryRaw`
      SELECT tu.*, tu."tenantId" AS "tenantId", t."schemaName" AS "schemaName", t."businessName" AS "businessName"
      FROM public.tenant_users tu
      JOIN public.tenants t ON tu."tenantId" = t.id
      WHERE tu."tenantId" = ${tenantId}
      ORDER BY tu."createdAt" DESC
    `;
  }
};

type TenantUserColumnConfig = {
  id: string;
  tenantId: string;
  email: string;
  passwordHash?: string;
};

let tenantUserColumnConfig: TenantUserColumnConfig | null = null;

const quoteIdentifier = (columnName: string): string => `"${columnName}"`;

const resolveTenantUserColumns = async (): Promise<TenantUserColumnConfig> => {
  if (tenantUserColumnConfig) {
    return tenantUserColumnConfig;
  }

  await ensureTenantTables();
  const prisma = getPrismaClient();
  const columns = (await prisma.$queryRawUnsafe(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tenant_users'
    `
  )) as { column_name: string }[];

  const columnNames = new Set(columns.map((column) => column.column_name));

  const pickColumn = (options: string[], fallback: string): string => {
    const match = options.find((option) => columnNames.has(option));
    return quoteIdentifier(match ?? fallback);
  };

  const pickOptionalColumn = (options: string[]): string | undefined => {
    const match = options.find((option) => columnNames.has(option));
    return match ? quoteIdentifier(match) : undefined;
  };

  tenantUserColumnConfig = {
    id: pickColumn(["id"], "id"),
    tenantId: pickColumn(["tenantId", "tenant_id"], "tenantId"),
    email: pickColumn(["email"], "email"),
    passwordHash: pickOptionalColumn(["passwordHash", "password_hash"])
  };

  return tenantUserColumnConfig;
};

const resolveTenantId = async (tenantId?: string): Promise<string | null> => {
  if (tenantId) {
    return tenantId;
  }

  await ensureTenantTables();
  const schemaName = getActiveSchema();
  if (!schemaName) {
    return null;
  }

  const prisma = getPrismaClient();
  const result = (await prisma.$queryRawUnsafe(
    `
      SELECT id
      FROM public.tenants
      WHERE "schemaName" = $1
    `,
    schemaName
  )) as { id: string }[];

  return result[0]?.id ?? null;
};

const upsertTenantUser = async (data: {
  tenantId?: string;
  email?: string;
  passwordHash?: string;
  previousEmail?: string;
}): Promise<void> => {
  const resolvedTenantId = await resolveTenantId(data.tenantId);

  if (!resolvedTenantId || !data.email) {
    console.log("Skipping tenant user upsert due to missing tenant ID or email");
    return;
  }

  const prisma = getPrismaClient();
  const columns = await resolveTenantUserColumns();
  const lookupEmail = data.previousEmail ?? data.email;

  const existingRows = (await prisma.$queryRawUnsafe(
    `
      SELECT ${columns.id} AS id
      FROM public.tenant_users
      WHERE ${columns.email} = $1
    `,
    lookupEmail
  )) as { id?: string }[];

  if (existingRows.length > 0) {
    const existingId = existingRows[0]?.id;
    if (!existingId) {
      return;
    }

    const values: (string | null)[] = [data.email, resolvedTenantId];
    const updateFields = [`${columns.email} = $1`, `${columns.tenantId} = $2`];

    if (data.passwordHash && columns.passwordHash) {
      updateFields.push(`${columns.passwordHash} = $${values.length + 1}`);
      values.push(data.passwordHash);
    }

    values.push(existingId);

    const updateQuery = `
      UPDATE public.tenant_users
      SET ${updateFields.join(", ")}
      WHERE ${columns.id} = $${values.length}
      RETURNING *
    `;

    await prisma.$queryRawUnsafe(updateQuery, ...values);
    return;
  }

  const insertColumns = [columns.id, columns.tenantId, columns.email];
  const values: string[] = [randomUUID(), resolvedTenantId, data.email];
  const placeholders = values.map((_, index) => `$${index + 1}`);

  if (data.passwordHash && columns.passwordHash) {
    insertColumns.push(columns.passwordHash);
    values.push(data.passwordHash);
    placeholders.push(`$${values.length}`);
  }

  const insertQuery = `
    INSERT INTO public.tenant_users (${insertColumns.join(", ")})
    VALUES (${placeholders.join(", ")})
    RETURNING *
  `;

  await prisma.$queryRawUnsafe(insertQuery, ...values);
};
