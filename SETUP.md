# Tan Tracker — Setup Guide

## Cloudflare Resources Created
- **KV Namespace**: `TAN_TRACKER_KV` (id: `2f211cf731824810a33598031711b708`)

## Before Deploying

### 1. Get a Mapbox Token
1. Create account at https://account.mapbox.com/
2. Copy your **public** token (starts with `pk.eyJ1...`)

### 2. Set Mapbox Token as Worker Secret
```bash
cd worker
npx wrangler secret put MAPBOX_TOKEN
# Paste your token when prompted
```

### 3. Update Worker URL in Frontend
Edit `frontend/js/api.js` — update `WORKER_URL` with your deployed worker URL:
```
https://tan-tracker-proxy.YOUR_SUBDOMAIN.workers.dev
```

Also update `MAPBOX_TOKEN` in `frontend/js/app.js` with your public Mapbox token.

## Deploy

### Deploy Worker
```bash
cd worker
npx wrangler deploy
```

### Deploy Frontend (Cloudflare Pages)
```bash
# From repo root
npx wrangler pages deploy frontend --project-name tan-tracker
```

Or connect the GitHub repo in Cloudflare Pages dashboard:
- Build command: *(none — static site)*
- Build output directory: `frontend`

## PWA Icons
Generate PNG icons from `frontend/icons/icon.svg`:
- 192×192 → `frontend/icons/icon-192.png`
- 512×512 → `frontend/icons/icon-512.png`

Use any SVG→PNG converter (e.g. Squoosh, ImageMagick).
