
import { CuisineType, ChineseSubCuisine } from './types';

export const CUISINE_OPTIONS: CuisineType[] = ['中餐', '西餐', '日韩料理', '东南亚菜', '其他'];
export const CHINESE_SUB_CUISINES: ChineseSubCuisine[] = ['不限', '川菜', '粤菜', '鲁菜', '湘菜', '苏菜', '浙菜', '徽菜', '闽菜'];
export const TASTE_OPTIONS = ['辣的', '甜的', '酸的', '咸的', '淡的', '清爽', '浓郁'];

export const STORAGE_KEYS = {
  SAVED_RECIPES: 'neo_recipe_saved',
  HISTORY: 'neo_recipe_history'
};
