import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";
import cron from "node-cron";
import dotenv from "dotenv";
import { getRecipeLinks, scrapeXianghaRecipe } from "./scrapers/xiangha.js";

// 加载环境变量
const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "../food-check.db");

// 加载环境变量
dotenv.config();
dotenv.config({ path: join(__dirname, "../.env.local") });

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// 初始化数据库
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Database connection error:", err.message);
  } else {
    console.log("Connected to the SQLite database.");
    initDb();
  }
});

function initDb() {
  db.serialize(() => {
    // 收藏菜谱表
    db.run(`CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      cuisine TEXT,
      diners INTEGER,
      nutritionInfo TEXT,
      tags TEXT,
      dishes TEXT,
      createdAt INTEGER
    )`);

    // 生成历史表
    db.run(`CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      cuisine TEXT,
      diners INTEGER,
      nutritionInfo TEXT,
      tags TEXT,
      dishes TEXT,
      createdAt INTEGER
    )`);

    // 基础菜谱库 (爬虫抓取)
    db.run(`CREATE TABLE IF NOT EXISTS base_recipes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source_url TEXT UNIQUE,
      ingredients TEXT,
      steps TEXT,
      tags TEXT,
      createdAt INTEGER
    )`);
  });
}

// --- 数据库初始化完成 ---

// --- AI 代理配置 ---
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || process.env.VITE_DEEPSEEK_API_KEY;

if (DEEPSEEK_API_KEY) {
    console.log("DeepSeek API Key loaded successfully.");
} else {
    console.warn("DeepSeek API Key NOT found in environment variables.");
}

// AI 代理路由
app.post('/api/ai/chat', async (req, res) => {
  if (!DEEPSEEK_API_KEY) {
    return res.status(500).json({ error: "服务器未配置 DEEPSEEK_API_KEY" });
  }

  // --- 基表优先匹配逻辑 ---
  const userMessage = req.body.messages?.find(m => m.role === 'user')?.content || "";
  const matchInput = userMessage.match(/综合需求：(.*?)(?:\n|$)/);
  const dishQuery = matchInput ? matchInput[1].trim() : "";

  if (dishQuery && dishQuery.length > 1) {
    const sql = `SELECT * FROM base_recipes WHERE title LIKE ? OR tags LIKE ? LIMIT 1`;
    const rows = await new Promise((resolve) => {
      db.all(sql, [`%${dishQuery}%`, `%${dishQuery}%`], (err, rows) => resolve(rows || []));
    });

    if (rows.length > 0) {
      const match = rows[0];
      console.log(`[Proxy] Found DB match for "${dishQuery}": ${match.title}`);
      
      const simulatedRecipe = {
        title: match.title,
        cuisine: "中餐 (实时库匹配)",
        dishes: [
          {
            name: match.title,
            ingredients: JSON.parse(match.ingredients),
            instructions: JSON.parse(match.steps)
          }
        ],
        nutritionInfo: "💡 该食谱匹配自香哈网真实数据库，为您提供地道的烹饪参考。",
        tags: JSON.parse(match.tags || "[]")
      };

      return res.json({
        choices: [
          {
            message: {
              content: JSON.stringify(simulatedRecipe)
            }
          }
        ]
      });
    }
  }

  // --- 如果没匹配到，走 AI 生成 ---
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        ...req.body,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("AI Proxy Error:", err);
    res.status(500).json({ error: "AI 代理请求失败" });
  }
});

// --- API 路由 ---

// 获取收藏菜谱 (支持分页)
app.get('/api/recipes', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  db.all('SELECT * FROM recipes ORDER BY createdAt DESC LIMIT ? OFFSET ?', [limit, offset], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags),
      dishes: JSON.parse(row.dishes)
    })));
  });
});

// 保存收藏菜谱
app.post('/api/recipes', (req, res) => {
  const { id, title, cuisine, diners, nutritionInfo, tags, dishes, createdAt } = req.body;
  const sql = `INSERT INTO recipes (id, title, cuisine, diners, nutritionInfo, tags, dishes, createdAt) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [id, title, cuisine, diners, nutritionInfo, JSON.stringify(tags), JSON.stringify(dishes), createdAt];
  
  db.run(sql, params, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});

// 获取历史记录
app.get('/api/history', (req, res) => {
  db.all('SELECT * FROM history ORDER BY createdAt DESC LIMIT 100', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags),
      dishes: JSON.parse(row.dishes)
    })));
  });
});

// 保存历史记录
app.post('/api/history', (req, res) => {
  const { id, title, cuisine, diners, nutritionInfo, tags, dishes, createdAt } = req.body;
  const sql = `INSERT INTO history (id, title, cuisine, diners, nutritionInfo, tags, dishes, createdAt) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [id, title, cuisine, diners, nutritionInfo, JSON.stringify(tags), JSON.stringify(dishes), createdAt];
  
  db.run(sql, params, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id });
  });
});

// 获取基础菜谱 (用于 AI 前置检索)
app.get('/api/base-recipes', (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);

  const sql = `SELECT * FROM base_recipes WHERE title LIKE ? LIMIT 5`;
  db.all(sql, [`%${query}%`], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(row => ({
      ...row,
      ingredients: JSON.parse(row.ingredients),
      steps: JSON.parse(row.steps),
      tags: JSON.parse(row.tags)
    })));
  });
});

// --- 爬虫控制与定时任务 ---

async function runScraper(limit = 10) {
    console.log(`Starting multi-category scraper task (target: ${limit} new recipes)...`);
    
    // 多品类与菜系入口
    const targets = [
        { name: "热菜", url: "https://www.xiangha.com/caipu/z-recai/" },
        { name: "凉菜", url: "https://www.xiangha.com/caipu/z-liangcai/" },
        { name: "汤羹", url: "https://www.xiangha.com/caipu/z-tanggeng/" },
        { name: "面食", url: "https://www.xiangha.com/caipu/z-mianshi/" },
        { name: "素菜", url: "https://www.xiangha.com/caipu/z-sucai/" },
        { name: "荤菜", url: "https://www.xiangha.com/caipu/z-huncai/" },
        { name: "海鲜", url: "https://www.xiangha.com/caipu/z-haixian/" },
        // 八大菜系
        { name: "川菜", url: "https://www.xiangha.com/caipu/x-chuancai/" },
        { name: "湘菜", url: "https://www.xiangha.com/caipu/x-xiangcai/" },
        { name: "粤菜", url: "https://www.xiangha.com/caipu/x-yuecai/" },
        { name: "鲁菜", url: "https://www.xiangha.com/caipu/x-lucai/" },
        { name: "苏菜", url: "https://www.xiangha.com/caipu/x-sucai/" },
        { name: "浙菜", url: "https://www.xiangha.com/caipu/x-zhecai/" },
        { name: "闽菜", url: "https://www.xiangha.com/caipu/x-mincai/" },
        { name: "徽菜", url: "https://www.xiangha.com/caipu/x-huicai/" }
    ];
    
    let addedCount = 0;
    let page = 1;
    const maxPages = 50; 

    while (addedCount < limit && page <= maxPages) {
        for (const target of targets) {
            if (addedCount >= limit) break;
            
            console.log(`Fetching ${target.name} page ${page}...`);
            const links = await getRecipeLinks(target.url, page);
            
            if (!links || links.length === 0) continue;

            for (const link of links) {
                if (addedCount >= limit) break;

                try {
                    const exists = await new Promise((resolve) => {
                        db.get(`SELECT 1 FROM base_recipes WHERE source_url = ?`, [link], (err, row) => resolve(!!row));
                    });

                    if (exists) continue;

                    // 间隔保护
                    await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 400));

                    const recipe = await scrapeXianghaRecipe(link);
                    if (recipe) {
                        // 注入菜系/品类标签
                        let tags = JSON.parse(recipe.tags);
                        if (!tags.includes(target.name)) tags.push(target.name);
                        recipe.tags = JSON.stringify(tags);

                        const sql = `INSERT OR IGNORE INTO base_recipes (id, title, source_url, ingredients, steps, tags, createdAt) 
                                     VALUES (?, ?, ?, ?, ?, ?, ?)`;
                        const params = [recipe.id, recipe.title, recipe.source_url, recipe.ingredients, recipe.steps, recipe.tags, recipe.createdAt];
                        
                        await new Promise((resolve, reject) => {
                            db.run(sql, params, (err) => err ? reject(err) : resolve());
                        });
                        
                        addedCount++;
                        if (addedCount % 10 === 0) {
                            console.log(`Progress: Added ${addedCount}/${limit} new recipes across categories.`);
                        }
                    }
                } catch (err) {
                    console.error(`Scraper error for ${link}:`, err.message);
                }
            }
        }
        page++;
    }
    console.log(`Multi-category scraper finished. Total added: ${addedCount}`);
}

// 每天凌晨 2 点运行
cron.schedule('0 2 * * *', () => {
    runScraper(500);
});

// 手动触发爬虫 (管理员接口)
app.post('/api/admin/scrape', async (req, res) => {
    const limit = req.body.limit || 10;
    runScraper(limit);
    res.json({ message: "Scraper started in background", limit });
});

// --- 静态资源托管 (仅用于生产环境) ---
const distPath = join(__dirname, "../dist");
app.use(express.static(distPath));

// 针对单页应用 (SPA) 的路由 (作为最后的中间件)
app.use((req, res) => {
  if (!req.path.startsWith('/api')) {
    const indexPath = join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send("API Endpoint not found. (Frontend build is missing, please run 'npm run build' or use dev server)");
    }
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running at http://0.0.0.0:${port}`);
});
