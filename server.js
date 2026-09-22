/**
 * AIGC 创作平台 · 代理服务（生产可用）
 * - 静态托管 index.html（带缓存头）
 * - 代理 Agnes AI 生图 / 生视频接口（Key 只存在服务端，不进前端）
 * - /api/download 代理下载生成的图片/视频（仅允许 Agnes 输出域名）
 *
 * 运行: node server.js  （Node 18+，无第三方依赖）
 *
 * 配置优先级: 环境变量 > config.json
 *   AGNES_API_KEY   API Key（推荐用环境变量，config.json 不要提交到仓库）
 *   AGNES_BASE_URL  默认 https://apihub.agnes-ai.com
 *   PORT            监听端口，默认 3077
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

/* ---------- 用户系统（文件存储 + scrypt 密码哈希 + 无状态签名 token） ---------- */
const USERS_FILE = path.join(__dirname, "users.json");
const SECRET_FILE = path.join(__dirname, ".session_secret");
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000; // token 有效期 30 天

/* 签名密钥：优先环境变量 SESSION_SECRET，否则落在 .session_secret 文件里（首次自动生成）。
   密钥持久化保存，所以服务重启后已签发的 token 依然有效 —— 不需要重新登录。 */
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try { const s = fs.readFileSync(SECRET_FILE, "utf8").trim(); if (s) return s; } catch (e) {}
  const s = crypto.randomBytes(32).toString("hex");
  try { fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 }); } catch (e) {}
  return s;
}
const SESSION_SECRET = loadSecret();

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); }
  catch { return { users: [] }; }
}
function saveUsers(data) {
  // 原子写入：先写临时文件再 rename，避免写入中途崩溃导致 users.json 损坏
  const tmp = USERS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, USERS_FILE);
}

/* ---------- 简易限流（内存滑动窗口，防登录/注册暴力破解） ---------- */
const _rl = new Map(); // key: ip+route → number[]
function rateLimit(req, route, max = 20, windowMs = 10 * 60 * 1000) {
  const ip = req.socket.remoteAddress || "?";
  const key = ip + "|" + route;
  const now = Date.now();
  const arr = (_rl.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { _rl.set(key, arr); return false; }
  arr.push(now); _rl.set(key, arr);
  // 防内存膨胀：Map 过大时清理过期窗口
  if (_rl.size > 5000) {
    for (const [k, v] of _rl) { const f = v.filter(t => now - t < windowMs); f.length ? _rl.set(k, f) : _rl.delete(k); }
  }
  return true;
}
function hashPassword(pw, salt) {
  return crypto.scryptSync(pw, salt, 64).toString("hex");
}
function verifyPassword(pw, user) {
  const a = Buffer.from(hashPassword(pw, user.salt), "hex");
  const b = Buffer.from(user.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
/* ---- 无状态签名 token：payload {email, ver, exp} + HMAC-SHA256 ----
   · 服务本身不存会话，重启不丢登录态
   · ver 是用户的 tokenVer，登出时自增，使该用户此前签发的所有 token 立即失效 */
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return body + "." + mac;
}
function parseToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const expect = crypto.createHmac("sha256", SESSION_SECRET).update(parts[0]).digest("base64url");
  const a = Buffer.from(parts[1]), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!p.email || !p.exp || Date.now() > p.exp) return null;
    return p;
  } catch (e) { return null; }
}
function newToken(user) {
  return sign({ email: user.email, ver: user.tokenVer || 0, exp: Date.now() + TOKEN_TTL });
}
function userByToken(token) {
  const p = parseToken(token);
  if (!p) return null;
  const db = loadUsers();
  const u = db.users.find(x => x.email === p.email);
  if (!u) return null;
  if ((u.tokenVer || 0) !== (p.ver || 0)) return null; // 已登出，旧 token 失效
  return u;
}
function authUser(req) {
  const h = req.headers["authorization"] || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? userByToken(m[1].trim()) : null;
}

/* ---------- 配置 ---------- */
let fileConfig = {};
try { fileConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); } catch (e) {}
const AGNES_KEY = process.env.AGNES_API_KEY || fileConfig.AGNES_API_KEY || "";
const AGNES_BASE = (process.env.AGNES_BASE_URL || fileConfig.AGNES_BASE_URL || "https://apihub.agnes-ai.com").replace(/\/$/, "");
const PORT = parseInt(process.env.PORT || fileConfig.PORT, 10) || 3077;
// 是否要求「登录才能生成」：设为 "1" 开启，开启后 /api/image 与 /api/video 校验登录 token，
// 未登录直接 401，可防止公网访客盗用你的 Key。本地开发不设置即保持原有行为。
const REQUIRE_LOGIN = String(process.env.REQUIRE_LOGIN || fileConfig.REQUIRE_LOGIN || "") === "1";

if (!AGNES_KEY) {
  console.error("⚠️  未配置 API Key：请设置环境变量 AGNES_API_KEY 或在 config.json 中填写 AGNES_API_KEY");
}

/* ---------- Agnes 请求封装 ---------- */
let _tlsRetry = false; // 避免无限递归
function _isCertError(e) {
  const msg = (e.message || "") + " " + (e.cause?.message || "");
  const code = e.cause?.code || "";
  return msg.includes("certificate") || code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY";
}
async function agnesFetch(pathname, method, body) {
  try {
    const res = await fetch(AGNES_BASE + pathname, {
      method: method || "GET",
      headers: {
        "Authorization": "Bearer " + AGNES_KEY,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: res.status, json };
  } catch (e) {
    // SSL 证书错误：macOS Node 有时验证失败，重试时禁用校验（仅一次）
    if (!_tlsRetry && _isCertError(e)) {
      _tlsRetry = true;
      console.warn("[agnesFetch] SSL 证书错误，重试时跳过验证");
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      return agnesFetch(pathname, method, body);
    }
    throw e;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", c => {
      buf += c;
      if (buf.length > 20 * 1024 * 1024) { reject(new Error("body too large")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(buf ? JSON.parse(buf) : {}); }
      catch (e) { reject(new Error("invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

/* 通用安全响应头 */
const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function send(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    ...SEC_HEADERS,
  });
  res.end(s);
}

/* ---------- 模型参数整理（入参白名单校验，防任意参数透传） ---------- */
const VIDEO_DIMS = {
  "16:9": [832, 448],
  "9:16": [448, 832],
  "1:1": [576, 576],
};
const IMAGE_MODELS = ["agnes-image-2.1-flash", "agnes-image-2.0-flash"];
const VIDEO_MODELS = ["agnes-video-2.5-flash", "agnes-video-v2.0"];
const IMG_SIZES = ["1K", "2K", "3K", "4K"];
const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"];
const MAX_PROMPT_LEN = 4000;
const MAX_REF_IMAGES = 5;

/* 生图请求 → Agnes /v1/images/generations */
async function handleImage(payload) {
  const prompt = String(payload.prompt || "").slice(0, MAX_PROMPT_LEN);
  const body = {
    model: IMAGE_MODELS.includes(payload.model) ? payload.model : "agnes-image-2.1-flash",
    prompt,
    size: IMG_SIZES.includes(payload.size) ? payload.size : "1K",
    ratio: RATIOS.includes(payload.ratio) ? payload.ratio : "16:9",
    extra_body: { response_format: "url" },
  };
  if (Array.isArray(payload.images) && payload.images.length) {
    body.extra_body.image = payload.images.slice(0, MAX_REF_IMAGES); // 图生图 / 多图合成（URL 或 Data URI）
  }
  return agnesFetch("/v1/images/generations", "POST", body);
}

/* 生视频建任务 → Agnes /v1/videos */
async function handleVideoCreate(payload) {
  if (!VIDEO_MODELS.includes(payload.model) && payload.model) {
    return { status: 400, json: { error: "不支持的视频模型" } };
  }
  const model = payload.model || "agnes-video-v2.0";
  payload.prompt = String(payload.prompt || "").slice(0, MAX_PROMPT_LEN);
  const seconds = String(Math.min(Math.max(parseInt(payload.seconds, 10) || 5, 4), 12));
  const imageUrl = payload.image_url || "";

  if (model === "agnes-video-2.5") {
    // 付费模型保持禁用（每日赠送额度有限）；免费版请用 agnes-video-2.5-flash
    return { status: 403, json: { error: "agnes-video-2.5 为付费模型，已禁用。请改用 agnes-video-2.5-flash（限时免费）" } };
  }

  if (model === "agnes-video-2.5-flash") {
    // Flash 约束：size 固定 720P；仅支持 6 种比例；参考图 ≤5
    const allowed = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
    const ratio = allowed.includes(payload.ratio) ? payload.ratio : "16:9";
    const body = {
      model,
      prompt: payload.prompt,
      mode: imageUrl ? "keyframe" : "text",
      seconds,
      size: "720P",
      aspect_ratio: ratio,
    };
    if (imageUrl) body.first_frame = imageUrl;
    return agnesFetch("/v1/videos", "POST", body);
  }

  // agnes-video-v2.0
  const dims = VIDEO_DIMS[payload.ratio] || VIDEO_DIMS["16:9"];
  const frameRate = 24;
  const numFrames = Math.min((parseInt(seconds, 10) || 5) * frameRate + 1, 441);
  const body = {
    model,
    prompt: payload.prompt,
    width: dims[0],
    height: dims[1],
    num_frames: numFrames,
    frame_rate: frameRate,
  };
  if (imageUrl) body.image = imageUrl; // 图生视频
  return agnesFetch("/v1/videos", "POST", body);
}

/* ---------- 下载代理（仅允许 Agnes 输出域名，防开放代理滥用） ---------- */
const ALLOWED_HOSTS = [
  "platform-outputs.agnes-ai.space",
  "cos-platform-outputs.agnes-ai.cn",
  "platform-outputs.agnes-ai.cn",
];
async function handleDownload(req, res, target) {
  let u;
  try { u = new URL(target); } catch { return send(res, 400, { error: "invalid url" }); }
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.includes(u.hostname)) {
    return send(res, 403, { error: "domain not allowed" });
  }
  try {
    const upstream = await fetch(u, { method: "GET" });
    if (!upstream.ok) return send(res, 502, { error: "upstream " + upstream.status });
    const len = parseInt(upstream.headers.get("content-length") || "0", 10);
    if (len > 200 * 1024 * 1024) return send(res, 413, { error: "file too large" });
    const buf = Buffer.from(await upstream.arrayBuffer());
    const name = path.basename(u.pathname) || ("agnes-output" + (path.extname(u.pathname) || ""));
    res.writeHead(200, {
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Content-Length": buf.length,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, max-age=3600",
    });
    res.end(buf);
  } catch (e) {
    send(res, 502, { error: "download failed: " + e.message });
  }
}

/* ---------- Skill 主题图：AI 生成 + 本地缓存 ----------
   prompt 只允许来自服务端白名单（seed → prompt），防止该免登录接口被用来任意刷 Key。 */
const SKILLS_DIR = path.join(__dirname, "public", "skills");
try { fs.mkdirSync(SKILLS_DIR, { recursive: true }); } catch (e) {}
const _skillInflight = new Map(); // seed → 进行中的生成 Promise（并发去重）

const SKILL_PROMPTS = {
  "y2k-chrome": "Y2K 3D glossy chrome metallic pink blue gradient spheres, millennium futuristic aesthetic, shiny plastic bubbles, ultra vibrant, cute cyber aesthetic, studio lighting, high quality",
  "japanese-summer": "Japanese summer MV aesthetic, golden sunlight through green leaves, soft film grain, lens flare, blue sky and clouds, warm nostalgic tone, cinematic",
  "vogue-editorial": "Vogue magazine style fashion editorial, minimalist composition, dramatic lighting, elegant model, clean background, high contrast, cinematic color grading, professional photography",
  "jojo-transform": "JOJO anime style transformation scene, dynamic pose, bold outlines, neon pop colors, dramatic action, stylized manga aesthetic, vibrant pink and teal, expressive characters",
  "cyberpunk-tokyo": "Cyberpunk street photography, rainy night, neon signs reflecting on wet streets, futuristic Tokyo, purple and pink glow, cinematic wide angle, moody atmosphere",
  "xianxia-mist": "Chinese ancient xianxia drama, elegant white-robed swordsman standing on misty mountain peak, ink wash painting aesthetic, bamboo forest, soft fog, ethereal atmosphere",
  "basketball-summer": "Youth campus drama scene, sunny basketball court, blue sky with white clouds, cherry blossom petals falling, warm sunlight, nostalgic atmosphere",
  "enchanted-forest": "Enchanted forest with glowing fairy lights, fireflies floating, dreamy bokeh, magical atmosphere, deep green foliage, soft golden light rays, whimsical fantasy",
  "aerial-mountain": "Aerial drone cinematography, sweeping landscape shot, golden hour, mountain vista with winding river, cinematic wide angle, epic scale, professional",
  "mecha-transform": "Giant mecha robot transformation, metallic armor plates, sparks and energy effects, dramatic smoke, cinematic lighting, futuristic battlefield, explosive action",
  "soda-splash": "Commercial soda advertisement, ice cold soda can with water droplets splashing, bright summer blue sky, refreshing lemon and ice cubes, vibrant colors, product photography",
  "hiphop-neon": "Hip hop rap music video scene, neon-lit city street at night, rapper with mic, dynamic camera angle, colorful graffiti wall, energetic mood, cinematic lighting",
  "piano-tears": "Emotional piano music video, close up of black and white piano keys, soft spotlight, melancholic atmosphere, dark concert hall, moody cinematic lighting",
  "feature-flow": "AI film production, clapperboard, cinematic, movie set, professional filmmaking, high quality",
  "feature-canvas": "digital art canvas, creative painting, software interface, modern design tool, colorful brushes",
  "feature-script": "movie script, screenplay writing, film storyboard, desk with papers, professional screenwriter",
  "feature-assets": "digital asset library, 3D models warehouse, organized storage, character avatars on shelves, futuristic",
  "gal-city-race": "cinematic city at night, fast car racing, neon lights, motion blur, commercial TVC style, epic",
  "gal-desert-city": "ancient ruined city in desert, mysterious atmosphere, cinematic wide shot, adventure, dust, epic lighting",
  "gal-bamboo-girl": "Chinese traditional bamboo flute, mountain landscape with mist, ink wash style, elegant, soft light, MV scene",
  "gal-night-diner": "cozy Japanese diner at night, warm lantern light, steam rising from food, intimate atmosphere, cinematic",
  "gal-galaxy-travel": "galaxy space exploration, star trails, nebula colors, spaceship, wonder cosmic background, epic scale",
  "gal-robot-awaken": "cyborg robot awakening, glowing blue eyes, metallic body, sparks, sci-fi laboratory, dramatic lighting",
  "gal-cyber-market": "cyberpunk night market, neon signs, asian street food, rain reflections, crowd, futuristic, vibrant",
  "gal-qingluan": "Chinese mythological phoenix bird, ancient legend, flying through clouds, traditional art style, golden feathers, epic",
  "gal-soda-bubble": "refreshing soda bubbles, ice cold drink, summer blue sky, water droplets splashing, bright, cheerful, product ad",
};

/* 1x1 占位 JPEG（生成失败或无 Key 时兜底，避免 img 报错） */
const PLACEHOLDER_JPG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Afw==",
  "base64"
);
function sendPlaceholder(res, headers = {}) {
  res.writeHead(200, {
    "Content-Type": "image/jpeg",
    "Content-Length": PLACEHOLDER_JPG.length,
    "Cache-Control": "public, max-age=60", // 占位图短缓存，恢复后尽快重试
    ...headers,
  });
  res.end(PLACEHOLDER_JPG);
}

function safeSeed(s) {
  return String(s || "skill").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/* 发送已缓存的 Skill 图片：长缓存 + ETag 协商缓存。
   图片为固定资源（随版本库发布），URL 带 v= 版本号，可放心 immutable 一年。 */
function sendSkillFile(req, res, cacheFile, cacheStatus) {
  const stat = fs.statSync(cacheFile);
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  if ((req.headers["if-none-match"] || "") === etag) {
    res.writeHead(304, { ETag: etag, "Cache-Control": "public, max-age=31536000, immutable" });
    return res.end();
  }
  res.writeHead(200, {
    "Content-Type": "image/jpeg",
    "Content-Length": stat.size,
    "Cache-Control": "public, max-age=31536000, immutable",
    "ETag": etag,
    "Last-Modified": stat.mtime.toUTCString(),
    "X-Skill-Cache": cacheStatus,
  });
  return fs.createReadStream(cacheFile).pipe(res);
}

async function handleSkillImage(req, res, url) {
  const seed = safeSeed(url.searchParams.get("seed") || "skill");
  // prompt 只认服务端白名单；size/ratio 也走白名单
  const prompt = SKILL_PROMPTS[seed] || "";
  const size = IMG_SIZES.includes(url.searchParams.get("size")) ? url.searchParams.get("size") : "1K";
  const ratio = RATIOS.includes(url.searchParams.get("ratio")) ? url.searchParams.get("ratio") : "1:1";
  const cacheFile = path.join(SKILLS_DIR, seed + ".jpg");

  // 1. 缓存命中 → 直接返回文件
  if (fs.existsSync(cacheFile)) return sendSkillFile(req, res, cacheFile, "hit");

  // 2. seed 不在白名单 / 未配置 Key → 返回占位 JPEG（不消耗 API 额度）
  if (!prompt || !AGNES_KEY) return sendPlaceholder(res);

  // 3. 调 Agnes 生图（同一 seed 并发请求只生成一次，其余等待结果）
  if (_skillInflight.has(seed)) {
    try { await _skillInflight.get(seed); } catch (e) {}
    if (fs.existsSync(cacheFile)) return sendSkillFile(req, res, cacheFile, "hit-after-wait");
    return sendPlaceholder(res);
  }
  const genPromise = (async () => {
    const r = await handleImage({ model: "agnes-image-2.1-flash", prompt, size, ratio });
    const imgUrl = r.json?.data?.[0]?.url || r.json?.data?.[0]?.b64_json;
    if (!imgUrl) throw new Error("Agnes 未返回图片: " + JSON.stringify(r.json).slice(0, 120));

    let buf;
    if (typeof imgUrl === "string" && imgUrl.startsWith("data:")) {
      buf = Buffer.from(imgUrl.split(",")[1] || "", "base64"); // base64 格式
    } else {
      const upstream = await fetch(imgUrl, { method: "GET" }); // URL 格式：下载后缓存
      if (!upstream.ok) throw new Error("下载失败 " + upstream.status);
      buf = Buffer.from(await upstream.arrayBuffer());
    }
    fs.writeFileSync(cacheFile, buf);
  })();
  _skillInflight.set(seed, genPromise);
  try {
    await genPromise;
  } catch (e) {
    _skillInflight.delete(seed);
    console.error("[skill-image]", seed, "生成失败:", e.message);
    return sendPlaceholder(res, { "X-Skill-Error": e.message.slice(0, 80) });
  }
  _skillInflight.delete(seed);
  // 注意：新生成图为 Agnes 1K 原图，入库前应压缩（参考 public/skills 现有图片规格）
  return sendSkillFile(req, res, cacheFile, "miss-generated");
}

/* ---------- HTTP 服务 ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  if (req.method === "OPTIONS") return send(res, 204, {});

  // ---- API 路由 ----
  if (p === "/api/health") return send(res, 200, { ok: true, models: {
    image: ["agnes-image-2.0-flash", "agnes-image-2.1-flash"],
    video: ["agnes-video-2.5-flash", "agnes-video-v2.0"],
  }});

  // Skill 主题图（AI 生成 + 本地缓存）
  if (p === "/api/skill-image") return handleSkillImage(req, res, url);

  if (p === "/api/image" && req.method === "POST") {
    if (REQUIRE_LOGIN && !authUser(req)) return send(res, 401, { error: "请先登录后再生成" });
    if (!rateLimit(req, "gen", 60, 60 * 60 * 1000)) return send(res, 429, { error: "生成过于频繁，请稍后再试" });
    try {
      const payload = await readBody(req);
      if (!payload.prompt) return send(res, 400, { error: "缺少 prompt" });
      const r = await handleImage(payload);
      return send(res, r.status, r.json);
    } catch (e) { return send(res, 500, { error: e.message }); }
  }

  if (p === "/api/video" && req.method === "POST") {
    if (REQUIRE_LOGIN && !authUser(req)) return send(res, 401, { error: "请先登录后再生成" });
    if (!rateLimit(req, "gen", 60, 60 * 60 * 1000)) return send(res, 429, { error: "生成过于频繁，请稍后再试" });
    try {
      const payload = await readBody(req);
      if (!payload.prompt) return send(res, 400, { error: "缺少 prompt" });
      const r = await handleVideoCreate(payload);
      return send(res, r.status, r.json);
    } catch (e) { return send(res, 500, { error: e.message }); }
  }

  if (p === "/api/video/status" && req.method === "GET") {
    try {
      const id = url.searchParams.get("id") || "";
      const model = url.searchParams.get("model") || "agnes-video-v2.0";
      if (!id) return send(res, 400, { error: "缺少 id" });
      const r = await agnesFetch("/agnesapi?video_id=" + encodeURIComponent(id) + "&model_name=" + encodeURIComponent(model), "GET");
      return send(res, r.status, r.json);
    } catch (e) { return send(res, 500, { error: e.message }); }
  }

  if (p === "/api/download" && req.method === "GET") {
    const target = url.searchParams.get("url") || "";
    if (!target) return send(res, 400, { error: "缺少 url" });
    return handleDownload(req, res, target);
  }

  // ---- 账号：注册 / 登录 / 当前用户 / 登出 ----
  if (p === "/api/auth/register" && req.method === "POST") {
    if (!rateLimit(req, "register", 10)) return send(res, 429, { error: "请求过于频繁，请 10 分钟后再试" });
    try {
      const { email, password } = await readBody(req);
      const mail = String(email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return send(res, 400, { error: "邮箱格式不正确" });
      if (!password || String(password).length < 6) return send(res, 400, { error: "密码至少 6 位" });
      const db = loadUsers();
      if (db.users.find(u => u.email === mail)) return send(res, 409, { error: "该邮箱已注册，请直接登录" });
      const salt = crypto.randomBytes(16).toString("hex");
      const user = {
        email: mail, salt, hash: hashPassword(String(password), salt),
        createdAt: Date.now(), tokenVer: 0,
      };
      db.users.push(user);
      saveUsers(db);
      const token = newToken(user);
      console.log("[注册]", mail);
      return send(res, 200, { ok: true, token, user: { email: mail } });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }

  if (p === "/api/auth/login" && req.method === "POST") {
    if (!rateLimit(req, "login", 20)) return send(res, 429, { error: "尝试次数过多，请 10 分钟后再试" });
    try {
      const { email, password } = await readBody(req);
      const mail = String(email || "").trim().toLowerCase();
      const db = loadUsers();
      const user = db.users.find(u => u.email === mail);
      if (!user) return send(res, 401, { error: "账号不存在，请先注册" });
      if (!verifyPassword(String(password || ""), user)) return send(res, 401, { error: "密码错误" });
      const token = newToken(user);
      console.log("[登录]", mail);
      return send(res, 200, { ok: true, token, user: { email: mail } });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }

  if (p === "/api/auth/me" && req.method === "GET") {
    const u = authUser(req);
    if (!u) return send(res, 401, { error: "未登录" });
    return send(res, 200, { ok: true, user: { email: u.email, username: u.username || "", avatar: u.avatar || "", createdAt: u.createdAt } });
  }

  // ---- 更新个人资料（用户名 / 头像） ----
  if (p === "/api/auth/profile" && req.method === "POST") {
    const u = authUser(req);
    if (!u) return send(res, 401, { error: "未登录" });
    try {
      const { username, avatar } = await readBody(req);
      const db = loadUsers();
      const user = db.users.find(x => x.email === u.email);
      if (!user) return send(res, 404, { error: "用户不存在" });

      if (username !== undefined) {
        const name = String(username).trim();
        if (name.length > 40) return send(res, 400, { error: "用户名不能超过 40 个字符" });
        if (name && !/^[a-zA-Z0-9\-_一-龥]+$/.test(name)) return send(res, 400, { error: "用户名只支持字母、数字、\"-\"、\"_\"和中文" });
        user.username = name;
      }
      if (avatar !== undefined) {
        const a = String(avatar);
        // 限制头像 dataURL 大小 ~2MB
        if (a.length > 2 * 1024 * 1024) return send(res, 400, { error: "头像图片不能超过 2MB" });
        user.avatar = a;
      }
      saveUsers(db);
      return send(res, 200, { ok: true, user: { email: user.email, username: user.username || "", avatar: user.avatar || "", createdAt: user.createdAt } });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }

  if (p === "/api/auth/logout" && req.method === "POST") {
    const h = req.headers["authorization"] || "";
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (m) {
      // 无状态 token 无法在服务端"删除"，改为给该用户的 tokenVer 自增，
      // 使其此前签发的所有 token 立即失效（重启后依然有效）
      const tk = parseToken(m[1].trim());
      if (tk) {
        const db = loadUsers();
        const u = db.users.find(x => x.email === tk.email);
        if (u) { u.tokenVer = (u.tokenVer || 0) + 1; saveUsers(db); }
      }
    }
    return send(res, 200, { ok: true });
  }

  // ---- 静态文件（白名单 + ETag 协商缓存 + gzip 压缩 + 分级 Cache-Control） ----
  let file = p === "/" ? "/index.html" : p;
  file = path.normalize(file).replace(/^(\.\.[\/\\])+/, "");
  const full = path.join(__dirname, file);
  if (!isStaticAllowed(full)) { res.writeHead(403, SEC_HEADERS); return res.end("Forbidden"); }
  serveStatic(req, res, full);
});

/* 静态访问白名单：根目录只允许这几个文件，其余仅放行 assets/ 与 public/ 目录。
   config.json / users.json / .session_secret / server.js 等一律 403。 */
const STATIC_ROOT_FILES = new Set(["/index.html", "/favicon.png", "/favicon.svg", "/logo.png"]);
const STATIC_DIRS = [path.join(__dirname, "assets"), path.join(__dirname, "public")];
function isStaticAllowed(full) {
  if (!full.startsWith(__dirname)) return false;
  const rel = path.relative(__dirname, full);
  // 任何一段以 . 开头（.session_secret / .git / .env …）都拒绝
  if (rel.split(path.sep).some(seg => seg.startsWith("."))) return false;
  if (STATIC_ROOT_FILES.has("/" + rel)) return true;
  return STATIC_DIRS.some(d => full.startsWith(d + path.sep));
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".mp4": "video/mp4",
  ".woff2": "font/woff2", ".ico": "image/x-icon",
};
// 可 gzip 的文本类型
const GZIP_EXTS = new Set([".html", ".js", ".css", ".json", ".svg"]);
const GZIP_MIN = 1024; // 小于 1KB 压缩无意义

function serveStatic(req, res, full) {
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...SEC_HEADERS });
      return res.end("Not Found");
    }
    const ext = path.extname(full).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
    // HTML 不缓存（发版即生效）；其他资源缓存 7 天（URL 带 ?v= 版本号，改版即换 URL）
    const cache = ext === ".html" ? "no-cache" : "public, max-age=604800";
    const baseHeaders = { "Content-Type": mime, "Cache-Control": cache, "ETag": etag, ...SEC_HEADERS };

    // 协商缓存命中 → 304
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, baseHeaders);
      return res.end();
    }

    const acceptGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
    const stream = fs.createReadStream(full);
    // 读流中途出错（如文件被删）→ 直接销毁响应，避免未捕获异常
    stream.on("error", () => res.destroy());
    if (acceptGzip && GZIP_EXTS.has(ext) && st.size >= GZIP_MIN) {
      const gz = zlib.createGzip({ level: 6 });
      res.writeHead(200, { ...baseHeaders, "Content-Encoding": "gzip", "Vary": "Accept-Encoding" });
      return stream.pipe(gz).pipe(res);
    }
    res.writeHead(200, { ...baseHeaders, "Content-Length": st.size });
    stream.pipe(res);
  });
}

server.listen(PORT, () => {
  console.log(`AIGC Studio 已启动: http://localhost:${PORT}`);
  console.log(`Agnes Base: ${AGNES_BASE}  |  Key: ${AGNES_KEY ? "已配置(" + AGNES_KEY.slice(0, 8) + "...)" : "未配置!"}`);
  console.log(`登录才能生成: ${REQUIRE_LOGIN ? "已开启（未登录将被拒绝）" : "未开启 —— 任何人都能调用生成接口，公网部署建议开启"}`);
});
