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
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// 辅助函数：生成丰富的营养信息说明
function generateNutritionInfo(selectedRecipes, diners) {
  const dishNames = selectedRecipes.map(r => r.title);
  
  // 分析菜系
  const cuisines = selectedRecipes.map(r => r.cuisine_type || '').filter(c => c);
  const uniqueCuisines = [...new Set(cuisines.map(c => c.split('(')[0].trim().replace('中餐', '').trim()))].filter(c => c);
  
  // 分析烹饪方法
  const allCookingMethods = selectedRecipes.flatMap(r => 
    r.cooking_methods ? JSON.parse(r.cooking_methods) : []
  );
  const uniqueMethods = [...new Set(allCookingMethods)];
  
  // 分析口味标签
  const allTasteTags = selectedRecipes.flatMap(r => 
    r.taste_tags ? JSON.parse(r.taste_tags) : []
  );
  const uniqueTastes = [...new Set(allTasteTags)];
  
  // 分析营养标签
  const allNutritionTags = selectedRecipes.flatMap(r => 
    r.nutrition_tags ? JSON.parse(r.nutrition_tags) : []
  );
  const uniqueNutrition = [...new Set(allNutritionTags)];
  
  // 分析食材种类
  const allIngredients = selectedRecipes.flatMap(r => {
    const ings = r.ingredients ? JSON.parse(r.ingredients) : [];
    return ings.slice(0, 3).map(ing => typeof ing === 'object' ? ing.name : ing);
  });
  const uniqueIngredients = [...new Set(allIngredients)];
  
  // 检查是否有汤
  const hasSoup = selectedRecipes.some(r => 
    (r.title + (r.tags || '')).toLowerCase().match(/汤|羹|粥/)
  );
  
  // 检查荤素搭配
  const meatRegex = /肉|鸡|鸭|鱼|虾|牛|羊|猪|腿|翅|排骨|肚|肠|肺/;
  const hasMeat = selectedRecipes.some(r => meatRegex.test(r.title) && !(r.tags && r.tags.includes('素菜')));
  const hasVeggie = selectedRecipes.some(r => r.tags && (r.tags.includes('素菜') || r.title.match(/豆腐|青菜|白菜|菠菜|芹菜|茄子|土豆/)));
  
  // 构建营养信息说明（分段落）
  let parts = [];
  
  // 第一部分：搭配逻辑
  if (selectedRecipes.length > 1) {
    let pairingLogic = `🎯 **搭配逻辑**：`;
    
    if (hasMeat && hasVeggie) {
      pairingLogic += `荤素均衡，营养全面`;
    } else if (hasMeat) {
      pairingLogic += `以荤菜为主，富含蛋白质`;
    } else {
      pairingLogic += `清爽素食，健康低脂`;
    }
    
    if (hasSoup) {
      pairingLogic += `，配有汤羹滋润养胃`;
    }
    
    if (uniqueMethods.length > 1) {
      pairingLogic += `。烹饪方式多样（${uniqueMethods.slice(0, 3).join('、')}），口感层次丰富`;
    }
    
    parts.push(pairingLogic);
  }
  
  // 第二部分：营养价值
  let nutritionValue = `💊 **营养价值**：`;
  
  if (uniqueNutrition.length > 0) {
    nutritionValue += uniqueNutrition.slice(0, 4).join('、');
  } else {
    // 如果没有营养标签，根据食材推测
    const nutritionBenefits = [];
    if (uniqueIngredients.some(i => i.match(/鱼|虾|鸡|肉/))) nutritionBenefits.push('富含优质蛋白');
    if (uniqueIngredients.some(i => i.match(/豆腐|豆|菌|菇/))) nutritionBenefits.push('植物蛋白丰富');
    if (uniqueIngredients.some(i => i.match(/青菜|白菜|芹菜|菠菜|萝卜|西兰花/))) nutritionBenefits.push('膳食纤维充足');
    if (uniqueIngredients.some(i => i.match(/西红柿|胡萝卜|南瓜|红薯/))) nutritionBenefits.push('维生素丰富');
    
    nutritionValue += nutritionBenefits.length > 0 
      ? nutritionBenefits.slice(0, 3).join('、') 
      : '营养均衡，适合日常食用';
  }
  
  parts.push(nutritionValue);
  
  // 第三部分：口味特色
  if (uniqueTastes.length > 0) {
    parts.push(`👅 **口味特色**：${uniqueTastes.slice(0, 3).join('、')}风味`);
  }
  
  // 第四部分：适合人群
  let suitableFor = `👨‍👩‍👧‍👦 **适合**：`;
  if (diners >= 4) {
    suitableFor += `${diners}人家庭聚餐，分量充足`;
  } else if (diners >= 2) {
    suitableFor += `${diners}人用餐，量足且不浪费`;
  } else {
    suitableFor += `单人享用，简单便捷`;
  }
  parts.push(suitableFor);
  
  return parts.join('\n\n');
}


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

    // base_recipes 表，用于本地菜谱库推荐
    db.run(`CREATE TABLE IF NOT EXISTS base_recipes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source_url TEXT UNIQUE,
      ingredients TEXT,
      steps TEXT,
      tags TEXT,
      cuisine_type TEXT,
      cooking_methods TEXT,
      taste_tags TEXT,
      nutrition_tags TEXT,
      source TEXT DEFAULT 'scraped',
      createdAt INTEGER
    )`);
    
    // 如果表已存在，添加新列（兼容旧数据库）
    db.run(`ALTER TABLE base_recipes ADD COLUMN cuisine_type TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column')) console.error('添加cuisine_type列失败:', err);
    });
    db.run(`ALTER TABLE base_recipes ADD COLUMN cooking_methods TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column')) console.error('添加cooking_methods列失败:', err);
    });
    db.run(`ALTER TABLE base_recipes ADD COLUMN taste_tags TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column')) console.error('添加taste_tags列失败:', err);
    });
    db.run(`ALTER TABLE base_recipes ADD COLUMN nutrition_tags TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column')) console.error('添加nutrition_tags列失败:', err);
    });
    db.run(`ALTER TABLE base_recipes ADD COLUMN source TEXT DEFAULT 'scraped'`, (err) => {
      if (err && !err.message.includes('duplicate column')) console.error('添加source列失败:', err);
    });

    // 兼容已有数据库：向 user_profile 添加 family_members
    db.run(`ALTER TABLE user_profile ADD COLUMN family_members TEXT DEFAULT '[]'`, (err) => {
      if (err && !err.message.includes('duplicate column')) console.error('添加family_members列失败:', err);
    });
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

// 辅助函数：使用AI提取菜品标签
async function extractRecipeTags(dishName, ingredients) {
  const ingredientNames = ingredients.map(i => (typeof i === 'object' ? i.name : i)).join('、');
  const prompt = `分析菜品"${dishName}"（食材：${ingredientNames}），以JSON格式返回：
{
  "cuisine_type": "菜系（如：川菜、粤菜、湘菜、家常菜等）",
  "cooking_methods": ["烹饪方法数组（如：炒、蒸、煮、炖、烤、炸等）"],
  "taste_tags": ["口味标签数组（如：辣、咸、鲜、甜、酸、麻等）"],
  "nutrition_tags": ["营养标签数组（如：高蛋白、低脂、富含维生素、补钙等）"]
}

只返回JSON，不要其他内容。`;

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是一个专业的美食分析师，擅长分析菜品属性。' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`AI API调用失败: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content);
  } catch (err) {
    console.error('标签提取失败:', err.message);
    // 返回默认值
    return {
      cuisine_type: '中餐',
      cooking_methods: [],
      taste_tags: [],
      nutrition_tags: []
    };
  }
}


// AI 代理路由
app.post('/api/ai/chat', async (req, res) => {
  if (!DEEPSEEK_API_KEY) {
    return res.status(500).json({ error: "服务器未配置 DEEPSEEK_API_KEY" });
  }

  // --- 对话式偏好调整 ---
  let userMessage = req.body.messages?.find(m => m.role === 'user')?.content || "";
  const userId = 'peter_yong'; // 当前固定用户ID
  let preferenceInfo = "";
  
  // 提前提取就餐人数，用于可能的推荐转换
  const dinersMatch = userMessage.match(/就餐人数：(\d+) 人/);
  const diners = dinersMatch ? parseInt(dinersMatch[1]) : 1;

  try {
    // 🚀 性能优化：快速预检
    // 1. 提取核心需求，只对用户输入的内容进行检测，避开 Prompt 模板中的干扰词
    const matchInputPre = userMessage.match(/综合需求：(.*?)(?:\s*\(|\n|$)/);
    const dishQueryPre = matchInputPre ? matchInputPre[1].trim() : "";

    // 2. 如果没有偏好关键词（如喜欢、不喜欢、更），且用户明确输入了菜名，直接跳过 AI 解析
    const preferenceKeywords = ['喜欢', '不喜欢', '偏好', '更', '少', '多', '不要', '想吃', '不想', '爱吃', '不爱', '口味', '菜系', '清淡', '重口', '辣', '不辣'];
    
    // 只要针对"用户输入部分"进行检测，而不是检测整个 Prompt
    const hasPreferenceHint = preferenceKeywords.some(kw => dishQueryPre.includes(kw));

    let preferenceResult = null;
    if (hasPreferenceHint) {
       preferenceResult = await parsePreferenceAdjustment(userMessage);
    }
    
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
      preferenceInfo = generateConfirmationMessage(preferenceResult);
      console.log(`✅ 偏好已更新: ${preferenceInfo}`);

      // 关键逻辑：如果用户是在表达偏好，我们将搜索关键词改为他们刚刚提到的内容，以确保推荐符合新偏好
      const adjKeywords = preferenceResult.adjustments
        .filter(a => a.action === 'increase')
        .map(a => a.target);
      
      if (adjKeywords.length > 0) {
        // 构造一个新的需求描述，让后续的本地搜索或 AI 能精准匹配
        const newQuery = adjKeywords.join(' ');
        userMessage = `综合需求：${newQuery}\n就餐人数：${diners} 人\n(偏好更新提示：${preferenceInfo})`;
        // 同时更新请求体，确保 AI 也能看到优化后的关键词
        const userMsgIndex = req.body.messages?.findIndex(m => m.role === 'user');
        if (userMsgIndex !== -1) {
          req.body.messages[userMsgIndex].content = userMessage;
        }
        console.log(`📝 需求已重定向为: ${newQuery}`);
      }
    }
  } catch (preferenceErr) {
    console.error('⚠️  偏好解析处理失败:', preferenceErr.message);
    // 继续执行正常的AI对话流程
  }

  // --- 基表优先匹配逻辑 ---
  // 1. 提取核心需求和人数 (停止在换行或括号，避免抓取 Prompt 里的说明)
  const matchInput = userMessage.match(/综合需求：(.*?)(?:\s*\(|\n|$)/);
  let dishQuery = matchInput ? matchInput[1].trim() : "";
  // 人数已在上方提前提取
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
      
      sql += conditions.join(' OR ') + ` ORDER BY (CASE WHEN title LIKE ? THEN 3 WHEN title LIKE ? THEN 2 ELSE 1 END) DESC LIMIT 10`;
      // 优先：包含完整关键词
      params.push(`%${dishQuery}%`);
      // 其次：包含部分关键词
      params.push(`%${keywords[0]}%`);

      const rows = await new Promise((resolve) => {
        db.all(sql, params, (err, rows) => resolve(rows || []));
      });

      // 4. 多样性与一致性过滤 (进阶逻辑)
      let selectedRows = [];
      const usedKeywords = new Set();
      const lightKeywords = ['清淡', '不辣', '少盐', '淡', '原味'];
      const spicyKeywords = ['辣', '麻', '椒', '剁椒', '红油', '水煮', '回锅'];
      const isLightRequest = lightKeywords.some(k => dishQuery.includes(k));

      const meatRegex = /肉|鸡|鸭|鱼|虾|牛|羊|猪|腿|翅|排骨|肚|肠|肺|虎皮|回锅|煲/;
      
      for (const row of rows) {
        if (selectedRows.length >= targetDishCount) break;

        // 4.1 口味过滤
        if (isLightRequest && spicyKeywords.some(sk => row.title.includes(sk))) {
          continue;
        }

        // 4.2 荤素平衡过滤 (进阶：如果已经选了一道肉菜，且目标是两道菜，尝试跳过其它肉菜，除非它是强匹配)
        const isCurrentMeat = meatRegex.test(row.title) && !row.tags.includes('素菜');
        const hasMeatAlready = selectedRows.some(r => meatRegex.test(r.title) && !r.tags.includes('素菜'));
        
        // 如果已经有肉了，当前又是肉，且不是针对不同关键词的匹配（比如搜“牛肉和鸡肉”），则跳过
        if (hasMeatAlready && isCurrentMeat && keywords.length <= 1 && targetDishCount > 1) {
          continue; 
        }

        // 4.3 多样性过滤：检查该菜品是否与已选结果在“核心关键词”上重复
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

      // 5. 套餐配套率检查：只要有从本地库匹配到结果
      if (selectedRows.length > 0) {
        // 如果匹配到的菜不够（且用户需要更多），尝试从库里随机补几个不重复的作为搭配
        if (selectedRows.length < targetDishCount) {
          const needed = targetDishCount - selectedRows.length;
          const existingIds = new Set(selectedRows.map(r => r.id));
          const hasMeat = selectedRows.some(r => meatRegex.test(r.title) && !r.tags.includes('素菜'));

          await new Promise((resolve) => {
            // 策略：如果已经有肉，优先补素菜或汤；如果没有肉，随机补
            let fillSql = `SELECT * FROM base_recipes WHERE id NOT IN (${Array.from(existingIds).map(() => '?').join(',')})`;
            if (hasMeat) {
              // 优先查找带有“素菜”或“汤羹”标签的
              fillSql += ` AND (tags LIKE '%素菜%' OR tags LIKE '%汤羹%' OR title LIKE '%汤%')`;
            }
            fillSql += ` ORDER BY RANDOM() LIMIT ?`;
            
            db.all(fillSql, [...Array.from(existingIds), needed], (err, randomRows) => {
              if (!err && randomRows && randomRows.length > 0) {
                randomRows.forEach(r => {
                  if (selectedRows.length < targetDishCount) selectedRows.push(r);
                });
              }
              
              // 如果还是不够（可能素菜库里没搜到），再无限制随机补一次
              if (selectedRows.length < targetDishCount) {
                const finalNeeded = targetDishCount - selectedRows.length;
                const finalIds = new Set(selectedRows.map(r => r.id));
                db.all(`SELECT * FROM base_recipes WHERE id NOT IN (${Array.from(finalIds).map(() => '?').join(',')}) ORDER BY RANDOM() LIMIT ?`, 
                  [...Array.from(finalIds), finalNeeded], 
                  (err, lastRows) => {
                    if (!err && lastRows) lastRows.forEach(r => selectedRows.push(r));
                    resolve();
                  });
              } else {
                resolve();
              }
            });
          });
        }

        console.log(`[Proxy] Finalized ${selectedRows.length} DB matches (including complementary dishes)`);
        
        const dishes = selectedRows.map(match => ({
          name: match.title,
          ingredients: JSON.parse(match.ingredients),
          instructions: JSON.parse(match.steps)
        }));

        const simulatedRecipe = {
          id: crypto.randomUUID(),
          title: selectedRows.length > 1 ? `精选本地套餐：${selectedRows[0].title}等` : selectedRows[0].title,
          cuisine: selectedRows.length > 1 && selectedRows[0].cuisine_type 
            ? selectedRows[0].cuisine_type 
            : "中餐 (本地库优先匹配)",
          dishes: dishes,
          nutritionInfo: preferenceInfo 
            ? `✅ ${preferenceInfo}\n\n${generateNutritionInfo(selectedRows, diners)}`
            : generateNutritionInfo(selectedRows, diners),
          tags: Array.from(new Set(selectedRows.flatMap(r => JSON.parse(r.tags || "[]")))),
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
    
    // 如果有偏好更新确认语，尝试注入到 AI 生成的 JSON 内容中
    if (preferenceInfo && data.choices?.[0]?.message?.content) {
      try {
        let content = data.choices[0].message.content;
        // 尝试解析 JSON (AI 可能返回带 Markdown 的 JSON)
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const recipe = JSON.parse(jsonMatch[0]);
          recipe.nutritionInfo = `✅ ${preferenceInfo}\n\n${recipe.nutritionInfo || ""}`;
          // 如果原本是带 Markdown 的，保留外壳
          if (content.includes("```")) {
            data.choices[0].message.content = content.replace(jsonMatch[0], JSON.stringify(recipe, null, 2));
          } else {
            data.choices[0].message.content = JSON.stringify(recipe);
          }
        }
      } catch (e) {
        console.error("无法将确认语注入 AI 响应内容:", e);
      }
    }

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

// 保存AI生成的菜谱到base_recipes（用于后续推荐）
app.post('/api/base-recipes', async (req, res) => {
  try {
    const { dishes } = req.body;
    
    if (!dishes || !Array.isArray(dishes)) {
      return res.status(400).json({ error: '缺少dishes数组' });
    }

    let savedCount = 0;
    const errors = [];

    for (const dish of dishes) {
      try {
        // 1. 使用AI提取标签
        console.log(`[Base Recipes] 正在为"${dish.name}"提取标签...`);
        const tags = await extractRecipeTags(dish.name, dish.ingredients);
        
        // 2. 准备插入数据
        const id = crypto.randomUUID();
        const sql = `INSERT OR IGNORE INTO base_recipes 
          (id, title, ingredients, steps, tags, cuisine_type, cooking_methods, taste_tags, nutrition_tags, source, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'user_generated', ?)`;

        const params = [
          id,
          dish.name,
          JSON.stringify(dish.ingredients),
          JSON.stringify(dish.instructions),
          JSON.stringify([]),  // 通用tags留空
          tags.cuisine_type,
          JSON.stringify(tags.cooking_methods),
          JSON.stringify(tags.taste_tags),
          JSON.stringify(tags.nutrition_tags),
          Date.now()
        ];

        await new Promise((resolve, reject) => {
          db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this.changes);
          });
        });

        console.log(`[Base Recipes] ✅ "${dish.name}" 保存成功 (${tags.cuisine_type})`);
        savedCount++;
      } catch (err) {
        console.error(`[Base Recipes] ❌ 保存"${dish.name}"失败:`, err.message);
        errors.push({ dish: dish.name, error: err.message });
      }
    }

    res.json({ 
      success: true, 
      savedCount, 
      totalDishes: dishes.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('[Base Recipes] 保存失败:', err);
    res.status(500).json({ error: err.message });
  }
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
      familyMembers: row.family_members ? JSON.parse(row.family_members) : [],
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

// 保存用户家庭成员
app.post('/api/user-profile/:userId/family', (req, res) => {
  const { userId } = req.params;
  const { familyMembers } = req.body;
  
  if (!Array.isArray(familyMembers)) {
    return res.status(400).json({ error: 'familyMembers 需要是一个数组' });
  }

  const sql = `UPDATE user_profile SET family_members = ?, updated_at = ? WHERE user_id = ?`;
  db.run(sql, [JSON.stringify(familyMembers), Date.now(), userId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, changes: this.changes });
  });
});

// 记录用户反馈
app.post('/api/user-feedback', (req, res) => {
  const { userId, recipeId, feedbackType, recipeData } = req.body;
  
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
      await updateUserWeights(userId, recipeId, feedbackType, recipeData);
      res.json({ success: true, feedbackId });
    } catch (updateErr) {
      console.error('更新权重失败:', updateErr);
      res.json({ success: true, feedbackId, warning: '权重更新失败' });
    }
  });
});

// 智能推荐 API
app.post('/api/recommend', async (req, res) => {
  const { 
    userId, 
    diners, 
    excludeRecipeIds = [],
    excludeDishNames = [],  // 排除的菜名列表
    keyword = '',  // 新增：搜索关键词
    randomMode = false  // 🆕 随机推荐模式（蔡大厨推荐）
  } = req.body;
  
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
    
    // 3. 从 base_recipes 中查询候选菜谱（排除指定ID和菜名）
    const targetDishCount = diners >= 3 ? 3 : (diners >= 2 ? 2 : 1);
    const candidates = await new Promise((resolve) => {
      let sql = 'SELECT * FROM base_recipes';
      let conditions = [];
      let params = [];
      
      // 排除ID
      if (allExcludeIds.length > 0) {
        const placeholders = allExcludeIds.map(() => '?').join(',');
        conditions.push(`id NOT IN (${placeholders})`);
        params.push(...allExcludeIds);
      }
      
      // 排除菜名（新增）
      if (excludeDishNames.length > 0) {
        const placeholders = excludeDishNames.map(() => '?').join(',');
        conditions.push(`title NOT IN (${placeholders})`);
        params.push(...excludeDishNames);
      }
      
      // 新增：关键词搜索
      if (keyword) {
        conditions.push(`(
          title LIKE ? OR 
          ingredients LIKE ? OR 
          tags LIKE ? OR
          cuisine_type LIKE ?
        )`);
        const likePattern = `%${keyword}%`;
        params.push(likePattern, likePattern, likePattern, likePattern);
      }
      
      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }
      
      console.log(`[Recommend] 关键词: "${keyword}", SQL: ${sql}`);
      console.log(`[Recommend] 排除了 ${excludeDishNames.length} 道菜:`, excludeDishNames);
      
      db.all(sql, params, (err, rows) => {
        if (err) {
          console.error('[Recommend] SQL查询失败:', err);
          resolve([]);
        } else {
          console.log(`[Recommend] 候选菜谱数量: ${rows.length}`);
          resolve(rows || []);
        }
      });
    });
    
    if (candidates.length === 0) {
      return res.status(404).json({ 
        error: '没有符合条件的菜谱',
        message: keyword 
          ? `数据库中没有找到与“${keyword}”相关的菜谱，建议让AI生成！`
          : '您已经尝试过所有相关菜品了，建议换个食材试试！'
      });
    }
    
    // 4. 对候选菜谱评分
    const scoredCandidates = candidates.map(recipe => {
      let score = 0;
      const scoreDetails = {};
      
      if (randomMode) {
        // 🆕 随机推荐模式：完全随机评分，不依赖用户偏好
        score = Math.random();
        scoreDetails.random = true;
      } else {
        // 原有逻辑：基于用户画像的多维度评分
        // 菜系匹配度
        if (recipe.cuisine_type) {
          // 尝试清洗菜系名称（去除"料理"、"菜"等后缀）
          const cleanCuisine = recipe.cuisine_type.replace(/料理|菜$/g, '');
          const cuisineScore = profile.cuisineWeights[cleanCuisine] || profile.cuisineWeights[recipe.cuisine_type];
          if (cuisineScore) {
            score += cuisineScore * 2;  // 菜系权重 × 2
            scoreDetails.cuisine = cuisineScore;
          }
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
      }
      
      return { recipe, score, scoreDetails };
    });
    
    // 5. 按评分排序并选择前 N 个
    scoredCandidates.sort((a, b) => b.score - a.score);
    
    // 6. 多样性约束选择
    const selectedRecipes = [];
    const usedIngredients = new Set();
    const usedCookingMethods = new Set();
    const usedCuisines = new Set();
    let soupCount = 0;
    
    for (const candidate of scoredCandidates) {
      if (selectedRecipes.length >= targetDishCount) break;
      
      const { recipe } = candidate;
      
      // 检查菜品类型多样性（目前主要是防止两个汤）
      const recipeText = (recipe.title + (recipe.tags || []) + (recipe.cuisine_type || '')).toLowerCase();
      const isSoup = recipeText.includes('汤') || recipeText.includes('羹') || recipeText.includes('粥');
      
      if (isSoup && soupCount >= 1 && targetDishCount > 1) {
        continue; // 如果已经是多道菜模式，且已经选了一个汤，跳过
      }

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
        if (isSoup) soupCount++;
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
      id: recipe.id,
      name: recipe.title,
      ingredients: JSON.parse(recipe.ingredients),
      instructions: JSON.parse(recipe.steps).map((step, idx) => ({
        step: idx + 1,
        description: typeof step === 'string' ? step : (step.description || step.content || JSON.stringify(step))
      }))
    }));
    
    const recommendedRecipe = {
      id: crypto.randomUUID(),
      title: selectedRecipes.length > 1 
        ? `蔡大厨精选套餐·${selectedRecipes[0].title}等${selectedRecipes.length}道`
        : selectedRecipes[0].title,
      cuisine: randomMode ? '' : (selectedRecipes[0].cuisine_type || '综合菜系'),  // 🆕 随机模式不显示菜系
      dishes: recommendedDishes,
      nutritionInfo: generateNutritionInfo(selectedRecipes, diners),
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
async function updateUserWeights(userId, recipeId, feedbackType, recipeData) {
  // 1. 获取当前用户画像
  const profile = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM user_profile WHERE user_id = ?', [userId], (err, row) => {
      if (err) reject(err);
      else if (!row) reject(new Error('用户画像不存在'));
      else resolve({
        taste_weights: JSON.parse(row.taste_weights),
        cuisine_weights: JSON.parse(row.cuisine_weights),
        ingredient_weights: JSON.parse(row.ingredient_weights),
        cooking_method_weights: JSON.parse(row.cooking_method_weights),
        nutrition_weights: JSON.parse(row.nutrition_weights)
      });
    });
  });
  
  // 2. 获取菜谱信息（尝试从本地库查找，如果没有则使用传入的 recipeData）
  let recipesToProcess = [];
  
  if (recipeData && recipeData.dishes) {
    // 如果直接传了数据（多半是 AI 实时生成的），直接用它
    recipesToProcess = recipeData.dishes.map(d => ({
      title: d.name,
      cuisine: recipeData.cuisine,
      ingredients: JSON.stringify(d.ingredients),
      steps: JSON.stringify(d.instructions),
      taste_tags: JSON.stringify(recipeData.tags?.filter(t => ['酸','甜','苦','辣','咸','鲜','麻','清淡'].includes(t)) || []),
      nutrition_tags: JSON.stringify(recipeData.tags || [])
    }));
  } else {
    // 否则尝试从数据库查找
    const dbRecipe = await new Promise((resolve) => {
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
    if (dbRecipe) recipesToProcess = [dbRecipe];
  }
  
  if (recipesToProcess.length === 0) {
    console.log(`⚠️  未找到菜谱 ${recipeId} 且未提供 recipeData，跳过权重更新`);
    return;
  }
  
  // 3. 根据反馈类型调整权重
  const delta = feedbackType === 'like' ? 0.05 : -0.03; // 减小调整幅度，防止震荡
  const minWeight = 0.1;
  const maxWeight = 1.0;

  for (const recipe of recipesToProcess) {
    // 调整菜系权重
    const cuisine = recipe.cuisine_type || recipe.cuisine;
    if (cuisine) {
      const cleanCuisine = cuisine.split('(')[0].trim().replace('中餐', '').trim(); // 剔除通用词
      if (cleanCuisine && profile.cuisine_weights[cleanCuisine] !== undefined) {
        profile.cuisine_weights[cleanCuisine] = Math.max(minWeight, Math.min(maxWeight, profile.cuisine_weights[cleanCuisine] + delta));
      } else if (cleanCuisine) {
        profile.cuisine_weights[cleanCuisine] = 0.5 + delta;
      }
    }
    
    // 调整口味权重
    const tasteTags = recipe.taste_tags ? JSON.parse(recipe.taste_tags) : [];
    tasteTags.forEach(taste => {
      if (profile.taste_weights[taste] !== undefined) {
        profile.taste_weights[taste] = Math.max(minWeight, Math.min(maxWeight, profile.taste_weights[taste] + delta));
      } else {
        profile.taste_weights[taste] = 0.5 + delta;
      }
    });
    
    // 调整成分/食材权重 (仅对喜欢的显式增加)
    const ingredients = recipe.ingredients ? JSON.parse(recipe.ingredients) : [];
    ingredients.slice(0, 2).forEach(ing => {
      const ingName = typeof ing === 'object' ? ing.name : ing;
      if (profile.ingredient_weights[ingName] !== undefined) {
        profile.ingredient_weights[ingName] = Math.max(minWeight, Math.min(maxWeight, profile.ingredient_weights[ingName] + delta));
      } else if (feedbackType === 'like') {
        profile.ingredient_weights[ingName] = 0.6; 
      }
    });
  }
  
  // 4. 写回数据库
  const updateSql = `UPDATE user_profile 
                     SET taste_weights = ?, cuisine_weights = ?, ingredient_weights = ?,
                         cooking_method_weights = ?, nutrition_weights = ?, updated_at = ?
                     WHERE user_id = ?`;
  const updateParams = [
    JSON.stringify(profile.taste_weights),
    JSON.stringify(profile.cuisine_weights),
    JSON.stringify(profile.ingredient_weights),
    JSON.stringify(profile.cooking_method_weights),
    JSON.stringify(profile.nutrition_weights),
    Date.now(),
    userId
  ];
  
  await new Promise((resolve, reject) => {
    db.run(updateSql, updateParams, (err) => {
      if (err) reject(err);
      else {
        console.log(`✅ 用户 ${userId} 的权重已根据反馈(${feedbackType})更新`);
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
