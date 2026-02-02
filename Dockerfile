# 使用 Node.js 20 作为基础镜像
FROM node:20-slim AS builder

WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制源代码
COPY . .

# 构建前端静态文件
RUN npm run build

# 运行阶段
FROM node:20-slim

WORKDIR /app

# 复制后端依赖描述
COPY package*.json ./

# 仅安装生产环境依赖
RUN npm install --production

# 安装 sqlite3 工具（用于数据库管理和迁移）
RUN apt-get update && apt-get install -y sqlite3 && rm -rf /var/lib/apt/lists/*

# 从构建阶段复制构建好的静态文件和后端代码
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/types.ts ./types.ts

# 暴露后端端口
EXPOSE 3001

# 启动后端服务
CMD ["node", "server/index.js"]
