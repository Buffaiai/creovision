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
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
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
async function agnesFetch(pathname, method, body) {
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

function send(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(s);
}

/* ---------- 模型参数整理 ---------- */
const VIDEO_DIMS = {
  "16:9": [832, 448],
  "9:16": [448, 832],
  "1:1": [576, 576],
};

/* 生图请求 → Agnes /v1/images/generations */
async function handleImage(payload) {
  const body = {
    model: payload.model || "agnes-image-2.1-flash",
    prompt: payload.prompt,
    size: payload.size || "1K",
    ratio: payload.ratio || "16:9",
    extra_body: { response_format: "url" },
  };
  if (Array.isArray(payload.images) && payload.images.length) {
    body.extra_body.image = payload.images; // 图生图 / 多图合成（URL 或 Data URI）
  }
  return agnesFetch("/v1/images/generations", "POST", body);
}

/* 生视频建任务 → Agnes /v1/videos */
async function handleVideoCreate(payload) {
  const model = payload.model || "agnes-video-v2.0";
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

  if (p === "/api/image" && req.method === "POST") {
    if (REQUIRE_LOGIN && !authUser(req)) return send(res, 401, { error: "请先登录后再生成" });
    try {
      const payload = await readBody(req);
      if (!payload.prompt) return send(res, 400, { error: "缺少 prompt" });
      const r = await handleImage(payload);
      return send(res, r.status, r.json);
    } catch (e) { return send(res, 500, { error: e.message }); }
  }

  if (p === "/api/video" && req.method === "POST") {
    if (REQUIRE_LOGIN && !authUser(req)) return send(res, 401, { error: "请先登录后再生成" });
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
    return send(res, 200, { ok: true, user: { email: u.email, createdAt: u.createdAt } });
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

  // ---- 静态文件 ----
  let file = p === "/" ? "/index.html" : p;
  file = path.normalize(file).replace(/^(\.\.[\/\\])+/, "");
  const full = path.join(__dirname, file);
  if (!full.startsWith(__dirname)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Not Found"); }
    const ext = path.extname(full).toLowerCase();
    const mime = {
      ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8", ".json": "application/json",
      ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".mp4": "video/mp4",
    }[ext] || "application/octet-stream";
    // HTML 不缓存（发版即生效），其他资源缓存 1 小时
    const cache = ext === ".html" ? "no-cache" : "public, max-age=3600";
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": cache });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`AIGC Studio 已启动: http://localhost:${PORT}`);
  console.log(`Agnes Base: ${AGNES_BASE}  |  Key: ${AGNES_KEY ? "已配置(" + AGNES_KEY.slice(0, 8) + "...)" : "未配置!"}`);
  console.log(`登录才能生成: ${REQUIRE_LOGIN ? "已开启（未登录将被拒绝）" : "未开启 —— 任何人都能调用生成接口，公网部署建议开启"}`);
});
