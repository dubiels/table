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
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src/lib/server/db/migrate.ts ./migrate-src.ts
# The city dataset and its loader. Both are copied out flat, which is why
# seed-cities.ts imports nothing from src/ — the same constraint migrate.ts has.
COPY --from=build /app/scripts/seed-cities.ts ./seed-cities.ts
COPY --from=build /app/src/lib/server/cities/cities.tsv.gz ./cities.tsv.gz

# Seeding is idempotent: it hashes the dataset and skips when that hash is
# already loaded, so this costs nothing on a restart that changed neither.
CMD ["sh", "-c", "npx tsx migrate-src.ts && npx tsx seed-cities.ts && node build/index.js"]
