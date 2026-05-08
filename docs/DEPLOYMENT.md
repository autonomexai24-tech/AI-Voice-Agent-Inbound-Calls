# DEPLOYMENT.md — Deployment Architecture & Production Operations

> **Source files:** `Dockerfile`, `supervisord.conf`, `start.sh`, `init_db.py`, `next.config.mjs`
> **Subordinate to:** `/docs/PLAN.md`
> **Last verified against code:** 2026-05-08

---

## 1. Deployment Philosophy

**Simplicity is the architecture.**

This platform deploys as a single Docker container on a single VPS. There is no orchestration layer, no service mesh, no autoscaler, and no multi-region setup. This is intentional — it keeps costs low, deployment fast, debugging simple, and recovery straightforward.

The target deployment environment:
- **VPS:** KVM2 (2–4 vCPU, 4–8 GB RAM, India or Singapore DC)
- **Panel:** Easypanel (Docker management, TLS, domain routing)
- **Database:** Easypanel-managed PostgreSQL (same VPS or co-located)
- **Container:** Single Docker image with Supervisor managing two processes

---

## 2. Current Production Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Easypanel VPS                      │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │           Docker Container                    │   │
│  │                                               │   │
│  │   start.sh                                    │   │
│  │     └─ python init_db.py                      │   │
│  │     └─ supervisord (PID 1)                    │   │
│  │           ├─ python agent.py start            │   │
│  │           │    (LiveKit voice worker)          │   │
│  │           └─ node server.js                   │   │
│  │                (Next.js dashboard :3000)       │   │
│  │                                               │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │        PostgreSQL (Easypanel service)          │   │
│  │        Internal: voice-agent-db:5432           │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Easypanel Proxy                                     │
│    HTTPS :443 → container :3000 (dashboard)          │
│                                                      │
└─────────────────────────────────────────────────────┘

External connections:
  ├─ LiveKit Cloud (WebSocket) ← agent.py connects outbound
  ├─ Vobiz SIP Trunk → LiveKit Cloud → agent room
  ├─ OpenAI API (HTTPS) ← LLM calls
  ├─ Sarvam AI API (HTTPS) ← STT/TTS calls
  ├─ Cal.com API (HTTPS) ← booking calls
  └─ Fast2SMS API (HTTPS) ← SMS calls
```

---

## 3. Docker Multi-Stage Build

The Dockerfile uses a 3-stage build to minimize the final image size:

### Stage 1: Frontend builder (`node:20-slim`)

```dockerfile
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build && test -f .next/standalone/server.js
```

- Installs Node dependencies and builds Next.js.
- Verifies `server.js` exists in standalone output.
- Only the `.next/standalone` and `.next/static` artifacts carry forward.

### Stage 2: Python builder (`python:3.11-slim`)

```dockerfile
WORKDIR /app
RUN apt-get install build-essential ca-certificates curl
COPY requirements.txt ./
RUN pip install --no-cache-dir --user -r requirements.txt
```

- Installs Python dependencies with native extensions (psycopg2, etc.).
- Uses `--user` install to copy cleanly into runtime stage.

### Stage 3: Runtime (`python:3.11-slim`)

```dockerfile
RUN apt-get install ca-certificates curl ffmpeg supervisor
COPY --from=frontend-builder /usr/local/bin/node /usr/local/bin/node
COPY --from=python-builder /root/.local /root/.local
COPY . .
COPY --from=frontend-builder /app/frontend/.next/standalone ./frontend/.next/standalone
COPY --from=frontend-builder /app/frontend/.next/static ./frontend/.next/standalone/.next/static
COPY --from=frontend-builder /app/frontend/public ./frontend/.next/standalone/public
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
```

- Copies only the `node` binary (not full Node.js installation).
- Copies Python packages from builder.
- Copies standalone Next.js build.
- Installs `ffmpeg` (required for audio stream handling by LiveKit SDK).
- Installs Supervisor for process management.

### Why multi-stage

| Concern | Solution |
|---------|----------|
| Image size | Build tools excluded from runtime; only artifacts copied |
| Node.js overhead | Only `node` binary copied, not npm/yarn/npx |
| Python build deps | `build-essential` excluded from runtime |
| Security surface | Minimal runtime packages |

---

## 4. Why Standalone Next.js

Standard Next.js production (`npm start`) requires:
- Full `node_modules` directory in the container.
- `next` CLI to serve the app.
- ~200-400 MB of node_modules loaded into memory.

Standalone mode (`output: "standalone"` in `next.config.mjs`):
- Produces a self-contained `server.js` with inlined dependencies.
- Only ~15-30 MB of files needed.
- `node server.js` starts the server directly.
- ~60-80% less RAM usage than `npm start`.

**On a KVM2 VPS with 4 GB RAM shared between the Python agent and Next.js, this difference matters.**

---

## 5. Why Supervisor

The container runs two long-lived processes:
- `python agent.py start` — LiveKit voice worker
- `node server.js` — Next.js dashboard

Docker containers expect a single PID 1 process. Supervisor acts as PID 1 and manages both:

```ini
[program:voice_agent]
command=python agent.py start
directory=/app
autostart=true
autorestart=true
startretries=10
stopwaitsecs=30

[program:next_dashboard]
command=node server.js
directory=/app/frontend/.next/standalone
autostart=true
autorestart=true
startretries=5
stopwaitsecs=15
```

### Key behaviors

- **Auto-restart:** Both processes restart on crash (up to 10 retries for agent, 5 for dashboard).
- **Stop wait:** Agent gets 30s for graceful shutdown (active calls); dashboard gets 15s.
- **Logs:** Both stdout/stderr routed to container stdout for Easypanel log visibility.
- **No daemon mode:** `nodaemon=true` keeps Supervisor in foreground (required for Docker).

### Why not separate containers?

| Approach | Trade-off |
|----------|-----------|
| **Single container + Supervisor** | Simple, one deploy, shared env vars, shared network. Sufficient for current scale. |
| **Two containers** | Need Docker Compose or Easypanel service linking, separate env config, more RAM overhead from two base images. |
| **Kubernetes pods** | Massive infrastructure overhead for a single-tenant platform. |

**Decision:** Single container is intentional. It will be revisited only when horizontal scaling is needed (multiple concurrent VPS instances behind a load balancer).

---

## 6. Why Single-Container Architecture Is Intentional

### Cost

| Setup | Monthly cost (India VPS) |
|-------|------------------------:|
| 1 × KVM2 (4 GB RAM) | ~₹1,500–2,500 |
| 2 × KVM2 (separate containers) | ~₹3,000–5,000 |
| Kubernetes cluster (3 nodes) | ~₹8,000–15,000 |
| Managed Kubernetes (GKE/EKS) | ~₹15,000–30,000 |

### Operational simplicity

- One image to build.
- One container to deploy.
- One set of environment variables.
- One log stream to monitor.
- One thing to restart when something goes wrong.

### When to split

Split into separate containers only when:
1. The VPS consistently runs out of RAM (>85% usage).
2. Multiple VPS instances are needed for call volume.
3. The dashboard needs independent scaling from the agent.
4. SaaS multi-tenancy requires container-per-business isolation.

---

## 7. Why Kubernetes Is Intentionally Avoided

Kubernetes solves problems this platform does not have:

| Kubernetes feature | Platform need? |
|-------------------|:--------------:|
| Horizontal pod autoscaling | No — single VPS handles current volume |
| Service discovery | No — two processes in one container |
| Rolling deployments | No — Easypanel handles restarts |
| Multi-region failover | No — India-only deployment |
| Ingress controllers | No — Easypanel proxy handles TLS |
| ConfigMaps / Secrets | No — Easypanel env vars suffice |
| Pod health checks | Partially — `/api/health` can serve this |

**Adding Kubernetes would increase cost by 5-10×, increase operational complexity by 10×, and provide zero benefit at current scale.**

---

## 8. Why Microservices Are Intentionally Avoided

The platform has two processes (agent + dashboard) and four external API dependencies. This is not a microservices use case.

A microservices architecture would mean:
- Separate booking service, SMS service, transcript service.
- Inter-service communication (HTTP or message queue).
- Distributed tracing.
- Service-level monitoring.
- Independent deployment pipelines.

**For a platform that handles 50-500 calls/day at a single clinic, this is pure overhead.** The entire business logic fits in ~500 lines of Python + ~300 lines of TypeScript.

---

## 9. Why RAG Is Intentionally Avoided

See `/docs/LATENCY.md` for the full latency analysis. In summary:

- RAG adds 50-300ms per retrieval step.
- Multi-step RAG adds 200-1000ms per turn.
- A dental clinic's entire knowledge base (services, hours, pricing, FAQ) fits in ~200 tokens of system prompt.
- Injecting business context into the system prompt costs zero additional latency.
- RAG becomes necessary only when business knowledge exceeds ~2000 tokens — far beyond what a single clinic needs.

**If RAG is ever required:** Use single-step traditional vector RAG via PostgreSQL `pgvector`. Never agentic RAG, tree RAG, or multi-step retrieval.

---

## 10. Container Startup Sequence

```
Docker starts container
    → CMD ["/app/start.sh"]
        → python init_db.py
            → Validate DATABASE_URL
            → Read schema.sql
            → Connect to PostgreSQL (30 retries × 2s)
            → Execute schema (CREATE IF NOT EXISTS)
            → Seed default agent_config if empty
        → If init_db.py fails: ERROR logged, container exits
        → exec supervisord
            → Start voice_agent (python agent.py start)
                → Validate required runtime env vars and DB connectivity
            → Start next_dashboard (node server.js)
```

### Why fail on DB init failure?

Production startup is fail-fast. If PostgreSQL or schema initialization is unavailable, the container exits so Easypanel marks the deployment unhealthy and restarts according to its configured policy. This avoids running a dashboard and worker that appear alive while persistence is broken.

---

## 11. Health & Operations

### `/api/health` endpoint

```
GET /api/health → 200 if app, DB, required schema, and critical runtime env groups are ready; 503 otherwise
```

Docker defines a lightweight healthcheck against this endpoint. Easypanel can also use it for container health checks. If the health check fails repeatedly, Easypanel restarts the container.

Response:
```json
{
    "status": "healthy",
    "checks": {
        "app": "ok",
        "database": "ok",
        "schema": "ok",
        "databaseUrl": "ok",
        "openaiApiKey": "ok",
        "livekitUrl": "ok",
        "livekitApiKey": "ok",
        "livekitApiSecret": "ok",
        "sarvamApiKey": "ok",
        "calcomApiKey": "ok",
        "calcomEventTypeId": "ok",
        "fast2smsApiKey": "ok",
        "dashboardPassword": "ok"
    },
    "timestamp": "2026-05-08T12:00:00Z",
    "durationMs": 12
}
```

### Graceful shutdown

When Supervisor sends SIGTERM to the agent:
1. Stop accepting new LiveKit jobs.
2. Wait for active calls to finish (up to `stopwaitsecs=30`).
3. Run finalize_call() for any active call.
4. Exit cleanly.

Supervisor sends TERM to the full process group and allows up to 30 seconds for the Python worker to drain transcript tasks, complete the call log, and send/audit booking SMS. Next.js receives the same process-group shutdown behavior with a shorter timeout.

### Startup validation

At agent startup, validate:
- `DATABASE_URL` is set and reachable.
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` are set.
- `OPENAI_API_KEY` is set.
- `SARVAM_AI_API_KEY` or `SARVAM_API_KEY` is set.
- `CALCOM_API_KEY` and `CALCOM_EVENT_TYPE_ID` are set.
- `FAST2SMS_API_KEY` is set.
- `DASHBOARD_PASSWORD` is set.

Fail fast with clear error messages if any required variable is missing.

### Structured logging

- JSON-formatted log lines for machine parsing.
- Include `call_id` and event names for startup validation, shutdown finalization, and notification audit events.
- Log levels: ERROR for failures, WARNING for degraded state, INFO for lifecycle events.
- No DEBUG logging in production by default.

### Legacy runtime files

`ui_server.py`, `notify.py`, `calendar_tools.py`, and `config.json` are preserved for reference/backward compatibility but are not started by Supervisor. Production runtime entrypoints remain `agent.py`, `tools.py`, `notifications.py`, `init_db.py`, and the Next.js standalone dashboard.

---

## 12. Cost Optimization Strategy

### Why simplicity is the strategy

Every architectural choice is a cost decision:

| Decision | Monthly savings vs. alternative |
|----------|---:|
| Single container vs. Kubernetes | ~₹6,000–12,000 |
| Standalone Next.js vs. npm start | ~₹500 (RAM savings on VPS tier) |
| Recording links vs. S3 storage | ~₹1,500–3,000 |
| No vector DB vs. pgvector/Pinecone | ~₹2,000–5,000 |
| No multi-agent vs. LangChain | ₹0 (complexity cost, not direct) |
| Concise prompts (200 tokens vs. 2000) | ~₹500–1,500 (LLM token costs) |
| Short replies (120 tokens max) | ~₹300–800 (LLM output tokens) |
| Raw SQL vs. ORM | ₹0 (no runtime overhead) |
| Single VPS vs. managed cloud | ~₹5,000–15,000 |

### Token usage optimization

| Component | Tokens per call (estimated) |
|-----------|---:|
| System prompt | ~200–300 |
| Booking policy | ~80 |
| Conversation (5 turns × 2 ways) | ~300–500 |
| Tool calls (if booking) | ~100–200 |
| **Total per call** | **~680–1,080** |

At GPT-4o pricing (~$2.50/1M input, ~$10/1M output):
- **~₹0.15–0.30 per call** for LLM costs.
- **1,000 calls/month ≈ ₹150–300 LLM cost.**

### What keeps costs low

1. **Single container** — one VPS, one deploy, one set of costs.
2. **No duplicate recording storage** — use provider recordings.
3. **No vector database** — business context fits in prompts.
4. **No multi-agent orchestration** — one LLM call per turn.
5. **Concise system prompts** — under 300 tokens.
6. **Concise replies** — `max_completion_tokens=160`.
7. **Lightweight SQL** — no ORM overhead, no complex joins.
8. **No GPU dependency** — all AI inference via API (OpenAI, Sarvam).
9. **Easypanel simplicity** — no DevOps team needed.
10. **Provider recording reuse** — zero storage cost for audio.

---

## 13. Environment Variables

### Required for production

| Variable | Used by | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | agent.py, dashboard | PostgreSQL connection |
| `LIVEKIT_URL` | agent.py | LiveKit Cloud WebSocket URL |
| `LIVEKIT_API_KEY` | agent.py | LiveKit Cloud auth |
| `LIVEKIT_API_SECRET` | agent.py | LiveKit Cloud auth |
| `OPENAI_API_KEY` | agent.py | GPT-4o LLM calls |
| `SARVAM_AI_API_KEY` | agent.py | Sarvam STT/TTS |
| `CALCOM_API_KEY` | tools.py | Cal.com booking API |
| `CALCOM_EVENT_TYPE_ID` | tools.py | Cal.com event type |
| `FAST2SMS_API_KEY` | notifications.py | SMS sending |
| `DASHBOARD_PASSWORD` | dashboard middleware | Dashboard auth |

### Optional

| Variable | Used by | Default |
|----------|---------|---------|
| `CAL_EVENT_TYPE_ID` | tools.py | Fallback for `CALCOM_EVENT_TYPE_ID` |

### Never committed to source

All values live in Easypanel environment configuration. The `.env` file in the repo contains **placeholder/empty values** for development reference only.

---

## 14. Deployment Checklist

For the full production launch checklist, rollback SOP, backup SOP, and troubleshooting steps, use `RUNBOOK.md`.

### Pre-deployment

1. All environment variables set in Easypanel.
2. PostgreSQL service running and reachable.
3. `DATABASE_URL` uses internal Docker service name (not public hostname).
4. Domain configured with TLS in Easypanel.

### Deployment

1. Push to Git repository.
2. Easypanel pulls and builds Docker image.
3. Container starts → `init_db.py` runs → Supervisor starts processes.
4. Verify dashboard loads at `https://domain.com/login`.
5. Verify voice agent connects to LiveKit (check Easypanel logs for agent startup).

### Post-deployment verification

1. Login to dashboard.
2. Check Dashboard page loads metrics.
3. Check CRM page loads call logs.
4. Make a test inbound call.
5. Verify call appears in CRM.
6. Verify booking works (if testing booking flow).
7. Verify SMS arrives (if testing SMS flow).

### Rollback

1. In Easypanel, redeploy the previous image tag.
2. Container restarts with previous code.
3. Database schema is forward-compatible (`CREATE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
4. No manual database rollback needed for additive schema changes.

---

## 15. Scaling Path (When Needed)

### Current capacity (single container — estimate only, not load-tested)

- ~50–200 concurrent calls (LiveKit worker spawns processes per call). **This is an estimate, not a benchmark.** Actual capacity depends on per-call memory usage, VPS resources, and network conditions.
- ~10–50 dashboard users
- Limited by VPS RAM and CPU

### Horizontal scaling (future)

1. Run multiple VPS instances, each with the same Docker image.
2. Each agent registers with LiveKit Cloud independently.
3. LiveKit Cloud distributes incoming calls across available workers.
4. Dashboard remains on one instance (or add load balancer).
5. All instances share the same PostgreSQL database.

### Vertical scaling (immediate)

- Upgrade VPS tier (4 GB → 8 GB → 16 GB RAM).
- Cheapest improvement, no architecture change.
