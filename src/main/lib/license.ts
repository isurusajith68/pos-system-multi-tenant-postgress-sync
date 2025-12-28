import { settingsService } from "./database";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { app } from "electron";

const VALID_LICENSE_KEYS = [
  // Test keys removed for production
  // Use ENCRYPTED_VALID_LICENSE_KEYS for production deployment
];

// Load environment variables from .env.production file if they don't exist
function loadProductionEnv(): void {
  try {
    const envPath = join(app.getAppPath(), ".env.production");
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, "utf-8");
      const lines = envContent.split("\n");

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith("#")) {
          const [key, ...valueParts] = trimmedLine.split("=");
          const value = valueParts.join("=").replace(/^["']|["']$/g, ""); // Remove quotes
          if (key && value && !process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    }
  } catch (error) {
    console.error("Error loading production environment:", error);
  }
}

// Load production environment on module initialization
loadProductionEnv();

const ENCRYPTION_KEY = process.env.LICENSE_ENCRYPTION_KEY || "zentra_pos_secure_key_2024";

function simpleDecrypt(encrypted: string, key: string = ENCRYPTION_KEY): string {
  try {
    // Convert hex string back to bytes
    const encryptedBytes = new Uint8Array(
      encrypted.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
    );

    // XOR with key
    const keyBytes = new TextEncoder().encode(key);
    const decryptedBytes = new Uint8Array(encryptedBytes.length);

    for (let i = 0; i < encryptedBytes.length; i++) {
      decryptedBytes[i] = encryptedBytes[i] ^ keyBytes[i % keyBytes.length];
    }

    // Convert back to string
    return new TextDecoder().decode(decryptedBytes);
  } catch (error) {
    console.error("Error decrypting license key:", error);
    return "";
  }
}

// Get valid license keys (use plain text for development, encrypted for production)
function getValidLicenseKeys(): string[] {
  // Always use plain text keys for development/testing
  // Only use encrypted keys if they are properly configured and not empty
  const encryptedKeys = process.env.ENCRYPTED_LICENSE_KEYS
    ? process.env.ENCRYPTED_LICENSE_KEYS.split(",").map((key) => key.trim())
    : [];

  if (encryptedKeys.length > 0 && encryptedKeys[0].length > 10) {
    return encryptedKeys.map((encrypted) => simpleDecrypt(encrypted, ENCRYPTION_KEY));
  }

  return VALID_LICENSE_KEYS;
}

export const licenseService = {
  // Check if the app is already activated
  isActivated: async (): Promise<boolean> => {
    try {
      const activationSetting = await settingsService.findByKey("license_activated");
      return activationSetting?.value === "true";
    } catch (error) {
      console.error("Error checking license activation:", error);
      return false;
    }
  },

  // Validate a license key
  validateLicenseKey: (licenseKey: string): boolean => {
    // Basic format validation
    const licensePattern = /^ZENTRA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
    if (!licensePattern.test(licenseKey)) {
      return false;
    }

    // Check if the key is in our valid keys list
    const validKeys = getValidLicenseKeys();
    const isValid = validKeys.includes(licenseKey);

    return isValid;
  },

  // Activate the license
  activateLicense: async (licenseKey: string): Promise<{ success: boolean; message: string }> => {
    try {
      // Validate the license key
      if (!licenseService.validateLicenseKey(licenseKey)) {
        return {
          success: false,
          message: "Invalid license key. Please check your key and try again."
        };
      }

      // Store activation status
      await settingsService.upsert(
        "license_activated",
        "true",
        "boolean",
        "security",
        "License activation status"
      );

      // Store the license key (hashed for security)
      const hashedKey = await licenseService.hashLicenseKey(licenseKey);
      await settingsService.upsert(
        "license_key_hash",
        hashedKey,
        "string",
        "security",
        "Hashed license key for verification"
      );

      return {
        success: true,
        message: "License activated successfully!"
      };
    } catch (error) {
      console.error("Error activating license:", error);
      return {
        success: false,
        message: "Failed to activate license. Please try again."
      };
    }
  },

  // Deactivate the license (for testing purposes)
  deactivateLicense: async (): Promise<{ success: boolean; message: string }> => {
    try {
      await settingsService.upsert(
        "license_activated",
        "false",
        "boolean",
        "security",
        "License activation status"
      );

      await settingsService.delete("license_key_hash");

      return {
        success: true,
        message: "License deactivated successfully!"
      };
    } catch (error) {
      console.error("Error deactivating license:", error);
      return {
        success: false,
        message: "Failed to deactivate license."
      };
    }
  },

  // Simple hash function for license key (not cryptographically secure, but better than plain text)
  hashLicenseKey: async (licenseKey: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(licenseKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  },

  // Get license information
  getLicenseInfo: async () => {
    try {
      const isActivated = await licenseService.isActivated();
      const licenseKeyHash = await settingsService.findByKey("license_key_hash");

      return {
        isActivated,
        hasLicenseKey: !!licenseKeyHash,
        licenseKeyHash: licenseKeyHash?.value
      };
    } catch (error) {
      console.error("Error getting license info:", error);
      return {
        isActivated: false,
        hasLicenseKey: false,
        licenseKeyHash: null
      };
    }
  }
};
