import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

// 加载环境变量
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env.local') });

const dbPath = join(__dirname, '../../food-check.db');
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || process.env.VITE_DEEPSEEK_API_KEY;

if (!DEEPSEEK_API_KEY) {
  console.error('❌ 错误: 未找到 DEEPSEEK_API_KEY 环境变量');
  process.exit(1);
}

const db = new sqlite3.Database(dbPath);

/**
 * 使用 AI 分析菜谱并生成标签
 */
async function enrichRecipeWithAI(recipe) {
  const prompt = `你是一个中餐菜谱分析专家。请分析以下菜谱信息，提取结构化标签。

菜谱标题: ${recipe.title}
食材列表: ${JSON.stringify(recipe.ingredients || [])}
已有标签: ${JSON.stringify(recipe.tags || [])}

请以 JSON 格式返回以下信息：
{
  "cuisine_type": "菜系（川菜/粤菜/湘菜/鲁菜/苏菜/浙菜/闽菜/徽菜/家常菜等）",
  "taste_tags": ["口味标签（甜/辣/咸/酸/鲜/麻/苦等）"],
  "cooking_methods": ["烹饪方法（油炸/煎炒/炖煮/蒸煮/烤制/凉拌/煲汤等）"],
  "nutrition_tags": ["营养标签（蛋白质/脂肪/碳水化合物/维生素/矿物质/膳食纤维等）"]
}

要求：
1. cuisine_type 只能是一个菜系
2. taste_tags 列出所有明显的口味（最多3个）
3. cooking_methods 列出主要烹饪方法（1-2个）
4. nutrition_tags 根据食材推断营养成分（2-3个）

直接返回 JSON，不要其他文字。`;

  try {
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
      throw new Error(`API 请求失败: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content?.trim();
    
    if (!content) return null;
    
    // 提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    return JSON.parse(jsonMatch[0]);
    
  } catch (err) {
    console.error(`  ⚠️  AI 分析失败: ${err.message}`);
    return null;
  }
}

/**
 * 批量标注存量菜谱
 */
async function enrichRecipes() {
  console.log('🤖 开始使用 AI 批量标注存量菜谱...\n');
  
  // 1. 获取所有菜谱
  const recipes = await new Promise((resolve) => {
    db.all('SELECT * FROM base_recipes', (err, rows) => {
      resolve(rows || []);
    });
  });
  
  console.log(`📊 找到 ${recipes.length} 条菜谱\n`);
  
  // 2. 过滤需要标注的菜谱（缺少标签的）
  const needEnrich = recipes.filter(r => {
    return !r.cuisine_type || 
           !r.taste_tags || r.taste_tags === '[]' ||
           !r.cooking_methods || r.cooking_methods === '[]' ||
           !r.nutrition_tags || r.nutrition_tags === '[]';
  });
  
  console.log(`📝 需要标注的菜谱数量: ${needEnrich.length}`);
  
  if (needEnrich.length === 0) {
    console.log('✅ 所有菜谱已标注完成！');
    return;
  }
  
  console.log(`\n⚠️  警告: AI 标注会调用 ${needEnrich.length} 次 DeepSeek API`);
  console.log(`预计耗时: ${Math.ceil(needEnrich.length * 2 / 60)} 分钟`);
  console.log(`预计费用: ¥${(needEnrich.length * 0.003).toFixed(2)} 元\n`);
  
  // 3. 确认是否继续
  const autoConfirm = process.argv.includes('--yes') || process.argv.includes('-y');
  
  if (!autoConfirm) {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise((resolve) => {
      rl.question('是否继续？(y/N): ', resolve);
    });
    rl.close();
    
    if (answer.toLowerCase() !== 'y') {
      console.log('❌ 已取消');
      return;
    }
  } else {
    console.log('⏩ 检测到 --yes 参数，已自动确认继续...\n');
  }
  
  // 4. 批量标注
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < needEnrich.length; i++) {
    const recipe = needEnrich[i];
    
    console.log(`\n[${i + 1}/${needEnrich.length}] 标注: ${recipe.title}`);
    
    try {
      // 解析现有数据
      const ingredients = recipe.ingredients ? JSON.parse(recipe.ingredients) : [];
      const tags = recipe.tags ? JSON.parse(recipe.tags) : [];
      
      // AI 分析
      const enriched = await enrichRecipeWithAI({
        title: recipe.title,
        ingredients,
        tags
      });
      
      if (!enriched) {
        console.log('  ❌ 标注失败');
        failCount++;
        continue;
      }
      
      // 更新数据库
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE base_recipes 
           SET cuisine_type = ?, 
               taste_tags = ?, 
               cooking_methods = ?, 
               nutrition_tags = ?
           WHERE id = ?`,
          [
            enriched.cuisine_type || '',
            JSON.stringify(enriched.taste_tags || []),
            JSON.stringify(enriched.cooking_methods || []),
            JSON.stringify(enriched.nutrition_tags || []),
            recipe.id
          ],
          (err) => err ? reject(err) : resolve()
        );
      });
      
      console.log(`  ✅ 成功`);
      console.log(`     菜系: ${enriched.cuisine_type}`);
      console.log(`     口味: ${enriched.taste_tags?.join(', ')}`);
      console.log(`     烹饪: ${enriched.cooking_methods?.join(', ')}`);
      console.log(`     营养: ${enriched.nutrition_tags?.join(', ')}`);
      
      successCount++;
      
      // 控制频率（避免 API 限流）
      await new Promise(resolve => setTimeout(resolve, 1500));
      
    } catch (err) {
      console.error(`  ❌ 处理失败: ${err.message}`);
      failCount++;
    }
  }
  
  // 5. 统计结果
  console.log('\n\n🎉 批量标注完成！');
  console.log(`✅ 成功: ${successCount} 条`);
  console.log(`❌ 失败: ${failCount} 条`);
  console.log(`📊 成功率: ${((successCount / needEnrich.length) * 100).toFixed(1)}%`);
}

// 执行标注
(async () => {
  try {
    await enrichRecipes();
  } catch (err) {
    console.error('\n❌ 脚本执行失败:', err);
    process.exit(1);
  } finally {
    db.close();
  }
})();
