# Queue Operations Guide

## Queue Topology

| Queue | Workers | Concurrency | Jobs |
|---|---|---|---|
| `task-verify` | main worker | 8 | Async task validation (Twitch/Kick API checks) |
| `cron` | main worker | 1 | Repeatable scheduled jobs |
| `domain-timers` | main worker | 1 | One-off scheduled events (drops, broadcasts, predictions) |
| `fraud-review` | fraud worker | separate process | Fraud detection (separate `npm run worker:fraud`) |

## Job Policies

### Default Policy (all queues)
```
attempts: 4
backoff: exponential, 2500ms base
removeOnComplete: 1000 (keep last 1000 completed jobs)
removeOnFail: false (retain failed jobs for inspection)
```

### Repeatable Jobs

| Job Name | Queue | Schedule | Timeout | Idempotent |
|---|---|---|---|---|
| `weekly-referral` | cron | `5 0 * * 1` (Monday 00:05) | 300s | Yes (idempotency key per user/week) |
| `outbox-flush` | cron | every 500ms | 10s | Yes (FOR UPDATE SKIP LOCKED) |
| `giveaway-finalize` | cron | every 30s | 30s | Yes (no-op if already finalized) |
| `outbox-cleanup` | cron | `0 3 * * *` (daily 03:00) | 60s | Yes (deletes old published events) |

### Domain Timer Jobs

| Job Name | Queue | Trigger | Idempotent |
|---|---|---|---|
| `drop-end` | domain-timers | Scheduled at drop creation | Yes (checks drop state) |
| `live-auto-end` | domain-timers | Scheduled at broadcast start | Yes (checks broadcast ID) |
| `prediction-auto-close` | domain-timers | Scheduled at prediction open | Yes (checks prediction state) |

## Monitoring

### Check queue depth
```bash
redis-cli LLEN bull:cron:wait
redis-cli LLEN bull:task-verify:wait
redis-cli LLEN bull:domain-timers:wait
```

### Check failed jobs
```bash
redis-cli LLEN bull:cron:failed
redis-cli LLEN bull:task-verify:failed
redis-cli LLEN bull:domain-timers:failed
```

### View failed job details
```bash
redis-cli LRANGE bull:task-verify:failed 0 5
```

### Prometheus metrics
- `bullmq_job_duration_seconds` — histogram of job processing time
- `bullmq_queue_depth` — gauge of queue sizes (if custom collection added)

## Troubleshooting

### Queue is growing (backlog)
1. Check worker is running: `systemctl status mlaffon-worker`
2. Check for connection issues in logs: `journalctl -u mlaffon-worker -n 50`
3. Check Redis connectivity: `redis-cli ping`
4. Restart worker: `systemctl restart mlaffon-worker`

### Repeated failures
1. Check failed job data in Redis
2. Check Sentry for exception details
3. If jobs are corrupt, remove failed jobs:
   ```bash
   redis-cli DEL bull:task-verify:failed
   ```

### Stuck repeatable jobs
1. Remove and re-register:
   ```bash
   redis-cli DEL bull:cron:repeat
   ```
2. Restart worker (re-registers all repeatable jobs)

### Pause/Resume queue
```bash
# Pause (worker stops processing new jobs)
redis-cli RPUSH bull:cron:paused 1

# Resume
redis-cli DEL bull:cron:paused
```

## Graceful Shutdown

Workers handle `SIGTERM`:
1. Stop accepting new jobs
2. Wait for in-flight jobs to complete (up to 60s)
3. Close Redis connections
4. Exit

systemd `TimeoutStopSec=60` gives workers time to finish current jobs.
