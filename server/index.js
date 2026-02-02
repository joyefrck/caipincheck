import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";
import cron from "node-cron";
import dotenv from "dotenv";
import { getRecipeLinks, scrapeXianghaRecipe } from "./scrapers/xiangha.js";
import { parsePreferenceAdjustment, applyPreferenceAdjustments, generateConfirmationMessage } from "./preferenceParser.js";

// 加载环境变量
const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "../food-check.db");

// 加载环境变量
dotenv.config();
dotenv.config({ path: join(__dirname, "../.env.local") });

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// 初始化数据库
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Database connection error:", err.message);
  } else {
    console.log("Connected to the SQLite database.");
    initDb();
  }
});

function initDb() {
  db.serialize(() => {
    // 收藏菜谱表
    db.run(`CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      cuisine TEXT,
      diners INTEGER,
      nutritionInfo TEXT,
      tags TEXT,
      dishes TEXT,
      createdAt INTEGER
    )`);

    // 生成历史表
    db.run(`CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      cuisine TEXT,
      diners INTEGER,
      nutritionInfo TEXT,
      tags TEXT,
      dishes TEXT,
      createdAt INTEGER
    )`);

    // 基础菜谱库 (爬虫抓取)
    db.run(`CREATE TABLE IF NOT EXISTS base_recipes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source_url TEXT UNIQUE,
      ingredients TEXT,
      steps TEXT,
      tags TEXT,
      createdAt INTEGER
    )`);
  });
}

// --- 数据库初始化完成 ---

// --- AI 代理配置 ---
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || process.env.VITE_DEEPSEEK_API_KEY;

if (DEEPSEEK_API_KEY) {
    console.log("DeepSeek API Key loaded successfully.");
} else {
    console.warn("DeepSeek API Key NOT found in environment variables.");
}

// AI 代理路由
app.post('/api/ai/chat', async (req, res) => {
  if (!DEEPSEEK_API_KEY) {
    return res.status(500).json({ error: "服务器未配置 DEEPSEEK_API_KEY" });
  }

  // --- 对话式偏好调整 ---
  const userMessage = req.body.messages?.find(m => m.role === 'user')?.content || "";
  const userId = 'peter_yong'; // 当前固定用户ID
  
  try {
    const preferenceResult = await parsePreferenceAdjustment(userMessage);
    
    if (preferenceResult && preferenceResult.adjustments && preferenceResult.adjustments.length > 0) {
      console.log('🎯 检测到偏好调整:', preferenceResult.explanation);
      
      // 获取当前用户画像
      const currentProfile = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM user_profile WHERE user_id = ?', [userId], (err, row) => {
          if (err || !row) {
            reject(new Error('用户画像不存在'));
          } else {
            resolve({
              tasteWeights: JSON.parse(row.taste_weights),
              cuisineWeights: JSON.parse(row.cuisine_weights),
              ingredientWeights: JSON.parse(row.ingredient_weights),
              cookingMethodWeights: JSON.parse(row.cooking_method_weights),
              nutritionWeights: JSON.parse(row.nutrition_weights)
            });
          }
        });
      });
      
      // 应用偏好调整
      const updatedProfile = applyPreferenceAdjustments(currentProfile, preferenceResult.adjustments);
      
      // 更新数据库
      await new Promise((resolve, reject) => {
        const sql = `UPDATE user_profile 
                     SET taste_weights = ?, 
                         cuisine_weights = ?, 
                         ingredient_weights = ?,
                         cooking_method_weights = ?,
                         nutrition_weights = ?,
                         updated_at = ?
                     WHERE user_id = ?`;
        
        const params = [
          JSON.stringify(updatedProfile.tasteWeights),
          JSON.stringify(updatedProfile.cuisineWeights),
          JSON.stringify(updatedProfile.ingredientWeights),
          JSON.stringify(updatedProfile.cookingMethodWeights),
          JSON.stringify(updatedProfile.nutritionWeights),
          Date.now(),
          userId
        ];
        
        db.run(sql, params, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      // 生成确认消息
      const confirmationMsg = generateConfirmationMessage(preferenceResult);
      
      // 返回确认信息（不调用AI）
      return res.json({
        choices: [{
          message: {
            role: 'assistant',
            content: `${confirmationMsg}\n\n💡 ${preferenceResult.explanation}`
          }
        }]
      });
    }
  } catch (preferenceErr) {
    console.error('⚠️  偏好解析处理失败:', preferenceErr.message);
    // 继续执行正常的AI对话流程
  }

  // --- 基表优先匹配逻辑 ---
  // 1. 提取核心需求和人数
  const matchInput = userMessage.match(/综合需求：(.*?)(?:\n|$)/);
  let dishQuery = matchInput ? matchInput[1].trim() : "";
  const dinersMatch = userMessage.match(/就餐人数：(\d+) 人/);
  const diners = dinersMatch ? parseInt(dinersMatch[1]) : 1;
  const targetDishCount = diners >= 3 ? 3 : (diners >= 2 ? 2 : 1);

  // 1.1 提取偏好菜系 (用于推荐场景的本地匹配)
  const cuisineMatch = userMessage.match(/锁定偏好：本轮优先参考【(.*?)】/);
  const subCuisineMatch = userMessage.match(/\(特别是：(.*?)\)/);
  const preferredCuisine = cuisineMatch ? cuisineMatch[1] : '';
  const preferredSubCuisine = subCuisineMatch ? subCuisineMatch[1] : '';

  if (dishQuery && dishQuery.length > 0) {
    // 2. 关键词拆分 (空格、逗号、以及中文连接符)
    let keywords = dishQuery.split(/[\s,，和及与、]+/).filter(k => k.length >= 1);
    
    // 2.1 推荐场景优化：如果关键词是泛化的推荐语，尝试用偏好子菜系作为关键词
    const isRecommendation = dishQuery.includes("主厨今日特供") || dishQuery.includes("大厨绝活");
    if (isRecommendation && preferredSubCuisine && preferredSubCuisine !== '不限') {
      console.log(`[Proxy] Recommendation detected, using preferred subCuisine "${preferredSubCuisine}" for DB lookup`);
      keywords = [preferredSubCuisine];
    }
    
    if (keywords.length > 0) {
      // 3. 构建多关键词 SQL (组合匹配或单个匹配)
      // 我们采用更宽松的逻辑：只要匹配到其中一个核心词就考虑，但优先匹配多个词
      let sql = `SELECT * FROM base_recipes WHERE `;
      let conditions = [];
      let params = [];
      
      keywords.forEach(kw => {
        conditions.push(`(title LIKE ? OR tags LIKE ?)`);
        params.push(`%${kw}%`, `%${kw}%`);
      });
      
      sql += conditions.join(' OR ') + ` ORDER BY (CASE WHEN title LIKE ? THEN 2 ELSE 1 END) DESC LIMIT 10`;
      // 稍微偏向标题完全包含关键词的结果
      params.push(`%${dishQuery}%`);

      const rows = await new Promise((resolve) => {
        db.all(sql, params, (err, rows) => resolve(rows || []));
      });

      // 4. 多样性与一致性过滤 (进阶逻辑)
      let selectedRows = [];
      const usedKeywords = new Set();
      const lightKeywords = ['清淡', '不辣', '少盐', '淡', '原味'];
      const spicyKeywords = ['辣', '麻', '椒', '剁椒', '红油', '水煮', '回锅'];
      const isLightRequest = lightKeywords.some(k => dishQuery.includes(k));

      for (const row of rows) {
        if (selectedRows.length >= targetDishCount) break;

        // 4.1 口味过滤
        if (isLightRequest && spicyKeywords.some(sk => row.title.includes(sk))) {
          continue;
        }

        // 4.2 多样性过滤：检查该菜品是否与已选结果在“核心关键词”上重复
        // 获取这道菜匹配到的用户关键词
        const matchedKw = keywords.find(kw => row.title.includes(kw) || row.tags.includes(kw));
        
        if (matchedKw) {
          if (usedKeywords.has(matchedKw)) {
            // 如果这个关键词已经有匹配菜品了，且我们需要更多样性，则跳过
            // (除非用户提供的关键词太少，不得不重复使用，但在这种情况下我们倾向于交给 AI 搭配)
            continue;
          }
          usedKeywords.add(matchedKw);
        } else if (selectedRows.length > 0) {
          // 如果没有匹配到特定关键词（而是模糊匹配上的）且已经有了其它菜，为了安全起见跳过，除非它是第一道菜
          continue;
        }

        selectedRows.push(row);
      }

      // 5. 套餐配套率检查：如果无法凑齐用户要求的菜品数量，或者凑出来的组合过于单一，则放弃本地匹配，交给 AI
      if (selectedRows.length === targetDishCount) {
        console.log(`[Proxy] Found ${selectedRows.length} DB matches after filtering`);
        
        const dishes = selectedRows.map(match => ({
          name: match.title,
          ingredients: JSON.parse(match.ingredients),
          instructions: JSON.parse(match.steps)
        }));

        const simulatedRecipe = {
          id: crypto.randomUUID(),
          title: filteredRows.length > 1 ? `精选本地套餐：${filteredRows[0].title}等` : filteredRows[0].title,
          cuisine: "中餐 (本地库优先匹配)",
          dishes: dishes,
          nutritionInfo: `💡 已为您从本地库优先匹配了 ${filteredRows.length} 道符合口味要求的菜品。`,
          tags: Array.from(new Set(filteredRows.flatMap(r => JSON.parse(r.tags || "[]")))),
          diners: diners,
          createdAt: Date.now()
        };

        return res.json({
          choices: [
            {
              message: {
                content: JSON.stringify(simulatedRecipe)
              }
            }
          ]
        });
      }
    }
  }

  // --- 如果没匹配到，走 AI 生成 ---
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        ...req.body,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("AI Proxy Error:", err);
    res.status(500).json({ error: "AI 代理请求失败" });
  }
});

// --- API 路由 ---

// 获取收藏菜谱 (支持分页)
app.get('/api/recipes', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  db.all('SELECT * FROM recipes ORDER BY createdAt DESC LIMIT ? OFFSET ?', [limit, offset], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags),
      dishes: JSON.parse(row.dishes)
    })));
  });
});

// 保存收藏菜谱
app.post('/api/recipes', (req, res) => {
  const { id, title, cuisine, diners, nutritionInfo, tags, dishes, createdAt } = req.body;
  const sql = `INSERT INTO recipes (id, title, cuisine, diners, nutritionInfo, tags, dishes, createdAt) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [id, title, cuisine, diners, nutritionInfo, JSON.stringify(tags), JSON.stringify(dishes), createdAt];
  
  db.run(sql, params, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});

// 获取历史记录
app.get('/api/history', (req, res) => {
  db.all('SELECT * FROM history ORDER BY createdAt DESC LIMIT 100', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags),
      dishes: JSON.parse(row.dishes)
    })));
  });
});

// 保存历史记录
app.post('/api/history', (req, res) => {
  const { id, title, cuisine, diners, nutritionInfo, tags, dishes, createdAt } = req.body;
  const sql = `INSERT INTO history (id, title, cuisine, diners, nutritionInfo, tags, dishes, createdAt) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [id, title, cuisine, diners, nutritionInfo, JSON.stringify(tags), JSON.stringify(dishes), createdAt];
  
  db.run(sql, params, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id });
  });
});

// 获取基础菜谱 (用于 AI 前置检索)
app.get('/api/base-recipes', (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);

  const sql = `SELECT * FROM base_recipes WHERE title LIKE ? LIMIT 5`;
  db.all(sql, [`%${query}%`], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(row => ({
      ...row,
      ingredients: JSON.parse(row.ingredients),
      steps: JSON.parse(row.steps),
      tags: JSON.parse(row.tags)
    })));
  });
});

// --- 用户画像与推荐系统 API ---

// 获取用户画像
app.get('/api/user-profile/:userId', (req, res) => {
  const { userId } = req.params;
  db.get('SELECT * FROM user_profile WHERE user_id = ?', [userId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: '用户画像不存在' });
    
    res.json({
      userId: row.user_id,
      tasteWeights: JSON.parse(row.taste_weights),
      cuisineWeights: JSON.parse(row.cuisine_weights),
      ingredientWeights: JSON.parse(row.ingredient_weights),
      cookingMethodWeights: JSON.parse(row.cooking_method_weights),
      nutritionWeights: JSON.parse(row.nutrition_weights),
      updatedAt: row.updated_at
    });
  });
});

// 更新用户画像
app.post('/api/user-profile/:userId', (req, res) => {
  const { userId } = req.params;
  const { tasteWeights, cuisineWeights, ingredientWeights, cookingMethodWeights, nutritionWeights } = req.body;
  
  const sql = `UPDATE user_profile 
               SET taste_weights = ?, 
                   cuisine_weights = ?, 
                   ingredient_weights = ?,
                   cooking_method_weights = ?,
                   nutrition_weights = ?,
                   updated_at = ?
               WHERE user_id = ?`;
  
  const params = [
    JSON.stringify(tasteWeights),
    JSON.stringify(cuisineWeights),
    JSON.stringify(ingredientWeights),
    JSON.stringify(cookingMethodWeights),
    JSON.stringify(nutritionWeights),
    Date.now(),
    userId
  ];
  
  db.run(sql, params, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, userId });
  });
});

// 记录用户反馈
app.post('/api/user-feedback', (req, res) => {
  const { userId, recipeId, feedbackType } = req.body;
  
  if (!userId || !recipeId || !feedbackType) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  
  const feedbackId = crypto.randomUUID();
  const sql = `INSERT INTO user_feedback (id, user_id, recipe_id, feedback_type, created_at)
               VALUES (?, ?, ?, ?, ?)`;
  const params = [feedbackId, userId, recipeId, feedbackType, Date.now()];
  
  db.run(sql, params, async function(err) {
    if (err) return res.status(500).json({ error: err.message });
    
    // 反馈记录成功后，更新用户画像权重
    try {
      await updateUserWeights(userId, recipeId, feedbackType);
      res.json({ success: true, feedbackId });
    } catch (updateErr) {
      console.error('更新权重失败:', updateErr);
      res.json({ success: true, feedbackId, warning: '权重更新失败' });
    }
  });
});

// 智能推荐 API
app.post('/api/recommend', async (req, res) => {
  const { userId, diners, excludeRecipeIds = [] } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: '缺少用户 ID' });
  }
  
  try {
    // 1. 获取用户画像
    const profile = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM user_profile WHERE user_id = ?', [userId], (err, row) => {
        if (err) reject(err);
        else if (!row) reject(new Error('用户画像不存在'));
        else resolve({
          tasteWeights: JSON.parse(row.taste_weights),
          cuisineWeights: JSON.parse(row.cuisine_weights),
          ingredientWeights: JSON.parse(row.ingredient_weights),
          cookingMethodWeights: JSON.parse(row.cooking_method_weights),
          nutritionWeights: JSON.parse(row.nutrition_weights)
        });
      });
    });
    
    // 2. 获取历史记录（过去 7 天）
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentHistory = await new Promise((resolve) => {
      db.all('SELECT * FROM history WHERE created_at > ? ORDER BY created_at DESC', 
        [sevenDaysAgo], 
        (err, rows) => resolve(rows || [])
      );
    });
    
    const recentRecipeIds = recentHistory.map(r => r.id);
    const allExcludeIds = [...new Set([...excludeRecipeIds, ...recentRecipeIds])];
    
    // 3. 从 base_recipes 中查询候选菜谱
    const targetDishCount = diners >= 3 ? 3 : (diners >= 2 ? 2 : 1);
    const candidates = await new Promise((resolve) => {
      let sql = 'SELECT * FROM base_recipes';
      let params = [];
      
      if (allExcludeIds.length > 0) {
        const placeholders = allExcludeIds.map(() => '?').join(',');
        sql += ` WHERE id NOT IN (${placeholders})`;
        params = allExcludeIds;
      }
      
      db.all(sql, params, (err, rows) => resolve(rows || []));
    });
    
    if (candidates.length === 0) {
      return res.status(404).json({ error: '候选菜谱池为空，请添加更多基础菜谱' });
    }
    
    // 4. 多维度加权评分
    const scoredCandidates = candidates.map(recipe => {
      let score = 0;
      let scoreDetails = {};
      
      // 菜系匹配度
      if (recipe.cuisine_type && profile.cuisineWeights[recipe.cuisine_type]) {
        const cuisineScore = profile.cuisineWeights[recipe.cuisine_type];
        score += cuisineScore * 2;  // 菜系权重 × 2
        scoreDetails.cuisine = cuisineScore;
      }
      
      // 口味匹配度
      const tasteTags = recipe.taste_tags ? JSON.parse(recipe.taste_tags) : [];
      tasteTags.forEach(taste => {
        if (profile.tasteWeights[taste]) {
          score += profile.tasteWeights[taste] * 1.5;
          scoreDetails.taste = (scoreDetails.taste || 0) + profile.tasteWeights[taste];
        }
      });
      
      // 烹饪方法匹配度
      const cookingMethods = recipe.cooking_methods ? JSON.parse(recipe.cooking_methods) : [];
      cookingMethods.forEach(method => {
        if (profile.cookingMethodWeights[method]) {
          score += profile.cookingMethodWeights[method] * 1.2;
          scoreDetails.cookingMethod = (scoreDetails.cookingMethod || 0) + profile.cookingMethodWeights[method];
        }
      });
      
      // 营养标签匹配度
      const nutritionTags = recipe.nutrition_tags ? JSON.parse(recipe.nutrition_tags) : [];
      nutritionTags.forEach(nutrition => {
        if (profile.nutritionWeights[nutrition]) {
          score += profile.nutritionWeights[nutrition] * 1;
          scoreDetails.nutrition = (scoreDetails.nutrition || 0) + profile.nutritionWeights[nutrition];
        }
      });
      
      // 食材匹配度（动态权重）
      const ingredients = recipe.ingredients ? JSON.parse(recipe.ingredients) : [];
      ingredients.forEach(ing => {
        const ingName = typeof ing === 'object' ? ing.name : ing;
        if (profile.ingredientWeights[ingName]) {
          score += profile.ingredientWeights[ingName] * 1;
          scoreDetails.ingredient = (scoreDetails.ingredient || 0) + profile.ingredientWeights[ingName];
        }
      });
      
      return { recipe, score, scoreDetails };
    });
    
    // 5. 按评分排序并选择前 N 个
    scoredCandidates.sort((a, b) => b.score - a.score);
    
    // 6. 多样性约束选择
    const selectedRecipes = [];
    const usedIngredients = new Set();
    const usedCookingMethods = new Set();
    const usedCuisines = new Set();
    
    for (const candidate of scoredCandidates) {
      if (selectedRecipes.length >= targetDishCount) break;
      
      const { recipe } = candidate;
      
      // 检查食材多样性
      const ingredients = recipe.ingredients ? JSON.parse(recipe.ingredients) : [];
      const mainIngredients = ingredients.slice(0, 2).map(ing => 
        typeof ing === 'object' ? ing.name : ing
      );
      
      const hasIngredientConflict = mainIngredients.some(ing => usedIngredients.has(ing));
      
      // 检查烹饪方法多样性
      const cookingMethods = recipe.cooking_methods ? JSON.parse(recipe.cooking_methods) : [];
      const hasCookingMethodConflict = cookingMethods.length > 0 && 
        cookingMethods.every(method => usedCookingMethods.has(method));
      
      // 检查菜系多样性（如果已有 2 道同菜系，跳过）
      const cuisineCount = Array.from(usedCuisines).filter(c => c === recipe.cuisine_type).length;
      const hasCuisineConflict = cuisineCount >= 2;
      
      // 如果没有冲突，选择该菜谱
      if (!hasIngredientConflict && !hasCookingMethodConflict && !hasCuisineConflict) {
        selectedRecipes.push(recipe);
        mainIngredients.forEach(ing => usedIngredients.add(ing));
        cookingMethods.forEach(method => usedCookingMethods.add(method));
        if (recipe.cuisine_type) usedCuisines.add(recipe.cuisine_type);
      }
    }
    
    // 7. 异常处理：候选池不足时放宽限制
    if (selectedRecipes.length < targetDishCount) {
      console.log(`⚠️  多样性约束后候选不足 (${selectedRecipes.length}/${targetDishCount})，放宽限制`);
      
      // 放宽限制：只要评分高就选
      for (const candidate of scoredCandidates) {
        if (selectedRecipes.length >= targetDishCount) break;
        if (!selectedRecipes.find(r => r.id === candidate.recipe.id)) {
          selectedRecipes.push(candidate.recipe);
        }
      }
    }
    
    // 8. 转换为前端 Recipe 格式
    const recommendedDishes = selectedRecipes.map(recipe => ({
      name: recipe.title,
      ingredients: JSON.parse(recipe.ingredients),
      instructions: JSON.parse(recipe.steps).map((step, idx) => ({
        step: idx + 1,
        description: step
      }))
    }));
    
    const recommendedRecipe = {
      id: crypto.randomUUID(),
      title: selectedRecipes.length > 1 
        ? `蔡大厨精选套餐·${selectedRecipes[0].title}等${selectedRecipes.length}道`
        : selectedRecipes[0].title,
      cuisine: selectedRecipes[0].cuisine_type || '综合菜系',
      dishes: recommendedDishes,
      nutritionInfo: `💡 根据您的偏好智能推荐 ${selectedRecipes.length} 道菜，已确保食材多样、烹饪方式均衡、营养互补`,
      tags: Array.from(new Set(selectedRecipes.flatMap(r => JSON.parse(r.tags || '[]')))),
      diners: diners,
      createdAt: Date.now()
    };
    
    res.json(recommendedRecipe);
    
  } catch (err) {
    console.error('推荐失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 权重更新辅助函数
async function updateUserWeights(userId, recipeId, feedbackType) {
  // 1. 获取当前用户画像
  const profile = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM user_profile WHERE user_id = ?', [userId], (err, row) => {
      if (err) reject(err);
      else resolve({
        taste_weights: JSON.parse(row.taste_weights),
        cuisine_weights: JSON.parse(row.cuisine_weights),
        ingredient_weights: JSON.parse(row.ingredient_weights),
        cooking_method_weights: JSON.parse(row.cooking_method_weights),
        nutrition_weights: JSON.parse(row.nutrition_weights)
      });
    });
  });
  
  // 2. 获取菜谱信息（尝试从 base_recipes、recipes、history 中查找）
  let recipe = await new Promise((resolve) => {
    db.get('SELECT * FROM base_recipes WHERE id = ?', [recipeId], (err, row) => {
      if (row) return resolve(row);
      db.get('SELECT * FROM recipes WHERE id = ?', [recipeId], (err, row) => {
        if (row) return resolve(row);
        db.get('SELECT * FROM history WHERE id = ?', [recipeId], (err, row) => {
          resolve(row || null);
        });
      });
    });
  });
  
  if (!recipe) {
    console.log(`⚠️  未找到菜谱 ${recipeId}，跳过权重更新`);
    return;
  }
  
  // 3. 根据反馈类型调整权重
  const delta = feedbackType === 'like' ? 0.1 : -0.05;
  const minWeight = 0.1;
  const maxWeight = 1.0;
  
  // 调整菜系权重
  if (recipe.cuisine_type || recipe.cuisine) {
    const cuisine = recipe.cuisine_type || recipe.cuisine;
    if (profile.cuisine_weights[cuisine] !== undefined) {
      profile.cuisine_weights[cuisine] = Math.max(
        minWeight,
        Math.min(maxWeight, profile.cuisine_weights[cuisine] + delta)
      );
    } else {
      // 新菜系，添加到权重表
      profile.cuisine_weights[cuisine] = 0.5 + delta;
    }
  }
  
  // 调整口味权重
  const tasteTags = recipe.taste_tags ? JSON.parse(recipe.taste_tags) : [];
  tasteTags.forEach(taste => {
    if (profile.taste_weights[taste] !== undefined) {
      profile.taste_weights[taste] = Math.max(
        minWeight,
        Math.min(maxWeight, profile.taste_weights[taste] + delta)
      );
    } else {
      profile.taste_weights[taste] = 0.5 + delta;
    }
  });
  
  // 调整烹饪方法权重
  const cookingMethods = recipe.cooking_methods ? JSON.parse(recipe.cooking_methods) : [];
  cookingMethods.forEach(method => {
    if (profile.cooking_method_weights[method] !== undefined) {
      profile.cooking_method_weights[method] = Math.max(
        minWeight,
        Math.min(maxWeight, profile.cooking_method_weights[method] + delta)
      );
    } else {
      profile.cooking_method_weights[method] = 0.5 + delta;
    }
  });
  
  // 调整营养权重
  const nutritionTags = recipe.nutrition_tags ? JSON.parse(recipe.nutrition_tags) : [];
  nutritionTags.forEach(nutrition => {
    if (profile.nutrition_weights[nutrition] !== undefined) {
      profile.nutrition_weights[nutrition] = Math.max(
        minWeight,
        Math.min(maxWeight, profile.nutrition_weights[nutrition] + delta)
      );
    } else {
      profile.nutrition_weights[nutrition] = 0.5 + delta;
    }
  });
  
  // 调整食材权重（仅对主食材，即前 3 个）
  const ingredients = recipe.ingredients ? JSON.parse(recipe.ingredients) : [];
  ingredients.slice(0, 3).forEach(ing => {
    const ingName = typeof ing === 'object' ? ing.name : ing;
    if (profile.ingredient_weights[ingName] !== undefined) {
      profile.ingredient_weights[ingName] = Math.max(
        minWeight,
        Math.min(maxWeight, profile.ingredient_weights[ingName] + delta)
      );
    } else {
      profile.ingredient_weights[ingName] = 0.5 + delta;
    }
  });
  
  // 4. 更新数据库
  const sql = `UPDATE user_profile 
               SET taste_weights = ?, 
                   cuisine_weights = ?, 
                   ingredient_weights = ?,
                   cooking_method_weights = ?,
                   nutrition_weights = ?,
                   updated_at = ?
               WHERE user_id = ?`;
  
  const params = [
    JSON.stringify(profile.taste_weights),
    JSON.stringify(profile.cuisine_weights),
    JSON.stringify(profile.ingredient_weights),
    JSON.stringify(profile.cooking_method_weights),
    JSON.stringify(profile.nutrition_weights),
    Date.now(),
    userId
  ];
  
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) reject(err);
      else {
        console.log(`✅ 用户 ${userId} 的权重已更新 (${feedbackType})`);
        resolve();
      }
    });
  });
}

// --- 爬虫控制与定时任务 ---


async function runScraper(limit = 10) {
    console.log(`Starting multi-category scraper task (target: ${limit} new recipes)...`);
    
    // 多品类与菜系入口
    const targets = [
        { name: "热菜", url: "https://www.xiangha.com/caipu/z-recai/" },
        { name: "凉菜", url: "https://www.xiangha.com/caipu/z-liangcai/" },
        { name: "汤羹", url: "https://www.xiangha.com/caipu/z-tanggeng/" },
        { name: "面食", url: "https://www.xiangha.com/caipu/z-mianshi/" },
        { name: "素菜", url: "https://www.xiangha.com/caipu/z-sucai/" },
        { name: "荤菜", url: "https://www.xiangha.com/caipu/z-huncai/" },
        { name: "海鲜", url: "https://www.xiangha.com/caipu/z-haixian/" },
        // 八大菜系
        { name: "川菜", url: "https://www.xiangha.com/caipu/x-chuancai/" },
        { name: "湘菜", url: "https://www.xiangha.com/caipu/x-xiangcai/" },
        { name: "粤菜", url: "https://www.xiangha.com/caipu/x-yuecai/" },
        { name: "鲁菜", url: "https://www.xiangha.com/caipu/x-lucai/" },
        { name: "苏菜", url: "https://www.xiangha.com/caipu/x-sucai/" },
        { name: "浙菜", url: "https://www.xiangha.com/caipu/x-zhecai/" },
        { name: "闽菜", url: "https://www.xiangha.com/caipu/x-mincai/" },
        { name: "徽菜", url: "https://www.xiangha.com/caipu/x-huicai/" }
    ];
    
    let addedCount = 0;
    let page = 1;
    const maxPages = 50; 

    while (addedCount < limit && page <= maxPages) {
        for (const target of targets) {
            if (addedCount >= limit) break;
            
            console.log(`Fetching ${target.name} page ${page}...`);
            const links = await getRecipeLinks(target.url, page);
            
            if (!links || links.length === 0) continue;

            for (const link of links) {
                if (addedCount >= limit) break;

                try {
                    const exists = await new Promise((resolve) => {
                        db.get(`SELECT 1 FROM base_recipes WHERE source_url = ?`, [link], (err, row) => resolve(!!row));
                    });

                    if (exists) continue;

                    // 间隔保护
                    await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 400));

                    const recipe = await scrapeXianghaRecipe(link);
                    if (recipe) {
                        // 注入菜系/品类标签
                        let tags = JSON.parse(recipe.tags);
                        if (!tags.includes(target.name)) tags.push(target.name);
                        recipe.tags = JSON.stringify(tags);

                        const sql = `INSERT OR IGNORE INTO base_recipes (id, title, source_url, ingredients, steps, tags, createdAt) 
                                     VALUES (?, ?, ?, ?, ?, ?, ?)`;
                        const params = [recipe.id, recipe.title, recipe.source_url, recipe.ingredients, recipe.steps, recipe.tags, recipe.createdAt];
                        
                        await new Promise((resolve, reject) => {
                            db.run(sql, params, (err) => err ? reject(err) : resolve());
                        });
                        
                        addedCount++;
                        if (addedCount % 10 === 0) {
                            console.log(`Progress: Added ${addedCount}/${limit} new recipes across categories.`);
                        }
                    }
                } catch (err) {
                    console.error(`Scraper error for ${link}:`, err.message);
                }
            }
        }
        page++;
    }
    console.log(`Multi-category scraper finished. Total added: ${addedCount}`);
}

// 每天凌晨 2 点运行
cron.schedule('0 2 * * *', () => {
    runScraper(500);
});

// 手动触发爬虫 (管理员接口)
app.post('/api/admin/scrape', async (req, res) => {
    const limit = req.body.limit || 10;
    runScraper(limit);
    res.json({ message: "Scraper started in background", limit });
});

// --- 静态资源托管 (仅用于生产环境) ---
const distPath = join(__dirname, "../dist");
app.use(express.static(distPath));

// 针对单页应用 (SPA) 的路由 (作为最后的中间件)
app.use((req, res) => {
  if (!req.path.startsWith('/api')) {
    const indexPath = join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send("API Endpoint not found. (Frontend build is missing, please run 'npm run build' or use dev server)");
    }
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running at http://0.0.0.0:${port}`);
});
