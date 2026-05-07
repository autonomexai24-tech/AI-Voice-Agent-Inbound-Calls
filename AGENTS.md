# Agent Operations

## Build and Verification

- Build the dashboard locally: `cd frontend && npm install && npm run build`.
- Build the production container: `docker build -t inbound-ai-voice:fr-001 .`.
- Smoke test the container with production-like environment variables and confirm Supervisor starts `voice_agent` and `next_dashboard`.
- The production dashboard is served by `node server.js` from `frontend/.next/standalone` on port `8000`; do not use `npm start` or `next dev` in the container.
