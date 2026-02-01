import { Recipe } from "../types";

const API_BASE_URL = "/api";

export const apiService = {
  // 获取收藏菜谱 (支持分页)
  getSavedRecipes: async (page = 1, limit = 20): Promise<Recipe[]> => {
    const response = await fetch(`${API_BASE_URL}/recipes?page=${page}&limit=${limit}`);
    if (!response.ok) throw new Error("获取收藏菜谱失败");
    return response.json();
  },

  // 保存收藏菜谱
  saveRecipe: async (recipe: Recipe): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/recipes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(recipe),
    });
    if (!response.ok) throw new Error("保存菜谱失败");
  },

  // 获取生成历史
  getHistory: async (): Promise<Recipe[]> => {
    const response = await fetch(`${API_BASE_URL}/history`);
    if (!response.ok) throw new Error("获取历史记录失败");
    return response.json();
  },

  // 保存历史记录
  saveHistory: async (recipe: Recipe): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(recipe),
    });
    if (!response.ok) throw new Error("同步历史记录失败");
  },
};
