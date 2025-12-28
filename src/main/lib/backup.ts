import { app } from "electron";
import { join, resolve } from "path";
import { copyFile, mkdir, readdir, stat } from "fs/promises";
import { existsSync } from "fs";
import { is } from "@electron-toolkit/utils";

export const backupService = {
  createBackup: async (
    backupName?: string
  ): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      // Use the same database path logic as prisma.ts
      const dbPath = is.dev
        ? resolve(join(__dirname, "../../prisma/db/pos.db"))
        : join(app.getPath("userData"), "pos.db");

      // Verify database file exists before attempting backup
      if (!existsSync(dbPath)) {
        console.error("Database file not found at:", dbPath);
        return { success: false, error: `Database file not found at: ${dbPath}` };
      }

      // Create backups directory if it doesn't exist
      const backupsDir = join(app.getPath("userData"), "backups");
      if (!existsSync(backupsDir)) {
        await mkdir(backupsDir, { recursive: true });
      }

      // Generate backup filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
      const backupFileName = backupName
        ? `${backupName}_${timestamp}.db`
        : `backup_${timestamp}.db`;
      const backupPath = join(backupsDir, backupFileName);

      // Copy database file
      await copyFile(dbPath, backupPath);

      return { success: true, path: backupPath };
    } catch (error) {
      console.error("Error creating backup:", error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  },

  listBackups: async (): Promise<
    Array<{ name: string; path: string; size: number; createdAt: Date }>
  > => {
    try {
      const backupsDir = join(app.getPath("userData"), "backups");

      if (!existsSync(backupsDir)) {
        return [];
      }

      const files = await readdir(backupsDir);
      const backupFiles = files.filter((file) => file.endsWith(".db"));

      const backups = await Promise.all(
        backupFiles.map(async (file) => {
          const filePath = join(backupsDir, file);
          const stats = await stat(filePath);

          return {
            name: file,
            path: filePath,
            size: stats.size,
            createdAt: stats.mtime
          };
        })
      );

      // Sort by creation date (newest first)
      return backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (error) {
      console.error("Error listing backups:", error);
      return [];
    }
  },

  restoreBackup: async (backupPath: string): Promise<{ success: boolean; error?: string }> => {
    try {
      // Use the same database path logic as prisma.ts
      const dbPath = is.dev
        ? resolve(join(__dirname, "../../prisma/db/pos.db"))
        : join(app.getPath("userData"), "pos.db");

      // Verify backup file exists
      if (!existsSync(backupPath)) {
        return { success: false, error: "Backup file not found" };
      }

      // Copy backup file to database location
      await copyFile(backupPath, dbPath);

      return { success: true };
    } catch (error) {
      console.error("Error restoring backup:", error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  },

  deleteBackup: async (backupPath: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { unlink } = await import("fs/promises");

      if (!existsSync(backupPath)) {
        return { success: false, error: "Backup file not found" };
      }

      await unlink(backupPath);
      return { success: true };
    } catch (error) {
      console.error("Error deleting backup:", error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  },

  getBackupStats: async (): Promise<{
    totalBackups: number;
    totalSize: number;
    lastBackup?: Date;
  }> => {
    try {
      const backups = await backupService.listBackups();

      if (backups.length === 0) {
        return { totalBackups: 0, totalSize: 0 };
      }

      const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);
      const lastBackup = backups[0].createdAt;

      return {
        totalBackups: backups.length,
        totalSize,
        lastBackup
      };
    } catch (error) {
      console.error("Error getting backup stats:", error);
      return { totalBackups: 0, totalSize: 0 };
    }
  }
};
