ARG BUN_IMAGE=oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
FROM ${BUN_IMAGE} AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM ${BUN_IMAGE}
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts/public-demo.ts ./scripts/public-demo.ts
COPY --chmod=0755 deploy/dist/settlement-demo-source /usr/local/bin/settlement-demo-source
COPY deploy/dist/new-api-LICENSE /usr/share/doc/partner-demo/new-api-LICENSE
USER bun
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 CMD bun -e 'const host=new URL(process.env.SETTLEMENT_PUBLIC_ORIGIN).host; const r=await fetch("http://127.0.0.1:4316/healthz",{headers:{Host:host}});if(!r.ok)process.exit(1);'
CMD ["bun", "scripts/public-demo.ts"]
