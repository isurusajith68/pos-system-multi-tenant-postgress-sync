import { BrowserWindow, webContents } from "electron";

export interface PrinterConfig {
  width: number;
  height: number;
  margin: string;
  copies: number;
  preview: boolean;
  silent: boolean;
}

export interface ReceiptData {
  header?: string;
  storeName?: string;
  storeAddress?: string;
  storePhone?: string;
  invoiceNumber: string;
  date: string;
  time: string;
  items: Array<{
    name: string;
    quantity: number;
    unit: string;
    price: number;
    total: number;
    itemDiscount?: number;
    originalPrice?: number;
  }>;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paymentMethod?: string;
  amountReceived?: number;
  change?: number;
  footer?: string;
}

// Configured printer device information
const CONFIGURED_PRINTER = {
  name: "EPSON TM-T82 Receipt", // Use EPSON TM-T82 Receipt as default
  displayName: "EPSON TM-T82 Receipt",
  isDefault: true
};

export const printerService = {
  getPrinters: async (): Promise<
    Array<{ name: string; displayName: string; isDefault: boolean }>
  > => {
    try {
      const printers = await webContents.getFocusedWebContents()?.getPrintersAsync();

      let result: Array<{ name: string; displayName: string; isDefault: boolean }> = [];

      if (printers) {
        result = printers.map((printer) => ({
          name: printer.name,
          displayName: printer.displayName || printer.name,
          isDefault: false
        }));
      }

      const configuredExists = result.some((p) => p.name === CONFIGURED_PRINTER.name);
      if (!configuredExists) {
        result.unshift(CONFIGURED_PRINTER); // Add at the beginning as default
      }

      return result;
    } catch (error) {
      console.error("Error getting printers:", error);
      // Return at least the configured printer
      return [CONFIGURED_PRINTER];
    }
  },

  printReceipt: async (
    receiptData: ReceiptData,
    printerName?: string,
    config?: Partial<PrinterConfig>
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const defaultConfig: PrinterConfig = {
        width: 302,
        height: 600,
        margin: "0 0 0 0",
        copies: 1,
        preview: false,
        silent: true
      };
      const printConfig = { ...defaultConfig, ...config };

      const effectivePrinterName = printerName || CONFIGURED_PRINTER.name;

      const receiptHtml = generateReceiptHtml(receiptData);

      const printWindow = new BrowserWindow({
        show: false,
        width: 302,
        height: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          offscreen: false
        },

        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true
      });

      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(receiptHtml)}`);

      await new Promise((resolve) => setTimeout(resolve, 10));

      printWindow.show();
      printWindow.focus();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const printOptions: any = {
        preview: false,
        silent: true,
        copies: printConfig.copies,
        margins: {
          marginType: "custom" as const,
          top: 0,
          bottom: 0,
          left: 2,
          right: 2
        },
        pageSize: {
          width: 80000,
          height: 297000
        }
      };

      if (effectivePrinterName && effectivePrinterName !== "") {
        printOptions.deviceName = effectivePrinterName;
      } else {
        // Using system default printer
      }

      try {
        if (printConfig.silent) {
          printWindow.webContents.print(printOptions, (_success, _errorType) => {
            printWindow.close();
          });
        } else {
          const dialogOptions = { ...printOptions };
          delete dialogOptions.deviceName;
          printWindow.webContents.print(dialogOptions, (_success, _errorType) => {
            printWindow.close();
          });
        }
      } catch (printError) {
        console.error("Printer service: Print failed:", printError);
        printWindow.close();
      }

      return { success: true };
    } catch (error) {
      console.error("Error printing receipt:", error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  },

  printTest: async (printerName?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const testData: ReceiptData = {
        header: "පරීක්ෂණ රිසිට්පත",
        storeName: "ඔබේ වෙළඳසැල් නම",
        storeAddress: "123 මූලික මාවත",
        storePhone: "+94 XX XXX XXXX",
        invoiceNumber: "පරීක්ෂණ-001",
        date: new Date().toLocaleDateString("si-LK"),
        time: new Date().toLocaleTimeString("si-LK"),
        items: [
          {
            name: "පරීක්ෂණ භාණ්ඩය 1",
            quantity: 2,
            price: 1000.0,
            total: 2000.0,
            itemDiscount: 100.0,
            originalPrice: 1100.0,
            unit: "ක්"
          },
          {
            name: "පරීක්ෂණ භාණ්ඩය 2",
            quantity: 1,
            price: 1550.0,
            total: 1550.0,
            itemDiscount: 50.0,
            originalPrice: 1600.0,
            unit: "ක්"
          }
        ],
        subtotal: 3550.0,
        tax: 355.0,
        discount: 0,
        total: 3905.0,
        paymentMethod: "මුදල්",
        change: 1095.0,
        footer: "පරීක්ෂණය සඳහා ස්තුතියි!\nකෘර්තිකයා: පද්ධති පරිපාලක\ninfo@yourcompany.com"
      };

      const result = await printerService.printReceipt(testData, printerName, {
        preview: false,
        silent: true
      });

      return result;
    } catch (error) {
      console.error("Error printing test receipt:", error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }
};
function generateReceiptHtml(data: ReceiptData): string {
  return `
    <div style="font-family: 'Courier New', monospace;font-weight: bold; font-size: 11px; max-width: 250px; margin: 0 auto; background: #fff; padding: 2px; line-height: 1.3;">
      
      ${data.header ? `<div style="text-align: center; font-weight: bold; font-size: 20px; margin-bottom: 6px;">${data.header}</div>` : ""}
      ${data.storeAddress ? `<div style="text-align: center; font-size: 10px;">${data.storeAddress}</div>` : ""}
      ${data.storePhone ? `<div style="text-align: center; font-size: 10px; margin-bottom: 8px;">${data.storePhone}</div>` : ""}
      
      <table style="width: 100%; margin-bottom: 6px; font-size: 10px; border-collapse: collapse; font-weight: bold;">
        <tr>
          <td>අලෙවිකරු: ${data.footer}</td>
          <td style="text-align: right;">බිල් අංකය : ${data.invoiceNumber}</td>
        </tr>
        <tr>
          <td>දිනය : ${data.date}</td>
          <td style="text-align: right;">වේලාව : ${data.time}</td>
        </tr>
      </table>
      
      <div style="border-top: 1px dashed #000; margin: 4px 0;"></div>
      
      <!-- Item Count -->
      <div style="text-align: center; font-size: 10px; margin: 4px 0; font-weight: bold;">
        මුළු භාණ්ඩ ගණන: ${data.items.length}
      </div>
      
      <!-- Item Table -->
      <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
  <thead>
    <tr style="border-bottom: 1px dashed #000;">
      <th style="text-align: left; padding: 2px;">අයිතමය</th>
    </tr>
    <tr style="border-bottom: 1px dashed #000;">
       <th style="text-align: left; padding: 2px; width: 25%;">ප්‍රමාණය</th>
      <th style="text-align: right; padding: 2px; width: 25%;">සිල්ලර මිල</th>
      <th style="text-align: right; padding: 2px; width: 25%;">අපේ මිල</th>
      <th style="text-align: right; padding: 2px; width: 25%;">වටිනාකම</th>
    </tr>
  </thead>
  <tbody>
    ${data.items
      .map(
        (item) => `
        <tr>
          <!-- First row: Item name (full row) -->
          <td colspan="100%" style="padding: 2px; word-break: break-word; white-space: normal; font-weight: bold; text-align: left;">
            ${item.name}
          </td>
        </tr>
        <tr>
          <!-- Second row: qty + prices -->
          <td style="text-align: left; padding: 2px; width: 25%;font-weight: bold;">
            ${item.quantity} ${item.unit}
          </td>
          <td style="text-align: right; padding: 2px; width: 25%;font-weight: bold; ${item.originalPrice !== undefined && item.price < item.originalPrice ? "text-decoration: line-through;" : ""}">
            ${item.originalPrice ? `රු.${item.originalPrice.toFixed(2)}` : "රු.0.00"}
          </td>
          <td style="text-align: right; padding: 2px; width: 25%;font-weight: bold;">
            ${item.price ? `රු.${item.price.toFixed(2)}` : "රු.0.00"}
          </td>
          <td style="text-align: right; padding: 2px; width: 25%; font-weight: bold;">
            රු.${item.total.toFixed(2)}
          </td>
        </tr>
      `
      )
      .join("")}
  </tbody>
</table>

      
      <div style="border-top: 1px dashed #000; margin: 6px 0;"></div>
      
      <!-- Totals -->
      <table style="width: 100%; font-size: 11px;">
        <tr>
          <td>එකතුව</td>
          <td style="text-align: right; font-weight: bold;">රු.${data.subtotal.toFixed(2)}</td>
        </tr>
        ${
          data.discount > 0
            ? `<tr><td>වට්ටම්</td><td style="text-align: right;">-රු.${data.discount.toFixed(2)}</td></tr>`
            : ""
        }
        <tr>
          <td style="font-size: 12px; font-weight: bold;">මුළු ගෙවීම</td>
          <td style="text-align: right; font-size: 12px; font-weight: bold;">රු.${data.total.toFixed(2)}</td>
        </tr>
        ${
          data.amountReceived
            ? `<tr><td>ලැබුණු මුදල</td><td style="text-align: right;font-weight: bold;">රු.${data.amountReceived.toFixed(2)}</td></tr>`
            : ""
        }
        ${
          data.change
            ? `<tr><td>ඉතිරි මුදල</td><td style="text-align: right;font-weight: bold;">රු.${data.change.toFixed(2)}</td></tr>`
            : ""
        }
      </table>
     <!-- Separator line -->
<div style="text-align: center; margin-top: 8px; font-size: 9px; letter-spacing: 1px;">
  ------------------------------------------
</div>

<!-- Tagline -->
<div style="text-align: center; font-size: 12px; font-weight: bold; margin-top: 12px; line-height: 1.4;">
  ඔබට අවශ්‍ය සෑමදේම <br/> අඩුම මිලට
</div>

<!-- Thank you note -->
<div style="text-align: center; font-size: 10px; margin-top: 10px;">
  ⭐ ස්තුතියි නැවත එන්න ⭐
</div>

<!-- Separator line -->
<div style="text-align: center; margin-top: 8px; font-size: 9px; letter-spacing: 1px;">
  ------------------------------------------
</div>
<div style="text-align: center; margin-top: 5px; margin-bottom: 5px; font-size: 8px; font-weight: bold;">
        © 2025 Zentra Systems. All rights reserved.
      </div>
<div style="text-align: center; margin-top: 3px; margin-bottom: 5px; font-size: 8px; font-weight: bold;">
        Tel: +94 76 528 0144 | +94 78 123 6489
      </div>

    </div>
  `;
}
