// PM2 部署配置「模板」
// 用法：在服务器上复制成 ecosystem.config.js，然后填入你的 Key：
//   cp ecosystem.config.example.js ecosystem.config.js
//   vi ecosystem.config.js
//
// 注意：ecosystem.config.js 含 API Key，已在 .gitignore 中排除，切勿提交。
//       deploy.sh 也不会同步它，所以每个环境只需要在首次部署时配置一次。

module.exports = {
apps: [
  {
    name: "creovision",
    script: "server.js",
    cwd: "/opt/creovision",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false, // 生产环境不要开热重载，避免改到一半被自动加载
    max_memory_restart: "400M",
    env: {
      NODE_ENV: "production",
      PORT: 3077,
      // 必填：你的 Agnes API Key
      AGNES_API_KEY: "sk-在这里填你的Key",
      AGNES_BASE_URL: "https://apihub.agnes-ai.com",
      // 要求登录才能调用生图/生视频，防止公网盗用 Key（推荐保持 "1"）
      REQUIRE_LOGIN: "1",
      // 可选：多实例部署时，所有实例需配置同一个密钥
      // SESSION_SECRET: "一串足够长的随机字符串",
    },
  },
],
};
