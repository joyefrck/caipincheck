import { Recipe, UserPreferences } from "../types";

const API_BASE_URL = "/api";

// 后端代理路由
const PROXY_API_URL = `${API_BASE_URL}/ai/chat`;

// JSON Schema 定义
const recipeSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "套餐名称" },
    cuisine: { type: "string", description: "主要菜系" },
    dishes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "单道菜品名称" },
          ingredients: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                amount: { type: "string", description: "具体分量" }
              },
              required: ["name", "amount"]
            }
          },
          instructions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                step: { type: "integer" },
                description: { type: "string" }
              },
              required: ["step", "description"]
            }
          }
        },
        required: ["name", "ingredients", "instructions"]
      }
    },
    nutritionInfo: { type: "string", description: "整体营养均衡说明" },
    tags: { type: "array", items: { type: "string" } }
  },
  required: ["title", "cuisine", "dishes", "nutritionInfo", "tags"]
};

// 调用 DeepSeek API
async function callDeepSeek(systemPrompt: string, userPrompt: string, useJsonMode = false): Promise<string> {
  const requestBody: any = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.7, // 适度降低随机度，保证经典菜品的正宗性
    presence_penalty: 0.2, // 减少无谓的“换话题”，更专注于用户指定的食材
    max_tokens: 4000
  };
// ...接下来的逻辑保持不变...

  // 如果需要 JSON 模式，添加 response_format
  if (useJsonMode) {
    requestBody.response_format = { type: "json_object" };
  }

  const response = await fetch(PROXY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API 调用失败: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

export const generateRecipe = async (
  input: string,
  prefs: UserPreferences,
  excludedTitles: string[],
  userTasteProfile?: string
): Promise<Recipe> => {
  const isMultiDish = prefs.diners >= 2;
  // 随机生成的灵感指纹，强迫 AI 偏移
  const randomInsipiration = ['传统地道', '创新融合', '快手家常', '硬核大菜', '养生滋补'][Math.floor(Math.random() * 5)];
  
  const systemPrompt = `你是一个拥有广博知识库的世界级大厨，精通中西餐及各地方特色菜。
你现在的任务是生成一份独特的食谱。

## 核心法则：
1. 创意与正宗平衡：使用当前随机灵感指纹 [${Date.now()}-${Math.random()}] 进行创作偏移。但必须保证经典菜品的逻辑完整性，严禁为了创意而破坏菜品本味。
2. 杜绝食材思维定式：
   - 比如搜“五花肉”，必须从【回锅肉、东坡肉、粉蒸肉、把子肉、南乳扣肉、台式卤肉、梅菜扣肉、脆皮烧肉、农家小炒肉、笋干烧肉】等成千上万种做法中随机挑选，严禁反复推荐同一种。
   - 比如搜“鸡胸肉”，必须从【宫保鸡丁、辣子鸡丁、口水鸡、凉拌鸡丝、照烧鸡、小炒鸡、咖喱鸡】中挑选。
3. 尊重烹饪本质（严禁搞错基本形式）：
   - 【经典菜品本源】：遇到“盐焗鸡”、“清蒸鱼”等经典著名菜品，必须遵循正宗味型，绝对禁止在不辣的经典菜中加入辣椒或花椒。
   - 【地域名小吃】：遇到带有明确地域前缀的菜品（如“衡阳米粉”），必须遵循该地区的传统标准食用形态。
   - 【烧烤类、焖锅类】：必须遵循其特有的烹饪逻辑。
4. 口味红线（语义绝对执行）：
   - 如果用户输入或偏好中包含“清淡”、“不辣”、“无糖”等负面约束，严禁在 ingredients 中出现对应食材（如：辣椒、花椒、红油、大量的糖等）。
5. 结构化输出：必须符合以下 JSON Schema。

JSON Schema:
${JSON.stringify(recipeSchema, null, 2)}`;

  const userPrompt = `请根据以下要求生成一份详细的食谱计划：

1. 综合需求：${input}
   (请注意：请从中精准识别用户提到的【食材】、【口味】或【特定菜系】)
2. 锁定偏好：本轮优先参考【${prefs.cuisine || '中餐'}】架构 (特别是：${prefs.subCuisine || '不限'})。
3. 就餐人数：${prefs.diners} 人
4. 核心决策优先级（绝对执行）：
   - 【第一优先级 (最高)】：用户在“综合需求”中明确指出的口味禁忌（如“不要辣”、“不加糖”）以及**烹饪形式约束**（如明确要求“做汤”、“要喝粥”、“想吃面”、“做甜点”）。如果用户提到了“汤”，生成的料理中必须包含汤品或者是纯汤，绝对严禁将其生成为炒菜或炸物。
   - 【第二优先级】：经典菜名本源本味。如果用户输入了具有明确传统特征的菜名（如“猪肚鸡”、“清蒸鱼”），必须遵循其传统属性。
   - 【第三优先级】：用户偏好背景 (${userTasteProfile})。
   - 【第四优先级 (兜底)】：只有当用户输入极其模糊且未指定口味或形式时，才执行【大众口味/营养均衡】默认风格。
5. 严格回避（最高优先级，绝对执行）：
   ${excludedTitles.length > 0 ? `
   - 以下是用户明确不喜欢的菜品和套餐，你必须**绝对避开**：${excludedTitles.join('、')}
   - 重要：即使上述列表中的某道菜与用户当前搜索的食材相关（例如用户搜索"生蚝"，但列表中有"蒜蓉蒸生蚝"），你也**绝对不能**再次推荐该做法。你必须为该食材选择**完全不同的烹饪方法**（如"烤生蚝"、"生蚝粥"、"芝士焗生蚝"等）。
   - 如果该食材的所有做法都已被用户尝试过（排除列表过长），请在nutritionInfo中礼貌告知："这个食材的做法您已经全部尝试过了，建议换个食材试试！"
   ` : '无特定回避要求'}

关键约束：
- 需求理解：你要能听懂“南瓜，汤”这样的组合指令。既然用户提到了“汤”，你就必须给出南瓜浓汤、南瓜排骨汤等汤类做法，严禁给出像“蛋黄焗南瓜”这种干煸/炒制的菜。
- 菜品配置：${prefs.diners} 人就餐，必须提供【恰好 ${prefs.diners >= 3 ? '3' : isMultiDish ? '2' : '1'} 个】菜品搭配。严禁多给，严禁少给。
- 核心食材与多样性：如果用户提到了特定食材（如“牛肉”），生成的套餐中必须有【至少一道且通常为一道】以该食材为主料的核心菜品。**严禁所有菜品都使用同一种核心食材**。其余菜品应选择互补的食材（如：主菜是牛肉，副菜应选蔬菜或豆腐），确保餐桌丰富度。
- 荤素与品种平衡：若生成 2 个及以上菜品，必须包含【1道硬菜/主菜 (肉类) + 1道素菜/汤】。**绝对禁止生成两个或以上都是“汤”类或“面食”类的料理**（除非用户明确要求）。严禁出现两道菜都是同一种肉类（如“红豆牛肉”+“土豆牛肉”）的情况。如果是 3 道菜，建议“两菜一汤”或“一肉二素”。
- 口味契合度：如果用户提到了“清淡”，生成的【椒麻】、【麻辣】、【香辣】等口味的菜品将被视为严重错误。此时你必须生成白灼、清蒸、盐焗或家常素小炒等对应形式。
- 份量计算：食材分量需根据 ${prefs.diners} 人份量精准调整，确保刚好够吃。
- 营养说明：在 nutritionInfo 字段阐述本套餐是如何平衡蛋白质、纤维素及能量的。

直接返回 JSON，展示你的顶级大厨素养！`;

  const responseText = await callDeepSeek(systemPrompt, userPrompt, true);
  
  // 检查是否是偏好调整响应
  if (typeof responseText === 'object' && responseText.type === 'preference_update') {
    // 这是偏好调整响应，直接返回消息给用户
    const message = responseText.choices?.[0]?.message?.content || '偏好已更新';
    throw new Error(`PREFERENCE_UPDATE:${message}`);
  }
  
  // 健壮处理：提取 JSON 字符串（防止 AI 依然返回 ```json ... ``` 包裹的格式）
  let cleanJson = responseText;
  const jsonMatch = responseText.match(/```(?:json)?([\s\S]*?)```/);
  if (jsonMatch) {
    cleanJson = jsonMatch[1].trim();
  } else {
    // 尝试寻找第一个 { 和最后一个 }
    const firstBrace = responseText.indexOf('{');
    const lastBrace = responseText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanJson = responseText.substring(firstBrace, lastBrace + 1);
    }
  }

  try {
    const data = JSON.parse(cleanJson);
    return {
      ...data,
      id: crypto.randomUUID(),
      diners: prefs.diners,
      createdAt: Date.now(),
    };
  } catch (err) {
    console.error("JSON Parsing failed for response:", responseText);
    throw new Error("AI 返回的数据格式无法解析，请重试。");
  }
};

export const analyzeUserTaste = async (savedRecipes: Recipe[]): Promise<string> => {
  if (savedRecipes.length === 0) return "还没有足够的满意记录来分析您的口味。";
  
  const recipeSummaries = savedRecipes.slice(0, 10).map(r => 
    `菜名: ${r.title}, 菜系: ${r.cuisine}, 标签: ${r.tags.join(', ')}`
  ).join('; ');

  const systemPrompt = "你是一个专业的美食分析师，擅长通过用户的菜谱偏好分析其口味特征。";
  
  const userPrompt = `根据以下用户满意的菜谱记录，用一段简短、个性化且幽默的话（50字以内）总结用户的"美食人格"和"口味偏好"：
记录：${recipeSummaries}

直接返回总结文字，不要添加引号或其他格式。`;

  const response = await callDeepSeek(systemPrompt, userPrompt, false);
  
  return response.trim() || "美食探索者";
};
