FROM node:22-alpine AS build
WORKDIR /app
# native build tools for better-sqlite3 (uses prebuilds when available)
# py3-setuptools provides the distutils shim node-gyp needs -- Alpine's
# python3 is 3.12+, which dropped distutils from the standard library, and
# without this a native module build (better-sqlite3) fails at gyp's
# configure step. better-sqlite3 has no prebuilt binary for musl/Alpine on
# this Node version, so it always falls back to compiling from source here.
RUN apk add --no-cache python3 py3-setuptools make g++
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund && apk del python3 make g++
COPY server ./server
COPY fonts ./fonts
COPY --from=build /app/dist ./dist

ENV PORT=5334
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 5334
CMD ["node", "server/index.js"]
