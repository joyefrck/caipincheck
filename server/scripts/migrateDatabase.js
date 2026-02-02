import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '../../food-check.db');
const backupPath = join(__dirname, '../../food-check.db.backup');
const migrationPath = join(__dirname, '../migrations/001_user_profile.sql');

console.log('🚀 开始数据库迁移...\n');

// 1. 备份数据库
console.log('📦 Step 1: 备份现有数据库...');
try {
  if (fs.existsSync(dbPath)) {
    fs.copyFileSync(dbPath, backupPath);
    console.log(`✅ 数据库已备份到: ${backupPath}\n`);
  } else {
    console.log('⚠️  数据库文件不存在，跳过备份\n');
  }
} catch (err) {
  console.error('❌ 备份失败:', err.message);
  process.exit(1);
}

// 2. 读取迁移 SQL
console.log('📄 Step 2: 读取迁移脚本...');
let migrationSQL;
try {
  migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
  console.log(`✅ 已读取迁移脚本: ${migrationPath}\n`);
} catch (err) {
  console.error('❌ 读取迁移脚本失败:', err.message);
  process.exit(1);
}

// 3. 执行迁移
console.log('🔧 Step 3: 执行数据库迁移...');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ 数据库连接失败:', err.message);
    process.exit(1);
  }
});

// 改进的 SQL 语句分割逻辑
const cleanSQL = migrationSQL
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join('\n');

const statements = cleanSQL
  .split(';')
  .map(stmt => stmt.trim())
  .filter(stmt => stmt.length > 0);

console.log(`📝 共解析出 ${statements.length} 条 SQL 语句\n`);

let completed = 0;
let failed = 0;
let currentIndex = 0;

// 使用递归串行执行，确保语句按顺序执行
function executeNextStatement() {
  if (currentIndex >= statements.length) {
    // 所有语句执行完毕
    console.log(`\n📊 迁移完成统计:`);
    console.log(`   - 成功: ${completed}/${statements.length}`);
    console.log(`   - 失败: ${failed}/${statements.length}`);

    if (failed === 0) {
      console.log('\n✅ 数据库迁移成功完成！');
    } else {
      console.log('\n⚠️  迁移过程中有部分语句失败，请检查日志');
    }

    // 4. 验证迁移结果
    verifyMigration();
    return;
  }

  const stmt = statements[currentIndex];
  const stmtNum = currentIndex + 1;

  db.run(stmt, (err) => {
    if (err) {
      // 忽略 "duplicate column name" 错误（表示字段已存在）
      if (err.message.includes('duplicate column name')) {
        console.log(`⚠️  语句 ${stmtNum}: 字段已存在，跳过`);
        completed++;
      } else if (err.message.includes('UNIQUE constraint failed')) {
        console.log(`⚠️  语句 ${stmtNum}: 数据已存在，跳过`);
        completed++;
      } else {
        console.error(`❌ 语句 ${stmtNum} 执行失败:`, err.message);
        console.error(`   SQL: ${stmt.substring(0, 100)}...`);
        failed++;
      }
    } else {
      console.log(`✅ 语句 ${stmtNum} 执行成功`);
      completed++;
    }

    currentIndex++;
    executeNextStatement();
  });
}

// 验证迁移结果
function verifyMigration() {
  console.log('\n🔍 Step 4: 验证迁移结果...');

  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='user_profile'", (err, row) => {
    if (row) {
      console.log('✅ user_profile 表创建成功');
    } else {
      console.log('❌ user_profile 表未找到');
    }

    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='user_feedback'", (err, row) => {
      if (row) {
        console.log('✅ user_feedback 表创建成功');
      } else {
        console.log('❌ user_feedback 表未找到');
      }

      db.all("PRAGMA table_info(base_recipes)", (err, rows) => {
        if (err) {
          console.log('❌ 无法检查 base_recipes 表结构');
        } else {
          const hasNewColumns = rows.some(row => 
            row.name === 'cooking_methods' || 
            row.name === 'nutrition_tags' || 
            row.name === 'taste_tags' || 
            row.name === 'cuisine_type'
          );
          if (hasNewColumns) {
            console.log('✅ base_recipes 表结构已更新');
            console.log(`   新增字段:`, rows.filter(r => 
              ['cooking_methods', 'nutrition_tags', 'taste_tags', 'cuisine_type'].includes(r.name)
            ).map(r => r.name).join(', '));
          } else {
            console.log('⚠️  base_recipes 表未发现新字段');
          }
        }

        db.get("SELECT * FROM user_profile WHERE user_id='peter_yong'", (err, row) => {
          if (row) {
            console.log('✅ 彼得勇的用户画像已初始化');
            console.log('   口味权重:', JSON.parse(row.taste_weights));
            console.log('   菜系权重:', JSON.parse(row.cuisine_weights));
          } else {
            console.log('❌ 用户画像初始化失败');
          }

          db.close((err) => {
            if (err) {
              console.error('\n❌ 关闭数据库连接失败:', err.message);
            } else {
              console.log('\n🎉 数据库迁移流程全部完成！');
            }
          });
        });
      });
    });
  });
}

// 开始执行迁移
executeNextStatement();
