import { randomUUID } from "crypto";
import { getActiveSchema, getPrismaClient } from "./prisma";
import * as bcrypt from "bcrypt";
import { validateAndFormatQuantity } from "./quantityValidation";

const DEFAULT_DB_CONCURRENCY = 5;

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

const applyPagination = (query: Record<string, unknown>, pagination?: PaginationOptions): void => {
  if (!pagination) {
    return;
  }

  if (typeof pagination.skip === "number" && pagination.skip >= 0) {
    query.skip = pagination.skip;
  }

  if (typeof pagination.take === "number" && pagination.take > 0) {
    query.take = pagination.take;
  }
};

const buildProductWhereClause = (filters?: ProductFilters): Record<string, unknown> => {
  const whereClause: Record<string, unknown> = {};
  const orClauses: Record<string, unknown>[] = [];

  if (filters?.searchTerm) {
    const term = filters.searchTerm.trim();
    if (term) {
      orClauses.push(
        { name: { contains: term, mode: "insensitive" } },
        { englishName: { contains: term, mode: "insensitive" } },
        { sku: { contains: term, mode: "insensitive" } },
        { barcode: { contains: term, mode: "insensitive" } },
        { brand: { contains: term, mode: "insensitive" } },
        { description: { contains: term, mode: "insensitive" } }
      );
    }
  }

  if (filters?.code) {
    const code = filters.code.trim();
    if (code) {
      orClauses.push({ barcode: code }, { sku: code });
    }
  }

  if (orClauses.length > 0) {
    whereClause.OR = orClauses;
  }

  if (filters?.categoryId) {
    whereClause.categoryId = filters.categoryId;
  }

  if (filters?.stockFilter === "inStock") {
    whereClause.stockLevel = { gt: 0 };
  } else if (filters?.stockFilter === "outOfStock") {
    whereClause.stockLevel = { equals: 0 };
  }

  if (filters?.minPrice !== undefined || filters?.maxPrice !== undefined) {
    const priceFilter: Record<string, number> = {};
    if (filters?.minPrice !== undefined) {
      priceFilter.gte = filters.minPrice;
    }
    if (filters?.maxPrice !== undefined) {
      priceFilter.lte = filters.maxPrice;
    }
    whereClause.price = priceFilter;
  }

  return whereClause;
};

const buildProductOrderBy = (sort?: ProductSort): Record<string, unknown> => {
  const field = sort?.field ?? "createdAt";
  const direction = sort?.direction ?? "desc";

  switch (field) {
    case "name":
      return { name: direction };
    case "price":
      return { price: direction };
    case "category":
      return { category: { name: direction } };
    case "stock":
      return { stockLevel: direction };
    case "createdAt":
    default:
      return { createdAt: direction };
  }
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

const PRODUCT_CACHE_TTL_MS = 86400000;
const PRODUCT_CACHE_MAX = 1000;

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

const pruneProductCache = (): void => {
  if (productCache.size <= PRODUCT_CACHE_MAX) {
    return;
  }

  const overflow = productCache.size - PRODUCT_CACHE_MAX;
  const keys = productCache.keys();

  for (let i = 0; i < overflow; i += 1) {
    const next = keys.next();
    if (next.done) {
      break;
    }
    productCache.delete(next.value);
  }
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

const buildInventoryWhereClause = async (
  prisma: ReturnType<typeof getPrismaClient>,
  filters?: InventoryFilters
): Promise<Record<string, unknown>> => {
  const whereClause: Record<string, unknown> = {};
  const orClauses: Record<string, unknown>[] = [];

  if (filters?.productId) {
    whereClause.productId = filters.productId;
  }

  if (filters?.searchTerm) {
    const term = filters.searchTerm.trim();
    if (term) {
      orClauses.push(
        { batchNumber: { contains: term, mode: "insensitive" } },
        { product: { name: { contains: term, mode: "insensitive" } } },
        { product: { englishName: { contains: term, mode: "insensitive" } } },
        { product: { sku: { contains: term, mode: "insensitive" } } },
        { product: { barcode: { contains: term, mode: "insensitive" } } }
      );
    }
  }

  if (filters?.expiringSoon) {
    const expiryThreshold = new Date();
    expiryThreshold.setDate(expiryThreshold.getDate() + 7);
    whereClause.expiryDate = { lte: expiryThreshold };
  }

  if (filters?.lowStock) {
    const lowStockRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT inventory_id AS id
      FROM inventory
      WHERE quantity <= reorder_level
    `;
    whereClause.id = { in: lowStockRows.map((row) => row.id) };
  }

  if (orClauses.length > 0) {
    whereClause.OR = orClauses;
  }

  return whereClause;
};

const buildStockTransactionWhereClause = (
  filters?: StockTransactionFilters
): Record<string, unknown> => {
  const whereClause: Record<string, unknown> = {};
  const orClauses: Record<string, unknown>[] = [];

  if (filters?.productId) {
    whereClause.productId = filters.productId;
  }

  if (filters?.reason) {
    whereClause.reason = { contains: filters.reason, mode: "insensitive" };
  }

  if (filters?.dateFrom || filters?.dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (filters.dateFrom) {
      dateFilter.gte = filters.dateFrom;
    }
    if (filters.dateTo) {
      dateFilter.lte = filters.dateTo;
    }
    whereClause.transactionDate = dateFilter;
  }

  if (filters?.searchTerm) {
    const term = filters.searchTerm.trim();
    if (term) {
      orClauses.push(
        { reason: { contains: term, mode: "insensitive" } },
        { product: { name: { contains: term, mode: "insensitive" } } },
        { product: { englishName: { contains: term, mode: "insensitive" } } },
        { product: { sku: { contains: term, mode: "insensitive" } } }
      );
    }
  }

  if (orClauses.length > 0) {
    whereClause.OR = orClauses;
  }

  return whereClause;
};

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const safeLimit = Math.max(1, limit);
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) {
        return;
      }
      results[current] = await task(items[current], current);
    }
  };

  const workerCount = Math.min(safeLimit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

// Centralized stock level update utility
export const updateProductStockLevel = async (
  productId: string,
  newStockLevel: number,
  prismaInstance?: any // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<{ id: string; name: string; stockLevel: number }> => {
  const prisma = prismaInstance || getPrismaClient();
  const formattedStockLevel = validateAndFormatQuantity(newStockLevel);

  const updatedProduct = await prisma.product.update({
    where: { id: productId },
    data: { stockLevel: formattedStockLevel },
    select: {
      id: true,
      name: true,
      stockLevel: true
    }
  });
  clearProductCache();
  return updatedProduct;
};

// Sync product stock level with total inventory
export const syncProductStockWithInventory = async (
  productId: string,
  prismaInstance?: ReturnType<typeof getPrismaClient>
): Promise<{ id: string; name: string; stockLevel: number }> => {
  const prisma = prismaInstance || getPrismaClient();

  const totalInventory = await prisma.inventory.aggregate({
    where: { productId },
    _sum: { quantity: true }
  });

  const newStockLevel = totalInventory._sum.quantity || 0;
  return await updateProductStockLevel(productId, newStockLevel, prisma);
};

export const categoryService = {
  findMany: async (options?: FindManyOptions) => {
    const prisma = getPrismaClient();
    const query: Record<string, unknown> = {
      orderBy: { createdAt: "desc" }
    };

    if (options?.select) {
      query.select = options.select;
    } else {
      query.include = {
        parentCategory: true,
        subCategories: true
      };
    }

    applyPagination(query, options?.pagination);
    return await prisma.category.findMany(query as any);
  },

  create: async (data: { name: string; parentCategoryId?: string }) => {
    const prisma = getPrismaClient();

    // Check for duplicate name (case-insensitive for SQLite)
    const existingCategories = await prisma.category.findMany({
      where: {
        name: {
          contains: data.name
        }
      }
    });

    const duplicateCategory = existingCategories.find(
      (cat) => cat.name.toLowerCase() === data.name.toLowerCase()
    );

    if (duplicateCategory) {
      throw new Error(`Category with name "${data.name}" already exists`);
    }

    return await prisma.category.create({
      data,
      include: {
        parentCategory: true,
        subCategories: true
      }
    });
  },

  update: async (id: string, data: { name: string; parentCategoryId?: string }) => {
    const prisma = getPrismaClient();

    // Check for duplicate name (case-insensitive for SQLite, excluding current category)
    const existingCategories = await prisma.category.findMany({
      where: {
        name: {
          contains: data.name
        },
        NOT: {
          id: id
        }
      }
    });

    const duplicateCategory = existingCategories.find(
      (cat) => cat.name.toLowerCase() === data.name.toLowerCase()
    );

    if (duplicateCategory) {
      throw new Error(`Category with name "${data.name}" already exists`);
    }

    return await prisma.category.update({
      where: { id },
      data,
      include: {
        parentCategory: true,
        subCategories: true
      }
    });
  },

  delete: async (id: string) => {
    const prisma = getPrismaClient();
    return await prisma.category.delete({
      where: { id }
    });
  }
};

export const productService = {
  findMany: async (options?: ProductFindManyOptions) => {
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

    const prisma = getPrismaClient();
    const query: Record<string, unknown> = {
      orderBy: buildProductOrderBy(options?.sort),
      where: buildProductWhereClause(options?.filters)
    };

    if (options?.select) {
      query.select = options.select;
    } else {
      query.include = {
        category: true,
        images: true,
        productTags: {
          include: {
            tag: true
          }
        }
      };
    }

    applyPagination(query, options?.pagination);
    // console.log("[productService.findMany] hitting database", {
    //   cacheKey,
    //   filters: options?.filters,
    //   sort: options?.sort,
    //   pagination: options?.pagination
    // });
    const promise = prisma.product.findMany(query as any).then((rows) => {
      productCache.set(cacheKey, {
        data: rows as any[],
        expiresAt: Date.now() + PRODUCT_CACHE_TTL_MS
      });
      productCacheInFlight.delete(cacheKey);
      pruneProductCache();
      // console.log("[productService.findMany] cached query result", { cacheKey, count: rows.length });
      return rows as any[];
    });

    productCacheInFlight.set(cacheKey, promise);
    return promise.catch((error) => {
      // console.error("[productService.findMany] query failed", { cacheKey, error });
      productCacheInFlight.delete(cacheKey);
      throw error;
    });
  },
  count: async (filters?: ProductFilters) => {
    const prisma = getPrismaClient();
    return await prisma.product.count({
      where: buildProductWhereClause(filters)
    });
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
    taxInclusivePrice?: number;
    taxRate?: number;
    unitSize?: string;
    stockLevel?: number;
  }) => {
    const prisma = getPrismaClient();

    // Validate categoryId exists
    if (data.categoryId) {
      const categoryExists = await prisma.category.findUnique({
        where: { id: data.categoryId }
      });

      if (!categoryExists) {
        throw new Error(`Category with ID "${data.categoryId}" does not exist`);
      }
    }

    // // Check for duplicate name (case-insensitive for SQLite)
    // const existingProductsByName = await prisma.product.findMany({
    //   where: {
    //     name: {
    //       contains: data.name
    //     }
    //   }
    // });

    // const duplicateProductByName = existingProductsByName.find(
    //   (product) => product.name.toLowerCase() === data.name.toLowerCase()
    // );

    // if (duplicateProductByName) {
    //   throw new Error(`Product with name "${data.name}" already exists`);
    // }

    const createdProduct = await prisma.product.create({
      data: {
        ...data,
        costPrice: data.costPrice ?? 0,
        stockLevel: data.stockLevel !== undefined ? validateAndFormatQuantity(data.stockLevel) : 0
      },
      include: {
        category: true,
        images: true,
        productTags: {
          include: {
            tag: true
          }
        }
      }
    });
    clearProductCache();
    return createdProduct;
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
      taxInclusivePrice?: number;
      taxRate?: number;
      unitSize?: string;
      stockLevel?: number;
    }
  ) => {
    const prisma = getPrismaClient();
    console.log(data.stockLevel);
    // // Check for duplicate name if provided (case-insensitive for SQLite, excluding current product)
    // if (data.name) {
    //   const existingProductsByName = await prisma.product.findMany({
    //     where: {
    //       name: {
    //         contains: data.name
    //       },
    //       NOT: {
    //         id: id
    //       }
    //     },
    //     select: {
    //       id: true,
    //       name: true,
    //       stockLevel: true
    //     }
    //   });

    //   const duplicateProductByName = existingProductsByName.find(
    //     (product) => product.name.toLowerCase() === data.name!.toLowerCase()
    //   );

    //   if (duplicateProductByName) {
    //     throw new Error(`Product with name "${data.name}" already exists`);
    //   }
    // }

    const updateData = { ...data };

    const updatedProduct = await prisma.product.update({
      where: { id },
      data: updateData,
      include: {
        category: true,
        images: true,
        productTags: {
          include: {
            tag: true
          }
        }
      }
    });
    clearProductCache();
    return updatedProduct;
  },

  delete: async (id: string) => {
    const prisma = getPrismaClient();

    const deletedProduct = await prisma.$transaction(async (tx) => {
      // Check if product exists
      const product = await tx.product.findUnique({
        where: { id },
        include: {
          inventory: true,
          salesDetails: true,
          purchaseOrderItems: true,
          stockTransactions: true
        }
      });

      if (!product) {
        throw new Error("Product not found");
      }

      // Check if product has been used in sales
      if (product.salesDetails.length > 0) {
        throw new Error(
          "Cannot delete product that has been used in sales transactions. " +
            "This would compromise transaction history integrity."
        );
      }

      // Check if product has been used in purchase orders
      if (product.purchaseOrderItems.length > 0) {
        throw new Error(
          "Cannot delete product that has been used in purchase orders. " +
            "This would compromise purchase history integrity."
        );
      }

      // Delete related records in proper order

      // 1. Delete inventory records
      if (product.inventory.length > 0) {
        await tx.inventory.deleteMany({
          where: { productId: id }
        });
      }

      // 2. Delete stock transactions
      if (product.stockTransactions.length > 0) {
        await tx.stockTransaction.deleteMany({
          where: { productId: id }
        });
      }

      // 3. Delete product images
      await tx.productImage.deleteMany({
        where: { productId: id }
      });

      // 4. Delete product tag mappings
      await tx.productTagMap.deleteMany({
        where: { productId: id }
      });

      // 5. Delete inventory reports (if any)
      await tx.reportInventorySummary.deleteMany({
        where: { productId: id }
      });

      // 6. Finally delete the product
      const deletedProduct = await tx.product.delete({
        where: { id }
      });

      return deletedProduct;
    });
    clearProductCache();
    return deletedProduct;
  }
};

export const employeeService = {
  findMany: async (options?: FindManyOptions) => {
    const prisma = getPrismaClient();
    const query: Record<string, unknown> = {
      orderBy: { createdAt: "desc" }
    };

    if (options?.select) {
      query.select = options.select;
    } else {
      query.include = {
        employeeRoles: {
          include: {
            role: {
              select: {
                id: true,
                name: true,
                description: true,
                isSystem: true
              }
            }
          }
        }
      };
    }

    applyPagination(query, options?.pagination);
    return await prisma.employee.findMany(query as any);
  },

  create: async (data: {
    employee_id: string;
    name: string;
    role: string; // Keep for backwards compatibility
    email: string;
    address?: string;
    password_hash: string;
  }) => {
    const prisma = getPrismaClient();
    return await prisma.employee.create({
      data,
      include: {
        employeeRoles: {
          include: {
            role: {
              select: {
                id: true,
                name: true,
                description: true,
                isSystem: true
              }
            }
          }
        }
      }
    });
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
      const prisma = getPrismaClient();

      const employeeWithRoles = await prisma.$transaction(async (tx) => {
        const roleRecord =
          data.roleId
            ? await tx.role.findUnique({ where: { id: data.roleId }, select: { name: true } })
            : null;
        const assignedRoleName = roleRecord?.name ?? "";

        // Create employee with the assigned role name stored in the legacy role column
        const employee = await tx.employee.create({
          data: {
            employee_id: data.employee_id,
            name: data.name,
            role: assignedRoleName,
            email: data.email,
            address: data.address,
            password_hash: data.password_hash
          }
        });

      // Assign role if provided
        if (data.roleId) {
          await tx.employeeRole.create({
            data: {
              employeeId: employee.id,
              roleId: data.roleId
            }
          });
        }

      // Return employee with role relationship
      return await tx.employee.findUnique({
        where: { id: employee.id },
        include: {
          employeeRoles: {
            include: {
              role: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                  isSystem: true
                }
              }
            }
          }
        }
      });
    });

    await upsertTenantUser({
      tenantId: data.tenantId,
      email: data.email,
      passwordHash: data.password_hash
    });

    return employeeWithRoles;
  },

  update: async (
    id: string,
    data: {
      employee_id?: string;
      name?: string;
      role?: string;
      email?: string;
      password_hash?: string;
    }
  ) => {
    const prisma = getPrismaClient();
    return await prisma.employee.update({
      where: { id },
      data,
      include: {
        employeeRoles: {
          include: {
            role: {
              select: {
                id: true,
                name: true,
                description: true,
                isSystem: true
              }
            }
          }
        }
      }
    });
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
      roleId?: string;
      tenantId?: string;
      previousEmail?: string;
    }
  ) => {
    const prisma = getPrismaClient();

    const employeeWithRoles = await prisma.$transaction(async (tx) => {
      // Update employee basic info
      const updatePayload: Record<string, unknown> = {};

      if (data.employee_id !== undefined) {
        updatePayload.employee_id = data.employee_id;
      }
      if (data.name !== undefined) {
        updatePayload.name = data.name;
      }
      if (data.email !== undefined) {
        updatePayload.email = data.email;
      }
      if (data.address !== undefined) {
        updatePayload.address = data.address;
      }
      if (data.password_hash !== undefined) {
        updatePayload.password_hash = data.password_hash;
      }

      const roleChangeRequested = data.roleId !== undefined;
      let assignedRoleName: string | undefined;

      if (roleChangeRequested) {
        if (data.roleId) {
          const roleRecord = await tx.role.findUnique({
            where: { id: data.roleId },
            select: { name: true }
          });
          assignedRoleName = roleRecord?.name ?? "";
        } else {
          assignedRoleName = "";
        }
        updatePayload.role = assignedRoleName;
      }

      await tx.employee.update({
        where: { id },
        data: updatePayload
      });

      // Handle role assignment if provided
      if (data.roleId !== undefined) {
        // Remove all existing roles
        await tx.employeeRole.deleteMany({
          where: { employeeId: id }
        });

        // Assign new role if not null
        if (data.roleId) {
          await tx.employeeRole.create({
            data: {
              employeeId: id,
              roleId: data.roleId
            }
          });
        }
      }

      // Return updated employee with role relationship
      return await tx.employee.findUnique({
        where: { id },
        include: {
          employeeRoles: {
            include: {
              role: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                  isSystem: true
                }
              }
            }
          }
        }
      });
    });

    await upsertTenantUser({
      tenantId: data.tenantId,
      email: data.email,
      passwordHash: data.password_hash,
      previousEmail: data.previousEmail
    });

    return employeeWithRoles;
  },

  // Assign role to employee
  assignRole: async (employeeId: string, roleId: string) => {
    const prisma = getPrismaClient();

    // Remove existing roles first (single role system)
    await prisma.employeeRole.deleteMany({
      where: { employeeId }
    });

    const roleRecord = await prisma.role.findUnique({
      where: { id: roleId },
      select: { name: true }
    });
    const assignedRoleName = roleRecord?.name ?? "";

    await prisma.employee.update({
      where: { id: employeeId },
      data: { role: assignedRoleName }
    });

    // Assign new role
    return await prisma.employeeRole.create({
      data: {
        employeeId,
        roleId
      },
      include: {
        role: true,
        employee: true
      }
    });
  },

  // Remove role from employee
  removeRole: async (employeeId: string, roleId: string) => {
    const prisma = getPrismaClient();
    const deletedRole = await prisma.employeeRole.delete({
      where: {
        employeeId_roleId: {
          employeeId,
          roleId
        }
      }
    });

    const remainingRole = await prisma.employeeRole.findFirst({
      where: { employeeId },
      include: {
        role: {
          select: { name: true }
        }
      }
    });

    const nextRoleName = remainingRole?.role?.name ?? "";
    await prisma.employee.update({
      where: { id: employeeId },
      data: { role: nextRoleName }
    });

    return deletedRole;
  },

  // Get employee's role
  getEmployeeRole: async (employeeId: string) => {
    const prisma = getPrismaClient();
    const employeeRole = await prisma.employeeRole.findFirst({
      where: { employeeId },
      include: {
        role: true
      }
    });
    return employeeRole?.role || null;
  },

  delete: async (id: string) => {
    const prisma = getPrismaClient();
    return await prisma.employee.delete({
      where: { id },
      select: {
        id: true,
        employee_id: true,
        name: true,
        role: true,
        email: true
      }
    });
  },

  findByEmail: async (email: string) => {
    const prisma = getPrismaClient();
    return await prisma.employee.findUnique({
      where: { email }
    });
  },

  findByEmployeeId: async (employee_id: string) => {
    const prisma = getPrismaClient();
    return await prisma.employee.findUnique({
      where: { employee_id }
    });
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
    const prisma = getPrismaClient();

    const whereClause: Record<string, unknown> = {};

    if (filters?.dateFrom || filters?.dateTo) {
      whereClause.date = {};
      if (filters.dateFrom) {
        const fromDate = new Date(filters.dateFrom + "T00:00:00");
        (whereClause.date as Record<string, Date>).gte = fromDate;
      }
      if (filters.dateTo) {
        const toDate = new Date(filters.dateTo + "T23:59:59.999");
        (whereClause.date as Record<string, Date>).lte = toDate;
      }
    }

    if (filters?.employeeId && filters.employeeId !== "all") {
      whereClause.employeeId = filters.employeeId;
    }

    if (filters?.customerId && filters.customerId !== "all") {
      whereClause.customerId = filters.customerId;
    }

    if (filters?.paymentMode && filters.paymentMode !== "all") {
      whereClause.paymentMode = filters.paymentMode;
    }

    const query: Record<string, unknown> = {
      where: whereClause,
      orderBy: { date: "desc" }
    };

    if (options?.select) {
      query.select = options.select;
    } else {
      query.include = {
        customer: true,
        employee: true,
        payments: {
          include: {
            employee: true
          },
          orderBy: { createdAt: "desc" }
        },
        salesDetails: {
          include: {
            product: {
              include: {
                category: true
              }
            },
            customProduct: true
          }
        }
      };
    }

    applyPagination(query, options?.pagination);

    const invoices = await prisma.salesInvoice.findMany(query as any);

    // Recalculate outstanding balance for each invoice based on payments
    return invoices.map((invoice) => {
      if (
        !Array.isArray((invoice as any).payments) ||
        typeof (invoice as any).totalAmount !== "number"
      ) {
        return invoice;
      }

      const totalPaid = (invoice as any).payments.reduce(
        (sum: number, payment: { amount: number }) => sum + payment.amount,
        0
      );
      const outstandingBalance = (invoice as any).totalAmount - totalPaid;

      let paymentStatus = "paid";
      if (outstandingBalance > 0) {
        paymentStatus = totalPaid > 0 ? "partial" : "unpaid";
      }

      return {
        ...invoice,
        outstandingBalance,
        paymentStatus
      };
    });
  },

  findById: async (id: string) => {
    const prisma = getPrismaClient();
    const invoice = await prisma.salesInvoice.findUnique({
      where: { id },
      include: {
        customer: true,
        employee: true,
        payments: {
          include: {
            employee: true
          },
          orderBy: { createdAt: "desc" }
        },
        salesDetails: {
          include: {
            product: {
              include: {
                category: true
              }
            },
            customProduct: true
          }
        }
      }
    });

    // Recalculate outstanding balance based on payments
    if (invoice) {
      const totalPaid = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
      const outstandingBalance = invoice.totalAmount - totalPaid;

      let paymentStatus = "paid";
      if (outstandingBalance > 0) {
        paymentStatus = totalPaid > 0 ? "partial" : "unpaid";
      }

      return {
        ...invoice,
        outstandingBalance,
        paymentStatus
      };
    }

    return invoice;
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
    const prisma = getPrismaClient();

    const invoice = await prisma.$transaction(
      async (tx) => {
        // Validate employee exists, use default admin if not
        let validEmployeeId = data.employeeId;
        console.log("Validating employee ID:", data.employeeId);
        const employeeExists = await tx.employee.findUnique({
          where: { id: data.employeeId }
        });
        console.log("Employee exists:", !!employeeExists);

        if (!employeeExists) {
          // Try to find the default admin employee
          const defaultAdmin = await tx.employee.findFirst({
            where: { employee_id: "ADMIN001" }
          });
          console.log("Default admin found:", !!defaultAdmin);

          if (defaultAdmin) {
            validEmployeeId = defaultAdmin.id;
            console.log("Using default admin ID:", validEmployeeId);
          } else {
            // If no default admin exists, find any employee
            const anyEmployee = await tx.employee.findFirst();
            console.log("Any employee found:", !!anyEmployee);
            if (anyEmployee) {
              validEmployeeId = anyEmployee.id;
              console.log("Using any employee ID:", validEmployeeId);
            } else {
              throw new Error("No employees found in the system. Please create an employee first.");
            }
          }
        }

        // Validate customer exists if provided
        if (data.customerId) {
          const customerExists = await tx.customer.findUnique({
            where: { id: data.customerId }
          });
          console.log("Customer exists:", !!customerExists);

          if (!customerExists) {
            // Remove invalid customer reference
            data.customerId = undefined;
            console.log("Removed invalid customer reference");
          }
        }

        // Generate invoice number: INV-1000, INV-1001, etc.
        const lastInvoice = await tx.salesInvoice.findFirst({
          orderBy: { createdAt: "desc" },
          select: { id: true }
        });

        let nextInvoiceNumber = 1000; // Starting number
        console.log("Last invoice:", lastInvoice);
        if (lastInvoice) {
          // Extract the number from the last invoice ID if it follows the pattern
          const lastIdMatch = lastInvoice.id.match(/^INV-(\d+)$/);
          if (lastIdMatch) {
            nextInvoiceNumber = parseInt(lastIdMatch[1]) + 1;
          }
        }

        const invoiceNumber = `INV-${nextInvoiceNumber}`;
        console.log(data);
        // Create the sales invoice with the generated invoice number
        const productIds = Array.from(
          new Set(
            data.salesDetails
              .filter((detail) => detail.productId)
              .map((detail) => detail.productId!)
          )
        );
        const productCostMap = new Map<string, number>();

        if (productIds.length > 0) {
          const productCosts = await tx.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, costPrice: true }
          });

          productCosts.forEach((product) => {
            productCostMap.set(product.id, product.costPrice ?? 0);
          });
        }

        const invoice = await tx.salesInvoice.create({
          data: {
            id: invoiceNumber, // Use the generated invoice number as the ID
            customerId: data.customerId,
            employeeId: validEmployeeId,
            subTotal: data.subTotal,
            totalAmount: data.totalAmount,
            paymentMode: data.paymentMode,
            taxAmount: data.taxAmount || 0,
            discountAmount: data.discountAmount || 0,
            amountReceived: data.amountReceived,
            outstandingBalance: data.outstandingBalance || 0,
            paymentStatus: data.paymentStatus || "paid",
            salesDetails: {
              create: data.salesDetails.map((detail) => ({
                productId: detail.productId || undefined,
                customProductId: detail.customProductId || undefined,
                quantity: detail.quantity,
                unitPrice: detail.unitPrice,
                taxRate: detail.taxRate || 0,
                unit: detail.unit || "pcs",
                originalPrice: detail.originalPrice,
                costPrice: detail.productId ? (productCostMap.get(detail.productId) ?? 0) : 0
              }))
            }
          },
          include: {
            customer: true,
            employee: true,
            salesDetails: {
              include: {
                product: true,
                customProduct: true
              }
            }
          }
        });

        // Update product stock levels and inventory (only for regular products, not custom products)
        for (const detail of data.salesDetails) {
          // Skip custom products
          if (detail.customProductId || !detail.productId) {
            continue;
          }

          // Format quantity to 3 decimal places
          const formattedQuantity = validateAndFormatQuantity(detail.quantity);

          // Update Product.stockLevel
          if (detail.productId) {
            await tx.product.update({
              where: { id: detail.productId },
              data: {
                stockLevel: {
                  decrement: formattedQuantity
                }
              }
            });
          }

          // Update Inventory.quantity
          const inventory = await tx.inventory.findFirst({
            where: { productId: detail.productId }
          });

          if (inventory) {
            await tx.inventory.update({
              where: { id: inventory.id },
              data: {
                quantity: {
                  decrement: formattedQuantity
                }
              }
            });
          } else {
            // If no inventory record exists, create one with 0 quantity (since we're selling)
            await tx.inventory.create({
              data: {
                productId: detail.productId,
                quantity: Math.max(0, -formattedQuantity), // Ensure non-negative
                reorderLevel: 5 // Default reorder level
              }
            });
          }

          // Create stock transaction record
          await tx.stockTransaction.create({
            data: {
              productId: detail.productId,
              type: "OUT",
              changeQty: -formattedQuantity,
              reason: "Sale",
              relatedInvoiceId: invoice.id
            }
          });
        }

        // Update customer loyalty points if customer exists
        if (data.customerId) {
          const pointsToAdd = Math.floor(data.totalAmount / 10); // 1 point per Rs 10 spent
          await tx.customer.update({
            where: { id: data.customerId },
            data: {
              loyaltyPoints: {
                increment: pointsToAdd
              }
            }
          });

          // Create customer transaction record
          await tx.customerTransaction.create({
            data: {
              customerId: data.customerId,
              invoiceId: invoice.id,
              pointsEarned: pointsToAdd,
              pointsRedeemed: 0
            }
          });
        }

        return invoice;
      },
      {
        timeout: 15000,
        maxWait: 15000
      }
    );
    clearProductCache();
    return invoice;
  },

  delete: async (id: string) => {
    const prisma = getPrismaClient();

    const deletedInvoice = await prisma.$transaction(async (tx) => {
      // Get invoice details first
      const invoice = await tx.salesInvoice.findUnique({
        where: { id },
        include: {
          salesDetails: true
        }
      });

      if (!invoice) {
        throw new Error("Invoice not found");
      }

      // Restore product stock levels and create stock transactions
      for (const detail of invoice.salesDetails) {
        // Skip custom products (they don't have inventory)
        if (!detail.productId) {
          continue;
        }

        // Format quantity to 3 decimal places
        const formattedQuantity = validateAndFormatQuantity(detail.quantity);

        // Update Product.stockLevel
        await tx.product.update({
          where: { id: detail.productId },
          data: {
            stockLevel: {
              increment: formattedQuantity
            }
          }
        });

        // Update Inventory.quantity
        const inventory = await tx.inventory.findFirst({
          where: { productId: detail.productId }
        });

        if (inventory) {
          await tx.inventory.update({
            where: { id: inventory.id },
            data: {
              quantity: {
                increment: formattedQuantity
              }
            }
          });
        }

        // Create stock transaction record for stock restoration
        await tx.stockTransaction.create({
          data: {
            productId: detail.productId,
            type: "IN",
            changeQty: formattedQuantity,
            reason: "Invoice Deletion",
            relatedInvoiceId: invoice.id,
            transactionDate: new Date()
          }
        });
      }

      await tx.salesDetail.deleteMany({
        where: { invoiceId: id }
      });

      // Note: We keep stock transactions as audit trail
      // await tx.stockTransaction.deleteMany({
      //   where: { relatedInvoiceId: id }
      // });

      await tx.customerTransaction.deleteMany({
        where: { invoiceId: id }
      });

      // Delete all payments associated with this invoice
      await tx.payment.deleteMany({
        where: { invoiceId: id }
      });

      // Delete the invoice
      return await tx.salesInvoice.delete({
        where: { id }
      });
    });
    clearProductCache();
    return deletedInvoice;
  },

  getStats: async (filters?: { dateFrom?: string; dateTo?: string }) => {
    const prisma = getPrismaClient();

    const whereClause: Record<string, unknown> = {};

    if (filters?.dateFrom || filters?.dateTo) {
      whereClause.date = {};
      if (filters.dateFrom) {
        (whereClause.date as Record<string, Date>).gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        (whereClause.date as Record<string, Date>).lte = new Date(filters.dateTo);
      }
    }

    const invoices = await prisma.salesInvoice.findMany({
      where: whereClause
    });

    const totalRevenue = invoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0);
    const totalDiscount = invoices.reduce((sum, invoice) => sum + invoice.discountAmount, 0);
    const totalTax = invoices.reduce((sum, invoice) => sum + invoice.taxAmount, 0);
    const totalInvoices = invoices.length;
    const averageOrderValue = totalInvoices > 0 ? totalRevenue / totalInvoices : 0;

    return {
      totalRevenue,
      totalDiscount,
      totalTax,
      totalInvoices,
      averageOrderValue
    };
  },

  // Perform a full refund for an existing invoice
  refund: async (originalInvoiceId: string, options?: { employeeId?: string; reason?: string }) => {
    const prisma = getPrismaClient();

    const refundResult = await prisma.$transaction(async (tx) => {
      // Fetch original invoice with details
      const original = await tx.salesInvoice.findUnique({
        where: { id: originalInvoiceId },
        include: { salesDetails: true, customer: true }
      });
      console.log("Original invoice:", original);
      if (!original) throw new Error("Original invoice not found");

      // Prevent double refunds by checking if already refunded
      if (original.refundInvoiceId) {
        throw new Error("This invoice has already been refunded");
      }

      // Build refund invoice data - we create a new invoice that references the original
      const refundSalesDetails = original.salesDetails.map((d) => ({
        productId: d.productId,
        quantity: d.quantity,
        unitPrice: d.unitPrice,
        taxRate: d.taxRate || 0
      }));

      // Generate new invoice number for refund
      const lastInvoice = await tx.salesInvoice.findFirst({
        orderBy: { createdAt: "desc" },
        select: { id: true }
      });

      let nextInvoiceNumber = 1000; // Starting number
      if (lastInvoice) {
        const lastIdMatch = lastInvoice.id.match(/^INV-(\d+)$/);
        if (lastIdMatch) {
          nextInvoiceNumber = parseInt(lastIdMatch[1]) + 1;
        }
      }
      const invoiceNumber = `INV-${nextInvoiceNumber}`;

      const refundInvoice = await tx.salesInvoice.create({
        data: {
          id: invoiceNumber,
          customerId: original.customerId,
          employeeId: options?.employeeId || original.employeeId,
          subTotal: -original.subTotal,
          totalAmount: -original.totalAmount,
          paymentMode: original.paymentMode,
          taxAmount: -original.taxAmount,
          discountAmount: -original.discountAmount,
          amountReceived: -original.amountReceived,
          salesDetails: {
            create: refundSalesDetails
          }
        },
        include: { salesDetails: true }
      });

      // Restore product stock levels and inventory (IN transactions)
      for (const detail of original.salesDetails) {
        // Skip custom products (they don't have inventory)
        if (!detail.productId) {
          continue;
        }

        await tx.product.update({
          where: { id: detail.productId },
          data: {
            stockLevel: { increment: detail.quantity }
          }
        });

        const inventory = await tx.inventory.findFirst({ where: { productId: detail.productId } });
        if (inventory) {
          await tx.inventory.update({
            where: { id: inventory.id },
            data: {
              quantity: { increment: detail.quantity }
            }
          });
        } else {
          await tx.inventory.create({
            data: {
              productId: detail.productId,
              quantity: detail.quantity,
              reorderLevel: 5
            }
          });
        }

        await tx.stockTransaction.create({
          data: {
            productId: detail.productId,
            type: "IN",
            changeQty: detail.quantity,
            reason: options?.reason || "Refund",
            relatedInvoiceId: original.id
          }
        });
      }

      // Reverse loyalty points if applicable
      if (original.customerId) {
        const pointsToRemove = Math.floor(original.totalAmount / 10);
        await tx.customer.update({
          where: { id: original.customerId },
          data: {
            loyaltyPoints: { decrement: pointsToRemove }
          }
        });

        // Update existing customer transaction record (add to points redeemed)
        await tx.customerTransaction.update({
          where: {
            customerId_invoiceId: {
              customerId: original.customerId,
              invoiceId: original.id
            }
          },
          data: {
            pointsRedeemed: { increment: pointsToRemove }
          }
        });
      }

      // Link original invoice to refund invoice
      await tx.salesInvoice.update({
        where: { id: original.id },
        data: { refundInvoiceId: refundInvoice.id }
      });

      return { originalInvoiceId: original.id, refundInvoice };
    });
    clearProductCache();
    return refundResult;
  }
};

export const customerService = {
  findMany: async (options?: FindManyOptions) => {
    const prisma = getPrismaClient();
    const query: Record<string, unknown> = {
      orderBy: { createdAt: "desc" }
    };

    if (options?.select) {
      query.select = options.select;
    }

    applyPagination(query, options?.pagination);
    return await prisma.customer.findMany(query as any);
  },

  create: async (data: { name: string; email?: string; phone?: string; preferences?: string }) => {
    const prisma = getPrismaClient();

    // Check for duplicate email if provided
    if (data.email) {
      const existingCustomer = await prisma.customer.findFirst({
        where: { email: data.email }
      });

      if (existingCustomer) {
        throw new Error(`Customer with email "${data.email}" already exists`);
      }
    }

    return await prisma.customer.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        preferences: data.preferences,
        loyaltyPoints: 0
      }
    });
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
    const prisma = getPrismaClient();

    // Check for duplicate email if provided
    if (data.email) {
      const existingCustomer = await prisma.customer.findFirst({
        where: {
          email: data.email,
          NOT: { id }
        }
      });

      if (existingCustomer) {
        throw new Error(`Customer with email "${data.email}" already exists`);
      }
    }

    return await prisma.customer.update({
      where: { id },
      data
    });
  },

  delete: async (id: string) => {
    const prisma = getPrismaClient();
    return await prisma.customer.delete({
      where: { id }
    });
  },

  findByEmail: async (email: string) => {
    const prisma = getPrismaClient();
    return await prisma.customer.findFirst({
      where: { email }
    });
  },

  findByPhone: async (phone: string) => {
    const prisma = getPrismaClient();
    return await prisma.customer.findFirst({
      where: { phone }
    });
  }
};

// Inventory Service
export const inventoryService = {
  findMany: async (filters?: InventoryFilters, options?: FindManyOptions) => {
    const prisma = getPrismaClient();
    const where = await buildInventoryWhereClause(prisma, filters);

    const query: Record<string, unknown> = {
      where,
      orderBy: { updatedAt: "desc" }
    };

    if (options?.select) {
      query.select = options.select;
    } else {
      query.include = {
        product: {
          include: {
            category: true
          }
        }
      };
    }

    applyPagination(query, options?.pagination);
    return await prisma.inventory.findMany(query as any);
  },
  count: async (filters?: InventoryFilters) => {
    const prisma = getPrismaClient();
    const where = await buildInventoryWhereClause(prisma, filters);
    return await prisma.inventory.count({ where } as any);
  },

  create: async (data: {
    productId: string;
    quantity: number;
    reorderLevel: number;
    batchNumber?: string;
    expiryDate?: Date;
  }) => {
    const prisma = getPrismaClient();
    console.log(data);
    const productExists = await prisma.product.findUnique({
      where: { id: data.productId }
    });

    if (!productExists) {
      throw new Error(`Product with ID "${data.productId}" does not exist`);
    }

    const existing = await prisma.inventory.findFirst({
      where: {
        productId: data.productId
      }
    });

    if (existing) {
      throw new Error(
        `Inventory record already exists for this product. Current quantity: ${existing.quantity}. Use update or adjust stock instead.`
      );
    }

    const inventory = await prisma.$transaction(async (tx) => {
      const formattedQuantity = validateAndFormatQuantity(data.quantity);

      const inventory = await tx.inventory.create({
        data: {
          ...data,
          quantity: formattedQuantity
        },
        include: {
          product: {
            include: {
              category: true
            }
          }
        }
      });

      await tx.product.update({
        where: { id: data.productId },
        data: { stockLevel: formattedQuantity }
      });

      return inventory;
    });
    clearProductCache();
    return inventory;
  },

  // Upsert method: create if doesn't exist, update if exists
  upsert: async (data: {
    productId: string;
    quantity: number;
    reorderLevel: number;
    batchNumber?: string;
    expiryDate?: Date;
  }) => {
    const prisma = getPrismaClient();

    // Validate productId exists
    const productExists = await prisma.product.findUnique({
      where: { id: data.productId }
    });

    if (!productExists) {
      throw new Error(`Product with ID "${data.productId}" does not exist`);
    }

    const inventory = await prisma.$transaction(async (tx) => {
      // Format quantity to 3 decimal places
      const formattedQuantity = validateAndFormatQuantity(data.quantity);

      // Use Prisma's built-in upsert with the unique constraint
      const inventory = await tx.inventory.upsert({
        where: {
          productId: data.productId
        },
        update: {
          quantity: formattedQuantity,
          reorderLevel: data.reorderLevel,
          batchNumber: data.batchNumber,
          expiryDate: data.expiryDate
        },
        create: {
          productId: data.productId,
          quantity: formattedQuantity,
          reorderLevel: data.reorderLevel,
          batchNumber: data.batchNumber,
          expiryDate: data.expiryDate
        },
        include: {
          product: {
            include: {
              category: true
            }
          }
        }
      });

      // Update Product stockLevel to match inventory
      await tx.product.update({
        where: { id: data.productId },
        data: { stockLevel: inventory.quantity }
      });

      return inventory;
    });
    clearProductCache();
    return inventory;
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
    const prisma = getPrismaClient();

    // Format quantity to 3 decimal places if provided
    const updateData = { ...data };
    if (updateData.quantity !== undefined) {
      updateData.quantity = validateAndFormatQuantity(updateData.quantity);
    }

    return await prisma.inventory.update({
      where: { id },
      data: updateData,
      include: {
        product: {
          include: {
            category: true
          }
        }
      }
    });
  },

  delete: async (id: string) => {
    const prisma = getPrismaClient();
    return await prisma.inventory.delete({
      where: { id }
    });
  },

  findById: async (id: string) => {
    const prisma = getPrismaClient();
    return await prisma.inventory.findUnique({
      where: { id },
      include: {
        product: {
          include: {
            category: true
          }
        }
      }
    });
  },

  // Quick adjust method for updating stock with reason tracking
  quickAdjust: async (id: string, newQuantity: number, reason: string) => {
    const prisma = getPrismaClient();

    const updatedInventory = await prisma.$transaction(async (tx) => {
      // Get current inventory
      const inventory = await tx.inventory.findUnique({
        where: { id },
        include: {
          product: true
        }
      });

      if (!inventory) {
        throw new Error("Inventory item not found");
      }

      const previousQuantity = inventory.quantity;
      const changeQty = newQuantity - previousQuantity;

      // Update inventory
      const updatedInventory = await tx.inventory.update({
        where: { id },
        data: { quantity: newQuantity },
        include: {
          product: {
            include: {
              category: true
            }
          }
        }
      });

      // Create stock transaction record
      if (changeQty !== 0) {
        await tx.stockTransaction.create({
          data: {
            productId: inventory.productId,
            changeQty: changeQty,
            reason: reason,
            transactionDate: new Date(),
            relatedInvoiceId: null
          }
        });

        // Update Product stockLevel to match inventory
        await tx.product.update({
          where: { id: inventory.productId },
          data: { stockLevel: newQuantity }
        });
      }

      return updatedInventory;
    });
    clearProductCache();
    return updatedInventory;
  },

  getLowStockItems: async () => {
    const prisma = getPrismaClient();

    // For now, return all items and filter in the application layer
    // TODO: Use raw SQL query when database corruption is fixed
    const allItems = await prisma.inventory.findMany({
      include: {
        product: {
          include: {
            category: true
          }
        }
      },
      orderBy: { quantity: "asc" }
    });

    // Filter items where quantity is less than or equal to reorder level
    return allItems.filter((item) => item.quantity <= item.reorderLevel);
  },

  adjustStock: async (
    id: string,
    newQuantity: number,
    reason: string,
    relatedInvoiceId?: string
  ) => {
    const prisma = getPrismaClient();

    const updatedInventory = await prisma.$transaction(async (tx) => {
      // Get current inventory
      const inventory = await tx.inventory.findUnique({
        where: { id }
      });

      if (!inventory) {
        throw new Error("Inventory record not found");
      }

      const changeQty = newQuantity - inventory.quantity;

      // Update inventory
      const updatedInventory = await tx.inventory.update({
        where: { id },
        data: { quantity: newQuantity },
        include: {
          product: {
            include: {
              category: true
            }
          }
        }
      });

      // Create stock transaction record
      await tx.stockTransaction.create({
        data: {
          productId: inventory.productId,
          type: changeQty >= 0 ? "IN" : "OUT",
          changeQty,
          reason,
          relatedInvoiceId
        }
      });

      // Update Product stockLevel to match inventory
      await updateProductStockLevel(inventory.productId, newQuantity, tx);

      return updatedInventory;
    });
    clearProductCache();
    return updatedInventory;
  }
};

// Stock Sync Utility Functions
export const stockSyncService = {
  // Sync a single product's stock level from its inventories
  syncProductStockFromInventory: async (productId: string) => {
    const prisma = getPrismaClient();

    const totalInventory = await prisma.inventory.aggregate({
      where: { productId },
      _sum: { quantity: true }
    });

    const newStockLevel = totalInventory._sum.quantity || 0;

    await updateProductStockLevel(productId, newStockLevel, prisma);

    return newStockLevel;
  },

  // Sync all products' stock levels from their inventories
  syncAllProductsStockFromInventory: async () => {
    const prisma = getPrismaClient();

    const products = await prisma.product.findMany({
      select: { id: true }
    });

    await runWithConcurrency(products, DEFAULT_DB_CONCURRENCY, async (product) => {
      const totalInventory = await prisma.inventory.aggregate({
        where: { productId: product.id },
        _sum: { quantity: true }
      });

      const newStockLevel = totalInventory._sum.quantity || 0;

      return prisma.product.update({
        where: { id: product.id },
        data: { stockLevel: newStockLevel }
      });
    });
    clearProductCache();
    return products.length;
  }
};

// Stock Transaction Service
export const stockTransactionService = {
  findMany: async (filters?: StockTransactionFilters, options?: FindManyOptions) => {
    const prisma = getPrismaClient();
    const where = buildStockTransactionWhereClause(filters);

    const query: Record<string, unknown> = {
      where,
      orderBy: { transactionDate: "desc" }
    };

    if (options?.select) {
      query.select = options.select;
    } else {
      query.include = {
        product: {
          include: {
            category: true
          }
        }
      };
    }

    applyPagination(query, options?.pagination);
    return await prisma.stockTransaction.findMany(query as any);
  },
  count: async (filters?: StockTransactionFilters) => {
    const prisma = getPrismaClient();
    const where = buildStockTransactionWhereClause(filters);
    return await prisma.stockTransaction.count({ where } as any);
  },

  create: async (data: {
    productId: string;
    type: string;
    changeQty: number;
    reason: string;
    relatedInvoiceId?: string;
  }) => {
    const prisma = getPrismaClient();

    const transaction = await prisma.$transaction(async (tx) => {
      // Format changeQty to 3 decimal places
      const formattedChangeQty = validateAndFormatQuantity(data.changeQty);

      // Validate that the product exists
      const product = await tx.product.findUnique({
        where: { id: data.productId }
      });

      if (!product) {
        throw new Error(`Product with ID ${data.productId} not found`);
      }

      // First, check if inventory record exists for this product
      let inventory = await tx.inventory.findFirst({
        where: {
          productId: data.productId
        }
      });

      // If no inventory record exists, create one
      if (!inventory) {
        const initialQuantity = Math.max(0, formattedChangeQty);
        inventory = await tx.inventory.create({
          data: {
            productId: data.productId,
            quantity: initialQuantity,
            reorderLevel: 5 // Default reorder level
          }
        });
      } else {
        // Update existing inventory
        const newQuantity = Math.max(0, inventory.quantity + formattedChangeQty);

        // Prevent negative stock unless it's a valid adjustment
        if (newQuantity < 0 && formattedChangeQty < 0) {
          throw new Error(
            `Insufficient stock. Current: ${inventory.quantity}, Requested change: ${formattedChangeQty}`
          );
        }

        await tx.inventory.update({
          where: { id: inventory.id },
          data: { quantity: newQuantity }
        });
      }

      // Create the stock transaction record
      const transaction = await tx.stockTransaction.create({
        data: {
          ...data,
          changeQty: formattedChangeQty,
          transactionDate: new Date() // Ensure current timestamp
        },
        include: {
          product: {
            include: {
              category: true
            }
          }
        }
      });

      // Update Product stockLevel to reflect total inventory
      const totalInventory = await tx.inventory.aggregate({
        where: { productId: data.productId },
        _sum: { quantity: true }
      });

      const newProductStockLevel = totalInventory._sum.quantity || 0;

      await tx.product.update({
        where: { id: data.productId },
        data: { stockLevel: newProductStockLevel }
      });

      return transaction;
    });
    clearProductCache();
    return transaction;
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
    const prisma = getPrismaClient();

    const transaction = await prisma.$transaction(async (tx) => {
      // Get the existing transaction
      const existingTransaction = await tx.stockTransaction.findUnique({
        where: { id },
        include: {
          product: true
        }
      });

      if (!existingTransaction) {
        throw new Error("Stock transaction not found");
      }

      // If changeQty is being updated, we need to adjust the inventory
      if (data.changeQty !== undefined && data.changeQty !== existingTransaction.changeQty) {
        const inventory = await tx.inventory.findFirst({
          where: {
            productId: existingTransaction.productId
          }
        });

        if (inventory) {
          // Reverse the old change and apply the new change
          const quantityDifference = data.changeQty - existingTransaction.changeQty;
          const newQuantity = Math.max(0, inventory.quantity + quantityDifference);

          await tx.inventory.update({
            where: { id: inventory.id },
            data: { quantity: newQuantity }
          });

          // Update Product stockLevel
          const totalInventory = await tx.inventory.aggregate({
            where: { productId: existingTransaction.productId },
            _sum: { quantity: true }
          });

          await tx.product.update({
            where: { id: existingTransaction.productId },
            data: { stockLevel: totalInventory._sum.quantity || 0 }
          });
        }
      }

      // Update the transaction
      return await tx.stockTransaction.update({
        where: { id },
        data,
        include: {
          product: {
            include: {
              category: true
            }
          }
        }
      });
    });
    clearProductCache();
    return transaction;
  },

  delete: async (id: string) => {
    const prisma = getPrismaClient();

    const deletedTransaction = await prisma.$transaction(async (tx) => {
      // Get the transaction to be deleted
      const transaction = await tx.stockTransaction.findUnique({
        where: { id },
        include: {
          product: true
        }
      });

      if (!transaction) {
        throw new Error("Stock transaction not found");
      }

      // Reverse the transaction's effect on inventory
      const inventory = await tx.inventory.findFirst({
        where: {
          productId: transaction.productId
        }
      });

      if (inventory) {
        // Reverse the change
        const newQuantity = Math.max(0, inventory.quantity - transaction.changeQty);

        await tx.inventory.update({
          where: { id: inventory.id },
          data: { quantity: newQuantity }
        });

        // Update Product stockLevel
        const totalInventory = await tx.inventory.aggregate({
          where: { productId: transaction.productId },
          _sum: { quantity: true }
        });

        await tx.product.update({
          where: { id: transaction.productId },
          data: { stockLevel: totalInventory._sum.quantity || 0 }
        });
      }

      // Delete the transaction
      return await tx.stockTransaction.delete({
        where: { id }
      });
    });
    clearProductCache();
    return deletedTransaction;
  },

  // Enhanced method: Get stock movement analytics
  getStockMovementAnalytics: async (filters?: {
    productId?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }) => {
    const prisma = getPrismaClient();
    const where: Record<string, unknown> = {};

    if (filters?.productId) {
      where.productId = filters.productId;
    }

    if (filters?.dateFrom || filters?.dateTo) {
      const dateFilter: Record<string, Date> = {};
      if (filters.dateFrom) {
        dateFilter.gte = filters.dateFrom;
      }
      if (filters.dateTo) {
        dateFilter.lte = filters.dateTo;
      }
      where.transactionDate = dateFilter;
    }

    const transactions = await prisma.stockTransaction.findMany({
      where,
      include: {
        product: {
          include: {
            category: true
          }
        }
      },
      orderBy: { transactionDate: "desc" }
    });

    // Calculate analytics
    const analytics = {
      totalTransactions: transactions.length,
      totalStockIn: transactions
        .filter((t) => t.changeQty > 0)
        .reduce((sum, t) => sum + t.changeQty, 0),
      totalStockOut: transactions
        .filter((t) => t.changeQty < 0)
        .reduce((sum, t) => sum + Math.abs(t.changeQty), 0),
      netChange: transactions.reduce((sum, t) => sum + t.changeQty, 0),
      reasonBreakdown: transactions.reduce(
        (acc, t) => {
          acc[t.reason] = (acc[t.reason] || 0) + Math.abs(t.changeQty);
          return acc;
        },
        {} as Record<string, number>
      ),
      typeBreakdown: transactions.reduce(
        (acc, t) => {
          if (!acc[t.type]) {
            acc[t.type] = { count: 0, totalQuantity: 0 };
          }
          acc[t.type].count += 1;
          acc[t.type].totalQuantity += Math.abs(t.changeQty);
          return acc;
        },
        {} as Record<string, { count: number; totalQuantity: number }>
      )
    };

    return { transactions, analytics };
  },

  findById: async (id: string) => {
    const prisma = getPrismaClient();
    return await prisma.stockTransaction.findUnique({
      where: { id },
      include: {
        product: {
          include: {
            category: true
          }
        }
      }
    });
  }
};

// Supplier Service
export const supplierService = {
  findMany: async () => {
    const prisma = getPrismaClient();
    return await prisma.supplier.findMany({
      include: {
        purchaseOrders: {
          include: {
            items: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  },

  create: async (data: {
    name: string;
    contactName?: string;
    phone?: string;
    email?: string;
    address?: string;
  }) => {
    const prisma = getPrismaClient();

    // Check for duplicate name
    const existing = await prisma.supplier.findFirst({
      where: {
        name: {
          equals: data.name
        }
      }
    });

    if (existing) {
      throw new Error(`Supplier with name "${data.name}" already exists`);
    }

    return await prisma.supplier.create({
      data,
      include: {
        purchaseOrders: true
      }
    });
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
    const prisma = getPrismaClient();

    // Check for duplicate name if name is being updated
    if (data.name) {
      const existing = await prisma.supplier.findFirst({
        where: {
          name: {
            equals: data.name
          },
          NOT: { id }
        }
      });

      if (existing) {
        throw new Error(`Supplier with name "${data.name}" already exists`);
      }
    }

    return await prisma.supplier.update({
      where: { id },
      data,
      include: {
        purchaseOrders: true
      }
    });
  },

  delete: async (id: string) => {
    const prisma = getPrismaClient();
    return await prisma.supplier.delete({
      where: { id }
    });
  },

  findById: async (id: string) => {
    const prisma = getPrismaClient();
    return await prisma.supplier.findUnique({
      where: { id },
      include: {
        purchaseOrders: {
          include: {
            items: {
              include: {
                product: true
              }
            }
          }
        }
      }
    });
  }
};

// Purchase Order Service
export const purchaseOrderService = {
  findMany: async (filters?: { supplierId?: string; status?: string }) => {
    const prisma = getPrismaClient();
    const where: Record<string, unknown> = {};

    if (filters?.supplierId) {
      where.supplierId = filters.supplierId;
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    return await prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: true,
        items: {
          include: {
            product: {
              include: {
                category: true
              }
            }
          }
        }
      },
      orderBy: { orderDate: "desc" }
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
    const prisma = getPrismaClient();

    return await prisma.$transaction(async (tx) => {
      // Calculate total amount
      const totalAmount = data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

      // Create purchase order
      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          supplierId: data.supplierId,
          orderDate: data.orderDate,
          status: data.status,
          totalAmount
        }
      });

      // Create purchase order items with capped concurrency
      await runWithConcurrency(data.items, DEFAULT_DB_CONCURRENCY, (item) =>
        tx.purchaseOrderItem.create({
          data: {
            poId: purchaseOrder.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice
          }
        })
      );

      return await tx.purchaseOrder.findUnique({
        where: { id: purchaseOrder.id },
        include: {
          supplier: true,
          items: {
            include: {
              product: {
                include: {
                  category: true
                }
              }
            }
          }
        }
      });
    });
  },

  update: async (
    id: string,
    data: {
      status?: string;
      orderDate?: Date;
    }
  ) => {
    const prisma = getPrismaClient();
    return await prisma.purchaseOrder.update({
      where: { id },
      data,
      include: {
        supplier: true,
        items: {
          include: {
            product: {
              include: {
                category: true
              }
            }
          }
        }
      }
    });
  },

  delete: async (id: string) => {
    const prisma = getPrismaClient();

    return await prisma.$transaction(async (tx) => {
      // First delete all purchase order items
      await tx.purchaseOrderItem.deleteMany({
        where: { poId: id }
      });

      // Then delete the purchase order
      return await tx.purchaseOrder.delete({
        where: { id }
      });
    });
  },

  findById: async (id: string) => {
    const prisma = getPrismaClient();
    return await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: {
          include: {
            product: {
              include: {
                category: true
              }
            }
          }
        }
      }
    });
  },

  receiveItems: async (
    id: string,
    receivedItems: Array<{ itemId: string; receivedDate: Date }>
  ) => {
    const prisma = getPrismaClient();

    return await prisma.$transaction(async (tx) => {
      // Update received dates for items with capped concurrency
      await runWithConcurrency(receivedItems, DEFAULT_DB_CONCURRENCY, (item) =>
        tx.purchaseOrderItem.update({
          where: { id: item.itemId },
          data: { receivedDate: item.receivedDate }
        })
      );

      // Check if all items are received
      const purchaseOrder = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true }
      });

      if (purchaseOrder) {
        const allReceived = purchaseOrder.items.every((item) => item.receivedDate !== null);

        if (allReceived) {
          await tx.purchaseOrder.update({
            where: { id },
            data: { status: "completed" }
          });
        }
      }

      return await tx.purchaseOrder.findUnique({
        where: { id },
        include: {
          supplier: true,
          items: {
            include: {
              product: {
                include: {
                  category: true
                }
              }
            }
          }
        }
      });
    });
  }
};

export const paymentService = {
  findMany: async (filters?: {
    invoiceId?: string;
    customerId?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }) => {
    const prisma = getPrismaClient();
    return await prisma.payment.findMany({
      where: {
        ...(filters?.invoiceId && { invoiceId: filters.invoiceId }),
        ...(filters?.customerId && { customerId: filters.customerId }),
        ...(filters?.dateFrom || filters?.dateTo
          ? {
              createdAt: {
                ...(filters.dateFrom && { gte: filters.dateFrom }),
                ...(filters.dateTo && { lte: filters.dateTo })
              }
            }
          : {})
      },
      include: {
        invoice: {
          include: {
            customer: true,
            employee: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  },

  create: async (data: {
    invoiceId: string;
    amount: number;
    paymentMode: string;
    employeeId: string;
    notes?: string;
  }) => {
    const prisma = getPrismaClient();

    return await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          invoiceId: data.invoiceId,
          amount: data.amount,
          paymentMode: data.paymentMode,
          employeeId: data.employeeId,
          notes: data.notes
        }
      });

      const invoice = await tx.salesInvoice.findUnique({
        where: { id: data.invoiceId },
        select: { totalAmount: true }
      });

      if (invoice) {
        const totals = await tx.payment.aggregate({
          where: { invoiceId: data.invoiceId },
          _sum: { amount: true }
        });

        const totalPaid = totals._sum.amount ?? 0;
        const outstandingBalance = invoice.totalAmount - totalPaid;
        const paymentStatus =
          outstandingBalance > 0 ? (totalPaid > 0 ? "partial" : "unpaid") : "paid";

        await tx.salesInvoice.update({
          where: { id: data.invoiceId },
          data: {
            outstandingBalance,
            paymentStatus
          }
        });
      }

      return payment;
    });
  },

  findById: async (id: string) => {
    const prisma = getPrismaClient();
    return await prisma.payment.findUnique({
      where: { id },
      include: {
        invoice: {
          include: {
            customer: true,
            employee: true
          }
        }
      }
    });
  },

  update: async (
    id: string,
    data: {
      amount?: number;
      paymentMethod?: string;
      notes?: string;
    }
  ) => {
    const prisma = getPrismaClient();
    return await prisma.payment.update({
      where: { id },
      data,
      include: {
        invoice: {
          include: {
            customer: true
          }
        }
      }
    });
  },

  delete: async (id: string) => {
    const prisma = getPrismaClient();
    return await prisma.payment.delete({
      where: { id }
    });
  }
};

type SettingsRow = {
  key: string;
  value: string;
  type: string;
  category: string;
  description?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const settingsCache = new Map<string, SettingsRow[]>();
const settingsCacheInFlight = new Map<string, Promise<SettingsRow[]>>();

const resolveSettingsCacheKey = (): string => getActiveSchema() ?? "__public__";

const clearSettingsCache = (schemaName?: string): void => {
  const cacheKey = schemaName ?? resolveSettingsCacheKey();
  settingsCache.delete(cacheKey);
  settingsCacheInFlight.delete(cacheKey);
};

const getSettingsCached = async (): Promise<SettingsRow[]> => {
  const cacheKey = resolveSettingsCacheKey();
  const cached = settingsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const inFlight = settingsCacheInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const prisma = getPrismaClient();
  const promise = prisma.settings
    .findMany({
      orderBy: { key: "asc" }
    })
    .then((rows) => {
      settingsCache.set(cacheKey, rows as SettingsRow[]);
      settingsCacheInFlight.delete(cacheKey);
      return rows as SettingsRow[];
    })
    .catch((error) => {
      settingsCacheInFlight.delete(cacheKey);
      throw error;
    });

  settingsCacheInFlight.set(cacheKey, promise);
  return promise;
};

export const settingsService = {
  findMany: async () => {
    return await getSettingsCached();
  },

  findByKey: async (key: string) => {
    const prisma = getPrismaClient();
    return await prisma.settings.findUnique({
      where: { key }
    });
  },

  upsert: async (
    key: string,
    value: string,
    type: string = "string",
    category: string = "general",
    description?: string
  ) => {
    const prisma = getPrismaClient();

    // First try to find existing setting
    const existing = await prisma.settings.findUnique({
      where: { key }
    });

    if (existing) {
      // Update existing
      const updated = await prisma.settings.update({
        where: { key },
        data: {
          value,
          type,
          category,
          description,
          updatedAt: new Date()
        }
      });
      clearSettingsCache();
      return updated;
    } else {
      // Create new
      const created = await prisma.settings.create({
        data: {
          key,
          value,
          type,
          category,
          description
        }
      });
      clearSettingsCache();
      return created;
    }
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
    const prisma = getPrismaClient();
    const result = await prisma.$transaction(async (tx) => {
      const updatedSettings: SettingsRow[] = [];
      for (const setting of settings) {
        const updateResult = await tx.settings.updateMany({
          where: { key: setting.key },
          data: {
            value: setting.value,
            type: setting.type ?? "string",
            category: setting.category ?? "general",
            description: setting.description,
            updatedAt: new Date()
          }
        });

        if (updateResult.count === 0) {
          const created = await tx.settings.create({
            data: {
              key: setting.key,
              value: setting.value,
              type: setting.type ?? "string",
              category: setting.category ?? "general",
              description: setting.description
            }
          });
          updatedSettings.push(created);
          continue;
        }

        const updated = await tx.settings.findFirst({
          where: { key: setting.key },
          orderBy: { updatedAt: "desc" }
        });
        if (updated) {
          updatedSettings.push(updated);
        }
      }
      return updatedSettings;
    });
    clearSettingsCache();
    return result;
  },

  delete: async (key: string) => {
    const prisma = getPrismaClient();
    const deleted = await prisma.settings.delete({
      where: { key }
    });
    clearSettingsCache();
    return deleted;
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
    const prisma = getPrismaClient();
    return await prisma.role.findMany({
      include: {
        rolePermissions: {
          include: {
            permission: true
          }
        },
        employeeRoles: {
          include: {
            employee: true
          }
        }
      },
      orderBy: { name: "asc" }
    });
  },

  create: async (data: { name: string; description?: string; isSystem?: boolean }) => {
    const prisma = getPrismaClient();

    // Check for duplicate name
    const existing = await prisma.role.findUnique({
      where: { name: data.name }
    });

    if (existing) {
      throw new Error(`Role with name "${data.name}" already exists`);
    }

    return await prisma.role.create({
      data: {
        name: data.name,
        description: data.description,
        isSystem: data.isSystem || false
      },
      include: {
        rolePermissions: {
          include: {
            permission: true
          }
        }
      }
    });
  },

  update: async (
    id: string,
    data: {
      name?: string;
      description?: string;
    }
  ) => {
    const prisma = getPrismaClient();

    // Check if it's a system role
    const role = await prisma.role.findUnique({
      where: { id }
    });

    if (role?.isSystem) {
      throw new Error("Cannot modify system roles");
    }

    // Check for duplicate name if name is being updated
    if (data.name) {
      const existing = await prisma.role.findFirst({
        where: {
          name: data.name,
          NOT: { id }
        }
      });

      if (existing) {
        throw new Error(`Role with name "${data.name}" already exists`);
      }
    }

    return await prisma.role.update({
      where: { id },
      data,
      include: {
        rolePermissions: {
          include: {
            permission: true
          }
        }
      }
    });
  },

  delete: async (id: string) => {
    const prisma = getPrismaClient();

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Check if it's a system role
        const role = await tx.role.findUnique({
          where: { id }
        });

        if (role?.isSystem) {
          throw new Error("Cannot delete system roles");
        }

        // Check if role is assigned to any employees
        const assignedEmployees = await tx.employeeRole.findMany({
          where: { roleId: id }
        });

        if (assignedEmployees.length > 0) {
          throw new Error(
            `Cannot delete role that is assigned to ${assignedEmployees.length} employee(s). Remove role assignments first.`
          );
        }

        // Delete role permissions first
        await tx.rolePermission.deleteMany({
          where: { roleId: id }
        });

        // Delete the role
        return await tx.role.delete({
          where: { id }
        });
      });

      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  },

  findById: async (id: string) => {
    const prisma = getPrismaClient();
    return await prisma.role.findUnique({
      where: { id },
      include: {
        rolePermissions: {
          include: {
            permission: true
          }
        },
        employeeRoles: {
          include: {
            employee: true
          }
        }
      }
    });
  },

  assignToEmployee: async (roleId: string, employeeId: string, assignedBy?: string) => {
    const prisma = getPrismaClient();

    // Check if assignment already exists
    const existing = await prisma.employeeRole.findUnique({
      where: {
        employeeId_roleId: {
          employeeId,
          roleId
        }
      }
    });

    if (existing) {
      throw new Error("Employee already has this role assigned");
    }

    return await prisma.employeeRole.create({
      data: {
        roleId,
        employeeId,
        assignedBy
      },
      include: {
        role: true,
        employee: true
      }
    });
  },

  removeFromEmployee: async (roleId: string, employeeId: string) => {
    const prisma = getPrismaClient();

    return await prisma.employeeRole.delete({
      where: {
        employeeId_roleId: {
          employeeId,
          roleId
        }
      }
    });
  },

  checkUsage: async (roleId: string) => {
    const prisma = getPrismaClient();

    const count = await prisma.employeeRole.count({
      where: { roleId }
    });

    return { count };
  }
};

export const permissionService = {
  findMany: async () => {
    const prisma = getPrismaClient();
    return await prisma.permission.findMany({
      orderBy: [{ module: "asc" }, { action: "asc" }, { scope: "asc" }]
    });
  },

  create: async (data: {
    module: string;
    action: string;
    scope?: string;
    description?: string;
  }) => {
    const prisma = getPrismaClient();

    return await prisma.permission.create({
      data
    });
  },

  update: async (
    id: string,
    data: {
      description?: string;
    }
  ) => {
    const prisma = getPrismaClient();

    return await prisma.permission.update({
      where: { id },
      data
    });
  },

  delete: async (id: string) => {
    const prisma = getPrismaClient();

    return await prisma.$transaction(async (tx) => {
      // Check if permission is assigned to any roles
      const assignedRoles = await tx.rolePermission.findMany({
        where: { permissionId: id }
      });

      if (assignedRoles.length > 0) {
        // Remove permission from all roles first
        await tx.rolePermission.deleteMany({
          where: { permissionId: id }
        });
      }

      // Delete the permission
      return await tx.permission.delete({
        where: { id }
      });
    });
  },

  findById: async (id: string) => {
    const prisma = getPrismaClient();
    return await prisma.permission.findUnique({
      where: { id }
    });
  },

  findByModule: async (module: string) => {
    const prisma = getPrismaClient();
    return await prisma.permission.findMany({
      where: { module },
      orderBy: [{ action: "asc" }, { scope: "asc" }]
    });
  },

  bulkCreate: async (
    permissions: Array<{
      module: string;
      action: string;
      scope?: string;
      description?: string;
    }>
  ) => {
    const prisma = getPrismaClient();

    const results: any[] = [];

    for (const perm of permissions) {
      try {
        // First try to find existing permission
        const existing = await prisma.permission.findFirst({
          where: {
            module: perm.module,
            action: perm.action,
            scope: perm.scope || null
          }
        });

        if (existing) {
          // Update existing permission
          const updated = await prisma.permission.update({
            where: { id: existing.id },
            data: { description: perm.description }
          });
          results.push(updated);
        } else {
          const created = await prisma.permission.create({
            data: {
              module: perm.module,
              action: perm.action,
              scope: perm.scope || null,
              description: perm.description
            }
          });
          results.push(created);
        }
      } catch (error) {
        console.error(
          `Error creating/updating permission ${perm.module}:${perm.action}:${perm.scope}:`,
          error
        );
        throw error;
      }
    }

    return results;
  }
};

export const rolePermissionService = {
  grantPermission: async (roleId: string, permissionId: string) => {
    const prisma = getPrismaClient();

    return await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId,
          permissionId
        }
      },
      update: {
        granted: true
      },
      create: {
        roleId,
        permissionId,
        granted: true
      },
      include: {
        role: true,
        permission: true
      }
    });
  },

  revokePermission: async (roleId: string, permissionId: string) => {
    const prisma = getPrismaClient();

    return await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId,
          permissionId
        }
      },
      update: {
        granted: false
      },
      create: {
        roleId,
        permissionId,
        granted: false
      },
      include: {
        role: true,
        permission: true
      }
    });
  },

  removePermission: async (roleId: string, permissionId: string) => {
    const prisma = getPrismaClient();

    return await prisma.rolePermission.delete({
      where: {
        roleId_permissionId: {
          roleId,
          permissionId
        }
      }
    });
  },

  getRolePermissions: async (roleId: string) => {
    const prisma = getPrismaClient();

    return await prisma.rolePermission.findMany({
      where: { roleId },
      include: {
        permission: true
      }
    });
  },

  getEmployeePermissions: async (employeeId: string) => {
    const prisma = getPrismaClient();

    // Get all roles assigned to the employee
    const employeeRoles = await prisma.employeeRole.findMany({
      where: { employeeId },
      include: {
        role: {
          include: {
            rolePermissions: {
              where: { granted: true },
              include: {
                permission: true
              }
            }
          }
        }
      }
    });

    // Flatten permissions from all roles
    const permissions = employeeRoles.flatMap((er) =>
      er.role.rolePermissions.map((rp) => rp.permission)
    );

    // Remove duplicates
    const uniquePermissions = permissions.filter(
      (perm, index, self) => index === self.findIndex((p) => p.id === perm.id)
    );

    return uniquePermissions;
  },

  checkEmployeePermission: async (
    employeeId: string,
    module: string,
    action: string,
    scope?: string
  ): Promise<boolean> => {
    const permissions = await rolePermissionService.getEmployeePermissions(employeeId);

    return permissions.some(
      (perm) =>
        perm.module === module &&
        perm.action === action &&
        (scope === undefined || perm.scope === scope || perm.scope === null)
    );
  }
};

export const customProductService = {
  findMany: async (options?: FindManyOptions) => {
    const prisma = getPrismaClient();
    const query: Record<string, unknown> = {
      orderBy: { createdAt: "desc" }
    };

    if (options?.select) {
      query.select = options.select;
    }

    applyPagination(query, options?.pagination);
    return await prisma.customProduct.findMany(query as any);
  },

  create: async (data: { name: string; price: number }) => {
    const prisma = getPrismaClient();
    return await prisma.customProduct.create({
      data
    });
  },

  findById: async (id: string) => {
    const prisma = getPrismaClient();
    return await prisma.customProduct.findUnique({
      where: { id }
    });
  },

  update: async (id: string, data: { name?: string; price?: number }) => {
    const prisma = getPrismaClient();
    return await prisma.customProduct.update({
      where: { id },
      data
    });
  },

  delete: async (id: string) => {
    const prisma = getPrismaClient();
    return await prisma.customProduct.delete({
      where: { id }
    });
  }
};

// Tenant Services for Multi-Tenancy
export const tenantService = {
  findMany: async () => {
    const prisma = getPrismaClient();
    return await prisma.$queryRaw`
      SELECT * FROM public.tenants
      ORDER BY created_at DESC
    `;
  },

  create: async (data: { id: string; schema_name: string; company_name?: string }) => {
    const prisma = getPrismaClient();
    return await prisma.$queryRaw`
      INSERT INTO public.tenants (id, schema_name, company_name, created_at, updated_at)
      VALUES (${data.id}, ${data.schema_name}, ${data.company_name || null}, NOW(), NOW())
      RETURNING *
    `;
  },

  findById: async (id: string) => {
    const prisma = getPrismaClient();
    const result = await prisma.$queryRaw`
      SELECT * FROM public.tenants WHERE id = ${id}
    `;
    return (result as any[])[0] || null;
  },

  findBySchemaName: async (schemaName: string) => {
    const prisma = getPrismaClient();
    const result = await prisma.$queryRaw`
      SELECT * FROM public.tenants WHERE schema_name = ${schemaName}
    `;
    return (result as any[])[0] || null;
  },

  update: async (id: string, data: { schema_name?: string; company_name?: string }) => {
    const prisma = getPrismaClient();

    if (data.schema_name !== undefined && data.company_name !== undefined) {
      return await prisma.$queryRaw`
        UPDATE public.tenants
        SET schema_name = ${data.schema_name}, company_name = ${data.company_name}, updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;
    } else if (data.schema_name !== undefined) {
      return await prisma.$queryRaw`
        UPDATE public.tenants
        SET schema_name = ${data.schema_name}, updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;
    } else if (data.company_name !== undefined) {
      return await prisma.$queryRaw`
        UPDATE public.tenants
        SET company_name = ${data.company_name}, updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;
    }

    return null;
  },

  delete: async (id: string) => {
    const prisma = getPrismaClient();
    return await prisma.$queryRaw`
      DELETE FROM public.tenants WHERE id = ${id}
      RETURNING *
    `;
  }
};

export const subscriptionService = {
  findMany: async () => {
    const prisma = getPrismaClient();
    return await prisma.$queryRaw`
      SELECT * FROM public.subscriptions
      ORDER BY created_at DESC
    `;
  },

  create: async (data: {
    tenantId: string;
    planName: string;
    joinedAt?: Date;
    expiresAt: Date;
    status: string;
  }) => {
    const prisma = getPrismaClient();
    const joinedAt = data.joinedAt || new Date();

    return await prisma.$queryRaw`
      INSERT INTO public.subscriptions ("tenantId", "planName", "joinedAt", "expiresAt", status, created_at, updated_at)
      VALUES (${data.tenantId}, ${data.planName}, ${joinedAt}, ${data.expiresAt}, ${data.status}, NOW(), NOW())
      RETURNING *
    `;
  },

  findByTenantId: async (tenantId: string) => {
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

    updateFields.push(`updated_at = NOW()`);
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
    const prisma = getPrismaClient();
    return await prisma.$queryRaw`
      DELETE FROM public.subscriptions WHERE id = ${id}
      RETURNING *
    `;
  }
};

export const tenantUserService = {
  findMany: async () => {
    const prisma = getPrismaClient();
    return await prisma.$queryRaw`
      SELECT tu.*, t."schemaName", t."businessName"
      FROM public.tenant_users tu
      JOIN public.tenants t ON tu."tenantId" = t.id
      ORDER BY tu.created_at DESC
    `;
  },

  create: async (data: { id: string; tenant_id: string; email: string }) => {
    const prisma = getPrismaClient();
    return await prisma.$queryRaw`
      INSERT INTO public.tenant_users (id, "tenantId", email, created_at, updated_at)
      VALUES (${data.id}, ${data.tenant_id}, ${data.email}, NOW(), NOW())
      RETURNING *
    `;
  },

  findByEmail: async (email: string) => {
    const prisma = getPrismaClient();
    const result = await prisma.$queryRaw`
      SELECT tu.*, t."schemaName", t."businessName"
      FROM public.tenant_users tu
      JOIN public.tenants t ON tu."tenantId" = t.id
      WHERE tu.email = ${email}
    `;
    return (result as any[])[0] || null;
  },

  findById: async (id: string) => {
    const prisma = getPrismaClient();
    const result = await prisma.$queryRaw`
      SELECT tu.*, t."schemaName", t."businessName"
      FROM public.tenant_users tu
      JOIN public.tenants t ON tu."tenantId" = t.id
      WHERE tu.id = ${id}
    `;
    return (result as any[])[0] || null;
  },

  update: async (id: string, data: { email?: string }) => {
    const prisma = getPrismaClient();
    if (!data.email) return null;

    return await prisma.$queryRaw`
      UPDATE public.tenant_users
      SET email = ${data.email}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
  },

  delete: async (id: string) => {
    const prisma = getPrismaClient();
    return await prisma.$queryRaw`
      DELETE FROM public.tenant_users WHERE id = ${id}
      RETURNING *
    `;
  },

  findByTenantId: async (tenantId: string) => {
    const prisma = getPrismaClient();
    return await prisma.$queryRaw`
      SELECT tu.*, t."schemaName", t."businessName"
      FROM public.tenant_users tu
      JOIN public.tenants t ON tu."tenantId" = t.id
      WHERE tu."tenantId" = ${tenantId}
      ORDER BY tu.created_at DESC
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

  const schemaName = getActiveSchema();
  if (!schemaName) {
    return null;
  }

  const prisma = getPrismaClient();
  const result = (await prisma.$queryRawUnsafe(
    `
      SELECT id
      FROM public.tenants
      WHERE schema_name = $1
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
