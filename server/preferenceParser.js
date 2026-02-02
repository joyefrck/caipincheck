import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env.local') });

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || process.env.VITE_DEEPSEEK_API_KEY;

/**
 * 解析用户对话中的偏好调整意图
 * @param {string} message - 用户消息
 * @returns {Promise<Object|null>} - 解析结果或 null（如果没有偏好调整）
 */
export async function parsePreferenceAdjustment(message) {
  // 快速预检：是否包含偏好相关关键词
  const preferenceKeywords = [
    '喜欢', '不喜欢', '偏好', '更', '少', '多', '不要', '想吃', '不想', 
    '爱吃', '不爱', '口味', '菜系', '清淡', '重口', '辣', '不辣'
  ];
  
  const hasPreferenceHint = preferenceKeywords.some(kw => message.includes(kw));
  
  if (!hasPreferenceHint) {
    return null; // 不包含偏好相关内容，直接返回
  }
  
  // 使用 AI 进行深度解析
  try {
    const prompt = `你是一个用户偏好解析器。请分析以下用户消息，提取其中的饮食偏好调整意图。

用户消息：
"${message}"

请以 JSON 格式返回解析结果，格式如下：
{
  "hasPreference": true/false,  // 是否包含偏好调整
  "adjustments": [
    {
      "type": "cuisine/taste/ingredient/cooking_method/nutrition",  // 权重类型
      "target": "川菜/辣/鸡肉/油炸/蛋白质等",  // 具体目标
      "action": "increase/decrease",  // 增加或减少
      "intensity": 0.1-0.3  // 调整强度（0.1=稍微，0.2=明显，0.3=大幅）
    }
  ],
  "explanation": "简短解释用户意图"
}

示例：
用户: "我最近想少吃点油炸的，多吃清蒸的"
返回: {
  "hasPreference": true,
  "adjustments": [
    {"type": "cooking_method", "target": "油炸", "action": "decrease", "intensity": 0.2},
    {"type": "cooking_method", "target": "蒸煮", "action": "increase", "intensity": 0.2}
  ],
  "explanation": "用户希望减少油炸食物，增加清蒸食物"
}

请直接返回 JSON，不要任何额外的文字。`;

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      })
    });

    if (!response.ok) {
      console.error('❌ DeepSeek API 调用失败');
      return null;
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content?.trim();
    
    if (!content) return null;
    
    // 提取 JSON（可能被 markdown 代码块包裹）
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    const result = JSON.parse(jsonMatch[0]);
    
    return result.hasPreference ? result : null;
    
  } catch (err) {
    console.error('⚠️  偏好解析失败:', err.message);
    return null;
  }
}

/**
 * 将解析结果应用到用户画像权重
 * @param {Object} currentProfile - 当前用户画像
 * @param {Array} adjustments - 调整列表
 * @returns {Object} - 更新后的画像
 */
export function applyPreferenceAdjustments(currentProfile, adjustments) {
  const updatedProfile = JSON.parse(JSON.stringify(currentProfile)); // 深拷贝
  
  const minWeight = 0.1;
  const maxWeight = 1.0;
  
  for (const adj of adjustments) {
    let targetWeights = null;
    
    // 确定要调整的权重对象
    switch (adj.type) {
      case 'cuisine':
        targetWeights = updatedProfile.cuisine_weights || updatedProfile.cuisineWeights;
        break;
      case 'taste':
        targetWeights = updatedProfile.taste_weights || updatedProfile.tasteWeights;
        break;
      case 'ingredient':
        targetWeights = updatedProfile.ingredient_weights || updatedProfile.ingredientWeights;
        break;
      case 'cooking_method':
        targetWeights = updatedProfile.cooking_method_weights || updatedProfile.cookingMethodWeights;
        break;
      case 'nutrition':
        targetWeights = updatedProfile.nutrition_weights || updatedProfile.nutritionWeights;
        break;
      default:
        continue;
    }
    
    if (!targetWeights) continue;
    
    // 计算调整值
    const delta = adj.action === 'increase' ? adj.intensity : -adj.intensity;
    
    // 应用调整
    if (targetWeights[adj.target] !== undefined) {
      targetWeights[adj.target] = Math.max(
        minWeight,
        Math.min(maxWeight, targetWeights[adj.target] + delta)
      );
    } else {
      // 新增项，从中间值开始
      targetWeights[adj.target] = Math.max(
        minWeight,
        Math.min(maxWeight, 0.5 + delta)
      );
    }
  }
  
  return updatedProfile;
}

/**
 * 生成用户友好的确认消息
 * @param {Object} parseResult - 解析结果
 * @returns {string} - 确认消息
 */
export function generateConfirmationMessage(parseResult) {
  if (!parseResult || !parseResult.adjustments || parseResult.adjustments.length === 0) {
    return null;
  }
  
  const parts = parseResult.adjustments.map(adj => {
    const action = adj.action === 'increase' ? '增加' : '减少';
    const intensity = adj.intensity >= 0.25 ? '大幅' : (adj.intensity >= 0.15 ? '明显' : '适当');
    return `${intensity}${action}【${adj.target}】偏好`;
  });
  
  return `✅ 已为您${parts.join('，')}。下次推荐会更符合您的口味！`;
}
