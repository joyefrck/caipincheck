# ⚡ 生产环境部署 - 快速参考

## 🎯 最快部署方式（推荐）

# 1. 进入项目目录
cd /path/to/caipincheck

# 2.# 1. 确保服务器代码真的是 GitHub 最新的
git pull origin main

# 第一步：彻底清洗旧缓存并重新构建镜像
docker compose build --no-cache

# 第二步：启动并替换旧容器
docker compose up -d