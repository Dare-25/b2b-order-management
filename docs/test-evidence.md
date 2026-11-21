# Test Evidence

## 2026-11-21: Authentication and roles
- No token on /me returns 401: pass
- Customer token on /admin-only returns 403: pass
- Admin token on /admin-only returns 200: [pass or fail, only after you run it]