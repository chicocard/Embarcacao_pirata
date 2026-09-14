# Imagem enxuta, compativel com ARM (Oracle Ampere A1) e x86.
FROM node:22-bookworm-slim

# Ferramentas necessarias caso o better-sqlite3 precise compilar.
# Se o pacote pronto baixar, isso nao chega a ser usado.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia so os manifestos primeiro: o cache do Docker poupa reinstalacao
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server ./server
COPY public ./public
COPY testes ./testes
COPY ferramentas ./ferramentas

# Dados e sessao do WhatsApp ficam em volumes, fora da imagem
RUN mkdir -p /dados /sessao-whatsapp && chown -R node:node /app /dados /sessao-whatsapp

ENV NODE_ENV=production \
    DATA_DIR=/dados \
    WA_AUTH_DIR=/sessao-whatsapp \
    PORT=3000

USER node
EXPOSE 3000

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
