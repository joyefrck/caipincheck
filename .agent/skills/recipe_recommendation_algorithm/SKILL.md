---
name: 菜谱推荐算法
description: 基于用户画像的多维度加权评分推荐算法，用于智能菜谱推荐系统
---

# 菜谱推荐算法 Skill

## 概述

这是一个用于智能菜谱推荐的算法框架，采用**基于用户画像的多维度加权评分**，结合**多样性约束**和**时间去重策略**，为用户生成个性化且营养均衡的菜谱组合。

## 核心特性

- ✅ **个性化** - 根据用户偏好精准推荐
- ✅ **多样性** - 避免食材、烹饪方法、菜系重复
- ✅ **营养均衡** - 保证推荐菜品的营养互补
- ✅ **新鲜感** - 7天内不重复推荐
- ✅ **容错性** - 候选池不足时的降级策略
- ✅ **智能排除** - 区分灵魂料理与具体菜谱，精准排除

---

## 算法流程

```
1. 获取用户画像（菜系、口味、食材、烹饪方法、营养偏好权重）
2. 过滤7天内历史记录 + 用户排除列表
3. 对所有候选菜谱进行多维度评分
4. 按评分排序
5. 应用多样性约束筛选（食材、烹饪方法、菜系）
6. 如果候选不足，放宽约束继续筛选
7. 格式化并返回推荐结果
```

---

## 多维度评分公式

对于每道候选菜谱，计算综合评分：

```
总分 = 菜系分 × 2.0 + 口味分 × 1.5 + 烹饪方法分 × 1.2 + 营养分 × 1.0 + 食材分 × 1.0
```

### 评分维度说明

| 维度 | 权重系数 | 计算方式 | 设计理由 |
|------|---------|---------|---------|
| 菜系 | 2.0 | `用户菜系权重[菜谱菜系] × 2.0` | 菜系偏好最稳定，是选择首要因素 |
| 口味 | 1.5 | `Σ(用户口味权重[标签] × 1.5)` | 口味是核心体验，但可能跨菜系 |
| 烹饪方法 | 1.2 | `Σ(用户烹饪方法权重[方法] × 1.2)` | 影响口感和健康，重要性中等 |
| 营养 | 1.0 | `Σ(用户营养权重[标签] × 1.0)` | 长期健康考量，基础权重 |
| 食材 | 1.0 | `Σ(用户食材权重[食材] × 1.0)` | 基础权重（用户可能不清楚具体偏好） |

### 示例计算

**用户画像**:
- 川菜权重: 0.8
- 辣味权重: 0.7
- 咸味权重: 0.6

**菜谱**: 宫保鸡丁（川菜，辣+咸）

```
菜系分 = 0.8 × 2.0 = 1.6
口味分 = (0.7 + 0.6) × 1.5 = 1.95
总分 = 1.6 + 1.95 + ... = 高评分
```

---

## 多样性约束机制

### 三重约束

#### 1. 食材多样性
```javascript
// 避免"鸡肉套餐"（3道菜都是鸡肉）
if (菜谱主食材(前2个) ∩ 已选菜品主食材 ≠ ∅) {
  跳过该菜谱
}
```

#### 2. 烹饪方法多样性
```javascript
// 避免"油炸套餐"（3道菜都是油炸）
if (菜谱所有烹饪方法 ⊆ 已选烹饪方法集合) {
  跳过该菜谱
}
```

#### 3. 菜系多样性
```javascript
// 鼓励探索不同菜系（但允许最多2道同菜系）
if (同菜系已选菜品数量 >= 2) {
  跳过该菜谱
}
```

### 降级策略

当多样性约束过严，导致选出的菜品数量不足时：

```javascript
if (selected_recipes.length < target_count) {
  console.log("⚠️  放宽多样性限制");
  // 忽略多样性约束，直接按评分选择
  for (candidate in sorted_candidates) {
    if (!已选择(candidate)) {
      selected_recipes.push(candidate);
    }
  }
}
```

---

## 7天不重复逻辑

```javascript
const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
const recentHistory = await db.query(`
  SELECT id FROM history 
  WHERE created_at > ? 
`, [sevenDaysAgo]);

const excludeIds = [...recentHistory.map(r => r.id), ...userProvidedExcludeIds];

const candidates = await db.query(`
  SELECT * FROM base_recipes 
  WHERE id NOT IN (${excludeIds.join(',')})
`);
```

**设计考量**:
- 时间窗口: 7天（可配置）
- 排除来源: 历史记录 + 用户手动排除
- 目的: 保证每周都有新鲜体验

---

## 用户画像更新机制

### 反馈权重调整

```javascript
// 喜欢: +0.05，不喜欢: -0.03
const delta = feedbackType === 'like' ? 0.05 : -0.03;
const minWeight = 0.1;
const maxWeight = 1.0;

// 更新各维度权重
profile.cuisineWeights[cuisine] = clamp(
  profile.cuisineWeights[cuisine] + delta,
  minWeight,
  maxWeight
);
```

### 对话式偏好调整

当用户输入非特定菜名（如"我喜欢吃辣的"）时：

1. **解析**: AI 识别对话中的味型、菜系调整意图
2. **应用**: 立即更新数据库中的相应权重
3. **重定向**: 将偏好描述提取为关键词作为推荐需求
4. **注入**: 在返回结果中注入偏好更新提示

**示例**:
```
用户: "我喜欢吃川菜"
系统: 更新川菜权重 -> 推荐川菜 -> 显示"✅ 已增加川菜偏好"
```

---

## 性能优化策略

### 1. 短语速通 (Fast Pass)
**问题**: 简单查询也调用AI，延迟1-3秒  
**方案**: 正则预检，跳过AI
```javascript
if (QueryLength < 10 && !HasPreferenceKeywords) {
  // 直接本地查询，响应时间 < 50ms
}
```

### 2. 智能补位 (Smart Filling)
**问题**: 本地只匹配1道菜，无法凑齐套餐  
**方案**: 保留核心匹配 + 随机补位
```javascript
if (matched.length < target) {
  // 从本地库随机选取不重复菜品补位
  填充至目标数量
}
```

### 3. 精准匹配优先
**问题**: 模糊匹配导致结果不准  
**方案**: 调整SQL排序权重
```sql
ORDER BY 
  CASE 
    WHEN title = ? THEN 3        -- 完全匹配
    WHEN title LIKE ? THEN 2     -- 包含匹配
    ELSE 1                        -- 其他
  END DESC
```

### 4. 荤素平衡约束
**问题**: 推荐全肉或全素  
**方案**: 成分检测 + 补位偏向
```javascript
if (已选有肉菜) {
  // 后续空位强制从素菜或汤羹中选择
  补位优先级: 素菜 > 汤羹 > 其他
}
```

---

## 使用场景

### 场景1: 智能推荐
```javascript
// API调用
POST /api/recommend
{
  "userId": "peter_yong",
  "diners": 3,
  "excludeRecipeIds": []
}

// 返回
{
  "title": "蔡大厨精选套餐·宫保鸡丁等3道",
  "dishes": [...],
  "nutritionInfo": "🎯 荤素均衡，营养全面..."
}
```

### 场景2: 关键词搜索
```javascript
// 用户输入: "小炒肉"
// 系统: 1. 本地精准匹配 2. 智能补位 3. 返回套餐
```

### 场景3: 偏好学习
```javascript
// 用户点击"喜欢"
await recordFeedback('peter_yong', recipeId, 'like', recipeData);
// 系统自动更新用户画像权重
```

---

## 调优建议

### 调整评分权重
```javascript
// 降低菜系权重（如果推荐过于集中）
const cuisineScore = profile.cuisineWeights[cuisine] * 1.5; // 从2.0降到1.5
```

### 调整多样性阈值
```javascript
// 放宽菜系重复限制
const hasCuisineConflict = cuisineCount >= 3; // 从2改为3
```

### 调整学习速率
```javascript
// 降低单次反馈影响
const delta = feedbackType === 'like' ? 0.03 : -0.01; // 从0.05/-0.03降低
```

---

## 测试用例

### 正常场景
- **输入**: 用户喜欢川菜（权重0.8），2人用餐
- **预期**: 推荐2道川菜相关菜品，食材和烹饪方法多样

### 边界场景
- **输入**: 候选池只有5道菜，需要推荐3道
- **预期**: 成功推荐3道（可能触发放宽限制）

### 异常场景
- **输入**: 候选池为空
- **预期**: 返回错误"候选菜谱池为空，请添加更多基础菜谱"

---

## 数据结构

### 用户画像
```typescript
interface UserProfile {
  userId: string;
  tasteWeights: Record<string, number>;        // 口味权重
  cuisineWeights: Record<string, number>;      // 菜系权重
  ingredientWeights: Record<string, number>;   // 食材权重
  cookingMethodWeights: Record<string, number>; // 烹饪方法权重
  nutritionWeights: Record<string, number>;    // 营养权重
  updatedAt: number;
}
```

### 菜谱结构
```typescript
interface BaseRecipe {
  id: string;
  title: string;
  cuisine_type: string;
  ingredients: string; // JSON
  steps: string;       // JSON
  tags: string;        // JSON
  taste_tags: string;  // JSON
  cooking_methods: string; // JSON
  nutrition_tags: string;  // JSON
}
```

---

## 实现参考

完整实现请参考项目文件:
- 推荐API: `server/index.js` (第563-873行)
- 营养信息生成: `server/index.js` (第27-135行)
- 用户画像更新: `server/index.js` (第876-989行)
- 详细算法文档: `recommendation_algorithm.md`

---

## 许可证

本算法框架为蔡品检项目专用，版权所有 © 2025
