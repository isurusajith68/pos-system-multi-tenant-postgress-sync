export interface Product {
  product_id: string;
  sku: string;
  barcode: string;
  name: string;
  description: string;
  brand: string;
  category_id: string;
  price: number;
  cost_price: number;
  discounted_price: number;
  wholesale: number;
  tax_inclusive_price: number;
  tax_rate: number;
  unit_size: string;
  stock_level: number;
}

export interface Category {
  category_id: string;
  name: string;
  parent_category_id: string | null;
}

export interface ProductImage {
  image_id: string;
  product_id: string;
  url: string;
  alt_text: string;
  is_primary: boolean;
}

export interface ProductTag {
  tag_id: string;
  name: string;
}

export interface CartItem extends Product {
  quantity: number;
  total: number;
}
