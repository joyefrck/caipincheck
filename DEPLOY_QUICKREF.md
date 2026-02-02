# ⚡ 生产环境部署 - 快速参考

## 🎯 最快部署方式（推荐）

```bash
# 1. 进入项目目录
cd /path/to/caipincheck

# 2. 运行一键部署脚本
./deploy.sh
```

脚本会自动执行：备份数据库 → 安装依赖 → 数据库迁移 → 重启服务

---

## 📋 手动部署（分步执行）

### 前置要求
- ✅ 已拉取最新代码 (`git pull`)
- ✅ 已配置环境变量 `DEEPSEEK_API_KEY`

### 核心步骤

```bash
# 1️⃣ 备份数据库
cd server/scripts
./backup_db.sh

# 2️⃣ 执行迁移（创建表 + 标注菜谱）
node migrate_db.js

# 3️⃣ 重启服务
docker compose up -d --build   # Docker
# 或
pm2 restart all                # PM2
```

---

## 🔍 验证部署

```bash
# 检查用户画像
curl http://localhost:3001/api/user-profile/peter_yong

# 测试推荐引擎
curl -X POST http://localhost:3001/api/recommend \
  -H "Content-Type: application/json" \
  -d '{"userId": "peter_yong", "diners": 2}'

# 查看菜谱标注情况
sqlite3 food-check.db "SELECT COUNT(*) FROM base_recipes WHERE cuisine_type != '';"
```

---

## 🆘 回滚方案

```bash
# 停止服务
docker compose down  # 或 pm2 stop all

# 恢复数据库
cp backups/food-check.db.backup_XXXXXX food-check.db

# 回退代码
git checkout <previous-commit>

# 重启服务
docker compose up -d
```

---

## 📊 数据初始化选项

### 选项 A: 自动标注（推荐）
```bash
node server/scripts/migrate_db.js
```
- 基于规则自动推断菜系、口味、烹饪方法
- 速度快，无成本
- 准确率 ~70%

### 选项 B: AI 精准标注（可选）
```bash
node server/scripts/ai_enrich_recipes.js
```
- 使用 DeepSeek AI 分析每道菜谱
- 准确率 ~95%
- 有 API 调用费用（约 ¥0.003/菜谱）

---

## ⚠️ 常见问题速查

| 问题 | 解决方案 |
|-----|---------|
| "duplicate column name" | 正常，字段已存在，忽略即可 |
| 用户画像不存在 | 重新运行 `migrate_db.js` |
| API 返回 500 | 检查 `DEEPSEEK_API_KEY` 环境变量 |
| 推荐结果为空 | 运行爬虫补充菜谱：`curl -X POST http://localhost:3001/api/admin/scrape -d '{"limit":100}'` |

---

## 📱 部署后测试清单

- [ ] 访问首页正常
- [ ] "主厨今日特供"返回推荐
- [ ] 点击"喜欢"按钮有反馈
- [ ] 在对话框输入"我更喜欢川菜"得到确认
- [ ] 收藏功能正常
- [ ] 历史记录正常

---

## 📚 完整文档

详细信息请参考:
- **[完整部署指南](./DEPLOYMENT_GUIDE.md)** - 详细步骤和故障排除
- **[用户画像设计](./user_profile_design.md)** - 系统架构说明
- **[推荐算法详解](./recommendation_algorithm.md)** - 算法原理
