# The multi-platform digest pins the official Node image for amd64 and arm64.
FROM node:22.23.4-bookworm@sha256:18a6d90fd60542269850c80ca03b29b1d9b14d6b221ac7ee8e35b0d33ef904bd

COPY .nvmrc package.json /tmp/kanbun-toolchain/
COPY packages/verifier/package.json /tmp/kanbun-toolchain/verifier.json

# Derive pnpm and browser dependencies from the repository's pinned versions.
RUN node -e 'const fs = require("node:fs"); const expected = fs.readFileSync("/tmp/kanbun-toolchain/.nvmrc", "utf8").trim(); if (process.version !== `v${expected}`) throw new Error("Update the devcontainer Node image to match .nvmrc");' \
    && npm install --global "$(node -p 'require("/tmp/kanbun-toolchain/package.json").packageManager')" \
    && npx --yes "playwright@$(node -p 'require("/tmp/kanbun-toolchain/verifier.json").devDependencies["@playwright/test"]')" install-deps chromium \
    && apt-get install -y --no-install-recommends xauth libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/* /tmp/kanbun-toolchain

USER node
