import { Recipe, UserProfile, RecommendationRequest } from "../types";

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

  // --- 新增：用户画像与推荐系统 API ---

  // 获取用户画像
  getUserProfile: async (userId: string): Promise<UserProfile> => {
    const response = await fetch(`${API_BASE_URL}/user-profile/${userId}`);
    if (!response.ok) throw new Error("获取用户画像失败");
    return response.json();
  },

  // 更新用户画像
  updateUserProfile: async (userId: string, profile: UserProfile): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/user-profile/${userId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tasteWeights: profile.tasteWeights,
        cuisineWeights: profile.cuisineWeights,
        ingredientWeights: profile.ingredientWeights,
        cookingMethodWeights: profile.cookingMethodWeights,
        nutritionWeights: profile.nutritionWeights
      }),
    });
    if (!response.ok) throw new Error("更新用户画像失败");
  },

  // 记录用户反馈（喜欢/不喜欢）
  recordFeedback: async (userId: string, recipeId: string, feedbackType: 'like' | 'dislike'): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/user-feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, recipeId, feedbackType }),
    });
    if (!response.ok) throw new Error("记录反馈失败");
  },

  // 智能推荐菜谱
  getRecommendation: async (userId: string, diners: number, excludeRecipeIds: string[] = []): Promise<Recipe> => {
    const response = await fetch(`${API_BASE_URL}/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, diners, excludeRecipeIds }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "智能推荐失败");
    }
    return response.json();
  },
};

