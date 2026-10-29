# 宝宝记录 · 极空间照片服务
# 构建：docker build -t baby-record-photo .
# 运行见 README.md
FROM node:20-alpine
WORKDIR /app
COPY package.json server.js ./
RUN mkdir -p /data
ENV DATA_DIR=/data
ENV PORT=8789
EXPOSE 8789
VOLUME ["/data"]
CMD ["node", "server.js"]
