# Incident Response Playbook

## Severity Levels

| Level | Description | Response Time | Examples |
|---|---|---|---|
| P1 | Service down, data loss risk | <15min | API unreachable, DB corruption |
| P2 | Major feature broken | <1hr | Auth failing, payments broken |
| P3 | Degraded performance | <4hr | Slow queries, high latency |
| P4 | Minor issue | Next business day | UI glitch, log noise |

## First Response

### 1. Verify the issue
```bash
# API health
curl -s https://mlaffon.fun/health | jq .
curl -s https://mlaffon.fun/health/ready | jq .

# Service status
sudo systemctl status mlaffon-api mlaffon-worker

# Recent logs
journalctl -u mlaffon-api -n 50 --no-pager
journalctl -u mlaffon-worker -n 50 --no-pager
```

### 2. Common Scenarios

#### API returns 502/503
1. Check API process: `sudo systemctl status mlaffon-api`
2. Check memory: `free -h`
3. Check disk: `df -h`
4. Restart: `sudo systemctl restart mlaffon-api`

#### Database connection errors
1. Check PG: `sudo systemctl status postgresql`
2. Check connections: `psql -c "SELECT count(*) FROM pg_stat_activity"`
3. Kill idle transactions: `psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle in transaction' AND query_start < now() - interval '10 minutes'"`

#### Redis down
1. Check Redis: `sudo systemctl status redis`
2. Restart: `sudo systemctl restart redis`
3. App degrades gracefully (cache misses, higher DB load)

#### Worker stuck
1. Check worker: `sudo systemctl status mlaffon-worker`
2. Check queue depth: `redis-cli LLEN bull:cron:waiting`
3. Restart: `sudo systemctl restart mlaffon-worker`

#### High latency
1. Check event loop: look for `EVENT_LOOP_LAG` in logs
2. Check DB: `psql -c "SELECT * FROM pg_stat_activity WHERE state = 'active' AND query_start < now() - interval '5 seconds'"`
3. Check Redis: `redis-cli INFO stats | grep instantaneous_ops`

### 3. Escalation
- If issue persists >30min after first response → evaluate rollback
- If data integrity at risk → take DB snapshot first
- If security incident → rotate affected secrets immediately

## Post-Incident
1. Document: what happened, timeline, impact, root cause
2. Fix: implement permanent fix
3. Prevent: add monitoring/alerting to catch earlier
4. Review: discuss in team
