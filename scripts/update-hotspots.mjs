import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const CATEGORIES = ["金融", "科技", "民生", "AI", "教育"];
const HISTORY_PATH = "scripts/hotspot-history.json";
const SOURCE_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/json,text/plain,*/*",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
};

function beijingIsoString(date = new Date()) {
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);

  return `${formatted.replace(" ", "T")}+08:00`;
}

function beijingDisplayString(date = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/\//g, "-");
}

function safeJsonString(raw) {
  if (!raw) return "";
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch {
    return raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
  }
}

function cleanTitle(title) {
  return String(title || "")
    .replace(/\s+/g, " ")
    .replace(/[ \t]*(热|新|荐|沸|爆)$/u, "")
    .trim();
}

function searchKeywords(title) {
  return cleanTitle(title)
    .replace(/[“”"']/g, "")
    .replace(/[：:，,。！？!?#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recommendedSearchKeywords(title, desc = "") {
  const clean = searchKeywords(title)
    .replace(/^(官方通报|最新通报|多地|多家|专家称|媒体评|网传|曝)\s*/u, "")
    .replace(/\s*(引发关注|引发讨论|冲上热搜|上热搜|热议)$/u, "")
    .trim();
  if (clean.length <= 18) return clean;

  const quoted = title.match(/[“"]([^”"]{4,24})[”"]/);
  if (quoted?.[1]) return searchKeywords(quoted[1]);

  const numbers = clean.match(/[0-9]+(?:\.[0-9]+)?(?:万|亿|%|人|元|岁|级|个|名|家)?/g) || [];
  const entities = clean.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,}(?:银行|公司|集团|大学|学校|医院|城市|村|村庄|车企|基金|股票|利率|补贴|政策|工程|套餐|事故|地震|癌|就业|养老|医保|港交所|IPO|AI|Token)/g) || [];
  const descEntities = desc.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,}(?:银行|公司|集团|大学|学校|医院|城市|村|村庄|车企|基金|股票|利率|补贴|政策|工程|套餐|事故|地震|癌|就业|养老|医保|港交所|IPO|AI|Token)/g) || [];
  const pieces = [...entities, ...numbers, ...descEntities]
    .map((item) => searchKeywords(item))
    .filter(Boolean);
  const unique = Array.from(new Set(pieces)).slice(0, 4);
  if (unique.join(" ").length >= 6) return unique.join(" ");
  return clean.slice(0, 28);
}

function normalizeKey(title) {
  return searchKeywords(title).replace(/[^\p{Script=Han}\p{Letter}\p{Number}]/gu, "").toLowerCase();
}

function stableHash(text) {
  let hash = 5381;
  for (const char of text) hash = (hash * 33) ^ char.codePointAt(0);
  return (hash >>> 0).toString(36);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, {
    headers: { ...SOURCE_HEADERS, ...headers },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchBaiduHot() {
  const url = "https://top.baidu.com/board?tab=realtime";
  const html = await fetchText(url);
  const rows = [];
  const objectPattern =
    /"appUrl":"(?<url>(?:\\.|[^"])*)","desc":"(?<desc>(?:\\.|[^"])*)","hotChange":"(?<trend>[^"]*)","hotScore":"(?<score>\d+)"[\s\S]{0,1000}?"word":"(?<title>(?:\\.|[^"])*)"/g;

  for (const match of html.matchAll(objectPattern)) {
    const title = cleanTitle(safeJsonString(match.groups.title));
    if (!title) continue;
    rows.push({
      title,
      desc: safeJsonString(match.groups.desc),
      score: Number(match.groups.score) || 0,
      trend: match.groups.trend,
      source: "百度",
      url: safeJsonString(match.groups.url).replace(/\\u0026/g, "&"),
    });
  }

  return rows;
}

async function fetchToutiaoHot() {
  const url = "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc";
  const text = await fetchText(url, { referer: "https://www.toutiao.com/" });
  const json = JSON.parse(text);
  return (json.data || [])
    .map((row) => ({
      title: cleanTitle(row.Title || row.QueryWord),
      desc: row.Abstract || row.LabelDesc || "",
      score: Number(row.HotValue) || 0,
      source: "今日头条",
      url: row.Url || `https://so.toutiao.com/search?keyword=${encodeURIComponent(row.QueryWord || row.Title || "")}`,
      imageUrl: row.Image?.url || "",
      tags: row.InterestCategory || [],
      trend: row.Label === "new" ? "up" : "same",
    }))
    .filter((row) => row.title);
}

async function fetchWeiboHot() {
  const endpoints = [
    "https://weibo.com/ajax/side/hotSearch",
    "https://weibo.com/ajax/statuses/hot_band",
  ];
  for (const url of endpoints) {
    try {
      const text = await fetchText(url, { referer: "https://weibo.com/" });
      const json = JSON.parse(text);
      const list = json.data?.realtime || json.data?.band_list || json.data || [];
      if (!Array.isArray(list) || !list.length) continue;
      return list
        .map((row) => {
          const title = cleanTitle(row.word || row.note || row.title || row.word_scheme);
          return {
            title,
            desc: row.desc || row.word || "",
            score: Number(row.num || row.raw_hot || row.hot || 0),
            source: "微博",
            url: `https://s.weibo.com/weibo?q=${encodeURIComponent(title)}`,
            trend: row.is_new ? "up" : "same",
          };
        })
        .filter((row) => row.title);
    } catch {
      // Weibo often requires visitor verification. Keep it best-effort.
    }
  }
  return [];
}

function loadSeedHotspots() {
  try {
    return JSON.parse(readFileSync("scripts/fallback-hotspots.json", "utf8"));
  } catch {
    try {
      const source = readFileSync("data.js", "utf8");
      const context = { window: {} };
      vm.createContext(context);
      vm.runInContext(source, context, { timeout: 1000 });
      return Array.isArray(context.window.HOTSPOTS) ? context.window.HOTSPOTS : [];
    } catch {
      return [];
    }
  }
}

function loadHistory() {
  try {
    return JSON.parse(readFileSync(HISTORY_PATH, "utf8"));
  } catch {
    return { topics: {}, lastUpdatedAt: "", stats: { new: 0, continued: 0, dropped: 0 } };
  }
}

function writeHistory(history) {
  writeFileSync(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

function dateKey(value) {
  return String(value || "").slice(0, 10);
}

function daysBetween(fromDate, toDate) {
  const from = new Date(`${dateKey(fromDate)}T00:00:00+08:00`).getTime();
  const to = new Date(`${dateKey(toDate)}T00:00:00+08:00`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86400000));
}

function classifyTopic(item) {
  const text = `${item.title} ${item.desc || ""} ${(item.tags || []).join(" ")}`.toLowerCase();
  const scores = {
    AI: scoreMatches(text, [
      [/ai|人工智能|大模型|deepseek|openai|豆包|智能体|算力|生成式|aigc/i, 8],
      [/模型|机器人|自动化|智能|算法|算力|提示词/i, 4],
    ]),
    金融: scoreMatches(text, [
      [/银行|存款|利率|贷款|房贷|央行|股市|a股|港股|港交所|上市|募资|基金|保险|理财|金融|经济|gdp|汇率|楼市|房价|资产/i, 8],
      [/消费券|补贴|以旧换新|工资|收入|价格|税|债|公司|企业/i, 4],
    ]),
    教育: scoreMatches(text, [
      [/高考|中考|考研|考公|学校|中小学|招生|录取|毕业|就业|老师|学生|家长|课后|作业|教育|培训|竞赛/i, 8],
      [/论文|课堂|校园|学区|幼儿园|职业|实习|高校|大学生/i, 4],
    ]),
    科技: scoreMatches(text, [
      [/手机|芯片|半导体|新能源|汽车|机器人|航天|卫星|工程|技术|互联网|数据|电池|供应链|发布会|无人驾驶|低空经济/i, 8],
      [/产品|系统|平台|软件|硬件|电商|车企|智驾/i, 4],
    ]),
    民生: scoreMatches(text, [
      [/养老|医疗|医院|医保|社保|地震|暴雨|天气|交通|火车|食品|健康|消费|住房|社区|工资|工人|游客|安全|警方|官方通报|使馆|公民|白发|衰老|压力|医生|症状|癌|疾病/i, 8],
      [/儿童|老人|家庭|居民|城市|村庄|救援|事故|服务|价格|出行|研究显示/i, 4],
    ]),
  };
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return ranked[0][1] > 0 ? ranked[0][0] : "民生";
}

function scoreMatches(text, rules) {
  return rules.reduce((total, [pattern, weight]) => total + (pattern.test(text) ? weight : 0), 0);
}

function isLowValueTopic(item) {
  const text = `${item.title} ${item.desc || ""} ${(item.tags || []).join(" ")}`;
  const hasUsefulSignal =
    /政策|官方|通报|回应|数据|价格|利率|银行|教育|学校|学生|就业|AI|人工智能|手机|芯片|汽车|新能源|医疗|养老|社保|医保|交通|安全|地震|暴雨|工人|公民|消费者|补贴|住房|社区/i.test(text);
  const hasChinaPublicSignal =
    /中国|国内|大陆|香港|港交所|A股|人民币|央行|中使馆|中国公民|中国企业|中方|城市|省|市|县|村|居民|消费者|学生|家长|工人/i.test(text);
  const pureEntertainment =
    /明星|演员|歌手|网红|恋情|分手|结婚|离婚|综艺|电影|电视剧|演唱会|粉丝|八卦|红毯|男团|女团/i.test(text) &&
    !hasUsefulSignal;
  const pureSports =
    /夺冠|冠军|比赛|球员|球队|足球|篮球|nba|中超|网球|羽毛球|乒乓球|赛事|教练/i.test(text) &&
    !/体育产业|校园|学生|事故|安全|经济|门票|消费|未成年人/i.test(text);
  const pureNovelty =
    /表情包|穿搭|同款|路透|颜值|热梗|整活|晒照|舞台/i.test(text) &&
    !hasUsefulSignal;
  const pureCultureOrPropaganda =
    /总书记|文物故事|博物馆日|文化遗产|理论学习|主题教育/i.test(text) &&
    !/政策|消费|旅游|安全|教育改革|公共服务|补贴|就业|民生/i.test(text);
  const pureInternational =
    /伊朗|以色列|美国|俄罗斯|乌克兰|菲律宾|日本|韩国|特朗普|拜登|总统|最高领袖|战争|军方|导弹|袭击/i.test(text) &&
    !hasChinaPublicSignal &&
    !/贸易|关税|汇率|股市|供应链|芯片|能源|油价/i.test(text);
  const hardToExplainByTitle =
    text.length <= 16 &&
    !hasUsefulSignal &&
    !/[0-9]|政策|通报|回应|下调|上涨|下降|发布|上线|补贴|就业|事故|地震|暴雨|癌|利率|银行|AI/i.test(text);
  return pureEntertainment || pureSports || pureNovelty || pureCultureOrPropaganda || pureInternational || hardToExplainByTitle;
}

function trendText(trend) {
  if (trend === "up" || trend === "rise") return "上升";
  if (trend === "down" || trend === "fall") return "下降";
  return "持平";
}

function mergeByTitle(rows) {
  const map = new Map();
  rows.forEach((row, index) => {
    const key = normalizeKey(row.title);
    if (!key) return;
    const existing = map.get(key);
    if (existing) {
      existing.platforms = Array.from(new Set([...existing.platforms, row.source]));
      existing.sources.push(row);
      existing.score += row.score || 0;
      if (!existing.desc && row.desc) existing.desc = row.desc;
      if (!existing.imageUrl && row.imageUrl) existing.imageUrl = row.imageUrl;
      existing.bestRank = Math.min(existing.bestRank, index + 1);
      return;
    }
    map.set(key, {
      ...row,
      platforms: [row.source],
      sources: [row],
      score: row.score || 0,
      bestRank: index + 1,
    });
  });
  return Array.from(map.values());
}

function sourceReferences(item) {
  const refs = item.sources
    .filter((source) => source.url)
    .slice(0, 4)
    .map((source) => [`${source.source}：${source.title}`, source.url]);
  const keyword = encodeURIComponent(recommendedSearchKeywords(item.title, item.desc));
  refs.push(["百度新闻搜索", `https://www.baidu.com/s?wd=${keyword}%20新闻`]);
  refs.push(["官方回应搜索", `https://www.baidu.com/s?wd=${keyword}%20官方%20回应`]);
  return refs;
}

function makeDetail(item, updatedAt) {
  const platforms = item.platforms.join("、");
  const desc = item.desc?.trim();
  const title = cleanTitle(item.title);
  const paragraphOne = `截至${updatedAt}，"${title}"出现在${platforms}等公开热榜或热点页面中。页面记录的平台标题为"${title}"，推荐搜索词为"${recommendedSearchKeywords(title, desc)}"。`;
  const paragraphTwo = desc
    ? `公开页面摘要显示：${desc}`
    : `目前公开热榜只提供了标题和热度信息，暂未抓取到完整新闻摘要。该类热点需要通过参考来源中的新闻搜索、官方回应搜索和平台搜索入口继续核对。`;
  const paragraphThree = `从已抓取信息看，当前可确认的是该话题已经进入公开讨论场，具体事实仍应以权威媒体、官方通报、当事方公告或原始发布内容为准。若参考来源中没有明确官方链接，发布短视频时应说明"据公开平台热榜/公开搜索结果显示"，避免把平台讨论直接说成确定结论。`;
  return `${paragraphOne}\n\n${paragraphTwo}\n\n${paragraphThree}`;
}

function makeListDescription(item) {
  const desc = item.desc?.trim();
  if (desc && desc.length >= 45) {
    return `${item.title}进入${item.platforms.join("、")}等平台热榜。公开摘要显示，${desc} 这个话题适合先做事实梳理，把事件主体、发生时间、已公开信息和仍需核实的部分讲清楚。`;
  }
  return `${item.title}进入${item.platforms.join("、")}等平台热榜，目前可抓取到的公开信息以标题、热度和平台搜索结果为主。这个话题需要先确认原始来源、官方回应和权威媒体报道，再决定是否做成短视频。内容上适合从"发生了什么、为什么被关注、哪些信息还不能下结论"三步展开。`;
}

function makeWhy(item) {
  const categoryReason = {
    金融: "它关系到钱袋子、资产安全和普通家庭决策，天然容易引发转发和评论。",
    科技: "它涉及新技术、产业变化或产品体验，容易形成科普、争议和普通人影响三类内容。",
    民生: "它和日常生活、公共安全、健康、消费或家庭压力有关，用户代入感强。",
    AI: "它踩中 AI 工具、效率变化和技术焦虑，适合做解释型和体验型内容。",
    教育: "它关系到学生、家长和就业路径，受众明确，讨论情绪和实用需求都比较强。",
  };
  return categoryReason[item.category] || categoryReason.民生;
}

function makeRisk(item) {
  if (item.category === "金融") return "金融类内容不要给具体投资建议，不承诺收益，关键数字和政策口径必须核对权威来源。";
  if (item.category === "教育") return "教育类内容要注意地域和学校差异，不要把个案说成全国统一情况。";
  if (item.category === "AI" || item.category === "科技") return "科技类内容要区分发布会宣传、媒体报道和实际能力，避免夸大效果。";
  return "民生类内容要优先核实官方通报、权威媒体和原始来源，避免传播未经证实的信息。";
}

function makeAngles(item) {
  return [
    ["事实梳理", "先讲清楚事件主体、发生时间、平台热度和已公开信息，不急着下结论。"],
    ["普通人视角", "解释这件事和普通人的钱、生活、工作、学习或选择有什么关系。"],
    ["争议拆解", "把不同立场分别讲清楚，区分事实、情绪和猜测。"],
    ["避坑提醒", "列出发布前必须核实的信息，提醒观众不要被单一标题带节奏。"],
  ];
}

function makeImages(item) {
  const keyword = searchKeywords(item.title);
  const presets = {
    金融: [["财经新闻画面", `${keyword}、财经大屏、银行网点或数据图表，适合解释背景。`]],
    科技: [["科技产品画面", `${keyword}、发布会、设备特写或产业链示意，适合做开场。`]],
    民生: [["现场与生活场景", `${keyword}、城市街景、社区或公共服务场景，适合表现代入感。`]],
    AI: [["AI工具画面", `${keyword}、电脑界面、办公场景或模型概念图，适合解释工具影响。`]],
    教育: [["校园与家庭学习", `${keyword}、教室、书桌、家长沟通场景，适合讲受众影响。`]],
  };
  const base = presets[item.category] || presets.民生;
  const images = [
    ...base,
    ["平台搜索截图", `截取${item.platforms[0] || "平台"}搜索结果或热榜页面，用来证明话题来源。`],
    ["权威来源截图", "找到官方通报、权威媒体报道或原始发布内容后，作为事实核查画面。"],
  ];
  if (item.imageUrl) images.unshift(["头条热榜配图", "今日头条热榜提供的相关图片，可作为素材参考。"]);
  return images.slice(0, 3);
}

function creatorProfile(item, category, heat, viral, videoHeat) {
  const text = `${item.title} ${item.desc || ""}`;
  const hasClearDesc = (item.desc || "").length >= 35;
  const multiSource = item.platforms.length >= 2;
  const practicalSignal = /怎么|如何|政策|补贴|利率|价格|就业|教育|医疗|养老|安全|消费|住房|AI|工具|手机|汽车|银行|官方|通报|回应/i.test(text);
  const strongPublicConcern = /普通人|家庭|学生|家长|老人|工人|消费者|居民|公民|游客|孩子|年轻人/i.test(text);
  const oralSignal = /普通人|家庭|学生|家长|老人|工人|消费者|居民|村民|公民|游客|年轻人|孩子|钱|工资|就业|利率|银行|补贴|价格|医保|养老|住房|安全|健康|疾病|癌|白发|衰老|村庄|手机|汽车|AI工具|怎么|如何|为什么/i.test(text);
  const clearStorySignal = /通报|回应|发布|上线|下调|上涨|下降|显示|宣布|发现|查扣|确诊|患癌|发生|成为|来了|推出|调整/i.test(text);
  const riskySignal = /网传|曝|爆料|疑似|传言|未经证实|聊天记录|偷拍视频|八卦|恋情/i.test(text);
  const officialDrySignal = /文物故事|理论学习|领导人活动|国际访问|会议召开/i.test(text) && !practicalSignal;
  const categoryBonus = { 金融: 10, 教育: 6, 民生: 6, AI: 5, 科技: 4 }[category] || 3;
  const sourceBonus = multiSource ? 8 : 2;
  const descBonus = hasClearDesc ? 7 : -4;
  const practicalBonus = practicalSignal ? 8 : 0;
  const concernBonus = strongPublicConcern ? 5 : 0;
  const oralBonus = oralSignal ? 8 : 0;
  const storyBonus = clearStorySignal ? 5 : 0;
  const riskPenalty = (riskySignal ? 10 : 0) + (officialDrySignal ? 12 : 0);
  const score = clamp(
    Math.round(heat * 0.28 + viral * 0.18 + videoHeat * 0.12 + categoryBonus + sourceBonus + descBonus + practicalBonus + concernBonus + oralBonus + storyBonus - riskPenalty),
    35,
    98,
  );
  const oralScore = clamp(
    Math.round(score * 0.62 + (oralSignal ? 14 : 0) + (clearStorySignal ? 8 : 0) + (hasClearDesc ? 6 : -5) + (riskySignal ? -8 : 0)),
    30,
    98,
  );
  const reasons = [];
  if (multiSource) reasons.push("多平台同时出现，说明不是单点热闹");
  if (hasClearDesc) reasons.push("公开摘要较清楚，容易讲清事实");
  if (practicalSignal) reasons.push("和普通人的决策、生活或工作有关");
  if (strongPublicConcern) reasons.push("受众代入感强");
  if (riskySignal) reasons.push("存在传言或爆料信号，发布前要更谨慎核查");
  if (!reasons.length) reasons.push("有热度，但还需要先核实来源和事件背景");
  const oralReasons = [];
  if (oralSignal) oralReasons.push("普通人有代入感");
  if (clearStorySignal) oralReasons.push("事件动作明确，适合口播讲清楚");
  if (hasClearDesc) oralReasons.push("公开信息足够支撑开头");
  if (!oralReasons.length) oralReasons.push("可先收藏观察，等更多细节再拍");
  return {
    score,
    reason: reasons.slice(0, 3).join("；") + "。",
    oralScore,
    oralReason: oralReasons.slice(0, 3).join("；") + "。",
  };
}

function buildHotspot(item, index, updatedAt, historyEntry) {
  const category = classifyTopic(item);
  const rawScore = item.score || 0;
  const heat = clamp(Math.round(95 - index * 1.2 + Math.log10(rawScore + 10)), 58, 98);
  const sourceCountBonus = Math.min(item.platforms.length * 3, 9);
  const viral = clamp(heat - 2 + sourceCountBonus + (category === "民生" ? 2 : 0), 55, 98);
  const videoHeat = clamp(heat - 8 + sourceCountBonus + (["民生", "教育"].includes(category) ? 4 : 0), 45, 96);
  const creator = creatorProfile(item, category, heat, viral, videoHeat);
  const firstSeenAt = historyEntry?.firstSeenAt || updatedAt;
  const seenCount = historyEntry?.seenCount || 1;
  const lifecycle = historyEntry?.lifecycle || "新增";
  const isNewToday = dateKey(firstSeenAt) === dateKey(updatedAt);
  const historyScore = clamp(
    Math.round(creator.score * 0.42 + heat * 0.22 + Math.min(seenCount, 30) * 1.5 + (lifecycle === "持续上榜" ? 5 : 0)),
    35,
    98,
  );
  const id = `live-${stableHash(item.title)}`;
  return {
    id,
    title: cleanTitle(item.title),
    originalTitle: cleanTitle(item.title),
    searchKeywords: searchKeywords(item.title),
    recommendedSearchKeywords: recommendedSearchKeywords(item.title, item.desc),
    category,
    platforms: Array.from(new Set(item.platforms)),
    heat,
    viral,
    videoHeat,
    creatorScore: creator.score,
    creatorReason: creator.reason,
    oralScore: creator.oralScore,
    oralReason: creator.oralReason,
    firstSeen: firstSeenAt,
    lastSeen: updatedAt,
    seenCount,
    lifecycle,
    isNewToday,
    historyScore,
    trend: trendText(item.trend),
    rangeScore: {
      当日新增: isNewToday ? clamp(creator.score + 8, 45, 98) : 0,
      三天榜: clamp(Math.round(creator.score * 0.58 + heat * 0.24 + (isNewToday ? 7 : 0) + Math.min(seenCount, 3) * 3), 45, 98),
      周榜: clamp(Math.round(creator.score * 0.45 + historyScore * 0.35 + heat * 0.2), 45, 98),
      月榜: clamp(Math.round(historyScore * 0.62 + creator.score * 0.28 + heat * 0.1), 40, 98),
    },
    summary: item.desc || `${item.title}进入公开热榜，详情需要继续核对来源。`,
    listDescription: makeListDescription({ ...item, category }),
    detailContent: makeDetail({ ...item, category }, updatedAt),
    why: makeWhy({ ...item, category }),
    risk: makeRisk({ ...item, category }),
    references: sourceReferences(item),
    hotComments: [],
    images: makeImages({ ...item, category }),
    angles: makeAngles({ ...item, category }),
  };
}

function supplementWithSeeds(hotspots, seeds) {
  const result = [...hotspots];
  const seen = new Set(result.map((item) => normalizeKey(item.title)));
  const minimumByCategory = new Map(CATEGORIES.map((category) => [category, 5]));

  for (const category of CATEGORIES) {
    while (result.filter((item) => item.category === category).length < minimumByCategory.get(category)) {
      const seed = seeds.find((item) => item.category === category && !seen.has(normalizeKey(item.title)));
      if (!seed) break;
      seen.add(normalizeKey(seed.title));
      result.push({ ...seed, id: `seed-${seed.id}` });
    }
  }

  for (const seed of seeds) {
    if (result.length >= 36) break;
    const key = normalizeKey(seed.title);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...seed, id: `seed-${seed.id}` });
  }

  return result;
}

function writeHotspotData(hotspots) {
  const content = `// Auto-generated hotspot data. Do not edit by hand.\nwindow.HOTSPOTS = ${JSON.stringify(hotspots, null, 2)};\n`;
  writeFileSync("data.js", content, "utf8");
}

function writeUpdateMeta(updatedAt, sourceResults, hotspotCount, stats) {
  const content = `window.UPDATE_META = {
  lastUpdatedAt: "${beijingIsoString()}",
  updateMode: "live-public-pages",
  stats: ${JSON.stringify(stats, null, 2)},
  note: "Fetched ${hotspotCount} hotspots from public pages. Sources: ${sourceResults
    .map((item) => `${item.name}:${item.count}`)
    .join(", ")}.",
};
`;
  writeFileSync("update-meta.js", content, "utf8");
}

function writeIndexVersion(version) {
  const html = readFileSync("index.html", "utf8")
    .replace(/data\.js\?v=[^"]+/g, `data.js?v=${version}`)
    .replace(/update-meta\.js\?v=[^"]+/g, `update-meta.js?v=${version}`);
  writeFileSync("index.html", html, "utf8");
}

async function main() {
  const updatedAt = beijingDisplayString();
  const today = dateKey(updatedAt);
  const assetVersion = beijingIsoString().replace(/\D/g, "").slice(0, 12);
  const seeds = loadSeedHotspots();
  const history = loadHistory();
  const topics = history.topics || {};
  const previousActiveKeys = new Set(
    Object.entries(topics)
      .filter(([, entry]) => dateKey(entry.lastSeenAt) === dateKey(history.lastUpdatedAt))
      .map(([key]) => key),
  );
  const fetchers = [
    ["百度", fetchBaiduHot],
    ["今日头条", fetchToutiaoHot],
    ["微博", fetchWeiboHot],
  ];
  const sourceResults = [];
  const rows = [];

  for (const [name, fetcher] of fetchers) {
    try {
      const sourceRows = await fetcher();
      sourceResults.push({ name, count: sourceRows.length });
      rows.push(...sourceRows);
      console.log(`${name}: ${sourceRows.length}`);
    } catch (error) {
      sourceResults.push({ name, count: 0, error: error.message });
      console.warn(`${name}: failed - ${error.message}`);
    }
  }

  const merged = mergeByTitle(rows)
    .filter((item) => !isLowValueTopic(item))
    .sort((a, b) => b.platforms.length - a.platforms.length || b.score - a.score)
    .slice(0, 80);

  const currentKeys = new Set();
  const historyEntries = new Map();
  merged.forEach((item) => {
    const key = normalizeKey(item.title);
    currentKeys.add(key);
    const previous = topics[key];
    const firstSeenAt = previous?.firstSeenAt || updatedAt;
    const seenCount = (previous?.seenCount || 0) + 1;
    const previousScore = previous?.lastScore || 0;
    const score = item.score || 0;
    let lifecycle = "新增";
    if (previous?.firstSeenAt) {
      if (score > previousScore * 1.08) lifecycle = "热度上升";
      else if (score < previousScore * 0.86) lifecycle = "热度下降";
      else lifecycle = "持续上榜";
    }

    const entry = {
      key,
      title: item.title,
      firstSeenAt,
      lastSeenAt: updatedAt,
      seenCount,
      lastScore: score,
      platforms: Array.from(new Set([...(previous?.platforms || []), ...item.platforms])),
      lifecycle,
    };
    topics[key] = entry;
    historyEntries.set(key, entry);
  });

  const stats = {
    new: [...historyEntries.values()].filter((entry) => entry.lifecycle === "新增").length,
    continued: [...historyEntries.values()].filter((entry) => entry.lifecycle !== "新增").length,
    dropped: [...previousActiveKeys].filter((key) => !currentKeys.has(key)).length,
  };

  const liveHotspots = merged
    .map((item, index) => buildHotspot(item, index, updatedAt, historyEntries.get(normalizeKey(item.title))))
    .sort((a, b) => b.rangeScore.三天榜 - a.rangeScore.三天榜 || b.creatorScore - a.creatorScore);
  const finalHotspots = supplementWithSeeds(liveHotspots, seeds);

  history.topics = topics;
  history.lastUpdatedAt = updatedAt;
  history.stats = stats;

  writeHotspotData(finalHotspots);
  writeUpdateMeta(updatedAt, sourceResults, finalHotspots.length, stats);
  writeHistory(history);
  writeIndexVersion(assetVersion);
  console.log(`Generated ${finalHotspots.length} hotspots at ${updatedAt}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
