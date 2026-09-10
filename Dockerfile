# 可选：Docker 部署方式（如果你更习惯用容器）
#
# 构建：docker build -t creovision .
# 运行：docker run -d --name aigc \
#         -p 3077:3077 \
#         -e AGNES_API_KEY=sk-你的Key \
#         -v $(pwd)/users.json:/app/users.json \
#         --restart unless-stopped creovision
#
# 注意：挂载 users.json 是为了让注册的账号在容器重建后依然存在
FROM node:18-alpine

WORKDIR /app
COPY server.js index.html favicon.svg favicon.png logo.png ./

ENV PORT=3077
ENV NODE_ENV=production

EXPOSE 3077

CMD ["node", "server.js"]
