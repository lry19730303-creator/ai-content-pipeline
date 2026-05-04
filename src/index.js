export default {
  async scheduled(event, env, ctx) {
    const sources = [
      { name: "36氪", url: "https://36kr.com/feed", format: "rss", articles: 4 },
      { name: "r/management", url: "https://www.reddit.com/r/management/.rss", format: "atom", articles: 2, headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS Reader)" } },
      { name: "r/leadership", url: "https://www.reddit.com/r/leadership/.rss", format: "atom", articles: 2, headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS Reader)" } },
      { name: "r/sales", url: "https://www.reddit.com/r/sales/.rss", format: "atom", articles: 2, headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS Reader)" } },
      { name: "r/InsuranceAgent", url: "https://www.reddit.com/r/InsuranceAgent/.rss", format: "atom", articles: 2, headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS Reader)" } },
      { name: "r/quotes", url: "https://www.reddit.com/r/quotes/.rss", format: "atom", articles: 2, headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS Reader)" } }
    ];

    let allArticles = [];

    for (let source of sources) {
      try {
        const fetchOpts = source.headers ? { headers: source.headers } : {};
        const res = await fetch(source.url, fetchOpts);
        const xml = await res.text();
        const items = parseFeed(xml, source.format, source.name);

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
1. 首先，过滤掉完全无关的低质量内容。
2. 然后，围绕以下四个核心板块，撰写一篇《每日管理洞察》深度分析文章：

【板块一：培训与训练】提炼关于员工培训、销售训练、技能提升、学习型组织建设的最新方法和案例。
【板块二：人寿保险销售】提炼人寿保险销售技巧、客户经营、保险团队管理相关的内容。
【板块三：领导力】提炼关于领导力发展、团队激励、组织文化建设、管理者自我修炼的洞见。
【板块四：今日金句】从所有文章中摘选3-5条最有启发的金句（中英文皆可），每条附一句话点评。

输出要求：
- 格式：一篇完整的分析文章（HTML格式），不要输出"日报第X条"这样的列表格式
- 结构：四个板块各自独立成节，每个板块结合具体案例深入分析，对比不同来源的观点
- 重点：每个板块都要给出可直接落地执行的实操建议
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

function parseFeed(xmlText, format, sourceName) {
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
