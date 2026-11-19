# Attendly

Attendly is a student attendance app with separate student, faculty, and admin access. It stores records in SQLite and serves the existing responsive UI and JSON API from one Node.js service.

## Requirements

- Node.js 22.13 or newer (uses the built-in `node:sqlite` module)
- No package installation is required

## Run locally

From this folder, run:

```powershell
node server.js
```

Then open <http://127.0.0.1:3000>. The server creates `data/attendly.sqlite` on first run and seeds demo users, students, attendance history, and OD requests.

To run the API integration tests:

```powershell
node --test
```

## Demo sign-in

Choose the matching role on the login screen. Seeded accounts use the demo password `attendly`.

| Role | Account |
| --- | --- |
| Student | `STU-2041` |
| Faculty | `faculty@campus.edu` |
| Admin | `admin@campus.edu` |

Other seeded student IDs are listed in the admin/faculty Students page. Admins can add students there; a student ID becomes that student's login name.

## API and data

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/dashboard?date=YYYY-MM-DD`
- `GET` and `POST /api/attendance`
- `POST /api/od-requests` and `POST /api/od-requests/:id/decision`
- `POST /api/students` (admin only)

SQLite stores user accounts, salted scrypt password hashes, persistent expiring sessions, students, daily attendance entries, and OD requests. Attendance is calculated from daily records; approving an OD request writes an `od` attendance record in the same transaction. Students only receive their own attendance and requests; staff actions are role-checked by the server.

Set `PORT`, `HOST`, or `DB_PATH` to override the local defaults. The default host is `127.0.0.1`.

## Vercel + Railway deployment

Vercel hosts the static frontend; Railway runs the API and SQLite database. Deploy the Railway service first, then configure the Vercel frontend with its public API origin.

1. Deploy the repository root to Railway using `railway.json`.
2. Attach a persistent Railway volume mounted at `/data`.
3. Before the first production start, configure Railway variables:
   - `NODE_ENV=production`
   - `DB_PATH=/data/attendly.sqlite`
   - `ATTENDLY_ADMIN_PASSWORD`, `ATTENDLY_FACULTY_PASSWORD`, and `ATTENDLY_STUDENT_PASSWORD` (each at least 12 characters)
   - `ATTENDLY_FRONTEND_ORIGINS` (set this to the exact Vercel origin after the frontend is deployed)
   - Railway supplies `PORT`; the server binds to `0.0.0.0` in production.
4. Generate a public Railway domain and set the Vercel project’s `ATTENDLY_API_BASE` to that HTTPS origin, with no path or trailing slash.
5. After Vercel assigns its domain, set Railway’s `ATTENDLY_FRONTEND_ORIGINS` to that exact origin and redeploy the backend.

The Vercel build fails if `ATTENDLY_API_BASE` is missing. Production database initialization also fails if the three account passwords are missing or shorter than 12 characters. Secrets belong in the hosting providers’ environment-variable settings, never in source control or chat.

## Production note

This remains an MVP. The seeded student accounts share the configured initial student password; replace demo roster/accounts and establish institution-managed provisioning, password reset/change flows, HTTPS, backups, audit/retention policies, and monitoring before using real student records.
