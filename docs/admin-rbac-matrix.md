# Admin RBAC Permission Matrix

## Roles

| Role | Description |
|---|---|
| `super_admin` | Full access — all operations including destructive actions |
| `moderator` | Read + moderation — review, manage content, no financial/destructive actions |
| `viewer` | Read-only — dashboards and lists only |

## Permission Matrix

| Permission | Super Admin | Moderator | Viewer |
|---|:---:|:---:|:---:|
| **Read** | | | |
| `read:users` | ✓ | ✓ | ✓ |
| `read:giveaways` | ✓ | ✓ | ✓ |
| `read:promos` | ✓ | ✓ | ✓ |
| `read:tasks` | ✓ | ✓ | ✓ |
| `read:evidence` | ✓ | ✓ | ✓ |
| `read:predictions` | ✓ | ✓ | ✓ |
| `read:shop` | ✓ | ✓ | ✓ |
| `read:drops` | ✓ | ✓ | ✓ |
| `read:appeals` | ✓ | ✓ | ✓ |
| `read:audit` | ✓ | ✓ | ✓ |
| `read:settings` | ✓ | ✓ | ✓ |
| **Moderation** | | | |
| `mod:review_evidence` | ✓ | ✓ | |
| `mod:review_appeal` | ✓ | ✓ | |
| `mod:ban_user` | ✓ | ✓ | |
| `mod:manage_giveaways` | ✓ | ✓ | |
| `mod:manage_promos` | ✓ | ✓ | |
| `mod:manage_tasks` | ✓ | ✓ | |
| `mod:manage_drops` | ✓ | ✓ | |
| `mod:manage_live` | ✓ | ✓ | |
| `mod:manage_predictions` | ✓ | ✓ | |
| **Destructive / Financial** | | | |
| `admin:delete_user` | ✓ | | |
| `admin:adjust_balance` | ✓ | | |
| `admin:resolve_prediction` | ✓ | | |
| `admin:draw_giveaway` | ✓ | | |
| `admin:merge_users` | ✓ | | |
| `admin:manage_shop` | ✓ | | |
| `admin:manage_settings` | ✓ | | |
| `admin:manage_admins` | ✓ | | |
| `admin:upload_media` | ✓ | ✓ | |

## API Enforcement

All permissions are enforced server-side via `requirePermission(admin, permission, reply)`.
Attempting an unauthorized action returns HTTP 403:

```json
{
  "error": {
    "code": "forbidden",
    "message": "Missing permission: admin:delete_user"
  }
}
```

## Admin Login Response

On successful login, the API returns the role and all permissions:

```json
{
  "token": "eyJhbGci...",
  "role": "moderator",
  "permissions": ["read:users", "read:giveaways", "mod:review_evidence", ...]
}
```

The admin frontend should use the `permissions` array to conditionally render/disable UI elements.

## Admin Management

Only `super_admin` can manage other admins:

| Endpoint | Method | Description |
|---|---|---|
| `/api/admin/admins` | GET | List all admins |
| `/api/admin/admins` | POST | Create new admin |
| `/api/admin/admins/:id/role` | PATCH | Update admin role |
| `/api/admin/admins/:id` | DELETE | Deactivate admin |

Self-modification is blocked (cannot change own role or deactivate self).

## Seeding

The first admin is auto-seeded from env vars (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_PASSPHRASE`)
on first server startup with role `super_admin`. After that, manage admins through the API.
