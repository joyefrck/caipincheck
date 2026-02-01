<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1oeX4Gq8D18ukOmmXs8VvC_A-GhdmD43U

## 生产环境部署 (Docker)

如果你想通过 Docker 部署应用，请确保已安装 Docker 和 Docker Compose。

1. **设置 API Key**:
   在当前目录创建 `.env` 文件并添加：
   ```env
   GEMINI_API_KEY=你的API_KEY
   ```

2. **启动服务**:
   ```bash
   docker-compose up -d --build
   ```

3. **访问应用**:
   打开浏览器访问 `http://localhost:3001`

---

## 提交到 GitHub

1. 初始化仓库：
   ```bash
   git init
   git add .
   git commit -m "chore: initial commit with docker support"
   ```

2. 关联远程仓库：
   ```bash
   git remote add origin https://github.com/joyefrck/caipincheck.git
   git branch -M main
   git push -u origin main
   ```
