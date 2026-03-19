# ---------------------------------------------------------------------------
# frontend/Dockerfile
#
# Build context is the REPO ROOT (Railway default for DOCKERFILE builder).
# server.ts imports from ../image-generator/src/ and ../erc8004/scripts/,
# so all three packages must be present in the image.
#
# Railway sets the PORT env var automatically at runtime.
# ---------------------------------------------------------------------------

FROM node:20-alpine

WORKDIR /app

# ── Install dependencies (layer-cached until package.json changes) ──────────
COPY frontend/package*.json   ./frontend/
COPY image-generator/package*.json ./image-generator/
COPY erc8004/package*.json    ./erc8004/

RUN cd frontend      && npm install
RUN cd image-generator && npm install
RUN cd erc8004       && npm install

# ── Copy sources ─────────────────────────────────────────────────────────────
COPY frontend/   ./frontend/
COPY image-generator/ ./image-generator/
COPY erc8004/    ./erc8004/

# ── Run ──────────────────────────────────────────────────────────────────────
WORKDIR /app/frontend

EXPOSE 3000

CMD ["npm", "start"]
