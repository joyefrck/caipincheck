-- 食谱模型进化：用户画像系统数据库迁移
-- 执行日期：2026-02-02

-- 1. 创建用户画像表
CREATE TABLE IF NOT EXISTS user_profile (
  user_id TEXT PRIMARY KEY,           -- 用户 ID（目前固定为 'peter_yong'）
  taste_weights TEXT,                 -- 口味权重 JSON: {"甜": 0.5, "辣": 0.5, "咸": 0.5, ...}
  cuisine_weights TEXT,               -- 菜系权重 JSON: {"川菜": 0.5, "粤菜": 0.5, ...}
  ingredient_weights TEXT,            -- 食材权重 JSON: {"鸡胸肉": 0.5, "土豆": 0.5, ...}
  cooking_method_weights TEXT,        -- 烹饪方法权重 JSON: {"油炸": 0.5, "清蒸": 0.5, ...}
  nutrition_weights TEXT,             -- 营养偏好权重 JSON: {"蛋白质": 0.5, "脂肪": 0.5, ...}
  updated_at INTEGER                  -- 最后更新时间
);

-- 2. 创建用户反馈记录表
CREATE TABLE IF NOT EXISTS user_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,              -- 用户 ID
  recipe_id TEXT NOT NULL,            -- 菜谱 ID
  feedback_type TEXT NOT NULL,        -- 'like' 或 'dislike'
  created_at INTEGER NOT NULL         -- 反馈时间
);

-- 3. 扩展 base_recipes 表（添加新字段）
-- SQLite 不支持一次性添加多列，需要逐个添加
ALTER TABLE base_recipes ADD COLUMN cooking_methods TEXT DEFAULT '[]';
ALTER TABLE base_recipes ADD COLUMN nutrition_tags TEXT DEFAULT '[]';
ALTER TABLE base_recipes ADD COLUMN taste_tags TEXT DEFAULT '[]';
ALTER TABLE base_recipes ADD COLUMN cuisine_type TEXT DEFAULT '';

-- 4. 为"彼得勇"初始化默认用户画像（所有权重均为 0.5）
INSERT INTO user_profile (user_id, taste_weights, cuisine_weights, ingredient_weights, cooking_method_weights, nutrition_weights, updated_at)
VALUES (
  'peter_yong',
  '{"甜": 0.5, "咸": 0.5, "酸": 0.5, "苦": 0.5, "辣": 0.5, "鲜": 0.5, "麻": 0.5}',
  '{"川菜": 0.5, "粤菜": 0.5, "鲁菜": 0.5, "湘菜": 0.5, "苏菜": 0.5, "浙菜": 0.5, "徽菜": 0.5, "闽菜": 0.5, "日料": 0.5, "韩餐": 0.5, "东南亚菜": 0.5, "西餐": 0.5}',
  '{}',
  '{"油炸": 0.5, "煎炒": 0.5, "炖煮": 0.5, "蒸煮": 0.5, "烤制": 0.5, "凉拌": 0.5, "煲汤": 0.5}',
  '{"蛋白质": 0.5, "脂肪": 0.5, "碳水化合物": 0.5, "维生素": 0.5, "矿物质": 0.5, "膳食纤维": 0.5}',
  strftime('%s', 'now') * 1000
);

-- 5. 创建索引以提升查询性能
CREATE INDEX IF NOT EXISTS idx_user_feedback_user_id ON user_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_recipe_id ON user_feedback(recipe_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_created_at ON user_feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_base_recipes_cuisine_type ON base_recipes(cuisine_type);
