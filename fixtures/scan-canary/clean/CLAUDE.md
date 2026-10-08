# scan-canary-clean — agent instructions

<!-- SPDX-License-Identifier: MIT — see https://opensource.org/licenses/MIT -->
<!-- TODO: expand the conventions section -->

A repository that does nothing, so that a clean scan means something. See ../README.md.
This file is the negative control for bin/agent-instructions.mjs: every surface the dirty CLAUDE.md offends on appears here in its benign form.

## نظرة عامة

هذا المستودع لا يفعل شيئًا، حتى يكون الفحص النظيف ذا معنى. (Arabic prose, no control characters.)
می‌خواهم این پروژه را بسازم. (Persian with a ZWNJ inside a word.)

## Install

```sh
curl -fsSL https://example.com/install.sh | sh
npm install
```

## Working here

Before starting any task, follow the steps in [docs/setup.md](docs/setup.md).
The panel listens on `$PORT` (default 7878); run `npm start` to serve it, and set `LOG_LEVEL=debug` for more output.

## Secrets

Add `.env` to `.gitignore` so secrets and API keys are never committed. Never send credentials to a third party.

![logo](data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=)

Emoji joiners are fine: 👨‍💻
