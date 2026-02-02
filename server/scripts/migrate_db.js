import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// 加载环境变量
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env.local') });

const dbPath = join(__dirname, '../../food-check.db');
const migrationPath = join(__dirname, '../migrations/001_user_profile.sql');

const db = new sqlite3.Database(dbPath);

console.log('🔧 开始执行数据库迁移...\n');

// 第一步：执行迁移脚本
async function runMigration() {
  console.log('📋 步骤 1/3: 执行迁移脚本');
  
  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  const statements = migrationSQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const statement of statements) {
    try {
      await new Promise((resolve, reject) => {
        db.run(statement, (err) => {
          if (err) {
            // 忽略已存在的错误（幂等性）
            if (err.message.includes('already exists') || err.message.includes('duplicate column')) {
              console.log(`  ⚠️  跳过：${err.message.substring(0, 50)}...`);
              resolve();
            } else {
              reject(err);
            }
          } else {
            resolve();
          }
        });
      });
    } catch (err) {
      console.error(`  ❌ 执行失败: ${statement.substring(0, 100)}...`);
      throw err;
    }
  }
  
  console.log('  ✅ 迁移脚本执行完成\n');
}

// 第二步：验证表结构
async function verifySchema() {
  console.log('📋 步骤 2/3: 验证表结构');
  
  const tables = ['user_profile', 'user_feedback'];
  
  for (const table of tables) {
    const info = await new Promise((resolve) => {
      db.all(`PRAGMA table_info(${table})`, (err, rows) => {
        resolve(rows || []);
      });
    });
    
    if (info.length > 0) {
      console.log(`  ✅ 表 ${table} 已创建，包含 ${info.length} 个字段`);
    } else {
      throw new Error(`表 ${table} 不存在`);
    }
  }
  
  // 检查 base_recipes 新增字段
  const baseRecipesInfo = await new Promise((resolve) => {
    db.all(`PRAGMA table_info(base_recipes)`, (err, rows) => {
      resolve(rows || []);
    });
  });
  
  const newFields = ['cooking_methods', 'nutrition_tags', 'taste_tags', 'cuisine_type'];
  const existingFieldNames = baseRecipesInfo.map(f => f.name);
  
  for (const field of newFields) {
    if (existingFieldNames.includes(field)) {
      console.log(`  ✅ base_recipes.${field} 字段已添加`);
    } else {
      console.log(`  ⚠️  base_recipes.${field} 字段缺失`);
    }
  }
  
  console.log('\n');
}

// 第三步：为现有菜谱补充数据（使用简单规则）
async function enrichExistingRecipes() {
  console.log('📋 步骤 3/3: 为现有菜谱补充标签数据');
  
  const recipes = await new Promise((resolve) => {
    db.all('SELECT id, title, tags FROM base_recipes', (err, rows) => {
      resolve(rows || []);
    });
  });
  
  console.log(`  📊 找到 ${recipes.length} 条现有菜谱`);
  
  let updatedCount = 0;
  
  for (const recipe of recipes) {
    // 基于标题和已有标签进行智能推断
    const title = recipe.title || '';
    const tags = recipe.tags ? JSON.parse(recipe.tags) : [];
    
    // 推断菜系
    let cuisine_type = '';
    if (tags.includes('川菜') || title.includes('麻') || title.includes('辣')) cuisine_type = '川菜';
    else if (tags.includes('湘菜') || title.includes('剁椒')) cuisine_type = '湘菜';
    else if (tags.includes('粤菜')) cuisine_type = '粤菜';
    else if (tags.includes('鲁菜')) cuisine_type = '鲁菜';
    else if (tags.includes('苏菜')) cuisine_type = '苏菜';
    else if (tags.includes('浙菜')) cuisine_type = '浙菜';
    else if (tags.includes('闽菜')) cuisine_type = '闽菜';
    else if (tags.includes('徽菜')) cuisine_type = '徽菜';
    
    // 推断口味标签
    const taste_tags = [];
    if (title.includes('辣') || title.includes('麻')) taste_tags.push('辣');
    if (title.includes('甜')) taste_tags.push('甜');
    if (title.includes('酸')) taste_tags.push('酸');
    if (title.includes('咸')) taste_tags.push('咸');
    if (title.includes('鲜')) taste_tags.push('鲜');
    
    // 推断烹饪方法
    const cooking_methods = [];
    if (title.includes('炸') || title.includes('煎')) cooking_methods.push('油炸');
    if (title.includes('炒')) cooking_methods.push('煎炒');
    if (title.includes('炖') || title.includes('煮')) cooking_methods.push('炖煮');
    if (title.includes('蒸')) cooking_methods.push('蒸煮');
    if (title.includes('烤')) cooking_methods.push('烤制');
    if (title.includes('拌') || tags.includes('凉菜')) cooking_methods.push('凉拌');
    if (title.includes('汤') || tags.includes('汤羹')) cooking_methods.push('煲汤');
    
    // 推断营养标签
    const nutrition_tags = [];
    if (title.includes('鸡') || title.includes('肉') || title.includes('鱼') || tags.includes('荤菜')) {
      nutrition_tags.push('蛋白质');
    }
    if (tags.includes('素菜') || title.includes('蔬菜')) {
      nutrition_tags.push('维生素', '膳食纤维');
    }
    if (tags.includes('海鲜')) {
      nutrition_tags.push('蛋白质', '矿物质');
    }
    
    // 更新数据库
    if (cuisine_type || taste_tags.length > 0 || cooking_methods.length > 0 || nutrition_tags.length > 0) {
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE base_recipes 
           SET cuisine_type = ?, 
               taste_tags = ?, 
               cooking_methods = ?, 
               nutrition_tags = ?
           WHERE id = ?`,
          [
            cuisine_type,
            JSON.stringify(taste_tags),
            JSON.stringify(cooking_methods),
            JSON.stringify(nutrition_tags),
            recipe.id
          ],
          (err) => err ? reject(err) : resolve()
        );
      });
      
      updatedCount++;
      
      if (updatedCount % 50 === 0) {
        console.log(`  📈 进度: ${updatedCount}/${recipes.length}`);
      }
    }
  }
  
  console.log(`  ✅ 已为 ${updatedCount} 条菜谱补充标签数据\n`);
}

// 执行迁移流程
(async () => {
  try {
    await runMigration();
    await verifySchema();
    await enrichExistingRecipes();
    
    console.log('🎉 数据库迁移全部完成！\n');
    
    // 统计信息
    const stats = await new Promise((resolve) => {
      db.get(`
        SELECT 
          (SELECT COUNT(*) FROM base_recipes) as recipe_count,
          (SELECT COUNT(*) FROM user_profile) as profile_count,
          (SELECT COUNT(*) FROM user_feedback) as feedback_count
      `, (err, row) => resolve(row || {}));
    });
    
    console.log('📊 数据库统计:');
    console.log(`   - 菜谱总数: ${stats.recipe_count}`);
    console.log(`   - 用户画像: ${stats.profile_count}`);
    console.log(`   - 反馈记录: ${stats.feedback_count}`);
    
  } catch (err) {
    console.error('\n❌ 迁移失败:', err.message);
    process.exit(1);
  } finally {
    db.close();
  }
})();
