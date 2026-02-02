# 🍳 蔡品检 - 智能菜谱推荐系统

一个基于用户画像的智能菜谱推荐系统，通过持续学习用户偏好，提供个性化、多样化且营养均衡的菜谱组合。

## ✨ 核心功能

### 1. 智能推荐系统

**基于用户画像的多维度推荐引擎**，从5个维度理解用户偏好：
- 🍜 **菜系偏好** - 川菜、粤菜、湘菜等八大菜系
- 🌶️ **口味偏好** - 甜、辣、咸、酸、鲜等
- 🥘 **烹饪方法** - 油炸、煎炒、蒸煮、炖煮等
- 🥗 **食材偏好** - 鸡肉、海鲜、蔬菜等（动态学习）
- 💪 **营养需求** - 蛋白质、维生素、膳食纤维等

**推荐特性**:
- ✅ 7天内不重复推荐
- ✅ 食材多样性保障
- ✅ 烹饪方法均衡
- ✅ 营养互补搭配
- ✅ 根据就餐人数智能调整菜品数量

### 2. 用户偏好学习

**自动学习机制**:
- 👍 **点击喜欢** → 相关菜系、口味、烹饪方法权重 +0.1
- 👎 **点击不喜欢** → 相关权重 -0.05
- 🎯 **连续反馈** → 加速权重调整
- 📊 **权重范围** → 0.1-1.0（避免极端偏好）

**对话式偏好调整**:
用户可以通过自然语言调整偏好：
```
"我更喜欢川菜" → 川菜权重 +0.2
"不要那么辣" → 辣味权重 -0.2
"多一些海鲜" → 海鲜食材权重 +0.15
"少油炸，多清蒸" → 油炸权重 -0.2，蒸煮权重 +0.2
```

### 3. 本地菜谱库

**自动爬虫系统**:
- 每天凌晨2点自动抓取500条新菜谱
- 支持多品类：热菜、凉菜、汤羹、面食、海鲜等
- 支持八大菜系：川菜、湘菜、粤菜、鲁菜等
- 自动标注菜系、口味、烹饪方法、营养标签

**优先级**: 本地库优先匹配 → AI生成兜底

---

## 🚀 快速开始

### 本地开发

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，填入 DEEPSEEK_API_KEY

# 启动开发服务器（前端 + 后端）
npm run dev:all
```

访问: http://localhost:5173

---

## 📡 API 文档

### 推荐相关

#### 智能推荐
```http
POST /api/recommend
Content-Type: application/json

{
  "userId": "peter_yong",
  "diners": 3,
  "excludeRecipeIds": []  // 可选，手动排除的菜谱ID
}
```

**响应示例**:
```json
{
  "id": "rec-uuid",
  "title": "蔡大厨精选套餐·宫保鸡丁等3道",
  "cuisine": "川菜",
  "diners": 3,
  "dishes": [
    {
      "name": "宫保鸡丁",
      "ingredients": [...],
      "instructions": [...]
    }
  ],
  "nutritionInfo": "💡 根据您的偏好智能推荐...",
  "tags": ["川菜", "辣"],
  "createdAt": 1738502400000
}
```

### 用户画像

#### 获取用户画像
```http
GET /api/user-profile/:userId
```

#### 更新用户画像
```http
POST /api/user-profile/:userId
Content-Type: application/json

{
  "tasteWeights": { "辣": 0.7, ... },
  "cuisineWeights": { "川菜": 0.8, ... },
  ...
}
```

#### 记录用户反馈
```http
POST /api/user-feedback
Content-Type: application/json

{
  "userId": "peter_yong",
  "recipeId": "recipe-uuid",
  "feedbackType": "like" | "dislike"
}
```

### 菜谱管理

#### 获取收藏菜谱（分页）
```http
GET /api/recipes?page=1&limit=20
```

#### 保存收藏菜谱
```http
POST /api/recipes
Content-Type: application/json

{
  "id": "uuid",
  "title": "菜谱名称",
  "cuisine": "川菜",
  "diners": 2,
  ...
}
```

#### 获取历史记录
```http
GET /api/history
```

---

## 📚 技术文档

- [用户画像系统设计](./user_profile_design.md)
- [推荐算法详解](./recommendation_algorithm.md)

---

## 🛠️ 数据库管理

### 执行数据库迁移

```bash
# 1. 备份数据库
cd server/scripts
./backup_db.sh

# 2. 执行迁移（创建用户画像表、补充标签数据）
node migrate_db.js
```

### 手动触发爬虫

```bash
# 抓取100条新菜谱
curl -X POST http://localhost:3001/api/admin/scrape \
  -H "Content-Type: application/json" \
  -d '{"limit": 100}'
```

### 查询菜谱数量

```bash
# 进入项目目录
node -e "const db = new (require('sqlite3').Database)('./food-check.db'); \
db.get('SELECT count(*) as total FROM base_recipes', (err, row) => { \
  console.log('当前菜谱总数:', row.total); \
  db.close(); \
});"
```

---

## 🚀 生产环境部署

> **重要**: 如果您要部署本次重大更新（用户画像系统），请先阅读 **[部署指南 DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)**

本项目已针对 1Panel 和标准 Docker 环境进行了优化。

### 1. 初始部署
1. **准备代码**:
   克隆仓库到服务器目录：
   ```bash
   git clone https://github.com/joyefrck/caipincheck.git .
   ```

2. **配置环境变量**:
   在 1Panel 的容器编排界面或通过 `.env` 文件配置以下变量：
   - `DEEPSEEK_API_KEY`: 你的 DeepSeek API 密钥。
   - `TZ`: `Asia/Shanghai` (确保定时任务按北京时间运行)。

3. **启动服务**:
   ```bash
   docker compose up -d --build
   ```

### 2. 代码更新 (增量更新)
当你推送了新的代码到 GitHub 后，执行以下命令即可平滑更新：
1. **同步代码**: `git pull`
2. **应用并重启**: `docker compose up -d --build`

### 3. 定时任务说明
系统内置了基于 `node-cron` 的爬虫任务：
- **执行时间**: 每天凌晨 2:00 (北京时间)。
- **任务内容**: 自动从香哈网抓取 500 篇全新的菜谱。
- **去重逻辑**: 自动通过 URL 排除已存在的菜谱，确保数据库健康增长。

### 4. 常见问题
- **数据库加载失败**: 如果看到 `SQLITE_CANTOPEN`，请确保项目根目录下存在一个空的 `food-check.db` **文件**而非文件夹。
- **测试抓取**: 打开文件夹，终端运行：`curl -X POST http://127.0.0.1:3001/api/admin/scrape -H "Content-Type: application/json" -d '{"limit": 100}'`

- **查询菜谱数量**：打开容器终端，执行 `node -e "const db = new (require('sqlite3').Database)('./food-check.db'); db.get('SELECT count(*) as total FROM base_recipes', (err, row) => { console.log('当前菜谱总数:', row.total); db.close(); });"`

