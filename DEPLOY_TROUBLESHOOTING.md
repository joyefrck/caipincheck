# 🚨 1Panel 部署问题修复指南

根据您的截图，发现以下问题需要修复：

## ⚠️ 问题诊断

1. ❌ **DEEPSEEK_API_KEY 未设置**
2. ❌ **容器缺少 sqlite3 工具**
3. ❌ **迁移脚本执行失败** - user_feedback 表未创建

---

## ✅ 快速修复方案

### 步骤 1: 配置环境变量

在 1Panel 中配置环境变量：

**方法 A: 通过 1Panel 界面**
1. 进入应用设置 → 环境变量
2. 添加：`DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxx`
3. 保存并重启容器

**方法 B: 修改 .env.local 文件**
```bash
# 在宿主机项目目录
echo "DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxx" > .env.local
echo "VITE_DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxx" >> .env.local
```

### 步骤 2: 修复 docker-compose.yml

确保环境变量正确传递：

```yaml
services:
  caipincheck:
    build:
      context: .
    ports:
      - "3001:3001"
    volumes:
      - ./food-check.db:/app/food-check.db
      - ./.env.local:/app/.env.local  # 挂载环境变量文件
    restart: always
    environment:
      NODE_ENV: production
      DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY}
      VITE_DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY}
      TZ: Asia/Shanghai
```

### 步骤 3: 在宿主机直接执行迁移

由于容器环境复杂，**推荐在宿主机直接执行迁移**：

```bash
# 1. 确保宿主机有 Node.js 和 sqlite3
node --version
sqlite3 --version

# 2. 安装依赖（如果需要）
npm install

# 3. 在宿主机执行迁移
cd server/scripts
node migrate_db.js

# 4. 验证结果
sqlite3 ../../food-check.db << EOF
.tables
SELECT COUNT(*) FROM user_profile;
SELECT COUNT(*) FROM user_feedback;
EOF
```

### 步骤 4: 重建容器

```bash
docker compose down
docker compose up -d --build
```

---

## 🔧 高级方案：修复 Dockerfile

如果需要在容器内执行迁移，需要修改 Dockerfile 添加 sqlite3：

```dockerfile
# 在 Dockerfile 的运行阶段添加
RUN apt-get update && apt-get install -y sqlite3 && rm -rf /var/lib/apt/lists/*
```

然后重新构建镜像：
```bash
docker compose build --no-cache
docker compose up -d
```

---

## 📋 完整执行流程（推荐）

```bash
# 在宿主机 /opt/1panel/apps/caipincheck 目录

# 1. 配置环境变量
cat > .env.local << 'EOF'
DEEPSEEK_API_KEY=sk-your-actual-key-here
VITE_DEEPSEEK_API_KEY=sk-your-actual-key-here
EOF

# 2. 备份数据库
mkdir -p backups
cp food-check.db backups/food-check.db.backup_$(date +%Y%m%d_%H%M%S)

# 3. 拉取最新代码
git pull

# 4. 安装依赖（宿主机）
npm install

# 5. 在宿主机执行数据库迁移
cd server/scripts
node migrate_db.js
cd ../..

# 6. 验证迁移结果
sqlite3 food-check.db << EOF
SELECT name FROM sqlite_master WHERE type='table';
SELECT COUNT(*) as user_profiles FROM user_profile;
SELECT COUNT(*) as feedbacks FROM user_feedback;
SELECT COUNT(*) as recipes_with_cuisine FROM base_recipes WHERE cuisine_type != '';
EOF

# 7. 重建容器
docker compose down
docker compose up -d --build

# 8. 测试 API
sleep 5
curl http://localhost:3001/api/user-profile/peter_yong
```

---

## 🔍 验证清单

执行后检查：

```bash
# 1. 检查环境变量
docker compose exec caipincheck env | grep DEEPSEEK

# 2. 检查数据库表
sqlite3 food-check.db ".tables"

# 3. 检查用户画像
sqlite3 food-check.db "SELECT * FROM user_profile WHERE user_id='peter_yong';"

# 4. 测试推荐API
curl -X POST http://localhost:3001/api/recommend \
  -H "Content-Type: application/json" \
  -d '{"userId": "peter_yong", "diners": 2}'
```

---

## 🚨 常见问题

### Q1: CREATE INDEX 失败

**原因**: user_feedback 表未创建成功

**解决**: 
```bash
# 检查迁移脚本日志
node server/scripts/migrate_db.js 2>&1 | tee migrate.log

# 手动执行 SQL
sqlite3 food-check.db < server/migrations/001_user_profile.sql
```

### Q2: sqlite3: not found

**原因**: 容器内没有 sqlite3 工具

**解决**: 在宿主机执行迁移，或修改 Dockerfile

### Q3: DEEPSEEK_API_KEY not set

**解决**: 
```bash
# 检查环境变量文件
cat .env.local

# 确保 docker-compose.yml 中正确引用
```

---

## 💡 最佳实践

1. ✅ **在宿主机执行迁移**（推荐）
   - 避免容器环境复杂性
   - 更容易调试
   - 不依赖容器工具

2. ✅ **使用 .env.local 文件**
   - 统一管理环境变量
   - 容器和宿主机共享配置

3. ✅ **始终先备份数据库**
   - 迁移前必须备份
   - 保留多个时间点备份

---

## 📞 需要帮助？

如果以上方法仍然失败，请提供：
1. `node server/scripts/migrate_db.js` 的完整输出
2. `sqlite3 food-check.db ".schema"` 的输出
3. `.env.local` 文件内容（脱敏）
