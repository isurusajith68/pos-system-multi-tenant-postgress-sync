export interface Product {
  id: string;
  name: string;
  englishName?: string;
  sku?: string;
  price: number;
  costPrice?: number;
  stockLevel: number;
  categoryId: string;
  category?: {
    id: string;
    name: string;
  };
}

export interface Inventory {
  id: string;
  productId: string;
  quantity: number;
  reorderLevel: number;
  batchNumber?: string;
  expiryDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  product?: Product;
}

export interface StockTransaction {
  id: string;
  productId: string;
  type: string;
  changeQty: number;
  reason: string;
  relatedInvoiceId?: string;
  transactionDate: Date;
  createdAt: Date;
  updatedAt: Date;
  product?: {
    id: string;
    name: string;
    englishName?: string;
    sku?: string;
  };
}

export interface StockSyncInfo {
  productId: string;
  productName: string;
  productStockLevel: number;
  inventoryTotal: number;
  isInSync: boolean;
}

export interface QuickAdjustmentForm {
  adjustmentType: "set" | "add" | "subtract";
  newQuantity: number;
  changeAmount: number;
  reason: string;
  customReason: string;
  notes: string;
}

export interface QuickAdjustmentSummary {
  targetQuantity: number;
  delta: number;
  trend: "neutral" | "up" | "down";
  reasonLabel: string;
}
