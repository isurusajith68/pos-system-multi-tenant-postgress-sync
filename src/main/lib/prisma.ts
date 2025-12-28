import { is } from "@electron-toolkit/utils";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import type { Prisma, PrismaClient } from "../../generated/prisma";

// Global singleton instances - one for public schema, one for tenant schemas
type PrismaClientConstructor = new (options?: Prisma.PrismaClientOptions) => PrismaClient;

const DEFAULT_TENANT_CLIENT_LIMIT = 10;
const DEFAULT_TENANT_CONNECTION_LIMIT = 5;
const DEFAULT_POOL_TIMEOUT = 60;
const DEFAULT_TRANSACTION_MAX_WAIT = 15000;
const DEFAULT_TRANSACTION_TIMEOUT = 15000;

let publicPrismaInstance: PrismaClient | null = null;
const tenantPrismaInstances: Map<string, PrismaClient> = new Map();
let activeSchemaName: string | null = null;
let tenantClientLimit: number | null = null;
let tenantConnectionLimit: number | null = null;
let tenantPoolTimeout: number | null = null;
let publicPoolTimeout: number | null = null;
let transactionMaxWait: number | null = null;
let transactionTimeout: number | null = null;
let envLoaded = false;

export function getPrismaClient(): PrismaClient {
  if (activeSchemaName) {
    return getTenantPrismaClient(activeSchemaName);
  }

  return getPublicPrismaClient();
}

export function setActiveSchema(schemaName: string | null): void {
  const normalizedSchema = typeof schemaName === "string" ? schemaName.trim() : "";
  activeSchemaName = normalizedSchema ? normalizedSchema : null;
}

export function getActiveSchema(): string | null {
  return activeSchemaName;
}

function getPublicPrismaClientInternal(): PrismaClient {
  // Return existing instance if already created
  if (publicPrismaInstance) {
    return publicPrismaInstance;
  }

  try {
    // PostgreSQL connection for public schema - DATABASE_URL should be set in environment
    publicPrismaInstance = createPrismaClient(buildDatabaseUrl());

    return publicPrismaInstance;
  } catch (error) {
    console.error("Failed to initialize public Prisma client:", error);
    throw error;
  }
}

export function getPublicPrismaClient(): PrismaClient {
  return getPublicPrismaClientInternal();
}

function getTenantPrismaClientInternal(schemaName: string): PrismaClient {
  const normalizedSchema = schemaName.trim();
  const existingClient = tenantPrismaInstances.get(normalizedSchema);
  if (existingClient) {
    touchTenantClient(normalizedSchema, existingClient);
    return existingClient;
  }

  const tenantClient = createPrismaClient(buildDatabaseUrl(normalizedSchema));
  tenantPrismaInstances.set(normalizedSchema, tenantClient);
  evictTenantClientsIfNeeded();
  return tenantClient;
}

export function getTenantPrismaClient(schemaName: string): PrismaClient {
  return getTenantPrismaClientInternal(schemaName);
}

function touchTenantClient(schemaName: string, client: PrismaClient): void {
  tenantPrismaInstances.delete(schemaName);
  tenantPrismaInstances.set(schemaName, client);
}

function evictTenantClientsIfNeeded(): void {
  const maxClients = resolveTenantClientLimit();
  if (tenantPrismaInstances.size <= maxClients) {
    return;
  }

  const overflow = tenantPrismaInstances.size - maxClients;
  for (let i = 0; i < overflow; i += 1) {
    const oldestKey = tenantPrismaInstances.keys().next().value as string | undefined;
    if (!oldestKey) {
      return;
    }

    const client = tenantPrismaInstances.get(oldestKey);
    tenantPrismaInstances.delete(oldestKey);
    if (client) {
      void disconnectTenantClient(oldestKey, client);
    }
  }
}

async function disconnectTenantClient(schemaName: string, client: PrismaClient): Promise<void> {
  try {
    await client.$disconnect();
  } catch (error) {
    console.warn(`Failed to disconnect Prisma client for schema "${schemaName}":`, error);
  }
}

function buildDatabaseUrl(schemaName?: string): string {
  loadEnvIfNeeded();
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const url = new URL(baseUrl);

  if (!schemaName) {
    const poolTimeout = resolvePublicPoolTimeout();
    if (poolTimeout !== null) {
      url.searchParams.set("pool_timeout", poolTimeout.toString());
    }
    return url.toString();
  }

  url.searchParams.set("schema", schemaName);
  const tenantLimit = resolveTenantConnectionLimit();
  if (tenantLimit) {
    url.searchParams.set("connection_limit", tenantLimit.toString());
  }
  const poolTimeout = resolveTenantPoolTimeout();
  if (poolTimeout !== null) {
    url.searchParams.set("pool_timeout", poolTimeout.toString());
  }
  return url.toString();
}

function loadEnvIfNeeded(): void {
  if (envLoaded) {
    return;
  }

  const candidatePaths = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), ".env.production"),
    resolve(__dirname, "../../.env"),
    resolve(__dirname, "../../.env.production")
  ];

  for (const envPath of candidatePaths) {
    if (!existsSync(envPath)) {
      continue;
    }

    try {
      const content = readFileSync(envPath, "utf8");
      applyEnvFromFile(content);
      if (process.env.DATABASE_URL) {
        // Continue loading remaining files to pick up non-DB settings.
      }
    } catch (error) {
      console.warn(`Failed to load env file at ${envPath}:`, error);
    }
  }

  envLoaded = true;
}

function applyEnvFromFile(content: string): void {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_\\.-]*)\\s*=\\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    if (process.env[key] !== undefined) {
      continue;
    }

    let value = match[2].trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function resolveTenantClientLimit(): number {
  if (tenantClientLimit !== null) {
    return tenantClientLimit;
  }

  tenantClientLimit =
    getEnvNumber("PRISMA_TENANT_CLIENT_LIMIT") ?? DEFAULT_TENANT_CLIENT_LIMIT;
  return tenantClientLimit;
}

function resolveTenantConnectionLimit(): number {
  if (tenantConnectionLimit !== null) {
    return tenantConnectionLimit;
  }

  tenantConnectionLimit =
    getEnvNumber("PRISMA_TENANT_CONNECTION_LIMIT") ??
    getEnvNumber("PRISMA_CONNECTION_LIMIT") ??
    DEFAULT_TENANT_CONNECTION_LIMIT;
  return tenantConnectionLimit;
}

function resolveTenantPoolTimeout(): number | null {
  if (tenantPoolTimeout !== null) {
    return tenantPoolTimeout;
  }

  tenantPoolTimeout =
    getEnvNonNegativeNumber("PRISMA_TENANT_POOL_TIMEOUT") ??
    getEnvNonNegativeNumber("PRISMA_POOL_TIMEOUT") ??
    DEFAULT_POOL_TIMEOUT;
  return tenantPoolTimeout;
}

function resolvePublicPoolTimeout(): number | null {
  if (publicPoolTimeout !== null) {
    return publicPoolTimeout;
  }

  publicPoolTimeout =
    getEnvNonNegativeNumber("PRISMA_POOL_TIMEOUT") ?? DEFAULT_POOL_TIMEOUT;
  return publicPoolTimeout;
}

function resolveTransactionOptions(): Prisma.PrismaClientOptions["transactionOptions"] {
  return {
    maxWait: resolveTransactionMaxWait(),
    timeout: resolveTransactionTimeout()
  };
}

function resolveTransactionMaxWait(): number {
  if (transactionMaxWait !== null) {
    return transactionMaxWait;
  }

  transactionMaxWait =
    getEnvNumber("PRISMA_TX_MAX_WAIT") ??
    getEnvNumber("PRISMA_TRANSACTION_MAX_WAIT") ??
    DEFAULT_TRANSACTION_MAX_WAIT;
  return transactionMaxWait;
}

function resolveTransactionTimeout(): number {
  if (transactionTimeout !== null) {
    return transactionTimeout;
  }

  transactionTimeout =
    getEnvNumber("PRISMA_TX_TIMEOUT") ??
    getEnvNumber("PRISMA_TRANSACTION_TIMEOUT") ??
    DEFAULT_TRANSACTION_TIMEOUT;
  return transactionTimeout;
}

function getEnvNumber(key: string): number | null {
  loadEnvIfNeeded();
  const rawValue = process.env[key];
  if (!rawValue) {
    return null;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

function getEnvNonNegativeNumber(key: string): number | null {
  loadEnvIfNeeded();
  const rawValue = process.env[key];
  if (!rawValue) {
    return null;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.floor(parsed);
}

function createPrismaClient(databaseUrl: string): PrismaClient {
  const PrismaClientCtor = resolvePrismaClientConstructor();

  return new PrismaClientCtor({
    log: ["error", "warn"],
    // Connection pool settings are configured in the database URL
    transactionOptions: resolveTransactionOptions(),
    datasources: {
      db: {
        url: databaseUrl
      }
    }
  });
}

function resolvePrismaClientConstructor(): PrismaClientConstructor {
  // Always use our generated client instead of @prisma/client
  if (is.dev) {
    // In development, use the generated client from src
    const { PrismaClient: DevClient } = require(join(__dirname, "../../src/generated/prisma"));
    return DevClient;
  }

  // In production, try to find the generated client in the packaged app
  try {
    // Try the generated client path first
    const { PrismaClient: ProdClient } = require(join(__dirname, "../../src/generated/prisma"));
    return ProdClient;
  } catch {
    // Fallback to resources path
    const { PrismaClient: ResourceClient } = require(
      join(process.resourcesPath, "generated", "prisma")
    );
    return ResourceClient;
  }
}

// Cleanup function for graceful shutdown
export async function disconnectPrismaClients(): Promise<void> {
  const disconnectPromises: Promise<void>[] = [];

  if (publicPrismaInstance) {
    disconnectPromises.push(publicPrismaInstance.$disconnect());
  }

  for (const [schemaName, client] of tenantPrismaInstances.entries()) {
    disconnectPromises.push(
      client.$disconnect().catch((error) => {
        console.warn(`Failed to disconnect Prisma client for schema "${schemaName}":`, error);
      })
    );
  }

  await Promise.all(disconnectPromises);
  tenantPrismaInstances.clear();
  publicPrismaInstance = null;
}

// Handle graceful shutdown
process.on("beforeExit", async () => {
  await disconnectPrismaClients();
});

export default getPrismaClient;
