import axios from 'axios';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';

export async function scrapeXianghaRecipe(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });
    const $ = cheerio.load(response.data);

    const title = $('h2.dish-title').text().trim() || $('h1').text().trim();
    
    const ingredients = [];
    $('.rec_ing table tr td .cell').each((i, el) => {
      const amountEl = $(el).find('span');
      const amount = amountEl.text().trim();
      
      // 提取名称：优先寻找链接，并移除其中所有子标签（如 span）以获得纯食材名
      let nameEl = $(el).find('a.link');
      if (nameEl.length === 0) nameEl = $(el);
      
      let name = nameEl.clone().children().remove().end().text().trim();
      
      // 清理可能的干扰文字
      name = name.replace('相克食物', '').trim();
      
      if (name) {
        ingredients.push({ name, amount });
      }
    });

    const steps = [];
    $('#CookbookMake li p').each((i, el) => {
        const desc = $(el).text().trim();
        if (desc) {
            steps.push({ step: i + 1, description: desc });
        }
    });

    const tags = [];
    $('.rec_hea p').text().split(/\s+/).forEach(tag => {
        if (tag.trim()) tags.push(tag.trim());
    });
    // 补充面包屑中的分类作为标签
    $('.breadcrumb-nav a').each((i, el) => {
        const tag = $(el).text().trim();
        if (tag && tag !== '首页' && tag !== '菜谱' && !tags.includes(tag)) {
            tags.push(tag);
        }
    });

    return {
      id: uuidv4(),
      title,
      source_url: url,
      ingredients: JSON.stringify(ingredients),
      steps: JSON.stringify(steps),
      tags: JSON.stringify(tags),
      createdAt: Date.now()
    };
  } catch (error) {
    console.error(`Error scraping ${url}:`, error.message);
    return null;
  }
}

export async function getRecipeLinks(baseUrl, page = 1) {
    try {
        const pageUrl = page > 1 ? `${baseUrl}hot-${page}/` : baseUrl;
        const response = await axios.get(pageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });
        const $ = cheerio.load(response.data);
        const links = [];
        $('a.pic').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.startsWith('https://www.xiangha.com/caipu/')) {
                links.push(href);
            }
        });
        return [...new Set(links)]; // deduplicate
    } catch (error) {
        console.error(`Error getting links from ${pageUrl}:`, error.message);
        return [];
    }
}
