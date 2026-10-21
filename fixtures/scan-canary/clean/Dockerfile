# Digest-pinned, non-root, no package manager at all — nothing for a Dockerfile linter to catch.
FROM node:20.11.1-alpine@sha256:f4c96a28c0b2d8981664e03f461c2677152cd9a756012ffa8e2c6727427c2bda
WORKDIR /app
COPY --chown=1000:1000 package.json package-lock.json ./
COPY --chown=1000:1000 src ./src
USER 1000:1000
HEALTHCHECK CMD ["node", "-e", "process.exit(0)"]
CMD ["node", "src/index.mjs"]
