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

  // 保存AI生成的菜谱到base_recipes（用于后续推荐）
  saveToBaseRecipes: async (recipe: Recipe): Promise<{savedCount: number, totalDishes: number, errors?: any[]}> => {
    const response = await fetch(`${API_BASE_URL}/base-recipes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dishes: recipe.dishes }),
    });
    if (!response.ok) throw new Error("保存到基础菜谱库失败");
    return response.json();
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

  // 保存家庭成员
  saveFamilyMembers: async (userId: string, familyMembers: any[]): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/user-profile/${userId}/family`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ familyMembers }),
    });
    if (!response.ok) throw new Error("保存家庭成员失败");
  },

  // 记录用户反馈（喜欢/不喜欢）
  recordFeedback: async (userId: string, recipeId: string, feedbackType: 'like' | 'dislike', recipeData?: Recipe): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/user-feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, recipeId, feedbackType, recipeData }),
    });
    if (!response.ok) throw new Error("记录反馈失败");
  },

  // 智能推荐菜谱
  getRecommendation: async (
    userId: string,
    diners: number,
    excludeRecipeIds: string[] = [],
    excludeDishNames: string[] = [],
    keyword: string = '',  // 新增：搜索关键词
    randomMode: boolean = false  // 🆕 随机推荐模式
  ): Promise<Recipe> => {
    const response = await fetch(`${API_BASE_URL}/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        diners,
        excludeRecipeIds,
        excludeDishNames,
        keyword,  // 新增
        randomMode  // 🆕
      }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "推荐失败");
    }
    return response.json();
  },
};
