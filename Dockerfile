FROM node:26.12.1-alpine3.24

WORKDIR /app

ENV NODE_ENV=production

RUN npm install --global pnpm@12.9.0

COPY package/package.json package/pnpm-lock.yaml ./

RUN pnpm install --prod --frozen-lockfile
RUN rm -rf package.json pnpm-lock.yaml

COPY package/src ./src

USER node

CMD ["node", "src/index.ts"]
