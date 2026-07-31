# Cloud Run 用のイメージ。
# 認証情報はイメージに焼かず、実行時のサービスアカウント(ADC)から取得する。
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# package-lock.json を使って依存を固定する。npm install ではロックを無視しうる。
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src
COPY public ./public

# root で動かさない
USER node

# Cloud Run が PORT を注入する。HOST は K_SERVICE の有無から自動で 0.0.0.0 になる。
EXPOSE 8080
CMD ["node", "server.js"]
