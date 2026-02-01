
## 生产环境部署 (1Panel / Docker)

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
- **测试抓取**: 部署后可访问 `/api/admin/scrape` 手动触发测试抓取。

- **查询菜谱数量**：打开容器终端，执行 `node -e "const db = new (require('sqlite3').Database)('./food-check.db'); db.get('SELECT count(*) as total FROM base_recipes', (err, row) => { console.log('当前菜谱总数:', row.total); db.close(); });"`

