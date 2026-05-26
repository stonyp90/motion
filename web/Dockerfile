# syntax=docker/dockerfile:1.7-labs

# IMTN web — multi-stage build for Azure Container Apps.
#
# Layout:
#   `builder`  → installs deps + runs `next build` with `output: 'standalone'`.
#   `runner`   → distroless node image with just the server + static assets.
#
# Base image sourcing: we pull `node:22-alpine` from AWS Public ECR's
# Docker library mirror (`public.ecr.aws/docker/library/`) rather than
# Docker Hub directly — Docker Hub enforces an anonymous-pull rate
# limit (100/6h per IP) that bit us in ACR Build. AWS's mirror is a
# 1:1 copy of `docker.io/library/*` and has no rate limit. The runner
# stage's `gcr.io/distroless/nodejs22-debian12:nonroot` is Google's
# registry — also rate-limit-free.
#
# Image size target: < 200 MB. Last measured: ~140 MB compressed on
# linux/amd64 (distroless-node + standalone server + static assets).
#
# Build args:
#   NEXT_PUBLIC_ENGINE_BASE_URL — baked at build time because Next inlines
#     `NEXT_PUBLIC_*` into the client bundle. Override per-environment in
#     the deploy workflow (`az acr build --build-arg ...`).
#
# Runtime env (set by ACA from main.bicep):
#   AUTH_SECRET, AUTH_KEYCLOAK_*, KEYCLOAK_ISSUER — server-side route
#   handlers (NextAuth + /api/engine/file proxy) consume these at request
#   time. Never embed in the image.

# ------------------------------------------------------------------ deps
FROM public.ecr.aws/docker/library/node:22-alpine AS deps
WORKDIR /app
# Alpine + Next sharp need libc6-compat for some prebuilt binaries.
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ------------------------------------------------------------------ builder
FROM public.ecr.aws/docker/library/node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time public env. `ARG` defaults to empty so a missing arg
# doesn't crash the build — it just leaves the value blank, which the
# runtime-config fallback in `web/src/lib/runtime-config.ts` handles.
ARG NEXT_PUBLIC_ENGINE_BASE_URL=""
ENV NEXT_PUBLIC_ENGINE_BASE_URL=$NEXT_PUBLIC_ENGINE_BASE_URL

# Telemetry off for reproducible builds.
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ------------------------------------------------------------------ runner
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# `output: 'standalone'` puts the curated server tree under
# `.next/standalone/`; static + public are copied alongside to match
# what `node server.js` expects to find.
COPY --from=builder --chown=nonroot:nonroot /app/.next/standalone ./
COPY --from=builder --chown=nonroot:nonroot /app/.next/static ./.next/static
COPY --from=builder --chown=nonroot:nonroot /app/public ./public

EXPOSE 3000

# Distroless node images expose Node directly as the entrypoint — no
# shell, no package manager, no curl. `server.js` lives at the root of
# the standalone output.
CMD ["server.js"]
