FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# ---------------------------------------------------------------------------
# Chrome/Puppeteer runtime libraries.
#
# The t64 suffix matters: Ubuntu 24.04 (noble) renamed these packages
# (libatk1.0-0 -> libatk1.0-0t64) and installing the old name silently
# produces "libatk-1.0.so.0: cannot open shared object file" at Chrome
# launch time. We try both variants so the same Dockerfile builds on
# Debian bookworm and any Ubuntu release.
# ---------------------------------------------------------------------------
RUN set -eux; \
    apt-get update; \
    pkgs=""; \
    for p in \
      libatk1.0-0t64 libatk1.0-0 \
      libatk-bridge2.0-0t64 libatk-bridge2.0-0 \
      libasound2t64 libasound2 \
      libcups2t64 libcups2 \
      libnss3 libnspr4 libgbm1 libdrm2 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libxkbcommon0 libx11-6 libxcb1 libxext6 \
      libpango-1.0-0 libcairo2 libglib2.0-0t64 libglib2.0-0 \
      libdbus-1-3 libatspi2.0-0t64 libatspi2.0-0 \
    ; do \
      if apt-cache show "$p" >/dev/null 2>&1; then pkgs="$pkgs $p"; fi; \
    done; \
    apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation fonts-noto-color-emoji fonts-noto-cjk \
      $pkgs; \
    rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts

FROM deps AS production
COPY . .
RUN mkdir -p data

# Download Chrome unless the caller supplies a system binary via
# PUPPETEER_EXECUTABLE_PATH (e.g. the distro's chromium package).
RUN if [ -z "${PUPPETEER_EXECUTABLE_PATH:-}" ]; then \
      npx puppeteer browsers install chrome; \
    fi

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
