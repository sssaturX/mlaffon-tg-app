# Observability & Monitoring

## Logging

### Structured Logging
Fastify built-in pino logger outputs JSON-structured logs:
```json
{
  "level": 30,
  "time": 1703000000000,
  "pid": 1234,
  "hostname": "prod-1",
  "reqId": "abc-123",
  "msg": "request completed",
  "responseTime": 42,
  "req": { "method": "GET", "url": "/api/v1/me" },
  "res": { "statusCode": 200 }
}
```

### Log Sources
- **API server**: Fastify request/response logs with `reqId`
- **Worker**: BullMQ job logs with structured `{ queue, jobName, jobId, phase }` format
- **Slow requests**: Configurable via `API_SLOW_REQUEST_MS` env
- **DB queries**: Slow query logging via `API_TRACE_MIN_MS`
- **Event loop**: Lag monitoring via `EVENT_LOOP_MONITOR_MS`

### Log Levels
- `error`: Unhandled exceptions, auth failures, payment failures
- `warn`: Rate limit hits, cache miss storms, expired subscriptions
- `info`: Request completions, job starts/ends, health checks
- `debug`: Detailed auth flow, cache operations

## Health Endpoints

| Endpoint | Purpose | Response |
|---|---|---|
| `GET /health` | Liveness probe | `{ ok, checks: { db, redis } }` |
| `GET /health/ready` | Readiness probe | 200 if all deps up, 503 otherwise |

## Metrics to Track

### Request Metrics
- Per-route latency (p50/p95/p99)
- Request throughput (req/sec)
- Error rate (4xx/5xx breakdown)
- Rate limit hits

### Database Metrics
- PG pool: total, idle, waiting connections
- Query latency per route
- Slow query count
- Active transactions

### Redis Metrics
- Cache hit/miss ratio per key pattern
- Redis latency
- Memory usage
- Connected clients

### Queue Metrics
- Queue depth per queue (cron, task-verify, domain-timers)
- Job completion rate
- Failed job count
- Job processing latency

### Business Metrics
- Active WebSocket connections
- Push notification delivery rate
- Giveaway participation rate
- Shop purchase throughput

## Alerting Rules (Recommended)

| Alert | Condition | Severity |
|---|---|---|
| API down | `/health/ready` returns 503 for >1min | Critical |
| High error rate | 5xx rate >5% for 5min | Critical |
| DB pool saturated | waiting >0 for >30s | High |
| Queue backlog | depth >1000 for >5min | High |
| Redis down | Redis ping fails for >30s | Critical |
| Slow API | p95 latency >3s for 5min | Medium |
| Worker failures | >10 failed jobs in 5min | High |
| Disk space | >85% usage | Medium |

## Future Enhancements
- Integrate Sentry for error tracking (add `@sentry/node` to API + admin + web)
- Prometheus metrics endpoint at `/metrics`
- Grafana dashboards for all metric categories
- OpenTelemetry traces for request flow across API → DB → Redis → External
