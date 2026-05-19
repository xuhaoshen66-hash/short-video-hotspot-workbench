const ranges = ["三天榜", "周榜", "月榜", "当日新增"];
const statuses = ["待观察", "值得拍", "今日拍摄", "已拍摄", "已发布", "已放弃"];
const rangeDisplayLimits = {
  三天榜: 20,
  周榜: 20,
  月榜: 30,
  当日新增: 10,
};
const topicFilterOptions = ["全部", "只看金融", "只看政策"];
const policyHomeLimits = {
  三天榜: 3,
  周榜: 3,
  月榜: 4,
  当日新增: 2,
};

function readStoredJson(key, fallback) {
  try {
    const value = window.localStorage?.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

const state = {
  loggedIn: false,
  view: "dashboard",
  previousView: "dashboard",
  range: "三天榜",
  topicFilter: "全部",
  libraryStatus: "全部",
  selectedId: null,
  expandedTimelines: readStoredJson("creatorRadarExpandedTimelines", {}),
  saved: readStoredJson("creatorRadarSaved", []),
  ignored: readStoredJson("creatorRadarIgnored", []),
  customHotspots: readStoredJson("creatorRadarCustomHotspots", []),
  updatedAt: new Date(window.UPDATE_META?.lastUpdatedAt || Date.now()),
};

const seedHotspots = window.HOTSPOTS || [];
let hotspots = [...seedHotspots, ...state.customHotspots];
const $ = (selector) => document.querySelector(selector);

function on(selector, eventName, handler) {
  const element = $(selector);
  if (!element) return;
  element.addEventListener(eventName, handler);
}

function enterApp() {
  $("#loginView").hidden = true;
  $("#appView").hidden = false;
  state.loggedIn = true;
  showToast("欢迎回来。");
}

function saveLocal() {
  try {
    window.localStorage?.setItem("creatorRadarSaved", JSON.stringify(state.saved));
    window.localStorage?.setItem("creatorRadarIgnored", JSON.stringify(state.ignored));
    window.localStorage?.setItem("creatorRadarExpandedTimelines", JSON.stringify(state.expandedTimelines));
    window.localStorage?.setItem("creatorRadarCustomHotspots", JSON.stringify(state.customHotspots));
  } catch (error) {
    showToast("浏览器没有开放本地保存，本次内容只在当前页面有效。");
  }
}

function rebuildHotspots() {
  hotspots = [...seedHotspots, ...state.customHotspots];
}

function seedSavedTopics() {
  const seeds = window.SEED_TIMELINES || [];
  let changed = false;
  seeds.forEach((seed) => {
    const existing = state.saved.find((item) => item.id === seed.id);
    if (existing) {
      existing.timeline = seed.timeline || [];
      if (seed.status && !existing.status) existing.status = seed.status;
    } else {
      state.saved.unshift({
        id: seed.id,
        status: seed.status || "待观察",
        savedAt: formatDate(new Date()),
        timeline: seed.timeline || [],
      });
    }
    changed = true;
  });
  if (changed) saveLocal();
}

function normalizeSavedStatuses() {
  let changed = false;
  state.saved.forEach((item) => {
    if (item.status === "准备拍" || item.status === "已生成提示词") {
      item.status = "值得拍";
      changed = true;
    }
  });
  if (changed) saveLocal();
}

function pruneMissingLocalMarks() {
  const validIds = new Set(hotspots.map((item) => item.id));
  const savedBefore = state.saved.length;
  const ignoredBefore = state.ignored.length;
  state.saved = state.saved.filter((item) => validIds.has(item.id));
  state.ignored = state.ignored.filter((id) => validIds.has(id));
  if (state.saved.length !== savedBefore || state.ignored.length !== ignoredBefore) {
    saveLocal();
  }
}

function addCustomHotspot() {
  const title = $("#customTitle").value.trim();
  const category = $("#customCategory").value;
  const platformText = $("#customPlatforms").value.trim();
  const trend = $("#customTrend").value;
  const description = $("#customDescription").value.trim();
  const why = $("#customWhy").value.trim();
  const risk = $("#customRisk").value.trim();
  if (!title || !description || !why) {
    showToast("请至少填写标题、首页详细描述和为什么会火。");
    return;
  }
  const platformsValue = platformText
    ? platformText.split(/[、,，\s]+/).filter(Boolean)
    : ["手动录入"];
  const now = new Date();
  const id = `custom-${Date.now()}`;
  const heat = 72;
  const item = {
    id,
    title,
    category,
    platforms: platformsValue,
    heat,
    viral: 75,
    videoHeat: 50,
    firstSeen: formatDate(now),
    trend,
    rangeScore: { 当日新增: heat, 三天榜: heat, 周榜: heat, 月榜: heat },
    summary: description.slice(0, 80),
    listDescription: description,
    detailContent: description,
    why,
    risk: risk || "手动录入热点，发布前请核对来源和事实。",
    angles: [
      ["普通人视角", "这件事和普通人的生活、选择或利益有什么关系。"],
      ["时间线复盘", "如果后续出现关键转折，可以按起因、回应、当前状态梳理。"],
      ["避坑提醒", "提醒观众哪些信息需要核实，哪些结论不要下太早。"],
    ],
  };
  state.customHotspots.unshift(item);
  rebuildHotspots();
  saveLocal();
  ["customTitle", "customPlatforms", "customDescription", "customWhy", "customRisk"].forEach((idName) => {
    $(`#${idName}`).value = "";
  });
  renderHotspots();
  showToast("已添加到热点榜。");
}

function clearCustomHotspots() {
  if (!state.customHotspots.length) {
    showToast("当前没有手动热点。");
    return;
  }
  if (!window.confirm("确定清空所有手动添加的热点吗？")) return;
  state.customHotspots = [];
  rebuildHotspots();
  saveLocal();
  renderHotspots();
  showToast("已清空手动热点。");
}
function formatDate(date) {
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 1800);
}

function initSegmented(id, options, stateKey) {
  const wrap = $(`#${id}`);
  if (!wrap) return;
  wrap.innerHTML = options
    .map((option) => `<button class="${state[stateKey] === option ? "active" : ""}" data-value="${option}">${option}</button>`)
    .join("");
}

function renderFilters() {
  renderButtonGroup("rangeButtons", ranges, state.range);
  renderButtonGroup("topicFilterButtons", topicFilterOptions, state.topicFilter);
}

function renderButtonGroup(id, options, activeValue) {
  const wrap = $(`#${id}`);
  if (!wrap) return;
  wrap.innerHTML = options
    .map((option) => `<button class="${activeValue === option ? "active" : ""}" data-value="${option}" type="button">${option}</button>`)
    .join("");
}

function filteredHotspots() {
  const filtered = baseFilteredHotspots();
  const ranged = state.range === "当日新增" ? filtered.filter((item) => item.lifecycle === "新增" || item.isNewToday) : filtered;
  const sorted = ranged.sort((a, b) => rangeScoreFor(b, state.range) - rangeScoreFor(a, state.range));
  const visible = state.topicFilter === "全部" ? limitHomepagePolicyHotspots(sorted) : sorted;
  const allLimit = rangeDisplayLimits[state.range] || 10;
  const limit = state.topicFilter === "全部" ? allLimit : visible.length;
  return visible.slice(0, limit);
}

function baseFilteredHotspots() {
  return hotspots.filter((item) => {
    if (state.topicFilter === "只看金融") return item.category === "金融";
    if (state.topicFilter === "只看政策") return isPolicyHotspot(item);
    return true;
  });
}

function limitHomepagePolicyHotspots(items) {
  const limit = policyHomeLimits[state.range] ?? 3;
  if (!limit) return items.filter((item) => !isPolicyHotspot(item));
  const homepagePolicyIds = new Set(
    items
      .filter(isPolicyHotspot)
      .sort((a, b) => ordinaryImpactScore(b) - ordinaryImpactScore(a))
      .slice(0, limit)
      .map((item) => item.id)
  );
  return items.filter((item) => !isPolicyHotspot(item) || homepagePolicyIds.has(item.id));
}

function isPolicyHotspot(item) {
  const text = `${item.category || ""} ${item.title || ""} ${item.originalTitle || ""} ${(item.platforms || []).join(" ")}`;
  return item.category === "政策" || /国务院|中共中央|办公厅|部委|政府网|政策|条例|意见|通知|办法|规定|机制|制度/.test(text);
}

function ordinaryImpactScore(item) {
  const text = `${item.title || ""} ${item.originalTitle || ""} ${item.summary || ""}`;
  const keywordWeights = [
    ["长期护理", 70],
    ["失能", 42],
    ["药品价格", 52],
    ["新就业", 46],
    ["养老机构", 44],
    ["中小学", 40],
    ["课后服务", 38],
    ["分级诊疗", 38],
    ["养老", 36],
    ["药品", 35],
    ["就业", 30],
    ["教育", 30],
    ["保险", 28],
    ["护理", 26],
    ["老龄化", 24],
    ["住房", 24],
    ["医保", 24],
    ["社保", 24],
    ["价格", 20],
    ["工资", 20],
    ["个税", 20],
    ["公积金", 20],
    ["生育", 20],
    ["消费", 16],
    ["安全", 14],
    ["服务业", 12],
  ];
  const keywordScore = keywordWeights.reduce((score, [keyword, weight]) => {
    return text.includes(keyword) ? score + weight : score;
  }, 0);
  return rangeScoreFor(item, state.range) + keywordScore + (item.oralScore || 0) * 0.35;
}

function rangeScoreFor(item, range) {
  if (item.rangeScore?.[range] !== undefined) return item.rangeScore[range];
  if (range === "当日新增") return item.isNewToday ? creatorScore(item) + 8 : 0;
  if (range === "月榜") return Math.round(creatorScore(item) * 0.5 + (item.historyScore || 0) * 0.5);
  if (range === "周榜") return Math.round(creatorScore(item) * 0.62 + (item.historyScore || 0) * 0.38);
  return creatorScore(item);
}

function trendClass(trend) {
  if (trend === "上升") return "trend-up";
  if (trend === "下降") return "trend-down";
  return "trend-flat";
}

function trendIcon(trend) {
  const iconMap = {
    上升: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 15l5-6 5 6"/><path d="M12 9v11"/></svg>',
    持平: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    下降: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9l5 6 5-6"/><path d="M12 4v11"/></svg>',
  };
  return `<span class="trend-icon ${trendClass(trend)}" title="趋势：${trend}" aria-label="趋势：${trend}">${iconMap[trend] || "—"}</span>`;
}

function scoreBlock(label, value, tone = "") {
  return `<div class="score ${tone}"><span>${label}</span><b>${value}</b></div>`;
}

function creatorScore(item) {
  return item.creatorScore || Math.round(item.viral * 0.45 + item.heat * 0.35 + item.videoHeat * 0.2);
}

function oralScore(item) {
  return item.oralScore || Math.round(creatorScore(item) * 0.78 + (item.category === "金融" ? 7 : 0) + (item.category === "政策" ? 6 : 0) + (item.category === "民生" ? 5 : 0));
}

function topicDecision(item) {
  const score = creatorScore(item);
  if (score >= 88) {
    return {
      label: "优先拍",
      tone: "hot",
      reason: item.creatorReason || "值得拍指数高，话题有明确受众、可解释空间和传播动力，适合优先找细分角度。",
    };
  }
  if (score >= 76) {
    return {
      label: "可以拍",
      tone: "good",
      reason: item.creatorReason || "话题有明确受众和讨论点，适合做解释、复盘或普通人视角内容。",
    };
  }
  if (item.videoHeat >= 88 && score < 76) {
    return {
      label: "谨慎",
      tone: "warn",
      reason: "视频化热度已经很高，继续跟进需要避开同质化表达。",
    };
  }
  return {
    label: "观察",
    tone: "wait",
    reason: item.creatorReason || "热度或创作价值还不够明确，可以先收藏，等关键转折出现再拍。",
  };
}

function listDescription(item) {
  return (
    item.listDescription ||
    item.detailSummary ||
    `${item.summary}${item.why} 对短视频创作来说，重点不是简单复述热搜标题，而是把事件背景、涉及主体、争议焦点、普通人关心的影响讲清楚。如果后续出现官方回应或新的关键进展，也应该及时更新口播角度。`
  );
}

function detailTextFor(item) {
  const rawText = item.detailContent || item.detailSummary || item.summary || "";
  const cleanedText = cleanEventDetailText(rawText);
  return cleanedText || item.summary || rawText;
}

function cleanEventDetailText(text) {
  const creativePatterns = [
    /短视频/,
    /拍摄/,
    /怎么拍/,
    /如何拍/,
    /创作/,
    /口播/,
    /视频化/,
    /剪辑/,
    /素材/,
    /镜头/,
    /选题/,
    /博主/,
    /脚本/,
    /值得拍/,
    /发布前/,
    /适合做/,
    /适合从/,
  ];
  return text
    .split(/\n+/)
    .map((paragraph) => {
      const sentences = paragraph.match(/[^。！？!?]+[。！？!?]?/g) || [paragraph];
      return sentences
        .filter((sentence) => !creativePatterns.some((pattern) => pattern.test(sentence)))
        .join("")
        .trim();
    })
    .filter(Boolean)
    .join("\n\n");
}

function articleHtml(text) {
  const content = text || "";
  const paragraphs = content
    .split(/\n+/)
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join("");
  if (content.length <= 220) {
    return `<div class="article-text">${paragraphs}</div>`;
  }
  const preview = `${content.slice(0, 220)}...`;
  return `
    <div class="article-text article-collapsible collapsed">
      <div class="article-preview"><p>${preview}</p></div>
      <div class="article-full">${paragraphs}</div>
      <button class="article-toggle" type="button" data-action="article-toggle" aria-label="展开事件详情">
        <span class="chevron">⌄</span>
        <span>展开</span>
      </button>
    </div>
  `;
}

function platformLinks(item) {
  const keywordText = item.recommendedSearchKeywords || item.searchKeywords || item.originalTitle || item.title;
  const keyword = encodeURIComponent(keywordText);
  return [
    ["去微博搜索", `https://s.weibo.com/weibo?q=${keyword}`],
    ["去百度搜索", `https://www.baidu.com/s?wd=${keyword}`],
    ["去抖音搜索", `https://www.douyin.com/search/${keyword}`],
    ["去头条搜索", `https://so.toutiao.com/search?keyword=${keyword}`],
  ];
}

function searchKeywordHtml(item) {
  const recommended = item.recommendedSearchKeywords || item.searchKeywords || item.originalTitle || item.title;
  const original = item.originalTitle || item.title;
  return `
    <div class="search-keyword">
      <p class="muted">推荐搜索词：<b>${recommended}</b></p>
      ${original !== recommended ? `<p class="muted">平台原始标题：${original}</p>` : ""}
    </div>
  `;
}

function imageSuggestions(item) {
  const defaults = {
    金融: [
      ["利率与存款", "银行柜台、利率数字、家庭资产表，适合解释钱袋子影响。"],
      ["普通家庭理财", "账本、手机银行、计算器，适合做风险提醒。"],
      ["财经新闻背景", "财经大屏或新闻标题，适合做开场画面。"],
    ],
    政策: [
      ["政策原文", "中国政府网、部委官网、政策文件标题和发布日期，适合证明信息来源。"],
      ["办事场景", "政务大厅、社保医保窗口、社区服务站，适合解释普通人影响。"],
      ["数字变化", "补贴、利率、税费、缴费标准等关键数字，适合做重点提示。"],
    ],
    科技: [
      ["产品发布场景", "手机、汽车或芯片发布会画面，适合做话题引入。"],
      ["技术细节特写", "芯片、电路板、车机屏幕，适合做解释段落。"],
      ["用户使用场景", "普通人使用科技产品，适合讲影响。"],
    ],
    民生: [
      ["生活场景", "社区、餐厅、家庭消费场景，适合表现普通人感受。"],
      ["公共服务", "办事大厅、社区服务站，适合解释政策影响。"],
      ["街头讨论", "城市街景和人群，适合表现话题热度。"],
    ],
    AI: [
      ["AI办公界面", "电脑屏幕、文档、聊天窗口，适合做效率主题。"],
      ["人机协作", "人在电脑前使用 AI 工具，适合讲使用场景。"],
      ["科技抽象背景", "数据流、模型、终端设备，适合做过渡画面。"],
    ],
  };
  const images = item.images || defaults[item.category] || defaults.民生;
  return images.slice(0, 3);
}

function imageSuggestionHtml(item) {
  return imageSuggestions(item)
    .map(([title, text], index) => {
      const query = encodeURIComponent(`${item.title} ${title}`);
      return `
        <div class="image-card">
          <div class="image-preview">素材方向 ${index + 1} · ${title}</div>
          <div class="image-card-body">
            <h4>${title}</h4>
            <p>${text}</p>
            <a class="timeline-link" target="_blank" rel="noreferrer" href="https://image.baidu.com/search/index?tn=baiduimage&word=${query}">去搜相关图片</a>
          </div>
        </div>
      `;
    })
    .join("");
}

function commentHtml(comment) {
  return `
    <div class="comment-card">
      <div class="comment-meta">
        <span>${comment.source}</span>
        <span>${comment.author || "热门用户"}</span>
        <span>热度 ${comment.heat || "-"}</span>
      </div>
      <p>${comment.text}</p>
    </div>
  `;
}

function timelineNodeLinks(node, fallbackTitle) {
  const keyword = encodeURIComponent(node.query || fallbackTitle);
  const grouped = node.linksByType || {
    新闻: [["百度新闻", `https://www.baidu.com/s?wd=${keyword}%20新闻`]],
    官方: [["官方回应搜索", `https://www.baidu.com/s?wd=${keyword}%20官方回应`]],
    讨论: [
      ["微博", `https://s.weibo.com/weibo?q=${keyword}`],
      ["头条", `https://so.toutiao.com/search?keyword=${keyword}`],
    ],
  };
  return Object.entries(grouped)
    .map(([group, links]) => {
      const linkHtml = links
        .map(([label, href]) => `<a class="timeline-link" target="_blank" rel="noreferrer" href="${href}">${label}</a>`)
        .join("");
      return `<div class="timeline-link-group"><span class="timeline-link-label">${group}</span>${linkHtml}</div>`;
    })
    .join("");
}

function hotspotCard(item, mode = "dashboard") {
  const savedItem = state.saved.find((saved) => saved.id === item.id);
  const ignored = state.ignored.includes(item.id);
  const status = savedItem?.status || "待观察";
  const timelineStatus = savedItem?.timeline?.length ? "已生成" : "未生成";
  const decision = topicDecision(item);
  const libraryMeta = mode === "library" ? libraryMetaHtml(item, savedItem, decision) : "";
  return `
    <article class="hotspot-card">
      <div class="card-head">
        <div>
          <h2 class="card-title">${item.title}</h2>
          <div class="tags">
            <span class="tag">${item.category}</span>
            ${item.platforms.map((platform) => `<span class="tag platform-tag">${platform}</span>`).join("")}
            ${trendIcon(item.trend)}
            ${lifecycleTag(item)}
            <span class="decision-pill ${decision.tone}">${decision.label}</span>
            ${ignored ? `<span class="tag muted-tag">不感兴趣</span>` : ""}
            ${mode === "library" ? `<span class="tag platform-tag">${status}</span><span class="tag platform-tag">时间线：${timelineStatus}</span>` : ""}
          </div>
        </div>
        <div class="score-row">
          ${scoreBlock("值得拍", creatorScore(item), "primary")}
          ${scoreBlock("综合热度", item.rangeScore[state.range] || item.heat)}
          ${scoreBlock("视频热度", item.videoHeat)}
        </div>
      </div>
      <p class="summary">${listDescription(item)}</p>
      <p class="decision-reason"><b>推荐理由：</b>${decision.reason}</p>
      ${libraryMeta}
      <div class="button-row">
        <button class="secondary-button" data-action="${mode === "library" ? "saved-detail" : "detail"}" data-id="${item.id}">查看详情</button>
        <button class="secondary-button" data-action="save" data-id="${item.id}">${savedItem ? "取消收藏" : "收藏"}</button>
        ${mode === "library" ? statusButtons(item.id, status) : `<button class="secondary-button" data-action="ignore" data-id="${item.id}">${ignored ? "取消不感兴趣" : "不感兴趣"}</button>`}
      </div>
    </article>
  `;
}

function lifecycleTag(item) {
  if (!item.lifecycle && !item.isNewToday) return "";
  const label = item.lifecycle || (item.isNewToday ? "新增" : "");
  return `<span class="tag lifecycle-tag">${label}</span>`;
}

function statusButtons(id, status) {
  return `
    <select class="compact-select" data-action="status" data-id="${id}">
      ${statuses.map((item) => `<option ${item === status ? "selected" : ""}>${item}</option>`).join("")}
    </select>
    <button class="secondary-button" data-action="remove" data-id="${id}">删除收藏</button>
  `;
}

function libraryMetaHtml(item, savedItem, decision) {
  const angle = item.angles?.[0] ? `${item.angles[0][0]}：${item.angles[0][1]}` : "先做事实梳理，再提炼普通人视角。";
  const hasTimeline = savedItem?.timeline?.length ? "有关键时间线" : "暂无关键时间线";
  const checkRisk = item.category === "金融" || item.category === "政策" || item.category === "民生" ? "发布前必须核查来源" : "发布前建议核查来源";
  return `
    <div class="library-meta">
      <div><b>推荐角度</b><span>${angle}</span></div>
      <div><b>拍摄判断</b><span>${decision.label}，${decision.reason}</span></div>
      <div><b>资料状态</b><span>${hasTimeline}；${checkRisk}</span></div>
    </div>
  `;
}

function renderHotspots() {
  const list = filteredHotspots();
  const filterLabel = state.topicFilter === "全部" ? "" : ` / ${state.topicFilter}`;
  $("#resultCount").textContent = `${state.range}${filterLabel}：当前显示 ${list.length} 条热点`;
  $("#updatedAt").textContent = formatDate(state.updatedAt);
  const stats = window.UPDATE_META?.stats;
  const updateSummary = $("#updateSummary");
  if (updateSummary && stats) {
    updateSummary.textContent = `（新增 ${stats.new || 0}，持续 ${stats.continued || 0}，下榜 ${stats.dropped || 0}）`;
  }
  $("#hotspotList").innerHTML = list.length ? list.map((item) => hotspotCard(item)).join("") : emptyText("没有符合条件的热点");
}

function emptyText(text) {
  return `<article class="hotspot-card"><p class="muted">${text}</p></article>`;
}

function getHotspot(id) {
  return hotspots.find((item) => item.id === id);
}

function saveTopic(id) {
  const existing = state.saved.find((item) => item.id === id);
  if (existing) {
    state.saved = state.saved.filter((item) => item.id !== id);
    saveLocal();
    showToast("已取消收藏。");
    renderHotspots();
    renderLibrary();
    if (state.view === "savedDetail") showView("library");
    return;
  }
  state.saved.unshift({
    id,
    status: "待观察",
    savedAt: formatDate(new Date()),
    timeline: [],
  });
  saveLocal();
  showToast("已收藏到选题库。");
  renderHotspots();
  renderLibrary();
}

function toggleIgnore(id) {
  if (state.ignored.includes(id)) {
    state.ignored = state.ignored.filter((itemId) => itemId !== id);
    showToast("已取消不感兴趣标记。");
  } else {
    state.ignored.unshift(id);
    showToast("已标记不感兴趣，再点一次可取消。");
  }
  saveLocal();
  renderHotspots();
}

function renderDetail(id) {
  const item = getHotspot(id);
  state.selectedId = id;
  $("#detailContent").innerHTML = detailHtml(item, false);
  showView("detail");
}

function detailHtml(item, savedMode) {
  const savedItem = state.saved.find((saved) => saved.id === item.id);
  const detailText = detailTextFor(item);
  const links = platformLinks(item)
    .map(([label, href]) => `<a class="secondary-button" target="_blank" rel="noreferrer" href="${href}">${label}</a>`)
    .join("");
  return `
    <div class="detail-card">
      <div class="card-head">
        <div>
          <h2 class="card-title">${item.title}</h2>
          <div class="tags">
            <span class="tag">${item.category}</span>
            ${item.platforms.map((platform) => `<span class="tag platform-tag">${platform}</span>`).join("")}
            ${trendIcon(item.trend)}
          </div>
        </div>
        <div class="score-row">
          ${scoreBlock("值得拍", creatorScore(item), "primary")}
          ${scoreBlock("综合热度", item.heat)}
          ${scoreBlock("爆款潜力", item.viral)}
          ${scoreBlock("视频化热度", item.videoHeat)}
        </div>
      </div>

      <section class="section-block">
        <h3>为什么会火</h3>
        <p class="summary">${item.why}</p>
      </section>

      <section class="section-block">
        <h3>事件详情</h3>
        ${articleHtml(detailText)}
        ${detailReferencesHtml(item)}
      </section>

      <section class="section-block">
        <h3>选题判断</h3>
        ${shootDecisionHtml(item)}
      </section>

      <section class="section-block">
        <h3>拍摄角度矩阵</h3>
        ${angleMatrixHtml(item)}
      </section>

      ${item.hotComments?.length ? `
        <section class="section-block">
          <h3>最火辣评</h3>
          <div class="comment-list">
            ${item.hotComments.map(commentHtml).join("")}
          </div>
        </section>
      ` : ""}

      ${item.detailContent && item.detailContent.length > 500 ? `
        <section class="section-block">
          <h3>压缩说明</h3>
          <p class="muted">原始详情超过 500 字，页面已自动压缩成更适合阅读的版本。</p>
        </section>
      ` : ""}
      
      <section class="section-block">
        <h3>适合拍摄角度</h3>
        <div class="angle-grid">
          ${item.angles.map(([title, text]) => `<div class="mini-panel"><h4>${title}</h4><p>${text}</p></div>`).join("")}
        </div>
      </section>

      <section class="section-block">
        <h3>风险提醒</h3>
        <p class="summary">${item.risk}</p>
      </section>

      <section class="section-block">
        <h3>事实核查清单</h3>
        ${factCheckHtml(item)}
      </section>

      <section class="section-block">
        <h3>平台搜索入口</h3>
        ${searchKeywordHtml(item)}
        <div class="button-row">${links}</div>
      </section>

      <section class="section-block">
        <h3>剪辑素材建议</h3>
        <div class="image-grid">${imageSuggestionHtml(item)}</div>
      </section>

      ${savedMode ? timelineSection(item, savedItem) : ""}

      <div class="button-row">
        <button class="secondary-button" data-action="save" data-id="${item.id}">${savedItem ? "已收藏" : "收藏到选题库"}</button>
      </div>
    </div>
  `;
}

function shootDecisionHtml(item) {
  const score = creatorScore(item);
  const recommendation = score >= 88 ? "优先拍" : score >= 76 ? "可以拍" : score >= 62 ? "观察后再拍" : "暂不建议";
  const timing = item.videoHeat >= 85 ? "已有较多内容跟进，建议避开泛泛复述。" : item.videoHeat >= 60 ? "正在升温，适合尽快找细分角度。" : "短视频端还不拥挤，可以做解释型内容。";
  const bestAngle = item.angles?.[0] ? `${item.angles[0][0]}：${item.angles[0][1]}` : "先做事实梳理，再提炼普通人视角。";
  return `
    <div class="angle-grid">
      <div class="mini-panel">
        <h4>值得拍指数</h4>
        <p>${score} 分。${item.creatorReason || "综合热度、传播潜力、视频化空间和核查难度后得出。"}</p>
      </div>
      <div class="mini-panel">
        <h4>拍摄建议</h4>
        <p>${recommendation}</p>
      </div>
      <div class="mini-panel">
        <h4>当前时机</h4>
        <p>${timing}</p>
      </div>
      <div class="mini-panel">
        <h4>首选角度</h4>
        <p>${bestAngle}</p>
      </div>
    </div>
  `;
}

function angleMatrixHtml(item) {
  const customAngles = item.angles || [];
  const matrix = [
    ["普通人视角", customAngles[0]?.[1] || "这件事和普通人的生活、钱包、工作或选择有什么关系。"],
    ["反常识视角", customAngles.find(([name]) => name.includes("反常识"))?.[1] || "表面看是一个热点，真正值得关注的可能是背后的变化。"],
    ["避坑提醒", customAngles.find(([name]) => name.includes("避坑") || name.includes("风险"))?.[1] || "哪些说法需要核实，哪些选择不要因为情绪冲动。"],
    ["争议讨论", customAngles.find(([name]) => name.includes("争议") || name.includes("评论"))?.[1] || "不同人为什么会有不同立场，争议焦点到底在哪里。"],
    ["时间线复盘", customAngles.find(([name]) => name.includes("时间线") || name.includes("整理"))?.[1] || "按起因、关键转折、当前状态讲清楚事件。"],
  ];
  return `
    <div class="angle-matrix">
      ${matrix
        .map(
          ([title, text]) => `
            <div class="matrix-row">
              <b>${title}</b>
              <span>${text}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function factCheckHtml(item) {
  const checks = [
    ["原始来源", "找到最早的新闻、平台原帖、官方公告或当事人发声，避免只看二手转述。"],
    ["关键数字", item.category === "金融" ? "利率、金额、收益、时间范围必须核对，不要用模糊数字做结论。" : "涉及人数、金额、时间、范围的数据要核对来源。"],
    ["官方回应", "查看是否已有官方、品牌方、机构或平台回应；如果没有，要避免写成确定结论。"],
    ["地域差异", item.category === "政策" || item.category === "民生" ? "确认是否只适用于某个城市、机构、群体或地区，不要扩大成全国情况。" : "确认信息适用范围，不要把局部案例说成普遍现象。"],
    ["发布风险", item.risk || "发布前检查是否存在夸大、误导、未经证实或容易引发争议的表达。"],
  ];
  return `
    <ul class="check-list">
      ${checks.map(([title, text]) => `<li><b>${title}</b><span>${text}</span></li>`).join("")}
    </ul>
  `;
}

function detailReferencesHtml(item) {
  const references = item.references?.length
    ? item.references
    : [
        ["百度新闻搜索", `https://www.baidu.com/s?wd=${encodeURIComponent(item.title)}%20新闻`],
        ["微博搜索", `https://s.weibo.com/weibo?q=${encodeURIComponent(item.title)}`],
        ["今日头条搜索", `https://so.toutiao.com/search?keyword=${encodeURIComponent(item.title)}`],
      ];
  return `
    <div class="reference-block">
      <p>参考来源</p>
      <ol>
        ${references
          .map(([label, href]) => `<li><a target="_blank" rel="noreferrer" href="${href}">${label}</a></li>`)
          .join("")}
      </ol>
    </div>
  `;
}

function timelineSection(item, savedItem) {
  const timeline = savedItem?.timeline || [];
  const reversedTimeline = [...timeline].reverse();
  const expanded = Boolean(state.expandedTimelines[item.id]);
  const visibleTimeline = expanded ? reversedTimeline : reversedTimeline.slice(0, 3);
  const toggleText = expanded ? "收起时间线" : `查看完整时间线（共 ${timeline.length} 条）`;
  return `
    <section class="section-block">
      <h3>热点时间线</h3>
      <p class="summary">只记录会改变事件走向的关键节点，按最新进展倒序展示。首次出现、尚无重大转折的热点可以没有时间线。</p>
      <div class="button-row">
        <button class="secondary-button" data-action="timeline-generate" data-id="${item.id}">${timeline.length ? "重新生成时间线" : "生成时间线"}</button>
        <button class="secondary-button" data-action="timeline-update" data-id="${item.id}">更新时间线</button>
        <button class="secondary-button" data-action="timeline-add" data-id="${item.id}">添加手动节点</button>
        ${timeline.length > 3 ? `<button class="secondary-button" data-action="timeline-toggle" data-id="${item.id}">${toggleText}</button>` : ""}
      </div>
      ${timeline.length ? `<ol class="timeline">${visibleTimeline.map((node, index) => timelineItem(node, index, item)).join("")}</ol>` : `<p class="muted">还没有生成时间线。</p>`}
    </section>
  `;
}

function timelineItem(node, index, item) {
  const stage = node.stage || "观察节点";
  const level = node.level || "普通";
  const hasHighlight = node.people || node.quote;
  return `
    <li class="timeline-item">
      <div class="timeline-dot">${index + 1}</div>
      <div class="timeline-card">
        <div class="timeline-meta">
          <time>${node.time}</time>
          <span class="timeline-pill key">${stage}</span>
          <span class="timeline-pill ${level === "关键" ? "hot" : ""}">${level}</span>
          <span class="timeline-pill">${node.source}</span>
        </div>
        <h4>${node.title}</h4>
        <p>${node.text}</p>
        ${hasHighlight ? `
          <div class="timeline-points">
            ${node.people ? `<p><b>重点人物/主体：</b>${node.people}</p>` : ""}
            ${node.quote ? `<p><b>原话/金句：</b>${node.quote}</p>` : ""}
          </div>
        ` : ""}
        <p class="timeline-impact">影响判断：${node.impact}</p>
        <div class="timeline-links">${timelineNodeLinks(node, item.title)}</div>
      </div>
    </li>
  `;
}

function generateTimeline(item, mode = "generate") {
  const savedItem = state.saved.find((saved) => saved.id === item.id);
  if (!savedItem) return;
  const base = [
    {
      time: item.firstSeen,
      source: item.platforms[0],
      stage: "起点",
      level: "普通",
      title: "事件开始出现",
      text: `${item.title} 开始进入公开讨论，相关内容首先在部分平台出现。这个阶段的信息通常还不完整，适合先记录事件起点、涉及主体和最初传播渠道。`,
      impact: "适合先收集信息，不急着下结论。",
      query: item.title,
    },
    {
      time: "2026-05-17 09:30",
      source: item.platforms.slice(0, 2).join(" / "),
      stage: "升温",
      level: "重要",
      title: "话题明显升温",
      text: `${item.summary} 这一阶段说明话题已经从单点信息变成更广泛的公共讨论，需要重点观察争议焦点是否发生变化。`,
      impact: "可以准备解释型或梳理型内容。",
      query: `${item.title} 热点`,
    },
    {
      time: "2026-05-17 13:40",
      source: item.platforms.join(" / "),
      stage: "转折",
      level: "关键",
      title: "关键转折点",
      text: `${item.why} 这个节点之所以重要，是因为它会改变用户理解事件的方式，可能让内容从简单复述变成解释、对照或观点分析。`,
      impact: item.videoHeat >= 80 ? "短视频端竞争变强，需要避开同质化。" : "还有机会用清晰角度抢先切入。",
      query: `${item.title} 回应`,
    },
    {
      time: "2026-05-17 20:00",
      source: "系统观察",
      stage: "当前",
      level: "重要",
      title: "当前状态",
      text: `当前综合热度 ${item.heat}，爆款潜力 ${item.viral}，视频化热度 ${item.videoHeat}。这个状态用于判断现在是否还适合跟进，以及应该做事实梳理、观点评论还是风险提醒。`,
      impact: item.viral >= 85 ? "建议优先进入拍摄队列。" : "建议继续观察后续变化。",
      query: `${item.title} 最新`,
    },
  ];
  if (mode === "update") {
    base.push({
      time: formatDate(new Date()),
      source: "手动更新",
      stage: "更新",
      level: "普通",
      title: "新增观察点",
      text: "系统补充了最新观察，建议拍摄前再次核对平台搜索结果。",
      impact: "如果热度继续上升，可以改成跟进型口播。",
      query: `${item.title} 最新消息`,
    });
  }
  savedItem.timeline = base;
  saveLocal();
  renderSavedDetail(item.id);
  renderLibrary();
}

function addManualTimelineNode(id) {
  const savedItem = state.saved.find((saved) => saved.id === id);
  const item = getHotspot(id);
  if (!savedItem) return;
  const title = window.prompt("节点标题，比如：官方回应 / 网友争议 / 热度升温");
  if (!title) return;
  const text = window.prompt("节点说明，用一句话写清楚发生了什么");
  if (!text) return;
  savedItem.timeline.push({
    time: formatDate(new Date()),
    source: "手动添加",
    stage: "手动",
    level: "重要",
    title,
    text,
    impact: "这是你手动补充的重要信息，生成文案时可以重点使用。",
    query: `${item.title} ${title}`,
  });
  saveLocal();
  renderSavedDetail(item.id);
  renderLibrary();
}

function renderLibrary() {
  const status = state.libraryStatus;
  const saved = visibleSavedRecords()
    .filter((item) => status === "全部" || item.status === status)
    .map((item) => getHotspot(item.id))
    .filter(Boolean);
  renderLibraryOverview();
  $("#libraryList").innerHTML = saved.length ? saved.map((item) => hotspotCard(item, "library")).join("") : emptyText("还没有收藏选题。");
}

function visibleSavedRecords() {
  return state.saved.filter((item) => Boolean(getHotspot(item.id)));
}

function renderLibraryOverview() {
  const visibleSaved = visibleSavedRecords();
  const counts = {
    已收藏: visibleSaved.length,
    待观察: visibleSaved.filter((item) => item.status === "待观察").length,
    值得拍: visibleSaved.filter((item) => item.status === "值得拍").length,
    今日拍摄: visibleSaved.filter((item) => item.status === "今日拍摄").length,
    已拍摄: visibleSaved.filter((item) => item.status === "已拍摄").length,
    已发布: visibleSaved.filter((item) => item.status === "已发布").length,
  };
  $("#libraryStats").innerHTML = Object.entries(counts)
    .map(([label, value]) => `<div class="stat-card ${label === "今日拍摄" ? "today" : ""}"><b>${value}</b><span>${label}</span></div>`)
    .join("");
  const options = ["全部", ...statuses];
  $("#libraryStatusButtons").innerHTML = options
    .map((option) => `<button class="${state.libraryStatus === option ? "active" : ""}" data-value="${option}">${option}</button>`)
    .join("");
}

function renderSavedDetail(id) {
  const item = getHotspot(id);
  if (!item) {
    showToast("这个收藏热点已不在当前数据里，已从统计中移除。");
    pruneMissingLocalMarks();
    showView("library");
    return;
  }
  state.selectedId = id;
  $("#savedDetailContent").innerHTML = detailHtml(item, true);
  showView("savedDetail");
}

function showView(view) {
  state.previousView = state.view;
  state.view = view;
  const titles = {
    dashboard: "热点榜",
    detail: "热点详情",
    library: "我的选题库",
    savedDetail: "收藏热点详情",
    settings: "设置",
  };
  $("#pageTitle").textContent = titles[view];
  ["dashboard", "detail", "library", "savedDetail", "settings"].forEach((name) => {
    const viewEl = $(`#${name}View`);
    if (viewEl) viewEl.hidden = name !== view;
  });
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });
  if (view === "library") renderLibrary();
}

function handleAction(action, id, value, targetElement) {
  const item = getHotspot(id);
  if (action === "article-toggle") {
    const block = targetElement?.closest(".article-collapsible");
    if (!block) return;
    block.classList.toggle("collapsed");
    const button = block.querySelector(".article-toggle");
    if (button) {
      const collapsed = block.classList.contains("collapsed");
      button.innerHTML = `<span class="chevron">${collapsed ? "⌄" : "⌃"}</span><span>${collapsed ? "展开" : "收起"}</span>`;
      button.setAttribute("aria-label", collapsed ? "展开事件详情" : "收起事件详情");
    }
    return;
  }
  if (action === "detail") renderDetail(id);
  if (action === "saved-detail") renderSavedDetail(id);
  if (action === "save") saveTopic(id);
  if (action === "ignore") toggleIgnore(id);
  if (action === "remove") {
    state.saved = state.saved.filter((saved) => saved.id !== id);
    saveLocal();
    renderLibrary();
    renderHotspots();
    showToast("已删除收藏。");
  }
  if (action === "status") {
    const savedItem = state.saved.find((saved) => saved.id === id);
    if (savedItem) savedItem.status = value;
    saveLocal();
    renderLibrary();
    showToast("状态已更新。");
  }
  if (action === "timeline-generate") generateTimeline(item);
  if (action === "timeline-update") generateTimeline(item, "update");
  if (action === "timeline-add") addManualTimelineNode(id);
  if (action === "timeline-toggle") {
    state.expandedTimelines[id] = !state.expandedTimelines[id];
    saveLocal();
    renderSavedDetail(id);
  }
}

function bindEvents() {
  on("#enterButton", "click", enterApp);
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => showView(item.dataset.view));
  });
  on("#rangeButtons", "click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    state.range = button.dataset.value;
    renderFilters();
    renderHotspots();
  });
  on("#topicFilterButtons", "click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    state.topicFilter = button.dataset.value;
    renderFilters();
    renderHotspots();
  });
  on("#libraryStatusButtons", "click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    state.libraryStatus = button.dataset.value;
    renderLibrary();
  });
  on("#backToDashboard", "click", () => showView("dashboard"));
  on("#backToLibrary", "click", () => showView("library"));
  on("#addCustomHotspotButton", "click", addCustomHotspot);
  on("#clearCustomHotspotsButton", "click", clearCustomHotspots);
  document.body.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    handleAction(target.dataset.action, target.dataset.id, target.value, target);
  });
  document.body.addEventListener("change", (event) => {
    const target = event.target.closest("select[data-action='status']");
    if (!target) return;
    handleAction("status", target.dataset.id, target.value);
  });
}

function init() {
  try {
    normalizeSavedStatuses();
    pruneMissingLocalMarks();
    $("#todayText").textContent = new Date().toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    });
    renderFilters();
    renderHotspots();
    renderLibrary();
    bindEvents();
  } catch (error) {
    const list = $("#hotspotList");
    if (list) {
      list.innerHTML = `<article class="hotspot-card"><p class="summary">页面初始化失败：${error.message}</p><p class="muted">请按 Ctrl + F5 强制刷新；如果还不行，把这行错误发给我。</p></article>`;
    }
    console.error(error);
  }
}

init();
