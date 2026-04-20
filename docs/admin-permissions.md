# Admin Permissions & Security

## Authentication
- Admin login: `POST /api/admin/auth/login`
- Requires: email + password + passphrase (three-factor)
- Issues admin JWT with 8-hour expiry
- Admin JWT is signed with `ADMIN_JWT_SECRET` (separate from user JWT)

## Admin Actions Audit

All destructive admin actions are logged to the `admin_audit_log` table:

| Action | Entity Type | What's Logged |
|---|---|---|
| `delete_user` | user | user ID |
| `adjust_balance` | user | user ID, twitchDelta, kickDelta |
| `draw_giveaway` | giveaway | giveaway ID |
| `resolve_prediction` | prediction | prediction ID, outcome |
| `ban_user` | user | user ID, ban status |
| `review_evidence` | task_evidence | evidence ID, status |

## Audit Log Schema

```sql
CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  payload JSONB,
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Future Role Model

When the admin base grows beyond 1-2 people, implement roles:

| Role | Permissions |
|---|---|
| `super_admin` | Full access (destructive actions, settings, user deletion) |
| `moderator` | Review evidence, manage giveaways, view users (no deletion/balance) |
| `viewer` | Read-only access to all admin panels |

Implementation plan:
1. Add `role` column to admin auth (JWT claim or DB)
2. Add `requireRole(role)` middleware
3. Admin UI: conditionally render/disable buttons based on role
4. Audit log: include role in log entries

## Security Recommendations
- Rotate `ADMIN_JWT_SECRET` quarterly
- Use strong, unique passphrase (not shared among admins)
- Review audit log weekly
- Never share admin credentials
- All admin traffic should go through HTTPS/Cloudflare
