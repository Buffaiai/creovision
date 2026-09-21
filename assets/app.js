/* ============================================================
 * Agnes AI 模型注册表（经本地 server.js 代理调用，Key 在服务端）
 * ============================================================ */
const MODELS = {
  image: [
    { id: "agnes-image-2.1-flash", name: "Agnes Image 2.1 Flash", icon: "🎨", badge: { text: "推荐", cls: "rec" },
      desc: "高信息密度与复杂构图，2.1 升级版 · 1K-4K 全档免费" },
    { id: "agnes-image-2.0-flash", name: "Agnes Image 2.0 Flash", icon: "🖌️", badge: { text: "免费", cls: "free" },
      desc: "文生图 / 图生图 / 多图合成 · ELO Top 20 图像编辑模型" },
  ],
  video: [
    { id: "agnes-video-2.5-flash", name: "Agnes Video 2.5 Flash", icon: "⚡", badge: { text: "新·免费", cls: "new" },
      desc: "720P 固定 · 4-12 秒 · 文生 / 首尾帧 / 参考图 · 限时 $0 每秒" },
    { id: "agnes-video-v2.0", name: "Agnes Video V2.0", icon: "🎬", badge: { text: "免费", cls: "free" },
      desc: "文生视频 / 图生视频 · 4-12 秒时长 · 多种宽高比" },
  ],
};
const IMG_SIZES = [
  { v: "1K", n: "1K" }, { v: "2K", n: "2K" }, { v: "3K", n: "3K" }, { v: "4K", n: "4K" },
];
const VID_SIZES = [
  { v: "720P", n: "720P" }, { v: "960P", n: "960P" }, { v: "2K", n: "2K" },
];

/* ================= 工具 ================= */
const $ = s => document.querySelector(s);
/* HTML 转义：用户输入（prompt 等）插入 innerHTML 前必须过一遍，防 XSS */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function toast(msg, ms = 2800) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove("show"), ms);
}
const palettes = [
  ["#3b2b8f","#7b5cff"], ["#1f2b6e","#4a7dff"], ["#5c1f6e","#c26bff"],
  ["#0f3b4f","#2bc5d8"], ["#4f1f2b","#ff6b8a"], ["#243b0f","#8ad84a"],
  ["#3b3410","#ffb84a"], ["#101c3b","#5ca8ff"]
];
function grad(i, a = 0) {
  const p = palettes[(i + a) % palettes.length];
  const ang = 120 + (i * 47) % 120;
  return `background:linear-gradient(${ang}deg, ${p[0]}, ${p[1]});`;
}
function timeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

/* ================= 模式与参数联动 ================= */
let mode = "t2i";   // t2i | i2i | t2v | i2v
let refImages = []; // 图生图的 Data URI 列表
let activeModel = MODELS.image[0].id;

function applyMode(m) {
  mode = m;
  document.querySelectorAll(".mtab").forEach(t => t.classList.toggle("on", t.dataset.mode === m));
  const isImage = m === "t2i" || m === "i2i";
  // 尺寸下拉
  $("#sizeSel").innerHTML = (isImage ? IMG_SIZES : VID_SIZES)
    .map((x, i) => `<option value="${x.v}" ${i === 0 ? "selected" : ""}>${x.n}</option>`).join("");
  $("#sizeCurrentName").textContent = $("#sizeSel").value;
  $("#ratioCurrentName").textContent = $("#ratioSel").selectedOptions[0].text;
  $("#secCurrentName").textContent = $("#secSel").selectedOptions[0].text;
  // 显隐
  $("#refUploadRow").classList.toggle("show", m === "i2i");
  $("#refUrlRow").classList.toggle("show", m === "i2v");
  $("#secParam").style.display = isImage ? "none" : "flex";
  $("#sizeParam").style.display = "flex";
  // 占位文案
  $("#promptInput").placeholder = {
    t2i: "描述你想要的画面，例如：赛博朋克风格的霓虹街道，雨夜，电影感光影",
    i2i: "描述如何编辑参考图，例如：把背景换成雪山日落，保留人物主体",
    t2v: "描述视频内容和镜头运动，例如：一只柴犬在海边奔跑，镜头跟拍，夕阳",
    i2v: "描述静态图如何动起来，例如：让画面中的云缓慢流动，镜头缓缓推进",
  }[m];
  $("#sendLabel").textContent = isImage ? "生成图片" : "生成视频";
  // 模型：模式变更时若当前模型不在该组，自动切到该组第一个
  const list = MODELS[isImage ? "image" : "video"];
  if (!list.find(x => x.id === activeModel)) {
    activeModel = list[0].id;
  }
  $("#modelCurrentName").textContent = list.find(x => x.id === activeModel).name;
  renderModelPanel();
}
$("#modeTabs").addEventListener("click", e => {
  const el = e.target.closest(".mtab"); if (el) applyMode(el.dataset.mode);
});

/* 模型下拉面板 */
function renderModelPanel() {
  const isImage = mode === "t2i" || mode === "i2i";
  const list = MODELS[isImage ? "image" : "video"];
  const group = $("#modelPopover");
  group.innerHTML = `
    <div class="model-group-title">${isImage ? "图片模型" : "视频模型"}</div>
    ${list.map(m => {
      const active = m.id === activeModel;
      return `<div class="model-card ${active ? "active" : ""}" data-id="${m.id}">
        <div class="model-icon">${m.icon}</div>
        <div class="model-info">
          <div class="model-name">${m.name} ${m.badge ? `<span class="badge ${m.badge.cls}">${m.badge.text}</span>` : ""}</div>
          <div class="model-desc">${m.desc}</div>
        </div>
        <div class="model-pick">${active ? "✓" : "+"}</div>
      </div>`;
    }).join("")}
  `;
  group.querySelectorAll(".model-card").forEach(c => {
    c.onclick = () => {
      activeModel = c.dataset.id;
      const sel = list.find(x => x.id === activeModel);
      $("#modelCurrentName").textContent = sel.name;
      // Flash 仅支持 6 种比例，选中时把不支持的比例纠正为 16:9
      if (activeModel === "agnes-video-2.5-flash") {
        const rs = $("#ratioSel");
        if (["3:2", "2:3"].includes(rs.value)) {
          rs.value = "16:9";
          toast("Video 2.5 Flash 不支持 3:2 / 2:3，已切换为 16:9");
        }
      }
      closeAllPopovers();
      toast(`已切换到「${sel.name}」`);
    };
  });
}
/* 统一的 popover 管理（模型 / 尺寸 / 比例） */
function openModelPop() { $("#modelPopover").classList.add("open"); $("#modelTrigger").classList.add("open"); }
function closeAllPopovers(exceptId) {
  document.querySelectorAll(".model-popover.open").forEach(p => {
    if (p.id === exceptId) return;
    p.classList.remove("open");
    // 对应的 trigger 清 open
    const t = document.querySelector(`[data-trigger="${p.id}"]`);
    if (t) t.classList.remove("open");
    if (p.id === "modelPopover") $("#modelTrigger").classList.remove("open");
  });
}
function renderSizePopover() {
  const list = (mode === "t2i" || mode === "i2i") ? IMG_SIZES : VID_SIZES;
  const pop = $("#sizePopover");
  const cur = $("#sizeSel").value;
  pop.innerHTML = `<div class="model-group-title">尺寸</div>` +
    list.map(s => `
      <div class="model-card ${s.v === cur ? "active" : ""}" data-v="${s.v}">
        <div class="model-info"><div class="model-name">${s.n}</div></div>
        <div class="model-pick">${s.v === cur ? "✓" : ""}</div>
      </div>`).join("");
  pop.querySelectorAll(".model-card").forEach(c => {
    c.onclick = () => {
      const v = c.dataset.v;
      $("#sizeSel").value = v;
      $("#sizeCurrentName").textContent = v;
      closeAllPopovers();
    };
  });
}
function renderRatioPopover() {
  const pop = $("#ratioPopover");
  const cur = $("#ratioSel").value;
  pop.innerHTML = `<div class="model-group-title">比例</div>` +
    [...$("#ratioSel").options].map(o => `
      <div class="model-card ${o.value === cur ? "active" : ""}" data-v="${o.value}">
        <div class="model-info"><div class="model-name">${o.text}</div></div>
        <div class="model-pick">${o.value === cur ? "✓" : ""}</div>
      </div>`).join("");
  pop.querySelectorAll(".model-card").forEach(c => {
    c.onclick = () => {
      const v = c.dataset.v;
      $("#ratioSel").value = v;
      $("#ratioCurrentName").textContent = c.querySelector(".model-name").textContent;
      closeAllPopovers();
      // 视频 2.5 Flash 限制
      if (activeModel === "agnes-video-2.5-flash" && ["3:2", "2:3"].includes(v)) {
        $("#ratioSel").value = "16:9";
        $("#ratioCurrentName").textContent = "16:9 横版";
        toast("Video 2.5 Flash 不支持 3:2 / 2:3，已切换为 16:9");
      }
    };
  });
}
function renderSecPopover() {
  const pop = $("#secPopover");
  const cur = $("#secSel").value;
  pop.innerHTML = `<div class="model-group-title">时长</div>` +
    [...$("#secSel").options].map(o => `
      <div class="model-card ${o.value === cur ? "active" : ""}" data-v="${o.value}">
        <div class="model-info"><div class="model-name">${o.text}</div></div>
        <div class="model-pick">${o.value === cur ? "✓" : ""}</div>
      </div>`).join("");
  pop.querySelectorAll(".model-card").forEach(c => {
    c.onclick = () => {
      const v = c.dataset.v;
      $("#secSel").value = v;
      $("#secCurrentName").textContent = c.querySelector(".model-name").textContent;
      closeAllPopovers();
    };
  });
}
// param-trigger 点击切换
document.querySelectorAll(".param-trigger").forEach(trig => {
  trig.addEventListener("click", e => {
    e.stopPropagation();
    const popId = trig.dataset.trigger;
    const pop = document.getElementById(popId);
    const already = pop.classList.contains("open");
    closeAllPopovers();
    if (!already) {
      if (popId === "sizePopover") renderSizePopover();
      else if (popId === "ratioPopover") renderRatioPopover();
      else if (popId === "secPopover") renderSecPopover();
      pop.classList.add("open");
      trig.classList.add("open");
    }
  });
});
// 模型 trigger 也纳入 closeAllPopovers
$("#modelTrigger").addEventListener("click", e => {
  e.stopPropagation();
  const pop = $("#modelPopover");
  const already = pop.classList.contains("open");
  closeAllPopovers();
  if (!already) { openModelPop(); renderModelPanel(); }
});
document.addEventListener("click", e => {
  const clickedOpen = e.target.closest(".model-popover.open");
  const clickedTrig = e.target.closest(".param-trigger, #modelTrigger");
  if (!clickedOpen && !clickedTrig) closeAllPopovers();
});
applyMode("t2i");

/* 图生图：上传参考图 */
$("#uploadZone").addEventListener("click", () => $("#refFileInput").click());
$("#refFileInput").addEventListener("change", e => {
  const files = [...e.target.files].slice(0, 4);
  refImages = [];
  files.forEach(f => {
    const reader = new FileReader();
    reader.onload = () => { refImages.push(reader.result); renderThumbs(); };
    reader.readAsDataURL(f);
  });
  setTimeout(renderThumbs, 300);
  $("#uploadHint").textContent = `已选择 ${files.length} 张参考图`;
});
function renderThumbs() {
  $("#refThumbs").innerHTML = refImages.map(src => `<img src="${src}">`).join("");
}

/* ================= 生成流程 ================= */
/* 生成类接口带上登录 token（服务端开启 REQUIRE_LOGIN 后据此校验身份） */
function authHeaders() {
  const t = localStorage.getItem("aigc_token") || "";
  return t ? { Authorization: "Bearer " + t } : {};
}
async function apiPost(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { openAuth("login"); throw new Error("请先登录后再生成内容"); }
  if (!r.ok) throw new Error(j.error?.message || j.error || j.message || ("HTTP " + r.status));
  return j;
}
async function apiGet(path) {
  const r = await fetch(path, { headers: authHeaders() });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { openAuth("login"); throw new Error("请先登录后再生成内容"); }
  if (!r.ok) throw new Error(j.error?.message || j.error || j.message || ("HTTP " + r.status));
  return j;
}

/* ---- 创作记录：localStorage 持久化，刷新不丢、视频任务断点续轮询 ---- */
const STORE_KEY = "aigc_works_v1";
let works = []; // {id,type,prompt,model,status,url,error,videoId,time}
function loadWorks() {
  try { works = JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch (e) { works = []; }
  works.forEach(item => {
    const card = buildCard(item);
    if (item.status === "done" && item.url) finishCard(card, item.url, item.type === "video");
    else if (item.status === "fail") failCard(card, item.error || "生成失败");
    else if (item.type === "video" && item.videoId) pollVideo(card, item.videoId, item.model);
    // 图片任务是同步请求，页面刷新即中断，恢复时标记失败而不是永远"生成中"
    else failCard(card, "页面刷新，生成已中断");
  });
  if (works.length) $("#myworks").classList.remove("hide");
  updateWorksCount();
}
function saveWorks() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(works.slice(0, 60))); } catch (e) {}
  // 若用户当前停留在"作品"页面，实时同步最新状态
  const mwVisible = $("#mwPage") && !$("#mwPage").classList.contains("hide");
  if (mwVisible && typeof renderMyWorksPage === "function") renderMyWorksPage();
}
function findWork(id) { return works.find(w => w.id === id); }

function buildCard(item) {
  const grid = $("#workGrid");
  const card = document.createElement("div");
  card.className = "wcard";
  card.id = item.id;
  // 按真实比例渲染（默认 16:9），并按比例给卡片合适宽度，去掉 contain 黑边
  const ratio = (item.ratio || "16:9").replace(":", "/");
  const [rw, rh] = (item.ratio || "16:9").split(":").map(Number);
  const maxW = rh > rw ? 220 : (rw === rh ? 280 : 360);  // 竖图窄、方图居中、横图宽
  card.style.maxWidth = maxW + "px";
  card.style.width = "100%";
  card.innerHTML = `
    <div class="stage" style="aspect-ratio:${ratio}">
      <div class="loading">
        <div class="spinner"></div>
        <div class="lt">任务提交中…</div>
        <div class="pbar"><i></i></div>
      </div>
    </div>
    <div class="info">
      <h5 title="${esc(item.prompt)}">${esc(item.prompt)}</h5>
      <div class="meta">
        <span class="st">${item.status === "fail" ? "失败" : "生成中"}</span>
        <span>${item.model.split("-").slice(0,3).join(" ")} · ${item.time || timeStr()}</span>
      </div>
    </div>`;
  grid.prepend(card);
  $("#myworks").classList.remove("hide");
  updateWorksCount();
  return card;
}
function createWork(type, prompt, model) {
  const item = {
    id: "w" + Date.now() + Math.floor(Math.random() * 1000),
    type, prompt, model, status: "pending", time: timeStr(),
    ratio: $("#ratioSel").value,
  };
  works.unshift(item);
  saveWorks();
  return { item, card: buildCard(item) };
}
function updateWorksCount() {
  const n = document.querySelectorAll(".wcard").length;
  $("#worksCount").textContent = n ? `共 ${n} 条记录` : "";
}
function setCardProgress(card, pct, text) {
  const lt = card.querySelector(".lt"), bar = card.querySelector(".pbar i");
  if (lt) lt.textContent = text;
  if (bar) bar.style.width = Math.min(100, Math.max(3, pct)) + "%";
}
/* 按媒体真实像素校正卡片形状（修复历史记录缺 ratio、或存储比例与成片不符的情况） */
function fitCardToMedia(card, w, h) {
  if (!w || !h) return;
  const stage = card.querySelector(".stage");
  const maxW = h > w ? 220 : (w === h ? 280 : 360);
  if (stage) stage.style.aspectRatio = w + "/" + h;
  card.style.maxWidth = maxW + "px";
  const item = findWork(card.id);
  if (item && item.ratio !== w + ":" + h) { item.ratio = w + ":" + h; saveWorks(); }
}
function finishCard(card, url, isVideo) {
  const stage = card.querySelector(".stage");
  stage.innerHTML = isVideo
    ? `<video controls autoplay loop muted src="${url}"></video>`
    : `<img src="${url}">`;
  // 成片加载后按真实尺寸校正比例（老记录没有 ratio 也能自动纠正）
  if (isVideo) {
    const v = stage.querySelector("video");
    v.addEventListener("loadedmetadata", () => fitCardToMedia(card, v.videoWidth, v.videoHeight));
  } else {
    const img = stage.querySelector("img");
    img.onload = () => fitCardToMedia(card, img.naturalWidth, img.naturalHeight);
  }
  // 图片卡：直接点开大图；视频卡：用右侧按钮打开新页（避免与控制条冲突）
  if (!isVideo) {
    stage.style.cursor = "zoom-in";
    stage.title = "点击在新页面查看大图";
    stage.onclick = () => window.open(url, "_blank", "noopener");
  }
  const st = card.querySelector(".st");
  st.textContent = "已完成";
  st.className = "st done";
  const meta = card.querySelector(".meta");
  const actions = document.createElement("span");
  actions.style.display = "inline-flex";
  actions.style.gap = "10px";
  actions.style.marginLeft = "8px";
  if (isVideo) {
    const open = document.createElement("a");
    open.className = "dl-link"; open.href = url; open.target = "_blank"; open.rel = "noopener";
    open.textContent = "↗ 新页面打开";
    open.style.textDecoration = "none";
    actions.appendChild(open);
  }
  const dl = document.createElement("a");
  // 跨域资源 download 属性无效，走服务端代理强制下载
  const href = url.startsWith("data:") ? url : "/api/download?url=" + encodeURIComponent(url);
  dl.className = "dl-link"; dl.href = href; dl.download = "";
  dl.textContent = isVideo ? "⬇ 保存视频" : "⬇ 保存图片";
  actions.appendChild(dl);
  meta.appendChild(actions);
  const w = findWork(card.id);
  if (w) { w.status = "done"; w.url = url; delete w.videoId; saveWorks(); }
}
function failCard(card, msg) {
  const stage = card.querySelector(".stage");
  if (stage) stage.innerHTML = `<div class="errbox">😢 生成失败<br>${esc(msg)}</div>`;
  const st = card.querySelector(".st");
  if (st) { st.textContent = "失败"; st.className = "st fail"; }
  const w = findWork(card.id);
  if (w) { w.status = "fail"; w.error = String(msg).slice(0, 200); saveWorks(); }
}

/* 视频任务轮询 */
async function pollVideo(card, videoId, model) {
  const maxTries = 200; // ~10 分钟
  for (let i = 0; i < maxTries; i++) {
    await new Promise(r => setTimeout(r, 3000));
    let j;
    try { j = await apiGet(`/api/video/status?id=${encodeURIComponent(videoId)}&model=${encodeURIComponent(model)}`); }
    catch (e) { continue; } // 网络抖动，继续轮询
    const st = j.status || j.internal_status || "";
    const pct = typeof j.progress === "number" ? j.progress : (j.internal_progress ?? 0);
    const statusText = {
      queued: "排队中…", pending: "排队中…", inference: "生成中…",
      processing: "生成中…", uploading: "上传中…", completed: "完成", failed: "失败",
    }[st] || "生成中…";
    if (st === "completed") {
      const url = j.metadata?.url || j.url;
      if (!url) { failCard(card, "任务完成但未返回视频地址"); return; }
      setCardProgress(card, 100, "完成");
      finishCard(card, url, true);
      toast("视频生成完成 🎬");
      return;
    }
    if (st === "failed" || j.error) {
      failCard(card, j.error?.message || j.error || "服务端返回失败");
      return;
    }
    setCardProgress(card, pct, `${statusText} ${pct}%`);
  }
  failCard(card, "等待超时（10 分钟），请稍后重试");
}

/* 提交生成 */
$("#sendBtn").addEventListener("click", async () => {
  const prompt = $("#promptInput").value.trim();
  if (!prompt) return toast("先描述一下你的想法吧～");
  const model = activeModel;
  const size = $("#sizeSel").value;
  const ratio = $("#ratioSel").value;
  const seconds = $("#secSel").value;
  const btn = $("#sendBtn");

  // ---- 参数校验 ----
  if (mode === "i2i" && !refImages.length) return toast("图生图需要先上传参考图");
  if (mode === "i2v") {
    const url = $("#refUrlInput").value.trim();
    if (!url) return toast("图生视频需要填写参考图 URL");
    if (!/^https?:\/\//.test(url)) return toast("参考图 URL 需以 http(s):// 开头");
  }

  btn.disabled = true;
  $("#sendLabel").textContent = "提交中…";
  const isImage = mode === "t2i" || mode === "i2i";
  const { card } = createWork(isImage ? "image" : "video", prompt, model);
  card.scrollIntoView({ behavior: "smooth", block: "center" });

  try {
    if (mode === "t2i" || mode === "i2i") {
      setCardProgress(card, 30, "绘制中…");
      const j = await apiPost("/api/image", {
        model, prompt, size, ratio,
        images: mode === "i2i" ? refImages : [],
      });
      const url = j.data?.[0]?.url || (j.data?.[0]?.b64_json ? "data:image/png;base64," + j.data[0].b64_json : "");
      if (!url) throw new Error("接口未返回图片");
      finishCard(card, url, false);
      toast("图片生成完成 ✨");
    } else {
      setCardProgress(card, 5, "创建任务…");
      const j = await apiPost("/api/video", {
        model, prompt, size, ratio, seconds,
        image_url: mode === "i2v" ? $("#refUrlInput").value.trim() : "",
      });
      const vid = j.video_id || j.id || j.task_id;
      if (!vid) throw new Error("接口未返回任务 ID");
      const w = findWork(card.id);
      if (w) { w.videoId = vid; saveWorks(); } // 记录任务 ID，刷新页面后可续轮询
      setCardProgress(card, 8, "任务已创建，排队中…");
      toast("视频任务已提交，正在生成（预计 1-5 分钟）");
      pollVideo(card, vid, model);
    }
  } catch (e) {
    failCard(card, e.message || String(e));
    toast("⚠️ 生成失败：" + (e.message || e));
  } finally {
    btn.disabled = false;
    $("#sendLabel").textContent = (mode === "t2i" || mode === "i2i") ? "生成图片" : "生成视频";
  }
});

/* 清空创作记录 */
$("#clearWorks").addEventListener("click", () => {
  works = [];
  try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  $("#workGrid").innerHTML = "";
  $("#myworks").classList.add("hide");
  updateWorksCount();
  // 同步清空"作品"页面
  if (!$("#mwPage").classList.contains("hide")) renderMyWorksPage();
  toast("已清空创作记录（重新生成不受影响）");
});

/* 主题图工具：走本地 /api/skill-image（首次调 Agnes AI 生成，之后本地缓存）。
   prompt 已收敛到服务端白名单（按 seed 查表），前端只传 seed，防止接口被滥用刷 Key。 */
const U = (seed, prompt, ratio = "1:1") =>
  `/api/skill-image?seed=${encodeURIComponent(seed)}&ratio=${ratio}`;
const skills = [
  { name: "Y2K 3D 千禧风", cat: "热门玩法", desc: "塑料光泽 × 金属糖果色",
    img: U("y2k-chrome", "Y2K 3D glossy chrome metallic pink blue gradient spheres, millennium futuristic aesthetic, shiny plastic bubbles, ultra vibrant, cute cyber aesthetic, studio lighting, high quality") },
  { name: "日系夏天 MV", cat: "热门玩法", desc: "夏日阳光 × 清新胶片感",
    img: U("japanese-summer", "Japanese summer MV aesthetic, golden sunlight through green leaves, soft film grain, lens flare, blue sky and clouds, warm nostalgic tone, cinematic") },
  { name: "杂志风大片", cat: "热门玩法", desc: "高级质感 × 极简构图",
    img: U("vogue-editorial", "Vogue magazine style fashion editorial, minimalist composition, dramatic lighting, elegant model, clean background, high contrast, cinematic color grading, professional photography") },
  { name: "JOJO 风格变身", cat: "热门玩法", desc: "夸张姿态 × 霓虹波普",
    img: U("jojo-transform", "JOJO anime style transformation scene, dynamic pose, bold outlines, neon pop colors, dramatic action, stylized manga aesthetic, vibrant pink and teal, expressive characters") },
  { name: "赛博朋克街拍", cat: "热门玩法", desc: "霓虹雨夜 × 未来都市",
    img: U("cyberpunk-tokyo", "Cyberpunk street photography, rainy night, neon signs reflecting on wet streets, futuristic Tokyo, purple and pink glow, cinematic wide angle, moody atmosphere") },
  { name: "古风仙侠短片", cat: "剧情短片", desc: "白衣飘飘 × 水墨意境",
    img: U("xianxia-mist", "Chinese ancient xianxia drama, elegant white-robed swordsman standing on misty mountain peak, ink wash painting aesthetic, bamboo forest, soft fog, ethereal atmosphere") },
  { name: "青春校园剧", cat: "剧情短片", desc: "蓝天白云 × 夏日球场",
    img: U("basketball-summer", "Youth campus drama scene, sunny basketball court, blue sky with white clouds, cherry blossom petals falling, warm sunlight, nostalgic atmosphere") },
  { name: "微光精灵入镜", cat: "剧情短片", desc: "森林深处 × 梦幻光斑",
    img: U("enchanted-forest", "Enchanted forest with glowing fairy lights, fireflies floating, dreamy bokeh, magical atmosphere, deep green foliage, soft golden light rays, whimsical fantasy") },
  { name: "无人机运镜", cat: "商业广告", desc: "上帝视角 × 宏大叙事",
    img: U("aerial-mountain", "Aerial drone cinematography, sweeping landscape shot, golden hour, mountain vista with winding river, cinematic wide angle, epic scale, professional") },
  { name: "机甲变形特效", cat: "商业广告", desc: "金属重机 × 炸裂特效",
    img: U("mecha-transform", "Giant mecha robot transformation, metallic armor plates, sparks and energy effects, dramatic smoke, cinematic lighting, futuristic battlefield, explosive action") },
  { name: "汽水广告", cat: "商业广告", desc: "水珠飞溅 × 清凉一夏",
    img: U("soda-splash", "Commercial soda advertisement, ice cold soda can with water droplets splashing, bright summer blue sky, refreshing lemon and ice cubes, vibrant colors, product photography") },
  { name: "说唱 MV", cat: "音乐 / MV", desc: "街头态度 × 灯光炸裂",
    img: U("hiphop-neon", "Hip hop rap music video scene, neon-lit city street at night, rapper with mic, dynamic camera angle, colorful graffiti wall, energetic mood, cinematic lighting") },
  { name: "钢琴抒情 MV", cat: "音乐 / MV", desc: "黑白琴键 × 泪光朦胧",
    img: U("piano-tears", "Emotional piano music video, close up of black and white piano keys, soft spotlight, melancholic atmosphere, dark concert hall, moody cinematic lighting") },
];
/* 图片兜底：加载失败时回退到主题渐变 */
window._imgFallback = function(el, palIdx) {
  const p = palettes[(palIdx || 0) % palettes.length];
  const ang = 120 + (palIdx * 47) % 120;
  el.parentElement.style.backgroundImage = `linear-gradient(${ang}deg, ${p[0]}, ${p[1]})`;
  el.style.display = "none";
};
let activeSkillCat = "热门玩法";
function renderSkills() {
  const list = skills.filter(s => activeSkillCat === "全部" || s.cat === activeSkillCat);
  $("#skillCards").innerHTML = list.map((s, i) => `
    <div class="skill-card" onclick="useSkill('${s.name}')">
      <div class="thumb" style="${grad(i, 3)}">
        <img src="${s.img}" loading="lazy" onerror="_imgFallback(this,${i})" alt="">
        <div class="thumb-grad"></div>
        <span class="cat-tag">${s.cat}</span>
      </div>
      <div class="info">
        <span class="name">${s.name}</span>
        <span class="desc">${s.desc}</span>
      </div>
    </div>`).join("");
}
renderSkills();
function useSkill(name) {
  $("#promptInput").value = `使用「${name}」风格：`;
  $("#promptInput").focus();
  toast(`已选中 Skill「${name}」，接着描述你的想法吧`);
}
/* Skill 标签点击筛选 */
document.querySelectorAll(".skills-head .tag").forEach(t => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".skills-head .tag").forEach(x => x.classList.remove("on"));
    t.classList.add("on");
    activeSkillCat = t.textContent.trim();
    renderSkills();
  });
});
document.querySelector(".skills-head .more").addEventListener("click", () => {
  toast("更多 Skill 正在上线，敬请期待 ✨");
});

const features = [
  { t: "创作一键流", d: "上传剧本 → 自动分镜 → 一键直出", icon: "🎬",
    img: U("feature-flow", "AI film production, clapperboard, cinematic, movie set, professional filmmaking, high quality", "16:9") },
  { t: "无限画布", d: "自由排版多镜头 · 实时预览合成", icon: "🖼️",
    img: U("feature-canvas", "digital art canvas, creative painting, software interface, modern design tool, colorful brushes", "16:9") },
  { t: "剧本广场", d: "海量 IP 剧本 · 一键授权开拍", icon: "📖",
    img: U("feature-script", "movie script, screenplay writing, film storyboard, desk with papers, professional screenwriter", "16:9") },
  { t: "资产素材库", d: "角色/场景/道具 · 沉淀复用", icon: "📦",
    img: U("feature-assets", "digital asset library, 3D models warehouse, organized storage, character avatars on shelves, futuristic", "16:9") },
];
$("#features").innerHTML = features.map((f, i) => `
  <div class="feature" onclick="toast('「${f.t}」模块开发中，敬请期待')">
    <div class="f-thumb" style="${grad(i+3, 5)}">
      <img src="${f.img}" loading="lazy" onerror="_imgFallback(this,${i+3})" alt="">
      <span class="f-icon">${f.icon}</span>
    </div>
    <h4>${f.t}</h4><p>${f.d}</p>
  </div>`).join("");

const galleryWorks = [
  { t: "限时狂欢月 · 城市竞速", cat: "TVC", author: "StudioNeo", likes: "1.2w",
    img: U("gal-city-race", "cinematic city at night, fast car racing, neon lights, motion blur, commercial TVC style, epic", "16:9") },
  { t: "双探 · 荒漠迷城", cat: "影视", author: "光影旅人", likes: "9860",
    img: U("gal-desert-city", "ancient ruined city in desert, mysterious atmosphere, cinematic wide shot, adventure, dust, epic lighting", "16:9") },
  { t: "竹笛少女 · 山水间", cat: "MV", author: "南音社", likes: "8452",
    img: U("gal-bamboo-girl", "Chinese traditional bamboo flute, mountain landscape with mist, ink wash style, elegant, soft light, MV scene", "16:9") },
  { t: "深夜食堂 · AI 篇", cat: "短剧", author: "一碗剧场", likes: "7210",
    img: U("gal-night-diner", "cozy Japanese diner at night, warm lantern light, steam rising from food, intimate atmosphere, cinematic", "16:9") },
  { t: "星轨漫游指南", cat: "漫剧", author: "OrbitWorks", likes: "6933",
    img: U("gal-galaxy-travel", "galaxy space exploration, star trails, nebula colors, spaceship, wonder cosmic background, epic scale", "16:9") },
  { t: "机械之心 · 觉醒", cat: "影视", author: "GearBox", likes: "6104",
    img: U("gal-robot-awaken", "cyborg robot awakening, glowing blue eyes, metallic body, sparks, sci-fi laboratory, dramatic lighting", "16:9") },
  { t: "霓虹夜市 · 赛博日记", cat: "短剧", author: "霓虹小队", likes: "5877",
    img: U("gal-cyber-market", "cyberpunk night market, neon signs, asian street food, rain reflections, crowd, futuristic, vibrant", "16:9") },
  { t: "山海经 · 青鸾", cat: "MV", author: "拾遗录", likes: "5402",
    img: U("gal-qingluan", "Chinese mythological phoenix bird, ancient legend, flying through clouds, traditional art style, golden feathers, epic", "16:9") },
  { t: "夏日气泡水广告", cat: "TVC", author: "泡泡工厂", likes: "4988",
    img: U("gal-soda-bubble", "refreshing soda bubbles, ice cold drink, summer blue sky, water droplets splashing, bright, cheerful, product ad", "16:9") },
];
let cat = "全部";
function renderGallery() {
  const list = galleryWorks.filter(w => cat === "全部" || w.cat === cat);
  $("#galleryGrid").innerHTML = list.map((w, i) => `
    <div class="gcard" onclick="toast('播放《${w.t}》· 示例作品')">
      <div class="cover" style="${grad(i+2, cat.length)}">
        <img src="${w.img}" loading="lazy" onerror="_imgFallback(this,${i+2})" alt="">
        <span class="badge">${w.cat}</span>
        <span class="play">▶</span>
      </div>
      <div class="info"><h5>${w.t}</h5>
        <div class="meta"><span>@${w.author}</span><span>❤ ${w.likes}</span></div>
      </div>
    </div>`).join("");
}
renderGallery();
$("#gtabs").addEventListener("click", e => {
  const el = e.target.closest(".gtab"); if (!el) return;
  document.querySelectorAll(".gtab").forEach(t => t.classList.remove("on"));
  el.classList.add("on"); cat = el.dataset.cat; renderGallery();
});

document.querySelectorAll(".nav-item").forEach(n => {
  n.onclick = () => {
    document.querySelectorAll(".nav-item").forEach(x => x.classList.remove("active"));
    n.classList.add("active");
    if (n.dataset.nav === "设置") { closeCreatePage(); closeAssetsPage(); closeCanvasPage(); closeMwPage(); openSettings(); return; }
    if (n.dataset.nav === "作品") { closeSettings(); closeCreatePage(); closeAssetsPage(); closeCanvasPage(); openMwPage(); return; }
    if (n.dataset.nav === "创作") { closeSettings(); closeAssetsPage(); closeCanvasPage(); closeMwPage(); openCreatePage(); return; }
    if (n.dataset.nav === "资产") { closeSettings(); closeCreatePage(); closeCanvasPage(); closeMwPage(); openAssetsPage(); return; }
    if (n.dataset.nav === "画布") { closeSettings(); closeCreatePage(); closeAssetsPage(); closeMwPage(); openCanvasPage(); return; }
    // 首页：关闭所有子页面，恢复首页内容
    closeSettings();
    closeCreatePage();
    closeAssetsPage();
    closeCanvasPage();
    closeMwPage();
  };
});
document.querySelectorAll(".tool-btn").forEach(b => {
  b.onclick = () => { b.classList.toggle("active"); };
});

/* 启动：恢复历史创作记录 + 探测代理服务是否在线 */
loadWorks();
fetch("/api/health").then(r => r.ok ? r.json() : null).then(j => {
  if (!j) throw 0;
  $("#apiState").innerHTML = `<span class="api-dot ok"></span>Agnes AI 已接入 · 生图 ${j.models.image.length} 款 / 生视频 ${j.models.video.length} 款模型就绪`;
}).catch(() => {
  $("#apiState").innerHTML = `<span class="api-dot bad"></span>本地服务未启动 —— 请先运行 <b style="color:#a48aff">node server.js</b> 再使用生成功能`;
});

/* ============================================================
 * 注册 / 登录（账号数据存于服务端 users.json，token 存本地）
 * ============================================================ */
const authMask   = $("#authMask");
const loginBtn   = $("#loginBtn");
const userChip   = $("#userChip");
const userMail   = $("#userMail");
const userAvatar = $("#userAvatar");
const umAvatar      = $("#umAvatar");
const umName        = $("#umName");
const umAccountMail = $("#umAccountMail");
const logoutBtn  = $("#logoutBtn");
const authTitle  = $("#authTitle");
const authSub    = $("#authSub");
const authTabs   = $("#authTabs");
const authEmail  = $("#authEmail");
const authPwd    = $("#authPwd");
const authErr    = $("#authErr");
const authSubmit = $("#authSubmit");
const authClose  = $("#authClose");
const TOKEN_KEY  = "aigc_token";
const EMAIL_KEY  = "aigc_email";
const PROFILE_KEY = "aigc_profile";
let authMode = "login";

const getToken   = () => localStorage.getItem(TOKEN_KEY) || "";
const setToken   = t => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(EMAIL_KEY); localStorage.removeItem(PROFILE_KEY); };

/* 登录态 UI 成对切换：
   已登录 → 只显示账户胶囊（隐藏「注册 / 登录」）；
   未登录 → 只显示「注册 / 登录」（隐藏账户胶囊并收起菜单）。 */
function showUser(email, username, avatar) {
  const mail = String(email || "");
  const name = String(username || "").trim() || mail.split("@")[0] || "用户";
  const hasAvatar = !!avatar;
  loginBtn.classList.add("hide");
  userChip.classList.remove("hide");
  userMail.textContent = mail;
  if (hasAvatar) {
    userAvatar.innerHTML = `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    umAvatar.innerHTML = `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    const initial = (name[0] || "U").toUpperCase();
    userAvatar.textContent = initial;
    umAvatar.textContent = initial;
  }
  umName.textContent = name;
  umAccountMail.textContent = mail;
}
function hideUser() {
  userChip.classList.add("hide");
  userChip.classList.remove("open");
  loginBtn.classList.remove("hide");
  userMail.textContent = "";
}

function setAuthMode(m) {
  authMode = m;
  authTabs.querySelectorAll("span").forEach(s => s.classList.toggle("on", s.dataset.tab === m));
  if (m === "login") {
    authTitle.textContent = "登录创视界";
    authSub.textContent = "继续创作你的 AI 作品";
    authSubmit.textContent = "登录";
  } else {
    authTitle.textContent = "注册创视界";
    authSub.textContent = "创建属于你的创作账号";
    authSubmit.textContent = "注册并登录";
  }
}
function openAuth(mode) {
  setAuthMode(mode || "login");
  authErr.textContent = "";
  authMask.classList.add("show");
  setTimeout(() => authEmail.focus(), 50);
}
function closeAuth() { authMask.classList.remove("show"); }

async function fetchMe() {
  const token = getToken();
  if (!token) { hideUser(); return; }
  // 先按本地缓存的资料乐观渲染账户区，避免刷新时闪烁「注册 / 登录」
  const cachedProfile = localStorage.getItem(PROFILE_KEY);
  if (cachedProfile) {
    try {
      const p = JSON.parse(cachedProfile);
      showUser(p.email, p.username, p.avatar);
    } catch { /* ignore */ }
  } else {
    const cached = localStorage.getItem(EMAIL_KEY);
    if (cached) showUser(cached);
  }
  try {
    const r = await fetch("/api/auth/me", { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) { clearToken(); hideUser(); return; }   // token 失效/被登出 → 完整回退到游客态
    const data = await r.json();
    if (data.ok && data.user) {
      localStorage.setItem(EMAIL_KEY, data.user.email);
      localStorage.setItem(PROFILE_KEY, JSON.stringify(data.user));
      showUser(data.user.email, data.user.username, data.user.avatar);
    } else { clearToken(); hideUser(); }
  } catch (e) {
    // 网络异常：有缓存则保留乐观登录态（生成接口 401 时会再弹登录），无缓存才回退
    if (!cachedProfile) {
      const cached = localStorage.getItem(EMAIL_KEY);
      if (!cached) hideUser();
    }
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = authEmail.value.trim();
  const password = authPwd.value;
  authErr.textContent = "";
  if (!email || !password) { authErr.textContent = "请输入邮箱和密码"; return; }
  const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
  authSubmit.disabled = true;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      authErr.textContent = data.error || "操作失败，请重试";
      return;
    }
    setToken(data.token);
    const mail = (data.user && data.user.email) || email;
    localStorage.setItem(EMAIL_KEY, mail);
    // 乐观渲染，随后 fetchMe 更新真实资料
    showUser(mail);
    closeAuth();
    authEmail.value = ""; authPwd.value = "";
    toast(authMode === "login" ? "登录成功 💪" : "注册成功，已自动登录 💪");
    // 获取完整 profile 后，如果设置页开着则刷新内容
    await fetchMe();
    if (!settingsPage.classList.contains("hide")) {
      try { currentProfile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); } catch { currentProfile = null; }
      renderSettingsContent("profile");
    }
  } catch (err) {
    authErr.textContent = "网络异常，无法连接服务器";
  } finally {
    authSubmit.disabled = false;
  }
}

async function handleLogout() {
  const token = getToken();
  try {
    if (token) await fetch("/api/auth/logout", {
      method: "POST", headers: { Authorization: "Bearer " + token }
    });
  } catch (e) {}
  clearToken();
  hideUser();
  toast("已退出登录");
}

/* 事件绑定 */
loginBtn.addEventListener("click", () => openAuth("login"));
authClose.addEventListener("click", closeAuth);
authMask.addEventListener("click", e => { if (e.target === authMask) closeAuth(); });
authTabs.addEventListener("click", e => {
  const s = e.target.closest("span[data-tab]");
  if (s) { setAuthMode(s.dataset.tab); authErr.textContent = ""; }
});
authSubmit.addEventListener("click", handleAuthSubmit);
authPwd.addEventListener("keydown", e => { if (e.key === "Enter") handleAuthSubmit(e); });
authEmail.addEventListener("keydown", e => { if (e.key === "Enter") handleAuthSubmit(e); });
userChip.addEventListener("click", e => {
  e.stopPropagation();
  // 点击菜单内部（如「退出登录」）不切换展开态，避免冒泡把菜单又打开
  if (e.target.closest(".user-menu")) return;
  userChip.classList.toggle("open");
});
logoutBtn.addEventListener("click", e => { e.stopPropagation(); handleLogout(); });
document.addEventListener("click", e => {
  if (!userChip.contains(e.target)) userChip.classList.remove("open");
});

/* ============================================================
 * 设置页面（个人资料：用户名 + 头像）
 * ============================================================ */
const settingsPage    = $("#settingsPage");
const settingsContent = $("#settingsContent");
const spUserAvatar    = $("#spUserAvatar");
const spUserMail      = $("#spUserMail");

let currentProfile = null;   // 当前用户资料快照
let avatarDraft = "";       // 头像草稿（dataURL），未保存前

/* 首页内容区引用（用于切换显示） */
const heroSection  = document.querySelector(".hero");
const creatorSection = document.querySelector(".creator");
const skillsSection = document.querySelector(".skills");
const myworksSection = document.querySelector("#myworks");
const featuresSection = document.querySelector("#features");
const gallerySection = document.querySelector(".gallery");

async function openSettings() {
  // 确保有最新资料（未登录时 fetchMe 会静默失败）
  await fetchMe();
  // 从缓存取最新
  try { currentProfile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); } catch { currentProfile = null; }
  if (!currentProfile) currentProfile = { email: localStorage.getItem(EMAIL_KEY) || "", username: "", avatar: "" };

  // 更新左侧用户区
  const p = currentProfile;
  const hasLogin = !!getToken();
  spUserMail.textContent = hasLogin ? (p.email || "") : "未登录";
  if (p.avatar) {
    spUserAvatar.innerHTML = `<img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    const n = p.username || p.email || "U";
    spUserAvatar.textContent = (n[0] || "U").toUpperCase();
  }

  avatarDraft = p.avatar || "";
  renderSettingsContent("profile");

  // 隐藏首页内容，显示设置页
  heroSection && heroSection.classList.add("hide");
  creatorSection && creatorSection.classList.add("hide");
  skillsSection && skillsSection.classList.add("hide");
  myworksSection && myworksSection.classList.add("hide");
  featuresSection && featuresSection.classList.add("hide");
  gallerySection && gallerySection.classList.add("hide");
  settingsPage.classList.remove("hide");
}

function closeSettings() {
  // 隐藏设置页，恢复首页内容
  settingsPage.classList.add("hide");
  heroSection && heroSection.classList.remove("hide");
  creatorSection && creatorSection.classList.remove("hide");
  skillsSection && skillsSection.classList.remove("hide");
  myworksSection && myworksSection.classList.remove("hide");
  featuresSection && featuresSection.classList.remove("hide");
  gallerySection && gallerySection.classList.remove("hide");
}

/* ============================================================
 * 创作页面：剧集创作（上传剧本 / 粘贴文本）
 * ============================================================ */
const createPage      = $("#createPage");
const cpUpload        = $("#cpUpload");
const cpFileInput     = $("#cpFileInput");
const cpUploadBtn     = $("#cpUploadBtn");
const cpPasteBtn      = $("#cpPasteBtn");
const cpPasteMask     = $("#cpPasteMask");
const cpPasteText     = $("#cpPasteText");
const cpPasteCancel   = $("#cpPasteCancel");
const cpPasteConfirm  = $("#cpPasteConfirm");

function openCreatePage() {
  heroSection && heroSection.classList.add("hide");
  creatorSection && creatorSection.classList.add("hide");
  skillsSection && skillsSection.classList.add("hide");
  myworksSection && myworksSection.classList.add("hide");
  featuresSection && featuresSection.classList.add("hide");
  gallerySection && gallerySection.classList.add("hide");
  createPage.classList.remove("hide");
}
function closeCreatePage() {
  createPage.classList.add("hide");
  cpPasteMask.classList.remove("show");
}

/* ============================================================
 * 资产页面
 * ============================================================ */
const assetsPage = $("#assetsPage");
function openAssetsPage() {
  heroSection && heroSection.classList.add("hide");
  creatorSection && creatorSection.classList.add("hide");
  skillsSection && skillsSection.classList.add("hide");
  myworksSection && myworksSection.classList.add("hide");
  featuresSection && featuresSection.classList.add("hide");
  gallerySection && gallerySection.classList.add("hide");
  assetsPage.classList.remove("hide");
}
function closeAssetsPage() { assetsPage.classList.add("hide"); }

/* 资产页面 - 顶层 Tab */
document.querySelectorAll(".as-tab").forEach(t => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".as-tab").forEach(x => x.classList.remove("on"));
    t.classList.add("on");
  });
});
/* 资产页面 - 子 Tab */
document.querySelectorAll(".as-sub-tab").forEach(t => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".as-sub-tab").forEach(x => x.classList.remove("on"));
    t.classList.add("on");
  });
});

/* ============================================================
 * 画布页面 - Konva.js 初始化
 * ============================================================ */
let cvStage, cvLayer, cvBgLayer, cvTransformer, cvImgLayer;
let cvCanvasW = 1080, cvCanvasH = 1920;
let cvBgColor = "#ffffff";
let cvZoom = 1;
let cvActiveTool = "select";
const cvPage = document.getElementById("canvasPage");
const cvStageWrap = document.getElementById("cvStageWrap");
const cvZoomLabel = document.getElementById("cvZoomLabel");
const cvDropHint = document.getElementById("cvDropHint");

function openCanvasPage() {
  heroSection && heroSection.classList.add("hide");
  creatorSection && creatorSection.classList.add("hide");
  skillsSection && skillsSection.classList.add("hide");
  myworksSection && myworksSection.classList.add("hide");
  featuresSection && featuresSection.classList.add("hide");
  gallerySection && gallerySection.classList.add("hide");
  cvPage.classList.add("show");
  // 首次打开时初始化 Konva
  if (!cvStage) initKonva();
  else { fitStageToContainer(); }
  // 刷新图层列表
  renderLayers();
}
function closeCanvasPage() { cvPage.classList.remove("show"); }

/* ============================================================
 * 作品页面：展示首页生成的所有图片 / 视频
 * 数据源与首页"我的创作"共用 localStorage 的 works 数组，
 * 因此在首页进行创作后，作品会自动同步到本页面。
 * ============================================================ */
const mwPage  = $("#mwPage");
const mwGrid  = $("#mwGrid");
const mwEmpty = $("#mwEmpty");
const mwCount = $("#mwCount");
let mwFilter = "全部";   // 全部 / image / video

/* 根据当前筛选条件渲染作品列表 */
function renderMyWorksPage() {
  const list = works.filter(w => mwFilter === "全部" || w.type === mwFilter);
  mwGrid.innerHTML = "";
  if (!list.length) {
    mwGrid.classList.add("hide");
    mwEmpty.classList.remove("hide");
    mwCount.textContent = "";
    return;
  }
  mwEmpty.classList.add("hide");
  mwGrid.classList.remove("hide");
  mwCount.textContent = `共 ${list.length} 个作品`;

  mwGrid.innerHTML = list.map(w => {
    const isVideo = w.type === "video";
    const ratio = (w.ratio || "16:9").replace(":", "/");
    const status = w.status || "pending";
    const promptEsc = esc(w.prompt || "");
    const modelName = (w.model || "").split("-").slice(0, 3).join(" ");
    const time = w.time || "";
    let stageInner = "";
    if (status === "done" && w.url) {
      stageInner = isVideo
        ? `<video src="${w.url}" muted></video>`
        : `<img src="${w.url}" alt="">`;
    } else if (status === "fail") {
      stageInner = `<div class="ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg><span>生成失败</span></div>`;
    } else {
      stageInner = `<div class="ph"><div class="spinner"></div><span>生成中…</span></div>`;
    }
    const stTxt = status === "done" ? "已完成" : (status === "fail" ? "失败" : "生成中");
    const dlLink = status === "done" && w.url
      ? `<a class="dl-link" href="${w.url.startsWith("data:") ? w.url : "/api/download?url=" + encodeURIComponent(w.url)}" download="" target="_blank" rel="noopener">${isVideo ? "⬇ 保存视频" : "⬇ 保存图片"}</a>`
      : `<span></span>`;
    return `
      <div class="mw-card" data-id="${w.id}">
        <div class="stage" style="aspect-ratio:${ratio}">
          <span class="type-tag">${isVideo ? "🎬 视频" : "🖼️ 图片"}</span>
          ${stageInner}
        </div>
        <div class="info">
          <h5 title="${promptEsc}">${promptEsc || "（未填写描述）"}</h5>
          <div class="meta">
            <span class="st ${status === "done" ? "done" : (status === "fail" ? "fail" : "")}">${stTxt}</span>
            <span>${modelName} · ${time}</span>
          </div>
          <div class="meta">${dlLink}<span></span></div>
        </div>
      </div>`;
  }).join("");

  // 绑定视频点击播放
  mwGrid.querySelectorAll(".mw-card video").forEach(v => {
    v.addEventListener("click", () => {
      if (v.paused) { v.play(); v.controls = true; v.muted = false; }
      else { v.pause(); }
    });
  });
}

function openMwPage() {
  heroSection && heroSection.classList.add("hide");
  creatorSection && creatorSection.classList.add("hide");
  skillsSection && skillsSection.classList.add("hide");
  myworksSection && myworksSection.classList.add("hide");
  featuresSection && featuresSection.classList.add("hide");
  gallerySection && gallerySection.classList.add("hide");
  mwPage.classList.remove("hide");
  renderMyWorksPage();
}
function closeMwPage() { mwPage.classList.add("hide"); }

/* 作品页面 - 顶部筛选 Tab */
$("#mwTabs").addEventListener("click", e => {
  const el = e.target.closest(".mw-tab"); if (!el) return;
  document.querySelectorAll(".mw-tab").forEach(t => t.classList.remove("on"));
  el.classList.add("on");
  mwFilter = el.dataset.mw;
  renderMyWorksPage();
});
/* 作品页面 - 空态按钮：跳回首页创作 */
$("#mwGoHome").addEventListener("click", () => {
  const homeNav = document.querySelector('.nav-item[data-nav="首页"]');
  if (homeNav) homeNav.click();
});

function initKonva() {
  cvStage = new Konva.Stage({
    container: cvStageWrap,
    width: cvStageWrap.clientWidth,
    height: cvStageWrap.clientHeight,
    draggable: false,
  });
  // 背景层
  cvBgLayer = new Konva.Layer();
  const bgRect = new Konva.Rect({
    x: 0, y: 0, width: cvCanvasW, height: cvCanvasH,
    fill: cvBgColor, name: "__bg__",
  });
  cvBgLayer.add(bgRect);
  // 主图层（图片/形状/文字）
  cvLayer = new Konva.Layer();
  cvStage.add(cvBgLayer);
  cvStage.add(cvLayer);
  // Transformer
  cvTransformer = new Konva.Transformer({
    rotateEnabled: true,
    anchorSize: 8,
    borderStroke: "#7b5cff",
    anchorStroke: "#7b5cff",
    anchorFill: "#fff",
  });
  cvLayer.add(cvTransformer);
  cvTransformer.attachTo(cvLayer.find(".image, .text, .rect-shape, .circle-shape"));

  // 居中画布
  fitStageToContainer();

  // 点击：空白处取消选中；点到元素则选中（Konva 无内建 select 事件，需手动挂到 Transformer）
  const CV_SELECTABLE = ["image", "text", "rect-shape", "circle-shape"];
  cvStage.on("click tap", e => {
    if (e.target === cvStage || e.target === cvBgLayer.findOne(".__bg__")) {
      cvTransformer.nodes([]);
      cvLayer.batchDraw();
      renderPropsPanel(null);
      renderLayers();
      return;
    }
    // 从点击目标向上找到可选择的节点（Transformer 的手柄等不算）
    let node = e.target;
    while (node && node !== cvLayer && !CV_SELECTABLE.includes(node.name())) node = node.getParent();
    if (node && node !== cvLayer && CV_SELECTABLE.includes(node.name())) {
      cvTransformer.nodes([node]);
      cvLayer.batchDraw();
      renderPropsPanel(node);
      renderLayers();
    }
  });

  // 元素位置/尺寸变化时刷新图层
  cvLayer.on("dragend transformend", e => {
    renderPropsPanel(e.target);
    renderLayers();
  });

  // 窗口 resize
  window.addEventListener("resize", () => {
    if (!cvPage.classList.contains("show")) return;
    cvStage.width(cvStageWrap.clientWidth);
    cvStage.height(cvStageWrap.clientHeight);
    fitStageToContainer();
  });

  // 键盘快捷键
  document.addEventListener("keydown", e => {
    if (!cvPage.classList.contains("show")) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      if (cvTransformer.nodes().length) {
        cvTransformer.nodes().forEach(n => n.destroy());
        cvTransformer.nodes([]);
        cvLayer.batchDraw();
        renderLayers();
        renderPropsPanel(null);
      }
    } else if (e.key === "v" || e.key === "V") setTool("select");
    else if (e.key === "h" || e.key === "H") setTool("hand");
    else if (e.key === "t" || e.key === "T") setTool("text");
    else if (e.key === "Escape") { cvTransformer.nodes([]); cvLayer.batchDraw(); }
  });

  // 拖拽上传
  ["dragenter", "dragover"].forEach(evt => {
    cvStageWrap.addEventListener(evt, e => { e.preventDefault(); cvDropHint.classList.add("show"); });
  });
  ["dragleave", "drop"].forEach(evt => {
    cvStageWrap.addEventListener(evt, e => { e.preventDefault(); cvDropHint.classList.remove("show"); });
  });
  cvStageWrap.addEventListener("drop", e => {
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith("image/"));
    files.forEach(addImageFromFile);
  });

  // 画布内部拖拽
  cvStage.on("mouseenter", () => {
    if (cvActiveTool === "hand") cvStage.container().style.cursor = "grab";
  });

  bindCanvasControls();
}

function fitStageToContainer() {
  if (!cvStage) return;
  const cw = cvStage.width();
  const ch = cvStage.height();
  const scale = Math.min(cw / cvCanvasW, ch / cvCanvasH) * 0.7;
  cvZoom = scale;
  cvStage.scale({ x: scale, y: scale });
  cvStage.position({
    x: (cw - cvCanvasW * scale) / 2,
    y: (ch - cvCanvasH * scale) / 2,
  });
  cvZoomLabel.textContent = Math.round(scale * 100) + "%";
  cvLayer.batchDraw();
}

function setTool(tool) {
  cvActiveTool = tool;
  document.querySelectorAll(".cv-tool").forEach(t => t.classList.toggle("on", t.dataset.tool === tool));
  if (tool === "hand") {
    cvStage.draggable(true);
    cvStage.container().style.cursor = "grab";
    cvTransformer.nodes([]);
    cvLayer.batchDraw();
  } else {
    cvStage.draggable(false);
    cvStage.container().style.cursor = tool === "select" ? "default" : "crosshair";
  }
}

function addImageFromFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      // 缩放适配画布
      let w = img.naturalWidth, h = img.naturalHeight;
      const maxDim = Math.max(cvCanvasW, cvCanvasH) * 0.8;
      if (w > maxDim || h > maxDim) {
        const s = maxDim / Math.max(w, h);
        w *= s; h *= s;
      }
      const node = new Konva.Image({
        image: img, width: w, height: h,
        x: (cvCanvasW - w) / 2,
        y: (cvCanvasH - h) / 2,
        draggable: true,
        name: "image",
      });
      node._fileName = file.name;
      cvLayer.add(node);
      selectNode(node);
      cvLayer.batchDraw();
      renderLayers();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function addTextNode() {
  const node = new Konva.Text({
    x: cvCanvasW / 2 - 100,
    y: cvCanvasH / 2,
    text: "双击编辑文字",
    fontSize: 36,
    fontStyle: "bold",
    fill: "#ffffff",
    width: 200,
    align: "center",
    draggable: true,
    name: "text",
  });
  cvLayer.add(node);
  selectNode(node);
  cvLayer.batchDraw();
  renderLayers();

  // 双击编辑
  node.on("dblclick", () => {
    const textNode = node;
    const stage = cvStage;
    const layer = cvLayer;
    const text = textNode.text();
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "absolute";
    textarea.style.top = stage.container().offsetTop + textNode.getClientRect({ relativeTo: stage }).top + "px";
    textarea.style.left = stage.container().offsetLeft + textNode.getClientRect({ relativeTo: stage }).left + "px";
    textarea.style.width = textNode.getClientRect().width + "px";
    textarea.style.height = textNode.getClientRect().height + "px";
    textarea.style.fontSize = textNode.fontSize() + "px";
    textarea.style.fontWeight = textNode.fontStyle();
    textarea.style.color = textNode.fill();
    textarea.style.background = "transparent";
    textarea.style.border = "1px dashed #7b5cff";
    textarea.style.colorScheme = "dark";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const removeTextarea = () => {
      textarea.remove();
      textNode.text(textarea.value || "文字");
      layer.batchDraw();
      renderLayers();
      renderPropsPanel(textNode);
    };
    textarea.addEventListener("blur", removeTextarea);
    textarea.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); textarea.blur(); }
      if (e.key === "Escape") { textarea.value = text; textarea.blur(); }
    });
  });
}

function addShapeNode(type) {
  let node;
  const cx = cvCanvasW / 2, cy = cvCanvasH / 2;
  if (type === "rect") {
    node = new Konva.Rect({
      x: cx - 100, y: cy - 60, width: 200, height: 120,
      fill: "#7b5cff", cornerRadius: 12, draggable: true, name: "rect-shape",
    });
  } else {
    node = new Konva.Circle({
      x: cx, y: cy, radius: 80,
      fill: "#ff6bb5", draggable: true, name: "circle-shape",
    });
  }
  cvLayer.add(node);
  selectNode(node);
  cvLayer.batchDraw();
  renderLayers();
}

function selectNode(node) {
  cvTransformer.nodes([node]);
}

function bindCanvasControls() {
  // 工具栏
  document.querySelectorAll(".cv-tool").forEach(t => {
    t.addEventListener("click", () => {
      const tool = t.dataset.tool;
      if (tool === "upload") {
        document.getElementById("cvFileInput").click();
      } else if (tool === "text") {
        setTool("select");
        addTextNode();
      } else if (tool === "rect") {
        setTool("select");
        addShapeNode("rect");
      } else if (tool === "circle") {
        setTool("select");
        addShapeNode("circle");
      } else {
        setTool(tool);
      }
    });
  });

  // 文件选择
  document.getElementById("cvFileInput").addEventListener("change", e => {
    Array.from(e.target.files || []).filter(f => f.type.startsWith("image/")).forEach(addImageFromFile);
    e.target.value = "";
  });

  // 预设尺寸
  document.getElementById("cvPreset").addEventListener("change", e => {
    const val = e.target.value;
    if (val === "custom") return;
    const [w, h] = val.split("x").map(Number);
    cvCanvasW = w; cvCanvasH = h;
    document.getElementById("cvW").value = w;
    document.getElementById("cvH").value = h;
    resizeCanvas();
  });
  document.getElementById("cvResize").addEventListener("click", resizeCanvas);
  document.getElementById("cvW").addEventListener("change", e => cvCanvasW = Number(e.target.value));
  document.getElementById("cvH").addEventListener("change", e => cvCanvasH = Number(e.target.value));

  // 背景色
  document.getElementById("cvBgColor").addEventListener("input", e => {
    cvBgColor = e.target.value;
    const bg = cvBgLayer.findOne(".__bg__");
    if (bg) bg.fill(cvBgColor);
    cvBgLayer.batchDraw();
  });

  // 缩放
  document.getElementById("cvZoomIn").addEventListener("click", () => zoomBy(1.2));
  document.getElementById("cvZoomOut").addEventListener("click", () => zoomBy(1 / 1.2));
  document.getElementById("cvZoomReset").addEventListener("click", () => fitStageToContainer());

  // 删除
  document.getElementById("cvDelete").addEventListener("click", () => {
    cvTransformer.nodes().forEach(n => n.destroy());
    cvTransformer.nodes([]);
    cvLayer.batchDraw();
    renderLayers();
    renderPropsPanel(null);
  });

  // 导出
  document.getElementById("cvExport").addEventListener("click", exportCanvas);

  // 面板 Tab
  document.querySelectorAll(".cv-panel-tab").forEach(t => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".cv-panel-tab").forEach(x => x.classList.remove("on"));
      t.classList.add("on");
      document.querySelectorAll(".cv-panel-body > div").forEach(x => x.classList.remove("on"));
      document.getElementById(t.dataset.tab === "props" ? "cvProps" : "cvLayers").classList.add("on");
    });
  });

  // 滚轮缩放
  cvStageWrap.addEventListener("wheel", e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomBy(e.deltaY > 0 ? 1 / 1.1 : 1.1);
    }
  }, { passive: false });
}

function zoomBy(factor) {
  if (!cvStage) return;
  cvZoom = Math.max(0.1, Math.min(5, cvZoom * factor));
  const pos = cvStage.position();
  const oldScale = cvStage.scaleX();
  const newScale = cvZoom;
  const mousePointTo = {
    x: cvStageWrap.clientWidth / 2,
    y: cvStageWrap.clientHeight / 2,
  };
  cvStage.scale({ x: newScale, y: newScale });
  cvStage.position({
    x: mousePointTo.x - (mousePointTo.x - pos.x) * (newScale / oldScale),
    y: mousePointTo.y - (mousePointTo.y - pos.y) * (newScale / oldScale),
  });
  cvZoomLabel.textContent = Math.round(newScale * 100) + "%";
  cvLayer.batchDraw();
}

function resizeCanvas() {
  cvCanvasW = Number(document.getElementById("cvW").value);
  cvCanvasH = Number(document.getElementById("cvH").value);
  // 更新背景
  const bg = cvBgLayer.findOne(".__bg__");
  if (bg) { bg.width(cvCanvasW); bg.height(cvCanvasH); }
  // 超出画布的元素限制
  cvLayer.find(".image, .text, .rect-shape, .circle-shape").forEach(n => {
    const r = n.getClientRect();
    if (r.width > cvCanvasW) n.width(cvCanvasW * 0.8);
    if (r.height > cvCanvasH) n.height(cvCanvasH * 0.8);
    n.position({
      x: Math.min(n.x(), cvCanvasW - 50),
      y: Math.min(n.y(), cvCanvasH - 50),
    });
  });
  cvBgLayer.batchDraw();
  cvLayer.batchDraw();
  fitStageToContainer();
  toast(`画布尺寸：${cvCanvasW} × ${cvCanvasH}`);
}

function exportCanvas() {
  if (!cvStage) return;
  // 创建导出 stage，只保留画布区域内容
  const exportStage = new Konva.Stage({
    width: cvCanvasW, height: cvCanvasH, container: document.createElement("div"),
  });
  const exportBg = cvBgLayer.clone();
  const exportLayer = cvLayer.clone();
  // 移除 transformer
  exportLayer.find("Transformer").forEach(t => t.destroy());
  exportStage.add(exportBg);
  exportStage.add(exportLayer);

  const dataUrl = exportStage.toDataURL({ pixelRatio: 1, mimeType: "image/png" });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `canvas_${cvCanvasW}x${cvCanvasH}.png`;
  a.click();
  toast("导出成功！");
  // 清理
  exportStage.destroy();
}

/* ---- 图层面板 ---- */
function renderLayers() {
  if (!cvLayer) return;
  const items = cvLayer.find(".image, .text, .rect-shape, .circle-shape");
  const list = document.getElementById("cvLayerList");
  const empty = document.getElementById("cvEmptyLayers");
  if (!items.length) { list.innerHTML = ""; empty.style.display = "block"; return; }
  empty.style.display = "none";
  // 倒序：顶层在上
  list.innerHTML = "";
  for (let i = items.length - 1; i >= 0; i--) {
    const n = items[i];
    const div = document.createElement("div");
    div.className = "cv-layer-item";
    if (cvTransformer.nodes().includes(n)) div.classList.add("on");
    let thumbHtml = "", name = "";
    if (n.name() === "image") {
      name = n._fileName || "图片";
      const img = n.image();
      if (img) thumbHtml = `<img src="${img.src}">`;
    } else if (n.name() === "text") {
      name = "文字: " + (n.text().slice(0, 12) || "文字");
      thumbHtml = `<span style="font-size:10px;color:#7b5cff;font-weight:700;">T</span>`;
    } else if (n.name() === "rect-shape") {
      name = "矩形";
      thumbHtml = `<div style="width:20px;height:14px;border-radius:3px;background:${n.fill()};"></div>`;
    } else if (n.name() === "circle-shape") {
      name = "圆形";
      thumbHtml = `<div style="width:18px;height:18px;border-radius:50%;background:${n.fill()};"></div>`;
    }
    div.innerHTML = `
      <div class="cv-layer-thumb">${thumbHtml}</div>
      <div class="cv-layer-name">${name}</div>
      <div class="cv-layer-eye ${!n.visible() ? "off" : ""}" title="显隐">
        ${n.visible() ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'}
      </div>
    `;
    div.addEventListener("click", e => {
      if (e.target.closest(".cv-layer-eye")) {
        n.visible(!n.visible());
        cvLayer.batchDraw();
        renderLayers();
      } else {
        selectNode(n);
        cvLayer.batchDraw();
        renderLayers();
        renderPropsPanel(n);
      }
    });
    list.appendChild(div);
  }
}

/* ---- 属性面板 ---- */
function renderPropsPanel(node) {
  const noSel = document.getElementById("cvNoSel");
  const content = document.getElementById("cvPropContent");
  if (!node) { noSel.style.display = "block"; content.style.display = "none"; return; }
  noSel.style.display = "none"; content.style.display = "block";

  const type = node.name();
  let html = `
    <div class="cv-prop-group">
      <div class="cv-prop-label">位置</div>
      <div class="cv-prop-row"><label>X</label><input type="number" id="ppX" value="${Math.round(node.x())}"></div>
      <div class="cv-prop-row"><label>Y</label><input type="number" id="ppY" value="${Math.round(node.y())}"></div>
    </div>
    <div class="cv-prop-group">
      <div class="cv-prop-label">尺寸</div>
      <div class="cv-prop-row"><label>W</label><input type="number" id="ppW" value="${Math.round(node.width() * (node.scaleX() || 1))}"></div>
      <div class="cv-prop-row"><label>H</label><input type="number" id="ppH" value="${Math.round(node.height() * (node.scaleY() || 1))}"></div>
    </div>
    <div class="cv-prop-group">
      <div class="cv-prop-label">旋转</div>
      <div class="cv-prop-row"><input type="range" id="ppRot" min="0" max="360" value="${Math.round(node.rotation())}"> <span style="font-size:12px;color:var(--text-faint)">${Math.round(node.rotation())}°</span></div>
    </div>
  `;
  if (type === "text") {
    html += `
      <div class="cv-prop-group">
        <div class="cv-prop-label">文字内容</div>
        <div class="cv-prop-row"><textarea id="ppText" rows="3" style="flex:1;background:#ffffff08;border:1px solid var(--card-border);border-radius:6px;color:var(--text);padding:6px 8px;font-size:13px;outline:none;resize:vertical;">${node.text()}</textarea></div>
      </div>
      <div class="cv-prop-group">
        <div class="cv-prop-label">文字样式</div>
        <div class="cv-prop-row"><label>字号</label><input type="number" id="ppFS" value="${node.fontSize()}"></div>
        <div class="cv-prop-row"><label>颜色</label><input type="color" id="ppColor" value="${node.fill()}"></div>
        <div class="cv-prop-row"><label>粗体</label><input type="checkbox" id="ppBold" ${node.fontStyle() === "bold" ? "checked" : ""} style="width:16px;height:16px;"></div>
      </div>
    `;
  } else if (type === "rect-shape" || type === "circle-shape") {
    html += `
      <div class="cv-prop-group">
        <div class="cv-prop-label">填充颜色</div>
        <div class="cv-prop-row"><label>颜色</label><input type="color" id="ppColor" value="${node.fill()}"></div>
      </div>
    `;
  }
  content.innerHTML = html;

  // 绑定事件
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("input", fn); };
  bind("ppX", e => { node.x(Number(e.target.value)); cvLayer.batchDraw(); });
  bind("ppY", e => { node.y(Number(e.target.value)); cvLayer.batchDraw(); });
  bind("ppW", e => {
    const v = Number(e.target.value);
    if (type === "image") node.scaleX(v / node.width());
    else node.width(v);
    cvLayer.batchDraw();
  });
  bind("ppH", e => {
    const v = Number(e.target.value);
    if (type === "image") node.scaleY(v / node.height());
    else node.height(v);
    cvLayer.batchDraw();
  });
  bind("ppRot", e => { node.rotation(Number(e.target.value)); cvLayer.batchDraw(); });
  if (type === "text") {
    bind("ppText", e => { node.text(e.target.value); cvLayer.batchDraw(); });
    bind("ppFS", e => { node.fontSize(Number(e.target.value)); cvLayer.batchDraw(); });
    bind("ppColor", e => { node.fill(e.target.value); cvLayer.batchDraw(); });
    document.getElementById("ppBold")?.addEventListener("change", e => {
      node.fontStyle(e.target.checked ? "bold" : "normal"); cvLayer.batchDraw();
    });
  } else {
    bind("ppColor", e => { node.fill(e.target.value); cvLayer.batchDraw(); });
  }
}

/* 左侧子导航切换 */
document.querySelectorAll(".sp-item").forEach(item => {
  item.addEventListener("click", () => {
    const key = item.dataset.sp;
    // 退出登录特殊处理
    if (key === "logout") {
      handleLogout().then(() => {
        // 退出后刷新设置页内容（变为未登录态）
        currentProfile = { email: "", username: "", avatar: "" };
        avatarDraft = "";
        spUserMail.textContent = "未登录";
        spUserAvatar.textContent = "U";
        renderSettingsContent("profile");
      });
      return;
    }
    document.querySelectorAll(".sp-item").forEach(x => x.classList.remove("on"));
    item.classList.add("on");
    renderSettingsContent(key);
  });
});

function renderSettingsContent(key) {
  const p = currentProfile || {};
  const hasLogin = !!getToken();
  if (key === "profile") {
    // 未登录 → 显示登录引导
    if (!hasLogin) {
      settingsContent.innerHTML = `
        <div class="sc-profile" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:20px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="56" height="56" opacity=".4"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          <div style="font-size:16px;color:var(--text-dim)">登录后可管理个人资料</div>
          <button class="sc-save-btn" id="scLoginBtn" style="padding:12px 48px">立即登录 / 注册</button>
        </div>`;
      $("#scLoginBtn").addEventListener("click", () => openAuth("login"));
      return;
    }
    const initial = (p.username || p.email || "U").charAt(0).toUpperCase();
    const avatarHTML = avatarDraft
      ? `<div class="avatar"><img src="${avatarDraft}"></div>`
      : `<div class="avatar">${initial}</div>`;
    settingsContent.innerHTML = `
      <div class="sc-profile">
        <div class="sc-avatar-row">
          <div class="sc-avatar-wrap" id="scAvatarWrap">
            ${avatarHTML}
            <input type="file" id="scAvatarInput" accept="image/*" style="display:none">
            <div class="sc-avatar-edit" title="更换头像">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </div>
          </div>
        </div>
        <div class="sc-field">
          <label>用户名</label>
          <input type="text" id="scUsername" placeholder="输入用户名" value="${p.username || ""}" maxlength="40">
          <div class="hint">长度 1-40 个字符，支持字母、数字、"-"、"_"和中文。</div>
        </div>
        <div class="sc-field">
          <label>邮箱</label>
          <div class="readonly">${p.email || ""}</div>
        </div>
        <div class="sc-save-row">
          <button class="sc-save-btn" id="scSaveBtn">保存修改</button>
        </div>
      </div>
    `;
    // 绑定头像上传
    const wrap = $("#scAvatarWrap");
    const fileInput = $("#scAvatarInput");
    wrap.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", e => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { toast("头像图片不能超过 2MB"); return; }
      if (!file.type.startsWith("image/")) { toast("请选择图片文件"); return; }
      const reader = new FileReader();
      reader.onload = ev => {
        avatarDraft = ev.target.result;
        wrap.innerHTML = `
          <div class="avatar"><img src="${avatarDraft}"></div>
          <input type="file" id="scAvatarInput" accept="image/*" style="display:none">
          <div class="sc-avatar-edit" title="更换头像">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </div>`;
        wrap.addEventListener("click", () => fileInput.click());
      };
      reader.readAsDataURL(file);
    });
    $("#scSaveBtn").addEventListener("click", saveProfile);
  } else {
    const label = document.querySelector(`.sp-item[data-sp="${key}"]`)?.textContent.trim() || "";
    settingsContent.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-faint);gap:12px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" opacity=".5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
        <div style="font-size:14px">「${label}」模块开发中～</div>
      </div>`;
  }
}

async function saveProfile() {
  const username = $("#scUsername").value.trim();
  if (!username) { toast("用户名不能为空"); return; }
  if (username.length > 40) { toast("用户名不能超过 40 个字符"); return; }
  if (!/^[a-zA-Z0-9\-_一-龥]+$/.test(username)) { toast("用户名只支持字母、数字、\"-\"、\"_\"和中文"); return; }

  const btn = $("#scSaveBtn");
  btn.disabled = true; btn.textContent = "保存中…";
  try {
    const r = await fetch("/api/auth/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
      body: JSON.stringify({ username, avatar: avatarDraft })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) { toast(data.error || "保存失败"); return; }
    // 更新本地缓存 + UI
    currentProfile = data.user;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(data.user));
    localStorage.setItem(EMAIL_KEY, data.user.email);
    showUser(data.user.email, data.user.username, data.user.avatar);
    // 更新设置页左侧用户区
    spUserMail.textContent = data.user.email;
    if (data.user.avatar) {
      spUserAvatar.innerHTML = `<img src="${data.user.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    } else {
      const n = data.user.username || data.user.email.split("@")[0] || "U";
      spUserAvatar.textContent = (n[0] || "U").toUpperCase();
    }
    toast("已保存 ✅");
    btn.textContent = "保存修改";
  } catch (e) {
    toast("网络异常，保存失败");
  } finally {
    btn.disabled = false;
  }
}

/* 创作页面 - 上传/粘贴交互 */
cpUploadBtn.addEventListener("click", () => cpFileInput.click());
cpFileInput.addEventListener("change", e => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  toast(`已选择 ${files.length} 个文件，开始解析剧本…`);
  // TODO: 后续接入后端解析流程
});
cpPasteBtn.addEventListener("click", () => { cpPasteMask.classList.add("show"); cpPasteText.focus(); });
cpPasteCancel.addEventListener("click", () => cpPasteMask.classList.remove("show"));
cpPasteMask.addEventListener("click", e => { if (e.target === cpPasteMask) cpPasteMask.classList.remove("show"); });
document.addEventListener("keydown", e => { if (e.key === "Escape") cpPasteMask.classList.remove("show"); });
cpPasteConfirm.addEventListener("click", () => {
  const text = cpPasteText.value.trim();
  if (!text) { toast("请先粘贴剧本内容"); return; }
  toast(`已粘贴 ${text.length} 字，开始创作…`);
  cpPasteMask.classList.remove("show");
  cpPasteText.value = "";
  // TODO: 后续接入后端生成流程
});

/* 创作页面 - 拖拽上传 */
["dragenter", "dragover"].forEach(evt => {
  cpUpload.addEventListener(evt, e => { e.preventDefault(); cpUpload.classList.add("drag"); });
});
["dragleave", "drop"].forEach(evt => {
  cpUpload.addEventListener(evt, e => { e.preventDefault(); cpUpload.classList.remove("drag"); });
});
cpUpload.addEventListener("drop", e => {
  const files = Array.from(e.dataTransfer?.files || []);
  if (!files.length) return;
  toast(`已拖入 ${files.length} 个文件，开始解析剧本…`);
  // TODO: 后续接入后端解析流程
});

/* 启动：若本地已有登录态则恢复 */
fetchMe();
