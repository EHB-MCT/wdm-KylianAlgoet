# ChessMirror WMD (local, Docker)

A local-only "weapon of math destruction" demo built around a chess web app.
It collects per-user micro-interactions, builds a profile, and applies subtle UX interventions.
Includes:
- User-facing chess app
- Backend API (Express) + PostgreSQL (persistent)
- Admin dashboard (built into the same frontend at `/admin`)
- Data cleaning/validation + profiling
- Runs fully local with Docker Compose

## Quick start (recommended)

### 1) Requirements
- Docker Desktop (running)
- Git

### 2) Setup
1. Copy `.env.template` to `.env` at the project root
2. (Optional) change passwords/ports in `.env`

### 3) Run
```bash
docker compose up --build
```

### 4) Open
- User app: http://localhost:5173
- Admin dashboard: http://localhost:5173/admin

Admin login uses the password in `.env` (`ADMIN_PASSWORD`).

## Dev (optional, without Docker)
You can also run locally with Node 20+:
```bash
# backend
cd backend
npm install
npm run dev

# frontend (new terminal)
cd ../frontend
npm install
npm run dev
```

You'll still need Postgres; Docker is easiest.

## Project structure
- `backend/` Express API + Prisma
- `frontend/` React (Vite) user app + admin dashboard
- `docker-compose.yml` brings up db + api + frontend
- `.env.template` config

## Notes
- No external APIs or keys required.
- "Move quality" is a simple heuristic (hangs the moved piece immediately) to keep everything local and fast.
