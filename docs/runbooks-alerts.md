# Operational Runbooks — Alert Response

## Alert: API Health Check Failing

### Symptom
`/health/ready` returns 503 or is unreachable for >1 minute.

### Diagnosis
```bash
systemctl status mlaffon-api
curl -s http://localhost:3001/health | jq .
journalctl -u mlaffon-api -n 100 --no-pager
```

### Resolution
1. If process is down: `systemctl restart mlaffon-api`
2. If DB connection fails: check PostgreSQL (`systemctl status postgresql`)
3. If Redis fails: check Redis (`systemctl status redis`, `redis-cli ping`)
4. If OOM: check `journalctl -u mlaffon-api | grep -i "killed"`, increase `MemoryMax` in systemd

### Escalation
If restart doesn't fix it within 5 minutes → rollback to previous version.

---

## Alert: High 5xx Error Rate (>5% for 5 minutes)

### Symptom
Prometheus `http_requests_total{status_code=~"5.."}` / total > 0.05.

### Diagnosis
```bash
# Check recent errors in Sentry
# Check API logs
journalctl -u mlaffon-api --since "5 minutes ago" | grep -i error
# Check DB
psql -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active'"
```

### Resolution
1. Identify the failing route(s) from Sentry/metrics
2. If DB-related: check for long-running queries, kill them
3. If Redis-related: restart Redis
4. If code bug: rollback deployment

---

## Alert: Database Pool Saturated

### Symptom
`db_pool_connections{state="waiting"} > 0` for >30 seconds.

### Diagnosis
```bash
psql -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state"
psql -c "SELECT pid, now() - query_start AS duration, query FROM pg_stat_activity WHERE state = 'active' ORDER BY duration DESC LIMIT 10"
```

### Resolution
1. Kill long-running queries:
   ```sql
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity
   WHERE state = 'active' AND query_start < now() - interval '30 seconds'
   AND pid <> pg_backend_pid();
   ```
2. If persistent: increase `PG_POOL_MAX` in env and restart API
3. Long-term: investigate query causing saturation

---

## Alert: Queue Backlog Growing

### Symptom
`bullmq_queue_depth{queue="*", state="waiting"} > 1000` for >5 minutes.

### Diagnosis
```bash
redis-cli LLEN bull:task-verify:wait
redis-cli LLEN bull:cron:wait
systemctl status mlaffon-worker
journalctl -u mlaffon-worker -n 50
```

### Resolution
1. Restart worker: `systemctl restart mlaffon-worker`
2. If worker is processing but slowly: check external API latency (Twitch/Kick)
3. If Redis is the bottleneck: check `redis-cli INFO stats`

---

## Alert: Worker Failures Spike (>10 in 5 minutes)

### Symptom
Multiple Sentry events from worker, or `bullmq_queue_depth{state="failed"}` growing.

### Diagnosis
1. Check Sentry for error patterns
2. Check Redis for failed job data:
   ```bash
   redis-cli LRANGE bull:task-verify:failed 0 5
   ```

### Resolution
1. If external API is down (Twitch/Kick): wait for recovery, jobs will retry
2. If DB issue: resolve DB first
3. If code bug: rollback and clear failed queue

---

## Alert: Disk Space >85%

### Diagnosis
```bash
df -h
du -sh /var/log/journal/* | sort -h | tail -5
du -sh /opt/mlaffon/mlaffon-tg-app/apps/api/dist/ 
```

### Resolution
1. Clean old journals: `journalctl --vacuum-time=7d`
2. Clean npm cache: `npm cache clean --force`
3. Clean old Docker images if applicable
4. Long-term: add log rotation, increase disk

---

## Alert: Unusual Auth Failure Spike

### Symptom
Large number of 401 responses or admin login failures in audit log.

### Diagnosis
```sql
SELECT admin_email, count(*), max(created_at) 
FROM admin_audit_log 
WHERE action = 'login_failed' AND created_at > now() - interval '1 hour'
GROUP BY admin_email ORDER BY count DESC;
```

### Resolution
1. If brute force: Cloudflare rate limit should catch this
2. If specific admin: check if credentials changed, reset if needed
3. If widespread: check if JWT_SECRET was rotated without restarting
