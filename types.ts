
export type CuisineType = '中餐' | '西餐' | '日韩料理' | '东南亚菜' | '其他';
export type ChineseSubCuisine = '不限' | '川菜' | '粤菜' | '鲁菜' | '湘菜' | '苏菜' | '浙菜' | '徽菜' | '闽菜';

export interface Ingredient {
  name: string;
  amount: string;
}

export interface RecipeStep {
  step: number;
  description: string;
}

export interface Dish {
  name: string;
  ingredients: Ingredient[];
  instructions: RecipeStep[];
}

export interface Recipe {
  id: string;
  title: string;
  cuisine: string;
  subCuisine?: string;
  dishes: Dish[];
  nutritionInfo: string;
  diners: number;
  createdAt: number;
  tags: string[];
}

export interface UserPreferences {
  diners: number;
  taste: string;
  cuisine: CuisineType;
  subCuisine: ChineseSubCuisine;
}
