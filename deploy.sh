#!/bin/bash

# 🚀 生产环境一键部署脚本
# 用于食谱模型进化重大更新

set -e  # 遇到错误立即退出

echo "════════════════════════════════════════════════"
echo "  🍳 蔡品检 - 生产环境部署脚本"
echo "  食谱模型进化重大更新"
echo "════════════════════════════════════════════════"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

cd "$PROJECT_ROOT"

echo -e "${BLUE}📂 项目目录: $PROJECT_ROOT${NC}"
echo ""

# ========================================
# 步骤 1: 备份数据库
# ========================================
echo -e "${YELLOW}📦 步骤 1/6: 备份数据库${NC}"

if [ ! -f "food-check.db" ]; then
    echo -e "${RED}❌ 错误: 找不到数据库文件 food-check.db${NC}"
    exit 1
fi

mkdir -p backups
BACKUP_FILE="backups/food-check.db.backup_$(date +%Y%m%d_%H%M%S)"
cp food-check.db "$BACKUP_FILE"

if [ -f "$BACKUP_FILE" ]; then
    echo -e "${GREEN}✅ 数据库已备份到: $BACKUP_FILE${NC}"
else
    echo -e "${RED}❌ 备份失败！${NC}"
    exit 1
fi
echo ""

# ========================================
# 步骤 2: 拉取代码（跳过，由用户手动完成）
# ========================================
echo -e "${YELLOW}📥 步骤 2/6: 代码更新${NC}"
echo -e "${BLUE}ℹ️  请确认已执行 'git pull' 拉取最新代码${NC}"
read -p "是否已完成代码更新？(y/N): " code_updated

if [[ ! "$code_updated" =~ ^[Yy]$ ]]; then
    echo -e "${RED}❌ 请先更新代码后重新运行此脚本${NC}"
    exit 1
fi
echo ""

# ========================================
# 步骤 3: 安装依赖
# ========================================
echo -e "${YELLOW}📦 步骤 3/6: 安装依赖${NC}"
npm install
echo -e "${GREEN}✅ 依赖安装完成${NC}"
echo ""

# ========================================
# 步骤 4: 数据库迁移
# ========================================
echo -e "${YELLOW}🔧 步骤 4/6: 执行数据库迁移${NC}"
cd server/scripts
node migrate_db.js

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ 数据库迁移成功${NC}"
else
    echo -e "${RED}❌ 数据库迁移失败！请检查日志${NC}"
    echo -e "${YELLOW}💡 提示: 可以尝试恢复备份: cp $BACKUP_FILE food-check.db${NC}"
    exit 1
fi
cd "$PROJECT_ROOT"
echo ""

# ========================================
# 步骤 5: 构建前端（可选）
# ========================================
echo -e "${YELLOW}🏗️  步骤 5/6: 构建前端（可选）${NC}"
read -p "是否需要重新构建前端？(y/N): " build_frontend

if [[ "$build_frontend" =~ ^[Yy]$ ]]; then
    npm run build
    echo -e "${GREEN}✅ 前端构建完成${NC}"
else
    echo -e "${BLUE}ℹ️  跳过前端构建${NC}"
fi
echo ""

# ========================================
# 步骤 6: 重启服务
# ========================================
echo -e "${YELLOW}🔄 步骤 6/6: 重启服务${NC}"

# 检测部署方式
if [ -f "docker-compose.yml" ]; then
    echo -e "${BLUE}检测到 Docker Compose 部署${NC}"
    read -p "是否重启 Docker 服务？(y/N): " restart_docker
    
    if [[ "$restart_docker" =~ ^[Yy]$ ]]; then
        docker compose down
        docker compose up -d --build
        echo -e "${GREEN}✅ Docker 服务已重启${NC}"
    fi
elif command -v pm2 &> /dev/null; then
    echo -e "${BLUE}检测到 PM2 部署${NC}"
    read -p "是否重启 PM2 服务？(y/N): " restart_pm2
    
    if [[ "$restart_pm2" =~ ^[Yy]$ ]]; then
        pm2 restart all
        echo -e "${GREEN}✅ PM2 服务已重启${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  未检测到 Docker 或 PM2，请手动重启服务${NC}"
fi
echo ""

# ========================================
# 完成
# ========================================
echo ""
echo "════════════════════════════════════════════════"
echo -e "  ${GREEN}🎉 部署完成！${NC}"
echo "════════════════════════════════════════════════"
echo ""
echo "📊 部署摘要:"
echo "   - 数据库备份: $BACKUP_FILE"
echo "   - 迁移状态: 成功"
echo "   - 服务状态: 已重启"
echo ""
echo "🔍 验证步骤:"
echo "   1. 访问应用: http://your-domain"
echo "   2. 测试 API: curl http://localhost:3001/api/user-profile/peter_yong"
echo "   3. 测试推荐: 使用\"主厨今日特供\"功能"
echo ""
echo "📚 更多信息:"
echo "   - 部署指南: ./DEPLOYMENT_GUIDE.md"
echo "   - 用户画像: ./user_profile_design.md"
echo "   - 推荐算法: ./recommendation_algorithm.md"
echo ""
echo -e "${GREEN}✅ 部署脚本执行成功！${NC}"
