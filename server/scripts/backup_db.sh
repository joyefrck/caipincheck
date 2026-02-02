#!/bin/bash

# 数据库备份脚本
# 用法: ./backup_db.sh

# 设置颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 数据库路径
DB_PATH="../food-check.db"
BACKUP_DIR="../backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/food-check.db.backup_${TIMESTAMP}"

echo -e "${YELLOW}🔧 开始数据库备份...${NC}"

# 创建备份目录（如果不存在）
mkdir -p "$BACKUP_DIR"

# 检查数据库文件是否存在
if [ ! -f "$DB_PATH" ]; then
    echo -e "${RED}❌ 错误：数据库文件不存在: $DB_PATH${NC}"
    exit 1
fi

# 执行备份
cp "$DB_PATH" "$BACKUP_FILE"

# 验证备份文件
if [ -f "$BACKUP_FILE" ]; then
    ORIGINAL_SIZE=$(stat -f%z "$DB_PATH" 2>/dev/null || stat -c%s "$DB_PATH" 2>/dev/null)
    BACKUP_SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null)
    
    if [ "$ORIGINAL_SIZE" -eq "$BACKUP_SIZE" ]; then
        echo -e "${GREEN}✅ 备份成功！${NC}"
        echo -e "${GREEN}   原始文件大小: $(numfmt --to=iec-i --suffix=B $ORIGINAL_SIZE 2>/dev/null || echo ${ORIGINAL_SIZE} bytes)${NC}"
        echo -e "${GREEN}   备份文件位置: $BACKUP_FILE${NC}"
        
        # 清理超过30天的旧备份
        find "$BACKUP_DIR" -name "food-check.db.backup_*" -mtime +30 -delete
        echo -e "${YELLOW}🧹 已清理超过30天的旧备份${NC}"
    else
        echo -e "${RED}❌ 错误：备份文件大小不匹配${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ 错误：备份文件创建失败${NC}"
    exit 1
fi
