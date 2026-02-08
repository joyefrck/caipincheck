# ⚡ 生产环境部署 - 快速参考

## 🎯 最快部署方式（推荐）

### 1. 进入项目目录

```bash
cd /path/to/caipincheck
```

### 2. 确保服务器代码真的是 GitHub 最新的

```bash
git pull origin main
```

### 第一步：彻底清洗旧缓存并重新构建镜像

```bash
docker compose build --no-cache
```

### 第二步：启动并替换旧容器

```bash
docker compose up -d
```

## 给菜谱打标签（AI 分析）

### 方式 A：交互运行（需保持窗口开启）

```bash
docker compose exec caipincheck npm run db:enrich
```

### 方式 B：后台运行（运行后可关闭窗口）

```bash
docker compose exec -d caipincheck node server/scripts/ai_enrich_recipes.js --yes
```
