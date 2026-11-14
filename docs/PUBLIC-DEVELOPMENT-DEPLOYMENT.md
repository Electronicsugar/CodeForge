# Public development deployment

## Current frontend

The production frontend is https://codeforge-three-iota.vercel.app, deployed to
the `codeforge` project on the existing CodeForge Hobby team. It is deployed from
the `frontend` directory using the Vercel CLI; automatic Git deployments are not
configured. The project stores the public API and Socket.IO URLs for production
and preview builds. The backend currently remains a local process exposed through
a temporary Cloudflare tunnel, so the Vercel website still depends on this
computer and the backend tunnel remaining available.

On 15 November 2026, the remote frontend build and anonymous-browser smoke checks
passed: frontend rendering, Online status, browser cross-origin problem loading,
direct `/login` navigation, health status, rejection of unauthenticated profile
requests, and rejection of unauthenticated WebSocket connections. Authenticated
battle/judge flows were not rerun as part of this deployment.

The frontend can run on Vercel. The existing Node/Socket.IO backend, BullMQ
worker, MongoDB, Redis and Docker C++ runner must remain running separately.
Deploy only `frontend` to Vercel; never upload the backend `.env` or database.

## Frontend build configuration

Configure these Vercel environment variables before building:

```text
VITE_API_URL=https://<backend-host>/api/v1
VITE_SOCKET_URL=https://<backend-host>
```

Use `frontend` as the project root, `npm run build` as the build command and
`dist` as the output directory. `frontend/vercel.json` provides SPA route fallback.
These Vite variables are public URLs embedded in the bundle, not secrets.
Changing them requires a new build/deployment.

## Backend configuration

Keep the current database and JWT settings. Set `NODE_ENV=production` and pass
the public frontend origins through the backend process environment:

```text
FRONTEND_URL=https://<project>.vercel.app,https://<frontend-tunnel>.trycloudflare.com
```

The backend accepts comma-separated origins and continues to permit the existing
local development frontend at `http://localhost:5173`. List exact origins, without
trailing paths. Restart the backend after changing the process environment.
This can override deployment-specific settings without editing the existing `.env`.

## Free Cloudflare development links

A Cloudflare quick tunnel can expose the backend on local port 3000. A second
tunnel can expose a server serving the built frontend. The frontend build must
point to the backend tunnel, and the backend must allow the frontend origin.

Quick tunnels have temporary, randomly assigned URLs and no uptime guarantee.
They depend on this computer, its network connection, the application processes,
Docker and the existing database containers staying running. Restarting a tunnel
may change its URL, requiring new frontend variables/builds and backend origins.
They are development links, not an always-on cloud server.

## Verification

Check the public backend `/health`, the public problem catalogue, and that
`/api/v1/users/me` returns 401 without authentication. Verify that unauthenticated
Socket.IO WebSocket connections fail with `Authentication token missing`.
In a browser, verify login-page rendering, an Online indicator, cross-origin API
access and direct navigation to `/login`. Check developer-console errors.

For Vercel, repeat these checks against the actual deployed production URL after
including that URL in the backend allowlist. Do not report a successful deployment
based only on a build completing or a Git push succeeding.
