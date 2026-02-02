
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
  taste?: string;
  cuisine?: CuisineType;
  subCuisine?: ChineseSubCuisine;
}

// 用户画像类型
export interface UserProfile {
  userId: string;
  tasteWeights: Record<string, number>;        // 例如 {"辣": 0.8, "甜": 0.5}
  cuisineWeights: Record<string, number>;      // 例如 {"川菜": 0.9, "粤菜": 0.6}
  ingredientWeights: Record<string, number>;   // 例如 {"鸡胸肉": 0.7}
  cookingMethodWeights: Record<string, number>; // 例如 {"清蒸": 0.9}
  nutritionWeights: Record<string, number>;     // 例如 {"蛋白质": 0.8}
  updatedAt: number;
}

// 用户反馈类型
export interface UserFeedback {
  id: string;
  userId: string;
  recipeId: string;
  feedbackType: 'like' | 'dislike';
  createdAt: number;
}

// 基础菜谱类型（本地库）
export interface BaseRecipe {
  id: string;
  title: string;
  sourceUrl: string;
  ingredients: string;  // JSON 字符串
  steps: string;        // JSON 字符串
  tags: string;         // JSON 字符串
  cookingMethods: string; // JSON 字符串数组
  nutritionTags: string;  // JSON 字符串数组
  tasteTags: string;      // JSON 字符串数组
  cuisineType: string;
  createdAt: number;
}

// 推荐请求类型
export interface RecommendationRequest {
  userId: string;
  diners: number;
  excludeRecipeIds?: string[];
}
