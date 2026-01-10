import { BrowserWindow, webContents } from "electron";

export interface PrinterConfig {
  width: number;
  height: number;
  margin: string;
  copies: number;
  preview: boolean;
  silent: boolean;
  receiptTemplate?: string;
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

export const printerService = {
  getPrinters: async (): Promise<
    Array<{ name: string; displayName: string; isDefault: boolean }>
  > => {
    try {
      const printers = await webContents.getFocusedWebContents()?.getPrintersAsync();

      if (!printers) {
        return [];
      }

      return printers.map((printer) => ({
        name: printer.name,
        displayName: printer.displayName || printer.name,
        isDefault: false
      }));
    } catch (error) {
      console.error("Error getting printers:", error);
      return [];
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

      const receiptHtml = getReceiptHtml(receiptData, config?.receiptTemplate);

      const printWindow = new BrowserWindow({
        show: false,
        width: 302,
        height: 600,
        center: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          offscreen: false
        },
        frame: true,
        alwaysOnTop: true,
        skipTaskbar: true
      });

      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(receiptHtml)}`);

      await new Promise((resolve) => setTimeout(resolve, 10));

      printWindow.show();
      printWindow.focus();
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const printOptions: any = {
        preview: false,
        silent: true,
        copies: printConfig.copies,
        margins: {
          marginType: "custom" as const,
          top: 0,
          bottom: 0,
          left: 0,
          right: 0
        },
        pageSize: {
          width: 72000,
          height: 2970000
        }
      };

      if (printerName && printerName !== "") {
        printOptions.deviceName = printerName;
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

  printTest: async (
    printerName?: string,
    receiptTemplate?: string
  ): Promise<{ success: boolean; error?: string }> => {
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
            name: "පරීක්ෂණ භාණ්ඩය 2 පරීක්ෂණ භාණ්ඩය 2 පරීක්ෂණ භාණ්ඩය 2 පරීක්ෂණ භාණ්ඩය 2",
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
        silent: true,
        receiptTemplate
      });

      return result;
    } catch (error) {
      console.error("Error printing test receipt:", error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }
};

function getReceiptHtml(data: ReceiptData, template?: string): string {
  if (template === "restudent_si") {
    return generateReceiptRestudentHtml(data);
  }
  if (template === "restudent_en") {
    return generateReceiptRestudentHtmlEnglish(data);
  }
  return generateReceiptHtml(data);
}
function generateReceiptHtml(data: ReceiptData): string {
  const Profit = data.items.reduce(
    (total, i) => total + ((i.originalPrice || 0) - i.price) * i.quantity,
    0
  );

  return `
    <style>
      @page { size: 80mm auto; margin: 0; }
      body { margin: 0; }
    </style>
    <div style="font-family: 'Courier New', monospace;font-weight: bold; font-size: 11px; width: 95%; margin: 0; background: #fff; padding: 0px; line-height: 1.3;">
      
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
       <th style="text-align: left; padding: 2px; width: 12%;">ප්‍රමාණය</th>
      <th style="text-align: right; padding: 2px; width: 30%;">සිල්ලර මිල</th>
      <th style="text-align: right; padding: 2px; width: 30%;">අපේ මිල</th>
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
          <td style="text-align: left; padding: 2px; width: 12%;font-weight: bold;">
            ${item.quantity} ${item.unit}
          </td>
          <td style="text-align: right; padding: 2px; width: 30%;font-weight: bold; ${item.originalPrice !== undefined && item.price < item.originalPrice ? "text-decoration: line-through;" : ""}">
            ${item.originalPrice ? `රු.${item.originalPrice.toFixed(2)}` : "රු.0.00"}
          </td>
          <td style="text-align: right; padding: 2px; width: 30%;font-weight: bold;">
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
          <td style="font-size: 12px; font-weight: bold;">එකතුව</td>
          <td style="text-align: right; font-weight: bold;">රු.${data.subtotal.toFixed(2)}</td>
        </tr>
        ${
          data.discount > 0
            ? `<tr><td style="font-size: 12px; font-weight: bold;">වට්ටම්</td><td style="text-align: right;">-රු.${data.discount.toFixed(2)}</td></tr>`
            : ""
        }
        <tr>
          <td style="font-size: 12px; font-weight: bold;">ගෙවිය යුතු මුදල</td>
          <td style="text-align: right; font-size: 12px; font-weight: bold;">රු.${data.total.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="font-size: 12px; font-weight: bold;">ලැබූ ලාභය</td>
          <td style="text-align: right; font-size: 12px; font-weight: bold;">රු.${Profit.toFixed(2)}</td>
        </tr>
        ${
          data.amountReceived
            ? `<tr><td style="font-size: 12px; font-weight: bold;">ලැබුණු මුදල</td><td style="text-align: right;font-weight: bold;">රු.${data.amountReceived.toFixed(2)}</td></tr>`
            : ""
        }
        ${
          data.change
            ? `<tr><td style="font-size: 12px; font-weight: bold;">ඉතිරි මුදල</td><td style="text-align: right;font-weight: bold;">රු.${data.change.toFixed(2)}</td></tr>`
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

function generateReceiptRestudentHtml(data: ReceiptData): string {
  return `
    <style>
      @page { size: 80mm auto; margin: 0; }
      body { margin: 0; }
    </style>
    <div style="font-family: 'Courier New', monospace;font-weight: bold; font-size: 11px; width: 95%; margin: 0; background: #fff; padding: 0px; line-height: 1.3;">
      
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
       <th style="text-align: left; padding: 2px; width: 12%;">ප්‍රමාණය</th>
      <th style="text-align: right; padding: 2px; width: 30%;">මිල</th>
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
          <td style="text-align: left; padding: 2px; width: 12%;font-weight: bold;">
            ${item.quantity} ${item.unit}
          </td>
          <td style="text-align: right; padding: 2px; width: 30%;font-weight: bold;">
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
          <td style="font-size: 12px; font-weight: bold;">එකතුව</td>
          <td style="text-align: right; font-weight: bold;">රු.${data.subtotal.toFixed(2)}</td>
        </tr>
        ${
          data.discount > 0
            ? `<tr><td style="font-size: 12px; font-weight: bold;">වට්ටම්</td><td style="text-align: right;">-රු.${data.discount.toFixed(2)}</td></tr>`
            : ""
        }
        <tr>
          <td style="font-size: 12px; font-weight: bold;" >ගෙවිය යුතු මුදල</td>
          <td style="text-align: right; font-size: 12px; font-weight: bold;">රු.${data.total.toFixed(2)}</td>
        </tr>
        ${
          data.amountReceived
            ? `<tr><td style="font-size: 12px; font-weight: bold;">ලැබුණු මුදල</td><td style="text-align: right;font-weight: bold;">රු.${data.amountReceived.toFixed(2)}</td></tr>`
            : ""
        }
        ${
          data.change
            ? `<tr><td style="font-size: 12px; font-weight: bold;">ඉතිරි මුදල</td><td style="text-align: right;font-weight: bold;">රු.${data.change.toFixed(2)}</td></tr>`
            : ""
        }
      </table>
     <!-- Separator line -->
<div style="text-align: center; margin-top: 8px; font-size: 9px; letter-spacing: 1px;">
  ------------------------------------------
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


function generateReceiptRestudentHtmlEnglish(data: ReceiptData): string {
  return `
    <style>
      @page { size: 80mm auto; margin: 0; }
      body { margin: 0; }
    </style>
    <div style="font-family: 'Courier New', monospace;font-weight: bold; font-size: 11px; width: 95%; margin: 0; background: #fff; padding: 0px; line-height: 1.3;">
      
      ${data.header ? `<div style="text-align: center; font-weight: bold; font-size: 20px; margin-bottom: 6px;">${data.header}</div>` : ""}
      ${data.storeAddress ? `<div style="text-align: center; font-size: 10px;">${data.storeAddress}</div>` : ""}
      ${data.storePhone ? `<div style="text-align: center; font-size: 10px; margin-bottom: 8px;">${data.storePhone}</div>` : ""}
      
      <table style="width: 100%; margin-bottom: 6px; font-size: 10px; border-collapse: collapse; font-weight: bold;">
        <tr>
          <td>Customer: ${data.footer}</td>
          <td style="text-align: right;">Invoice No: ${data.invoiceNumber}</td>
        </tr>
        <tr>
          <td>Date: ${data.date}</td>
          <td style="text-align: right;">Time: ${data.time}</td>
        </tr>
      </table>
      
      <div style="border-top: 1px dashed #000; margin: 4px 0;"></div>
      
      <!-- Item Count -->
      <div style="text-align: center; font-size: 10px; margin: 4px 0; font-weight: bold;">
        Item Count: ${data.items.length}
      </div>
      
      <!-- Item Table -->
      <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
  <thead>
    <tr style="border-bottom: 1px dashed #000;">
      <th style="text-align: left; padding: 2px;">Item</th>
    </tr>
    <tr style="border-bottom: 1px dashed #000;">
       <th style="text-align: left; padding: 2px; width: 12%;">Qty</th>
      <th style="text-align: right; padding: 2px; width: 30%;">Price</th>
      <th style="text-align: right; padding: 2px; width: 25%;">Total</th>
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
          <td style="text-align: left; padding: 2px; width: 12%;font-weight: bold;">
            ${item.quantity} ${item.unit}
          </td>
          <td style="text-align: right; padding: 2px; width: 30%;font-weight: bold;">
            ${item.price ? `Rs.${item.price.toFixed(2)}` : "Rs.0.00"}
          </td>
          <td style="text-align: right; padding: 2px; width: 25%; font-weight: bold;">
            Rs.${item.total.toFixed(2)}
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
          <td style="font-size: 12px; font-weight: bold;">Subtotal</td>
          <td style="text-align: right; font-weight: bold;">Rs.${data.subtotal.toFixed(2)}</td>
        </tr>
        ${
          data.discount > 0
            ? `<tr><td style="font-size: 12px; font-weight: bold;">Discount</td><td style="text-align: right;">-Rs.${data.discount.toFixed(2)}</td></tr>`
            : ""
        }
        <tr>
          <td style="font-size: 12px; font-weight: bold;">Total Amount</td>
          <td style="text-align: right; font-size: 12px; font-weight: bold;">Rs.${data.total.toFixed(2)}</td>
        </tr>
        ${
          data.amountReceived
            ? `<tr><td style="font-size: 12px; font-weight: bold;">Amount Received</td><td style="font-size: 12px; text-align: right;font-weight: bold;">Rs.${data.amountReceived.toFixed(2)}</td></tr>`
            : ""
        }
        ${
          data.change
            ? `<tr><td style="font-size: 12px; font-weight: bold;">Change</td><td style="text-align: right;font-weight: bold;">Rs.${data.change.toFixed(2)}</td></tr>`
            : ""
        }
      </table>
     <!-- Separator line -->
<div style="text-align: center; margin-top: 8px; font-size: 9px; letter-spacing: 1px;">
  ------------------------------------------
</div>

<!-- Thank you note -->
<div style="text-align: center; font-size: 10px; margin-top: 10px;">
  Thank you for your purchase.
</div>

<!-- Separator line -->
<div style="text-align: center; margin-top: 8px; font-size: 9px; letter-spacing: 1px;">
  ------------------------------------------
</div>
<div style="text-align: center; margin-top: 5px; margin-bottom: 5px; font-size: 8px; font-weight: bold;">
        Ac 2025 Zentra Systems. All rights reserved.
      </div>
<div style="text-align: center; margin-top: 3px; margin-bottom: 5px; font-size: 8px; font-weight: bold;">
        Tel: +94 76 528 0144 | +94 78 123 6489
      </div>

    </div>
  `;
}


