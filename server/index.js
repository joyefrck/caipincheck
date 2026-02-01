import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "../food-check.db");

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
  });
}

// --- 静态资源托管 (仅用于生产环境) ---
const distPath = join(__dirname, "../dist");
app.use(express.static(distPath));

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

// 针对单页应用 (SPA) 的路由
app.get('/*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(join(distPath, 'index.html'));
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running at http://0.0.0.0:${port}`);
});
