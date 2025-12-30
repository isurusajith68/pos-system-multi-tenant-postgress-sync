import { syncNow, getTenantId } from "./sync";

type SyncState = "idle" | "syncing" | "error" | "offline";

const DEFAULT_BASE_INTERVAL_MS = 10000;
const MAX_BACKOFF_MS = 300000;

let currentState: SyncState = "idle";
let lastError: string | null = null;
let timer: NodeJS.Timeout | null = null;
let backoffMs = DEFAULT_BASE_INTERVAL_MS;

const isConnectionError = (error: unknown): boolean => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error && typeof (error as { message?: unknown }).message === "string"
          ? String((error as { message?: unknown }).message)
          : "";

  const normalized = message.toLowerCase();
  return (
    normalized.includes("can't reach database server") ||
    normalized.includes("server has closed the connection") ||
    normalized.includes("connectionreset") ||
    normalized.includes("econnreset") ||
    normalized.includes("connection was forcibly closed") ||
    normalized.includes("connection refused") ||
    normalized.includes("connect timeout") ||
    normalized.includes("timeout")
  );
};

const scheduleNext = (delayMs: number): void => {
  if (timer) {
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    void runCycle();
  }, delayMs);
};

const runCycle = async (): Promise<void> => {
  const tenantId = getTenantId();
  if (!tenantId) {
    currentState = "offline";
    scheduleNext(backoffMs);
    return;
  }

  currentState = "syncing";
  lastError = null;

  try {
    await syncNow();
    currentState = "idle";
    backoffMs = DEFAULT_BASE_INTERVAL_MS;
  } catch (error) {
    const connectionError = isConnectionError(error);
    currentState = connectionError ? "offline" : "error";
    lastError = error instanceof Error ? error.message : String(error);
    backoffMs = connectionError
      ? DEFAULT_BASE_INTERVAL_MS
      : Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  } finally {
    scheduleNext(backoffMs);
  }
};

export const startSyncWorker = (): void => {
  if (timer) {
    return;
  }
  scheduleNext(DEFAULT_BASE_INTERVAL_MS);
};

export const stopSyncWorker = (): void => {
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  timer = null;
  currentState = "idle";
  lastError = null;
  backoffMs = DEFAULT_BASE_INTERVAL_MS;
};

export const getSyncStatus = (): { state: SyncState; error: string | null } => {
  return { state: currentState, error: lastError };
};
