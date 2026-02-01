import { Recipe, UserPreferences } from "../types";

// DeepSeek API 配置
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const API_KEY = import.meta.env.VITE_DEEPSEEK_API_KEY;

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
    temperature: 1.0, // 提到最高随机度，确保生成结果的多样性
    presence_penalty: 0.6, // 鼓励模型谈论新话题，进一步增加多样性
    max_tokens: 4000
  };
// ...接下来的逻辑保持不变...

  // 如果需要 JSON 模式，添加 response_format
  if (useJsonMode) {
    requestBody.response_format = { type: "json_object" };
  }

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
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
1. 每一秒都要有新创意：使用当前随机灵感指纹 [${Date.now()}-${Math.random()}] 进行创作偏移。
2. 杜绝食材思维定式：
   - 比如搜“五花肉”，必须从【回锅肉、东坡肉、粉蒸肉、把子肉、南乳扣肉、台式卤肉、梅菜扣肉、脆皮烧肉、农家小炒肉、笋干烧肉】等成千上万种做法中随机挑选，严禁反复推荐同一种。
   - 比如搜“鸡胸肉”，必须从【宫保鸡丁、辣子鸡丁、口水鸡、凉拌鸡丝、照烧鸡、小炒鸡、咖喱鸡】中挑选。
3. 尊重烹饪本质（严禁搞错基本形式）：
   - 【火锅类】：如果用户提到火锅，其结构必须是：1. 制作底汤（锅底）；2. 准备蘸料；3. 准备丰富的生鲜食材清单供现场涮烫。绝对禁止将其写成炒菜。
   - 【地域名小吃】：遇到带有明确地域前缀的菜品（如“衡阳米粉”、“柳州螺蛳粉”、“兰州牛肉面”），必须遵循该地区的传统标准食用形态。
     - *案例说明*：衡阳米粉传统上是汤粉（如鱼汤粉、筒骨粉）或卤粉，绝非炒粉。除非用户明确说“炒”，否则严禁将其生成为炒菜逻辑。
   - 【烧烤类、焖锅类】：必须遵循其特有的烹饪逻辑。
4. 结构化输出：必须符合以下 JSON Schema。

JSON Schema:
${JSON.stringify(recipeSchema, null, 2)}`;

  const userPrompt = `请根据以下要求生成一份详细的食谱计划：

1. 综合需求：${input} (请从中智能识别用户提到的【食材】、【口味】或【特定菜系】)
2. 锁定偏好：本轮必须遵循【${prefs.cuisine}】架构 (特别是：${prefs.subCuisine})。
3. 就餐人数：${prefs.diners} 人
4. 默认兜底偏好：如果用户没指定口味/菜系，且锁定偏好为默认值，请执行【辣的】+【中餐(湘菜)】风格。
5. 用户偏好背景：${userTasteProfile || '尚无记录'}。
6. 严格回避：绝对禁止生成以下方案：${excludedTitles.join(', ')}。

关键约束：
- 结构专家：你要能听懂“猪肉，川菜超级辣”这样的混合指令，并据此生成四川风格的极辣猪肉料理。
- 菜品配置：${prefs.diners} 人就餐，必须提供 ${prefs.diners >= 3 ? '至少 3 个（其中必须包含 1 个汤品，形成“两菜一汤”或“多菜一汤”的稳固搭配）' : isMultiDish ? '至少 2 个' : '1 个'} 菜品搭配。
- 均衡营养：整体套餐必须严格执行【荤素搭配】逻辑。如果是 2 个菜及以上，严禁全是肉类或全是蔬菜。
- 份量计算：食材分量需根据 ${prefs.diners} 人份量精准调整，确保刚好够吃。
- 营养说明：在 nutritionInfo 字段阐述本套餐是如何平衡蛋白质、纤维素及能量的。

直接返回 JSON，展示你的顶级大厨素养！`;

  const responseText = await callDeepSeek(systemPrompt, userPrompt, true);
  
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
