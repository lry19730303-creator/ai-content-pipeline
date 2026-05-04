export default {
  async scheduled(event, env, ctx) {
    const sources = [
      { name: "36氪", url: "https://36kr.com/feed", format: "rss", articles: 5 },
      { name: "r/management", url: "https://www.reddit.com/r/management/.rss", format: "atom", articles: 3, headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS Reader)" } },
      { name: "r/leadership", url: "https://www.reddit.com/r/leadership/.rss", format: "atom", articles: 3, headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS Reader)" } }
    ];

    let allArticles = [];

    for (let source of sources) {
      try {
        const fetchOpts = source.headers ? { headers: source.headers } : {};
        const res = await fetch(source.url, fetchOpts);
        const xml = await res.text();
        const items = parseFeed(xml, source.format);

        if (items && items.length > 0) {
          allArticles = allArticles.concat(items.slice(0, source.articles));
        } else {
          console.log("未解析到文章:", source.name);
        }
      } catch (e) {
        console.log("抓取失败:", source.name, e.message);
      }
    }

    if (allArticles.length === 0) return;

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
      const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2048
      });
      emailHtml = aiResponse.response.replace(/```html|```/g, '');
    } catch (e) {
      console.log("AI 处理失败:", e);
      emailHtml = "<p>抱歉，今天的 AI 总结生成失败，请检查模型运行状态。</p>";
    }

    try {
      const pushRes = await fetch("http://www.pushplus.plus/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: env.PUSHPLUS_TOKEN,
          title: "【每日管理洞察】今日管理智慧深度分析",
          content: emailHtml,
          template: "html"
        })
      });

      console.log("微信推送结果:", await pushRes.json());
    } catch (e) {
      console.log("微信推送失败:", e);
    }
  }
};

function parseFeed(xmlText, format) {
  const items = format === "atom" ? parseAtomItems(xmlText) : parseRSSItems(xmlText);
  return items;
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
