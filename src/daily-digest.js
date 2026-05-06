import { createClient } from "@supabase/supabase-js";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_TO_EMAIL = process.env.RESEND_TO_EMAIL;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const sources = [
  { name: "r/management", url: "https://www.reddit.com/r/management/.rss", format: "atom", articles: 2, headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS Reader)" } },
  { name: "r/leadership", url: "https://www.reddit.com/r/leadership/.rss", format: "atom", articles: 2, headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS Reader)" } },
  { name: "r/sales", url: "https://www.reddit.com/r/sales/.rss", format: "atom", articles: 2, headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS Reader)" } },
  { name: "r/InsuranceAgent", url: "https://www.reddit.com/r/InsuranceAgent/.rss", format: "atom", articles: 2, headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS Reader)" } },
  { name: "r/quotes", url: "https://www.reddit.com/r/quotes/.rss", format: "atom", articles: 2, headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS Reader)" } },
  { name: "Simon Sinek (YT)", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCPmfPl-BsCd3wmE8i45LAoA", format: "youtube", articles: 2 },
  { name: "Harvard Business Review (YT)", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCWo4IA01TXzBeGJJKWHOG9g", format: "youtube", articles: 2 },
  { name: "Valuetainment (YT)", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCIHdDJ0tjn_3j-FS7s_X1kQ", format: "youtube", articles: 2 },
  { name: "Brendon Burchard (YT)", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCySH3WVP-5d4aJIfn8-WoPA", format: "youtube", articles: 2 }
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
      const items = parseFeed(xml, source.format, source.name);
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

  const prompt = `你是一位拥有20年经验的资深企业培训顾问与教练技术专家，你的读者是一线培训导师和企业内训师。
请仔细阅读以下今日资讯的完整文章内容（以英文内容为主，请以培训价值为准筛选）。

${articleList}

请你完成以下任务：
1. 首先，过滤掉与培训授课、销售训练、领导力教练、团队赋能完全无关的内容。
2. 然后，围绕以下四个核心板块，撰写一篇《每日培训洞察》深度分析文章：

【板块一：培训与训练】提炼关于员工培训、销售训练、技能提升、学习型组织建设的最新方法和案例。每个案例须附"课堂应用建议"——培训导师明天上课就能用的具体操作。
【板块二：人寿保险销售】提炼人寿保险销售技巧、客户经营、保险团队管理相关的内容。附"销售教练话术"——培训导师可直接用于角色扮演训练的对话脚本。
【板块三：领导力】提炼关于领导力发展、团队激励、组织文化建设、管理者自我修炼的洞见。附"引导提问清单"——培训导师在领导力工作坊中可使用的开放式问题。
【板块四：今日金句】从所有文章中摘选3-5条最有启发的金句（中英文皆可），每条附一句话点评，说明可用于哪个培训场景。

输出要求：
- 格式：一篇完整的分析文章（HTML格式），不要输出"日报第X条"这样的列表格式
- 结构：四个板块各自独立成节，每个板块结合具体案例深入分析，对比不同来源的观点
- 重点：所有内容以"培训导师如何使用"为落脚点，给出可立即用于课堂的素材和方法
- 字数：4000-5500字
- 排版：使用<h2>、<p>、<ul>、<li>、<strong>等HTML标签，干净专业
- 引用原文观点时，保留原文链接
- 只输出HTML代码，不要任何额外解释`;

  let digestHtml = "";
  try {
    console.log("正在调用 DeepSeek API...");
    digestHtml = await callDeepSeek(prompt);
    console.log(`AI 返回 ${digestHtml.length} 字符`);
  } catch (e) {
    console.log("AI 处理失败:", e.message);
    digestHtml = "<p>抱歉，今天的 AI 总结生成失败，请检查模型运行状态。</p>";
  }

  // 通过 Resend 推送邮件
  if (RESEND_API_KEY && RESEND_TO_EMAIL) {
    try {
      console.log(`正在通过 Resend 发送邮件到 ${RESEND_TO_EMAIL}...`);
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: `每日培训洞察 <${RESEND_FROM_EMAIL}>`,
          to: [RESEND_TO_EMAIL],
          subject: "【每日培训洞察】今日培训智慧深度分析",
          html: digestHtml
        })
      });
      if (resendRes.ok) {
        console.log("Resend 邮件发送成功");
      } else {
        const errBody = await resendRes.text();
        console.log("Resend 发送失败:", resendRes.status, errBody);
      }
    } catch (e) {
      console.log("Resend 发送失败:", e.message);
    }
  }

  // 可选：存储到 Supabase
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      console.log("正在存储到 Supabase...");
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { error } = await supabase.from("daily_digests").insert({
        content: digestHtml,
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

function parseFeed(xmlText, format, sourceName) {
  if (format === "youtube") return parseYoutubeItems(xmlText, sourceName);
  return format === "atom" ? parseAtomItems(xmlText, sourceName) : parseRSSItems(xmlText, sourceName);
}

function parseRSSItems(xmlText, sourceName) {
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
        source: sourceName,
        description: desc ? stripHtml(desc).slice(0, 3000) : ''
      });
    }
  }
  return items;
}

function parseAtomItems(xmlText, sourceName) {
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
        source: sourceName,
        description: content ? stripHtml(content).slice(0, 1500) : title
      });
    }
  }
  return items;
}

function parseYoutubeItems(xmlText, sourceName) {
  const items = [];
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = entryRegex.exec(xmlText)) !== null) {
    const entryContent = match[1];
    const title = extractTagContent(entryContent, 'title');
    const link = extractAtomLink(entryContent);
    const desc = extractMediaDescription(entryContent);
    if (title && link) {
      items.push({
        title,
        link,
        source: sourceName,
        description: desc ? stripHtml(desc).slice(0, 1500) : title
      });
    }
  }
  return items;
}

function extractMediaDescription(xml) {
  const match = /<media:description[^>]*>([\s\S]*?)<\/media:description>/i.exec(xml);
  if (!match) return null;
  return match[1].trim();
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
