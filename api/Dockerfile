# --- deps: install once, reused by build and runtime stages ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

# --- build: compile TypeScript ---
FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

# --- runtime: prod deps only + compiled output ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
USER app
EXPOSE 3000
CMD ["node", "dist/index.js"]
