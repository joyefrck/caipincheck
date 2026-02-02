# 🚀 1Panel Docker 环境部署指南

## ⚠️ 重要说明

**1Panel 环境不适合使用 `deploy.sh` 脚本**，因为：
- Docker 容器内外路径不同
- 数据库文件在宿主机或数据卷中
- 需要在容器内执行命令

---

## 📋 1Panel 推荐部署流程

### 步骤 1: 备份数据库（在宿主机）

```bash
# 找到数据卷挂载位置（通常在 /opt/1panel/apps/caipincheck/）
cd /opt/1panel/apps/caipincheck

# 创建备份目录
mkdir -p backups

# 备份数据库
cp food-check.db backups/food-check.db.backup_$(date +%Y%m%d_%H%M%S)

# 验证备份
ls -lh backups/
```

### 步骤 2: 进入容器执行迁移

```bash
# 方案 A: 使用 docker compose exec（推荐）
docker compose exec app sh -c "cd server/scripts && node migrate_db.js"

# 方案 B: 使用 docker exec（需要容器名）
docker exec -it caipincheck-app-1 sh -c "cd server/scripts && node migrate_db.js"

# 方案 C: 通过 1Panel 控制台
# 1. 进入容器终端
# 2. 执行: cd server/scripts && node migrate_db.js
```

### 步骤 3: 重建容器

在 1Panel 控制台：
1. 找到 caipincheck 应用
2. 点击 "重建" 按钮
3. 等待容器重启完成

### 步骤 4: 验证部署

```bash
# 测试用户画像接口
curl http://localhost:3001/api/user-profile/peter_yong

# 测试推荐接口
curl -X POST http://localhost:3001/api/recommend \
  -H "Content-Type: application/json" \
  -d '{"userId": "peter_yong", "diners": 2}'
```

---

## 🔧 一键执行方案（推荐）

创建一个适用于 1Panel 的部署脚本：

```bash
# 在宿主机项目目录执行
cat > deploy_1panel.sh << 'EOF'
#!/bin/bash
set -e

echo "🍳 1Panel 环境部署脚本"
echo "======================================"

# 1. 备份数据库
echo "📦 备份数据库..."
mkdir -p backups
cp food-check.db backups/food-check.db.backup_$(date +%Y%m%d_%H%M%S)
echo "✅ 备份完成"

# 2. 拉取最新代码
echo "📥 更新代码..."
git pull
echo "✅ 代码已更新"

# 3. 重建容器（会自动安装依赖）
echo "🔄 重建容器..."
docker compose down
docker compose up -d --build
echo "✅ 容器已重建"

# 4. 等待容器启动
echo "⏳ 等待容器启动..."
sleep 5

# 5. 执行数据库迁移
echo "🔧 执行数据库迁移..."
docker compose exec -T app sh -c "cd server/scripts && node migrate_db.js"
echo "✅ 迁移完成"

echo ""
echo "🎉 部署完成！"
echo "验证: curl http://localhost:3001/api/user-profile/peter_yong"
EOF

chmod +x deploy_1panel.sh
./deploy_1panel.sh
```

---

## 🔍 故障排查

### 问题1: 找不到数据库文件

**检查数据卷挂载**:
```bash
# 查看容器挂载
docker compose config

# 查看实际挂载路径
docker inspect caipincheck-app-1 | grep -A 10 Mounts
```

**解决方案**:
确保 `docker-compose.yml` 中正确挂载了数据库：
```yaml
volumes:
  - ./food-check.db:/app/food-check.db
```

### 问题2: 容器内没有 node 命令

**进入容器检查**:
```bash
docker compose exec app which node
docker compose exec app npm --version
```

### 问题3: migrate_db.js 报错

**查看完整日志**:
```bash
docker compose exec app sh -c "cd server/scripts && node migrate_db.js" 2>&1 | tee migrate.log
```

---

## ✅ 验证清单

在容器内执行：
```bash
# 进入容器
docker compose exec app sh

# 验证数据库
sqlite3 food-check.db << EOF
.tables
SELECT COUNT(*) FROM user_profile;
SELECT COUNT(*) FROM base_recipes WHERE cuisine_type != '';
EOF

# 退出容器
exit
```

---

## 📞 快速帮助

**最简单的方式（手动操作）**:

1. **备份数据库**（在宿主机）
   ```bash
   cp food-check.db food-check.db.backup_$(date +%Y%m%d_%H%M%S)
   ```

2. **进入 1Panel 控制台**
   - 找到 caipincheck 应用
   - 点击 "终端" 进入容器

3. **在容器终端执行**
   ```bash
   cd server/scripts
   node migrate_db.js
   ```

4. **重建容器**
   - 在 1Panel 控制台点击 "重建"

5. **测试功能**
   - 访问应用，测试推荐功能

---

## 🔄 回滚方案

如果出现问题：
```bash
# 停止容器
docker compose down

# 恢复数据库
cp backups/food-check.db.backup_XXXXXX food-check.db

# 回退代码
git reset --hard <previous-commit>

# 重新启动
docker compose up -d
```
