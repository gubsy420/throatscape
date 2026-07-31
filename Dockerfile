# ============================================================
#  Throatscape
#  The client and server have no dependencies, so there is no
#  build stage and nothing to install - copy the source, run it.
# ============================================================

FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

WORKDIR /app

# Copy only what the game needs. The static server hands out anything beneath
# its root, so the Dockerfile, README and git history deliberately stay out of
# the image rather than being excluded at request time.
# package.json is required: it carries "type": "module", without which the
# server's ESM imports will not load.
COPY --chown=node:node package.json ./
COPY --chown=node:node index.html  ./
COPY --chown=node:node css/    ./css/
COPY --chown=node:node js/     ./js/
COPY --chown=node:node server/ ./server/

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
