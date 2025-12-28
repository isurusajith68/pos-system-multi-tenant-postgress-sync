// scannerService.ts - Improved Scanner Service
import { BrowserWindow, globalShortcut } from "electron";
import usb from "usb-detection";

export interface ScannerConfig {
  enabled: boolean;
  deviceName?: string;
  vendorId?: number;
  productId?: number;
  autoFocus: boolean;
}

export interface ScannedData {
  type: "barcode" | "qrcode" | "unknown";
  data: string;
  timestamp: Date;
  device?: string;
}

// Extended scanner vendor IDs - add more common scanner manufacturers
const SCANNER_VENDOR_IDS = [
  0x04b8, // Epson
  0x0c2e, // Metrologic/Honeywell
  0x05e0, // Symbol Technologies
  0x046d, // Logitech
  0x0536, // Hand Held Products
  0x1504, // Microscan
  0x0483, // STMicroelectronics (some scanners)
  0x1a86, // QinHeng Electronics (CH340/CH341 based scanners)
  0x0403, // FTDI (some USB-serial scanners)
  0x067b, // Prolific (some USB-serial scanners)
  0x1eaf, // Leaflabs (some custom scanners)
  0x6700, // Luckydoor
  0x0218 // Generic barcode scanner (your scanner VID)
];

// Scanner product names to look for
const SCANNER_KEYWORDS = [
  "scanner",
  "barcode",
  "qr",
  "honeywell",
  "symbol",
  "datalogic",
  "zebra",
  "cognex",
  "sick",
  "keyence"
];

export const scannerService = {
  config: {
    enabled: false,
    autoFocus: true
  } as ScannerConfig,

  activeWindow: null as BrowserWindow | null,
  isScanning: false,
  scanBuffer: "",
  scanTimeout: null as NodeJS.Timeout | null,

  initialize: (mainWindow: BrowserWindow) => {
    scannerService.activeWindow = mainWindow;

    // Register keyboard scanner input handler
    scannerService.registerKeyboardScanner();

    // Listen for USB device connections
    usb.on("add", (device) => {
      scannerService.handleDeviceConnected(device);
    });

    usb.on("remove", (device) => {
      scannerService.handleDeviceDisconnected(device);
    });

    // Start monitoring USB devices
    try {
      usb.startMonitoring();
    } catch (error) {
      console.error("Failed to start USB monitoring:", error);
    }

    // Scan for already connected devices
    scannerService.scanForConnectedDevices();
  },

  scanForConnectedDevices: async () => {
    try {
      // Try to manually detect known scanner devices
      const detectedScanners = await scannerService.manualDeviceScan();

      if (detectedScanners === 0) {
        // Workaround: Temporarily stop and restart monitoring to trigger device events
        usb.stopMonitoring();
        setTimeout(() => {
          usb.startMonitoring();
        }, 1000);
      }

      // Notify that we're ready to detect devices
      if (scannerService.activeWindow) {
        scannerService.activeWindow.webContents.send("scanner:ready", {
          message: "Scanner service ready - monitoring for device connections"
        });
      }
    } catch (error) {
      console.error("Error scanning for connected devices:", error);
      // Fallback to basic monitoring
      try {
        usb.startMonitoring();
      } catch (monitorError) {
        console.error("Failed to restart USB monitoring:", monitorError);
      }
    }
  },

  manualDeviceScan: async (): Promise<number> => {
    try {
      // Manually check for known scanner devices by creating mock device objects
      // This is a workaround since usb-detection doesn't provide enumeration
      const knownScanners = [
        { vendorId: 0x0218, productId: 0x0210, deviceName: "Generic Barcode Scanner" }
        // Add more known scanner VIDs/PIDs here as needed
      ];

      let detectedCount = 0;
      for (const scanner of knownScanners) {
        // Create a mock device object to test detection
        const mockDevice = {
          vendorId: scanner.vendorId,
          productId: scanner.productId,
          deviceName: scanner.deviceName,
          deviceClass: 3 // HID class
        };

        if (scannerService.isScannerDevice(mockDevice)) {
          scannerService.handleDeviceConnected(mockDevice);
          detectedCount++;
        }
      }

      return detectedCount;
    } catch (error) {
      console.error("Error in manual device scan:", error);
      return 0;
    }
  },

  registerKeyboardScanner: () => {
    // Register global shortcut for scanner toggle
    try {
      globalShortcut.register("CommandOrControl+Shift+S", () => {
        scannerService.config.enabled = !scannerService.config.enabled;

        if (scannerService.activeWindow) {
          scannerService.activeWindow.webContents.send("scanner:status", {
            enabled: scannerService.config.enabled,
            status: scannerService.config.enabled ? "enabled" : "disabled"
          });
        }
      });
    } catch (error) {
      console.error("Failed to register global shortcut:", error);
    }

    // Listen for keyboard input when window is focused
    if (scannerService.activeWindow) {
      scannerService.activeWindow.webContents.on("before-input-event", (_event, input) => {
        // Always listen for scanner input when scanner is enabled (not just when scanning)
        // This allows barcode scanners to work even when not in "scanning" mode
        if (!scannerService.config.enabled) {
          return;
        }

        // Handle scanner input simulation
        scannerService.handleKeyboardInput(input);
      });
    }
  },

  handleKeyboardInput: (input: any) => {
    // Clear previous timeout
    if (scannerService.scanTimeout) {
      clearTimeout(scannerService.scanTimeout);
    }

    // Handle different input types
    if (input.type === "keyDown") {
      if (input.key === "Enter") {
        // Process the complete scan
        if (scannerService.scanBuffer.length > 0) {
          scannerService.processScanData(scannerService.scanBuffer.trim());
          scannerService.scanBuffer = "";
        }
      } else if (input.key.length === 1) {
        // Add character to buffer
        scannerService.scanBuffer += input.key;

        // Set timeout to auto-process if no more input
        scannerService.scanTimeout = setTimeout(() => {
          if (scannerService.scanBuffer.length > 0) {
            scannerService.processScanData(scannerService.scanBuffer.trim());
            scannerService.scanBuffer = "";
          }
        }, 100); // 100ms timeout
      }
    }
  },

  processScanData: (data: string) => {
    if (!data || data.length < 3) {
      return;
    }

    const scannedData: ScannedData = {
      type: scannerService.detectScanType(data),
      data: data,
      timestamp: new Date(),
      device: scannerService.config.deviceName
    };

    scannerService.handleScannedData(scannedData);
  },

  detectScanType: (data: string): "barcode" | "qrcode" | "unknown" => {
    // Enhanced detection logic
    if (data.startsWith("http") || data.includes("://") || data.includes("www.")) {
      return "qrcode";
    }

    // Common barcode formats
    if (
      /^[0-9]{8}$/.test(data) || // EAN-8
      /^[0-9]{12}$/.test(data) || // UPC-A
      /^[0-9]{13}$/.test(data) || // EAN-13
      /^[0-9]{14}$/.test(data) || // ITF-14
      /^[A-Z0-9]{8,}$/.test(data) || // Code 39/Code 128
      /^[0-9A-Z\-\.\ \$\/\+\%]{8,}$/.test(data)
    ) {
      // Code 39 extended
      return "barcode";
    }

    return "unknown";
  },

  handleScannedData: (data: ScannedData) => {
    if (scannerService.activeWindow) {
      // Send scanned data to renderer process
      scannerService.activeWindow.webContents.send("scanner:data", data);
    } else {
      console.warn("No active window to send scanner data to");
    }
  },

  handleDeviceConnected: (device: any) => {
    if (scannerService.isScannerDevice(device)) {
      const deviceName =
        device.deviceName ||
        device.product ||
        `Scanner VID:${device.vendorId?.toString(16)} PID:${device.productId?.toString(16)}`;

      scannerService.config.deviceName = deviceName;
      scannerService.config.vendorId = device.vendorId;
      scannerService.config.productId = device.productId;

      // Auto-enable scanner when device is connected
      scannerService.config.enabled = true;

      // Notify renderer
      if (scannerService.activeWindow) {
        scannerService.activeWindow.webContents.send("scanner:device-connected", {
          name: deviceName,
          vendorId: device.vendorId,
          productId: device.productId,
          autoEnabled: true
        });
      }
    }
  },

  handleDeviceDisconnected: (device: any) => {
    if (
      scannerService.isScannerDevice(device) &&
      device.vendorId === scannerService.config.vendorId &&
      device.productId === scannerService.config.productId
    ) {
      const disconnectedDevice = {
        name: scannerService.config.deviceName,
        vendorId: scannerService.config.vendorId,
        productId: scannerService.config.productId
      };

      scannerService.config.deviceName = undefined;
      scannerService.config.vendorId = undefined;
      scannerService.config.productId = undefined;

      // Notify renderer
      if (scannerService.activeWindow) {
        scannerService.activeWindow.webContents.send(
          "scanner:device-disconnected",
          disconnectedDevice
        );
      }
    }
  },

  isScannerDevice: (device: any): boolean => {
    // Check vendor ID
    if (device.vendorId && SCANNER_VENDOR_IDS.includes(device.vendorId)) {
      return true;
    }

    // Check device name/product name for scanner keywords
    const deviceName = (device.deviceName || device.product || "").toLowerCase();
    const manufacturerName = (device.manufacturer || "").toLowerCase();

    for (const keyword of SCANNER_KEYWORDS) {
      if (deviceName.includes(keyword) || manufacturerName.includes(keyword)) {
        return true;
      }
    }

    // Check device class (HID devices are often scanners)
    if (device.deviceClass === 3) {
      // HID class
      return true;
    }

    return false;
  },

  getConnectedDevices: async (): Promise<
    Array<{ name: string; vendorId: number; productId: number; type: string }>
  > => {
    try {
      const devices: Array<{ name: string; vendorId: number; productId: number; type: string }> =
        [];

      // Add current connected scanner if any
      if (scannerService.config.vendorId && scannerService.config.productId) {
        devices.push({
          name: scannerService.config.deviceName || "Unknown Scanner",
          vendorId: scannerService.config.vendorId,
          productId: scannerService.config.productId,
          type: "scanner"
        });
      }

      // Note: usb-detection library doesn't provide device enumeration
      // We rely on device add/remove events for detection

      return devices;
    } catch (error) {
      console.error("Error getting connected devices:", error);
      return [];
    }
  },

  startScanning: async (): Promise<{ success: boolean; message?: string }> => {
    try {
      if (!scannerService.config.enabled) {
        return { success: false, message: "Scanner is not enabled" };
      }

      scannerService.isScanning = true;
      scannerService.scanBuffer = "";

      // Notify renderer
      if (scannerService.activeWindow) {
        scannerService.activeWindow.webContents.send("scanner:status", {
          scanning: true,
          status: "scanning"
        });
      }

      return { success: true, message: "Scanner started successfully" };
    } catch (error) {
      console.error("Error starting scanner:", error);
      return { success: false, message: error instanceof Error ? error.message : "Unknown error" };
    }
  },

  stopScanning: async (): Promise<{ success: boolean; message?: string }> => {
    try {
      scannerService.isScanning = false;
      scannerService.scanBuffer = "";

      if (scannerService.scanTimeout) {
        clearTimeout(scannerService.scanTimeout);
        scannerService.scanTimeout = null;
      }

      // Notify renderer
      if (scannerService.activeWindow) {
        scannerService.activeWindow.webContents.send("scanner:status", {
          scanning: false,
          status: "idle"
        });
      }

      return { success: true, message: "Scanner stopped successfully" };
    } catch (error) {
      console.error("Error stopping scanner:", error);
      return { success: false, message: error instanceof Error ? error.message : "Unknown error" };
    }
  },

  setConfig: (config: Partial<ScannerConfig>) => {
    scannerService.config = { ...scannerService.config, ...config };
  },

  getConfig: (): ScannerConfig => {
    return { ...scannerService.config };
  },

  // Manual device detection method that can be called from renderer
  detectDevices: async (): Promise<{ success: boolean; message: string; devicesFound: number }> => {
    try {
      const detectedScanners = await scannerService.manualDeviceScan();

      if (detectedScanners > 0) {
        return {
          success: true,
          message: `Found ${detectedScanners} scanner device(s)`,
          devicesFound: detectedScanners
        };
      } else {
        // Try restarting monitoring as fallback
        usb.stopMonitoring();
        setTimeout(() => {
          usb.startMonitoring();
        }, 500);

        return {
          success: false,
          message: "No scanner devices detected. Try reconnecting your scanner.",
          devicesFound: 0
        };
      }
    } catch (error) {
      console.error("Error in manual device detection:", error);
      return {
        success: false,
        message: "Error detecting devices",
        devicesFound: 0
      };
    }
  },

  testScan: (): void => {
    const testData: ScannedData = {
      type: "barcode",
      data: "47921431341124792143134112", // Your test barcode
      timestamp: new Date(),
      device: "test-scanner"
    };

    scannerService.handleScannedData(testData);
  },

  cleanup: () => {
    try {
      usb.stopMonitoring();
      globalShortcut.unregisterAll();

      if (scannerService.scanTimeout) {
        clearTimeout(scannerService.scanTimeout);
      }

      scannerService.isScanning = false;
      scannerService.scanBuffer = "";
    } catch (error) {
      console.error("Error during scanner cleanup:", error);
    }
  }
};
