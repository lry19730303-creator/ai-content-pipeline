import { createClient } from "@supabase/supabase-js";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const PUSHPLUS_TOKEN = process.env.PUSHPLUS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const sources = [
  { name: "36氪", url: "https://36kr.com/feed", format: "rss", articles: 5 },
  { name: "r/management", url: "https://www.reddit.com/r/management/.rss", format: "atom", articles: 3, headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS Reader)" } },
  { name: "r/leadership", url: "https://www.reddit.com/r/leadership/.rss", format: "atom", articles: 3, headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS Reader)" } }
];

async function main() {
  console.log("=== 每日管理洞察 Pipeline 开始 ===");
  console.log(new Date().toISOString());

  const allArticles = [];

  for (const source of sources) {
    try {
      console.log(`正在获取: ${source.name}`);
      const fetchOpts = source.headers ? { headers: source.headers } : {};
      const res = await fetch(source.url, fetchOpts);
      if (!res.ok) {
        console.log(`获取失败: ${source.name} HTTP ${res.status}`);
        continue;
      }
      const xml = await res.text();
      const items = parseFeed(xml, source.format);
      console.log(`  → 解析到 ${items.length} 篇文章`);

      if (items.length > 0) {
        allArticles.push(...items.slice(0, source.articles));
      }
    } catch (e) {
      console.log(`抓取失败: ${source.name} — ${e.message}`);
    }
  }

  if (allArticles.length === 0) {
    console.log("未获取到任何文章，退出");
    return;
  }

  console.log(`共获取 ${allArticles.length} 篇文章`);

  const articleList = allArticles
    .map((a, i) => `[文章${i + 1} · ${a.source}]\n标题：${a.title}\n链接：${a.link}\n正文：${a.description}`)
    .join('\n\n---\n\n');

  const prompt = `你是一位拥有20年经验的跨国公司CEO兼资深商业管理专家。
请仔细阅读以下今日资讯的完整文章内容（中英文混合，请以内容质量为准，不要考虑语言）。

${articleList}

请你完成以下任务：
1. 首先，过滤掉与管理学、商业管理、团队领导力完全无关的内容（如纯娱乐八卦、纯技术教程、体育赛事等）。英文内容同样适用此规则。
2. 然后，针对管理相关的内容，撰写一篇《每日管理洞察》深度分析文章。

输出要求：
- 格式：一篇完整的分析文章（HTML格式），不要输出"日报第X条"这样的列表格式
- 结构：提炼5-6个今日核心管理议题，结合文章中提到的具体案例进行深入分析，对比不同来源的观点
- 重点：给出可直接用于团队管理的实操建议和行动指南，越具体越好
- 字数：4000-5500字
- 排版：使用<h2>、<p>、<ul>、<li>、<strong>等HTML标签，干净专业
- 引用原文观点时，保留原文链接
- 只输出HTML代码，不要任何额外解释`;

  let emailHtml = "";
  try {
    console.log("正在调用 DeepSeek API...");
    emailHtml = await callDeepSeek(prompt);
    console.log(`AI 返回 ${emailHtml.length} 字符`);
  } catch (e) {
    console.log("AI 处理失败:", e.message);
    emailHtml = "<p>抱歉，今天的 AI 总结生成失败，请检查模型运行状态。</p>";
  }

  // 推送到微信 (PushPlus)
  try {
    console.log("正在推送到微信...");
    const pushRes = await fetch("http://www.pushplus.plus/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: PUSHPLUS_TOKEN,
        title: "【每日管理洞察】今日管理智慧深度分析",
        content: emailHtml,
        template: "html"
      })
    });
    const result = await pushRes.json();
    console.log("微信推送结果:", JSON.stringify(result, null, 2));
  } catch (e) {
    console.log("微信推送失败:", e.message);
  }

  // 可选：存储到 Supabase
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      console.log("正在存储到 Supabase...");
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { error } = await supabase.from("daily_digests").insert({
        content: emailHtml,
        article_count: allArticles.length,
        created_at: new Date().toISOString()
      });
      if (error) console.log("Supabase 存储失败:", error.message);
      else console.log("已存储到 Supabase");
    } catch (e) {
      console.log("Supabase 存储失败:", e.message);
    }
  }

  console.log("=== Pipeline 完成 ===");
}

async function callDeepSeek(prompt) {
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
      temperature: 0.7
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data.choices[0].message.content;
  return content.replace(/```html|```/g, '');
}

// --- RSS/Atom Parsing ---

function parseFeed(xmlText, format) {
  return format === "atom" ? parseAtomItems(xmlText) : parseRSSItems(xmlText);
}

function parseRSSItems(xmlText) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemContent = match[1];
    const title = extractTagContent(itemContent, 'title');
    const link = extractTagContent(itemContent, 'link');
    const desc = extractTagContent(itemContent, 'description');
    if (title && link) {
      items.push({
        title,
        link,
        source: "36氪",
        description: desc ? stripHtml(desc).slice(0, 3000) : ''
      });
    }
  }
  return items;
}

function parseAtomItems(xmlText) {
  const items = [];
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = entryRegex.exec(xmlText)) !== null) {
    const entryContent = match[1];
    const title = extractTagContent(entryContent, 'title');
    const link = extractAtomLink(entryContent);
    const content = extractAtomContent(entryContent);
    if (title && link) {
      items.push({
        title,
        link,
        source: "Reddit",
        description: content ? stripHtml(content).slice(0, 1500) : title
      });
    }
  }
  return items;
}

function extractAtomLink(xml) {
  const regex = /<link[^>]*href="([^"]*)"[^>]*\/>/i;
  const match = regex.exec(xml);
  return match ? match[1] : null;
}

function extractAtomContent(xml) {
  const match = /<content[^>]*>([\s\S]*?)<\/content>/i.exec(xml);
  if (!match) return null;
  let text = match[1];
  const divMatch = /<div class="md">([\s\S]*?)<\/div>/i.exec(text);
  if (divMatch) text = divMatch[1];
  return text.trim();
}

function extractTagContent(xml, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = regex.exec(xml);
  if (!match) return null;
  let text = match[1].trim();
  const cdataMatch = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(text);
  if (cdataMatch) text = cdataMatch[1].trim();
  return text;
}

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

main().catch(e => {
  console.error("Pipeline 崩溃:", e);
  process.exit(1);
});
