FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src/lib/server/db/migrate.ts ./migrate-src.ts
RUN npm install -D tsx typescript
COPY --from=build /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

CMD ["sh", "-c", "npx tsx migrate-src.ts && node build/index.js"]
