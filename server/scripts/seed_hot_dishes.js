const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 连接数据库
const dbPath = path.join(__dirname, '../../food-check.db');
const db = new sqlite3.Database(dbPath);

console.log('🔧 开始执行数据补丁: 补充缺失的热门家常菜...');

const recipes = [
  {
    id: 'patch-20240202-xiaocaorou',
    title: '农家小炒肉',
    source_url: 'https://local/patch/xiaocaorou',
    ingredients: '[{"name": "五花肉", "amount": "250g"}, {"name": "杭椒", "amount": "150g"}, {"name": "红椒", "amount": "2个"}, {"name": "蒜瓣", "amount": "5个"}]',
    steps: '["五花肉切薄片，青红椒切滚刀块", "热锅凉油下肉片煸炒出油盛出", "留底油爆香蒜片，下青红椒炒至断生", "倒入肉片大火翻炒", "加入老抽、生抽、豆豉、盐调味", "沿锅边淋入少许米酒增香出锅"]',
    tags: '["湘菜", "下饭菜", "微辣"]',
    nutrition_tags: '["蛋白质", "维生素"]',
    taste_tags: '["辣", "咸", "鲜"]',
    cuisine_type: '湘菜',
    cooking_methods: '["爆炒"]'
  },
  {
    id: 'patch-20240202-baocai1',
    title: '手撕包菜',
    source_url: 'https://local/patch/baocai1',
    ingredients: '[{"name": "包菜", "amount": "500g"}, {"name": "五花肉", "amount": "100g"}, {"name": "干辣椒", "amount": "5个"}, {"name": "蒜瓣", "amount": "3个"}]',
    steps: '["包菜洗净撕成小块", "五花肉切薄片", "热锅凉油煸炒五花肉至出油", "放入蒜片干辣椒爆想", "倒入包菜大火快炒至断生", "加入生抽、醋、盐调味即可"]',
    tags: '["家常菜", "包菜", "快手菜"]',
    nutrition_tags: '["膳食纤维", "蛋白质"]',
    taste_tags: '["咸", "酸", "辣"]',
    cuisine_type: '湘菜',
    cooking_methods: '["煎炒"]'
  },
  {
    id: 'patch-20240202-baocai2',
    title: '包菜粉丝炒鸡蛋',
    source_url: 'https://local/patch/baocai2',
    ingredients: '[{"name": "包菜", "amount": "300g"}, {"name": "粉丝", "amount": "1把"}, {"name": "鸡蛋", "amount": "2个"}]',
    steps: '["粉丝泡软切段", "包菜切丝", "鸡蛋打散炒熟盛出", "锅留底油炒香葱花放入包菜丝炒软", "加入粉丝和鸡蛋翻炒", "加老抽、生抽、盐调味出锅"]',
    tags: '["家常菜", "包菜", "素食"]',
    nutrition_tags: '["碳水化合物", "维生素"]',
    taste_tags: '["咸", "鲜"]',
    cuisine_type: '家常菜',
    cooking_methods: '["煎炒"]'
  },
  {
    id: 'patch-20240202-tomato-egg',
    title: '西红柿炒鸡蛋',
    source_url: 'https://local/patch/tomato-egg',
    ingredients: '[{"name": "西红柿", "amount": "2个"}, {"name": "鸡蛋", "amount": "3个"}, {"name": "葱花", "amount": "少许"}]',
    steps: '["鸡蛋打散炒熟盛出", "西红柿切块", "锅留底油炒出西红柿汁", "倒入鸡蛋翻炒", "加盐和少许糖调味", "撒上葱花出锅"]',
    tags: '["家常菜", "快手菜", "国民菜"]',
    nutrition_tags: '["蛋白质", "维生素"]',
    taste_tags: '["酸", "甜", "咸"]',
    cuisine_type: '家常菜',
    cooking_methods: '["煎炒"]'
  }
];

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO base_recipes (
    id, title, source_url, ingredients, steps, tags, created_at, 
    nutrition_tags, taste_tags, cuisine_type, cooking_methods
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.serialize(() => {
  let count = 0;
  
  recipes.forEach(recipe => {
    insertStmt.run(
      recipe.id,
      recipe.title,
      recipe.source_url,
      recipe.ingredients,
      recipe.steps,
      recipe.tags,
      Date.now(),
      recipe.nutrition_tags,
      recipe.taste_tags,
      recipe.cuisine_type,
      recipe.cooking_methods,
      function(err) {
        if (err) {
          console.error(`❌ 插入失败 [${recipe.title}]:`, err.message);
        } else if (this.changes > 0) {
          console.log(`✅ 成功添加: ${recipe.title}`);
          count++;
        } else {
          console.log(`⏭️ 已存在，跳过: ${recipe.title}`);
        }
      }
    );
  });

  insertStmt.finalize(() => {
    console.log(`\n🎉 数据补丁执行完毕，共新增 ${count} 道菜谱。`);
    db.close();
  });
});
