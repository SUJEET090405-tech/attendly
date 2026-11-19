const {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual
} = require("node:crypto");
const { promisify } = require("node:util");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { createDatabase } = require("./database");

const scryptAsync = promisify(scrypt);
const SESSION_COOKIE = "attendly_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const MAX_BODY_BYTES = 64 * 1024;
const roleSet = new Set(["student", "faculty", "admin"]);
const palette = ["purple", "green", "orange", "blue"];
const staticFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"]
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function readCookie(request, name) {
  const header = request.headers.cookie || "";
  const entry = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : null;
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Send request data as JSON.");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected an object");
    return body;
  } catch {
    throw new HttpError(400, "Invalid JSON request body.");
  }
}

function toPublicUser(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    studentId: row.student_id,
    name: row.display_name
  };
}

function createAppServer(options = {}) {
  const db = createDatabase(options.dbPath);
  const allowedOrigins = new Set(
    (process.env.ATTENDLY_FRONTEND_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean)
  );
  const cookieSameSite = allowedOrigins.size ? "; SameSite=None" : "; SameSite=Strict";
  const loginAttempts = new Map();
  const passwordQuery = db.prepare("SELECT password_hash FROM users WHERE username = ? AND role = ?");
  const userBySession = db.prepare(`
    SELECT users.id, users.username, users.role, users.student_id, users.display_name, sessions.expires_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
  `);
  const deleteSession = db.prepare("DELETE FROM sessions WHERE token_hash = ?");

  function authenticatedUser(request) {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const tokenHash = sha256(token);
    const row = userBySession.get(tokenHash);
    if (!row) return null;
    if (row.expires_at <= Date.now()) {
      deleteSession.run(tokenHash);
      return null;
    }
    return { ...toPublicUser(row), sessionHash: tokenHash };
  }

  function requireUser(user, roles) {
    if (!user) throw new HttpError(401, "Please sign in to continue.");
    if (roles && !roles.includes(user.role)) throw new HttpError(403, "You do not have permission to do that.");
    return user;
  }

  function dashboard(user, date) {
    const studentFilter = user.role === "student" ? "WHERE s.id = ?" : "";
    const studentParams = user.role === "student" ? [user.studentId] : [];
    const students = db.prepare(`
      SELECT s.id, s.name, s.course, s.section, s.color,
        COUNT(a.id) AS held,
        COALESCE(SUM(CASE WHEN a.status IN ('present', 'od') THEN 1 ELSE 0 END), 0) AS attended
      FROM students s
      LEFT JOIN attendance_records a ON a.student_id = s.id
      ${studentFilter}
      GROUP BY s.id
      ORDER BY s.name
    `).all(...studentParams).map((student) => ({
      ...student,
      held: Number(student.held),
      attended: Number(student.attended)
    }));

    const requestFilter = user.role === "student" ? "WHERE r.student_id = ?" : "";
    const requestParams = user.role === "student" ? [user.studentId] : [];
    const requests = db.prepare(`
      SELECT r.id, r.student_id, s.name AS student_name, s.section, r.class_date,
        r.reason, r.status, r.created_at
      FROM od_requests r
      JOIN students s ON s.id = r.student_id
      ${requestFilter}
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
    `).all(...requestParams).map((request) => ({
      id: `OD-${String(request.id).padStart(4, "0")}`,
      studentId: request.student_id,
      studentName: request.student_name,
      section: request.section,
      date: request.class_date,
      reason: request.reason,
      status: request.status,
      created: new Date(request.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    }));

    const attendanceRows = user.role === "student"
      ? db.prepare("SELECT student_id, status FROM attendance_records WHERE class_date = ? AND student_id = ?").all(date, user.studentId)
      : db.prepare("SELECT student_id, status FROM attendance_records WHERE class_date = ?").all(date);
    const statuses = Object.fromEntries(attendanceRows.map((row) => [row.student_id, row.status]));
    let activity = [];
    if (user.role === "student") {
      activity = db.prepare(`
        SELECT class_date, status, subject
        FROM attendance_records
        WHERE student_id = ?
        ORDER BY class_date DESC, id DESC
        LIMIT 7
      `).all(user.studentId).map((row) => ({
        date: new Date(`${row.class_date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
        label: row.status === "od" ? `On duty · ${row.subject}` : row.subject,
        status: row.status === "absent" ? "absent" : "present"
      }));
    }

    return {
      user: toPublicUser(db.prepare("SELECT id, username, role, student_id, display_name FROM users WHERE id = ?").get(user.id)),
      students,
      requests,
      sessions: { [date]: statuses },
      activity
    };
  }

  async function handleApi(request, response, url) {
    const user = authenticatedUser(request);
    const pathname = url.pathname;
    const method = request.method;

    if (pathname === "/api/health" && method === "GET") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (pathname === "/api/auth/login" && method === "POST") {
      const body = await readJson(request);
      const role = typeof body.role === "string" ? body.role : "";
      const username = typeof body.username === "string" ? body.username.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!roleSet.has(role) || !username || !password || username.length > 120 || password.length > 256) {
        throw new HttpError(400, "Enter a valid role and account details.");
      }

      const address = request.socket.remoteAddress || "unknown";
      const attempt = loginAttempts.get(address);
      if (attempt && attempt.blockedUntil > Date.now()) {
        throw new HttpError(429, "Too many sign-in attempts. Try again in a few minutes.");
      }
      const account = passwordQuery.get(username, role);
      let valid = false;
      if (account) {
        const [saltHex, hashHex] = account.password_hash.split(":");
        const candidate = await scryptAsync(password, Buffer.from(saltHex, "hex"), 64);
        const expected = Buffer.from(hashHex, "hex");
        valid = expected.length === candidate.length && timingSafeEqual(expected, candidate);
      }
      if (!valid) {
        const failed = (attempt?.count || 0) + 1;
        loginAttempts.set(address, failed >= 5
          ? { count: 0, blockedUntil: Date.now() + 5 * 60 * 1000 }
          : { count: failed, blockedUntil: 0 });
        throw new HttpError(401, "Invalid account, password, or role.");
      }

      loginAttempts.delete(address);
      const token = randomBytes(32).toString("hex");
      const tokenHash = sha256(token);
      const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
      db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
        .run(tokenHash, db.prepare("SELECT id FROM users WHERE username = ? AND role = ?").get(username, role).id, expiresAt, new Date().toISOString());
      const secureCookie = process.env.NODE_ENV === "production" || request.socket.encrypted;
      sendJson(response, 200, { user: toPublicUser(db.prepare("SELECT id, username, role, student_id, display_name FROM users WHERE username = ? AND role = ?").get(username, role)) }, {
        "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly${cookieSameSite}; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secureCookie ? "; Secure" : ""}`
      });
      return;
    }

    if (pathname === "/api/auth/logout" && method === "POST") {
      if (user) deleteSession.run(user.sessionHash);
      const secureCookie = process.env.NODE_ENV === "production" || request.socket.encrypted;
      sendJson(response, 200, { ok: true }, {
        "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly${cookieSameSite}; Path=/; Max-Age=0${secureCookie ? "; Secure" : ""}`
      });
      return;
    }

    if (pathname === "/api/auth/me" && method === "GET") {
      requireUser(user);
      sendJson(response, 200, { user: toPublicUser(db.prepare("SELECT id, username, role, student_id, display_name FROM users WHERE id = ?").get(user.id)) });
      return;
    }

    if (pathname === "/api/dashboard" && method === "GET") {
      requireUser(user);
      const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
      if (!isValidDate(date)) throw new HttpError(400, "Choose a valid attendance date.");
      sendJson(response, 200, dashboard(user, date));
      return;
    }

    if (pathname === "/api/attendance" && method === "GET") {
      requireUser(user, ["faculty", "admin"]);
      const date = url.searchParams.get("date");
      if (!isValidDate(date)) throw new HttpError(400, "Choose a valid attendance date.");
      const records = db.prepare("SELECT student_id, status FROM attendance_records WHERE class_date = ?").all(date);
      sendJson(response, 200, { date, records: Object.fromEntries(records.map((row) => [row.student_id, row.status])) });
      return;
    }

    if (pathname === "/api/attendance" && method === "POST") {
      requireUser(user, ["faculty", "admin"]);
      const body = await readJson(request);
      if (!isValidDate(body.date) || typeof body.section !== "string" || !/^[A-Z0-9][A-Z0-9_-]{0,23}$/.test(body.section) || !Array.isArray(body.records) || body.records.length > 1000) {
        throw new HttpError(400, "Provide a valid date and attendance records.");
      }
      const roster = db.prepare("SELECT id FROM students WHERE section = ?").all(body.section).map((row) => row.id);
      const received = new Map();
      for (const record of body.records) {
        if (!record || typeof record.studentId !== "string" || !["present", "absent"].includes(record.status)) {
          throw new HttpError(400, "Each attendance record needs a student and a present/absent status.");
        }
        if (!roster.includes(record.studentId) || received.has(record.studentId)) {
          throw new HttpError(400, "Attendance records contain an unknown or duplicate student.");
        }
        received.set(record.studentId, record.status);
      }
      if (roster.length === 0 || received.size !== roster.length) throw new HttpError(400, "Mark every student in this section before saving attendance.");

      const upsert = db.prepare(`
        INSERT INTO attendance_records (student_id, class_date, status, subject, marked_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, class_date) DO UPDATE SET
          status = CASE WHEN attendance_records.status = 'od' THEN 'od' ELSE excluded.status END,
          marked_by = excluded.marked_by
      `);
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const [studentId, status] of received) {
          upsert.run(studentId, body.date, status, `${body.section} class attendance`, user.id, now);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      sendJson(response, 200, { ok: true, date: body.date });
      return;
    }

    if (pathname === "/api/students" && method === "POST") {
      requireUser(user, ["admin"]);
      const body = await readJson(request);
      const studentId = typeof body.studentId === "string" ? body.studentId.trim().toUpperCase() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const course = typeof body.course === "string" ? body.course.trim() : "";
      const section = typeof body.section === "string" ? body.section.trim().toUpperCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(studentId)) throw new HttpError(400, "Student ID must be 3–32 letters, numbers, hyphens, or underscores.");
      if (name.length < 2 || name.length > 80) throw new HttpError(400, "Student name must be between 2 and 80 characters.");
      if (course.length < 2 || course.length > 120) throw new HttpError(400, "Course must be between 2 and 120 characters.");
      if (!/^[A-Z0-9][A-Z0-9_-]{0,23}$/.test(section)) throw new HttpError(400, "Section must be 1–24 letters, numbers, hyphens, or underscores.");
      if (password.length < 10 || password.length > 128) throw new HttpError(400, "Set an initial password between 10 and 128 characters.");
      const colors = db.prepare("SELECT COUNT(*) AS count FROM students").get().count;
      const color = palette[Number(colors) % palette.length];
      const passwordHash = await hashPassword(password);
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("INSERT INTO students (id, name, course, section, color, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(studentId, name, course, section, color, now);
        db.prepare("INSERT INTO users (username, password_hash, role, student_id, display_name, created_at) VALUES (?, ?, 'student', ?, ?, ?)")
          .run(studentId, passwordHash, studentId, name, now);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        if (String(error.message).includes("UNIQUE constraint failed")) throw new HttpError(409, "That student ID already exists.");
        throw error;
      }
      sendJson(response, 201, { ok: true, studentId });
      return;
    }

    if (pathname === "/api/od-requests" && method === "POST") {
      requireUser(user, ["student"]);
      const body = await readJson(request);
      const classDate = body.date;
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!isValidDate(classDate) || classDate < new Date().toISOString().slice(0, 10)) {
        throw new HttpError(400, "Choose today or a future activity date.");
      }
      if (reason.length < 5 || reason.length > 300) throw new HttpError(400, "Reason must be between 5 and 300 characters.");
      const active = db.prepare(`
        SELECT id FROM od_requests
        WHERE student_id = ? AND class_date = ? AND status IN ('pending', 'approved')
      `).get(user.studentId, classDate);
      if (active) throw new HttpError(409, "You already have an active OD request for this date.");
      try {
        db.prepare(`
          INSERT INTO od_requests (student_id, class_date, reason, status, created_at)
          VALUES (?, ?, ?, 'pending', ?)
        `).run(user.studentId, classDate, reason, new Date().toISOString());
      } catch (error) {
        if (String(error.message).includes("UNIQUE constraint failed")) throw new HttpError(409, "You already have an active OD request for this date.");
        throw error;
      }
      sendJson(response, 201, { ok: true });
      return;
    }

    const decisionMatch = pathname.match(/^\/api\/od-requests\/(OD-\d+)\/decision$/);
    if (decisionMatch && method === "POST") {
      requireUser(user, ["faculty", "admin"]);
      const body = await readJson(request);
      if (!["approved", "rejected"].includes(body.decision)) throw new HttpError(400, "Choose approve or reject.");
      const requestId = Number(decisionMatch[1].slice(3));
      const odRequest = db.prepare("SELECT id, student_id, class_date, reason, status FROM od_requests WHERE id = ?").get(requestId);
      if (!odRequest) throw new HttpError(404, "OD request not found.");
      if (odRequest.status !== "pending") throw new HttpError(409, "This OD request has already been reviewed.");

      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE od_requests SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ? AND status = 'pending'")
          .run(body.decision, now, user.id, requestId);
        if (body.decision === "approved") {
          db.prepare(`
            INSERT INTO attendance_records (student_id, class_date, status, subject, marked_by, created_at)
            VALUES (?, ?, 'od', ?, ?, ?)
            ON CONFLICT(student_id, class_date) DO UPDATE SET
              status = 'od',
              subject = excluded.subject,
              marked_by = excluded.marked_by
          `).run(odRequest.student_id, odRequest.class_date, `On-duty · ${odRequest.reason}`, user.id, now);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      sendJson(response, 200, { ok: true, status: body.decision });
      return;
    }

    throw new HttpError(404, "API endpoint not found.");
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("X-Frame-Options", "DENY");
    let url;
    try {
      url = new URL(request.url, "http://localhost");
      const origin = request.headers.origin;
      if (origin) {
        const requestOrigin = `${request.socket.encrypted ? "https" : "http"}://${request.headers.host}`;
        const isConfiguredOrigin = allowedOrigins.has(origin);
        if (origin !== requestOrigin && !isConfiguredOrigin) {
          throw new HttpError(403, "This origin is not allowed.");
        }
        if (isConfiguredOrigin) {
          response.setHeader("Access-Control-Allow-Origin", origin);
          response.setHeader("Access-Control-Allow-Credentials", "true");
          response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
          response.setHeader("Access-Control-Allow-Headers", "Content-Type");
          response.setHeader("Vary", "Origin");
        }
      }
      if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
        response.writeHead(204);
        response.end();
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url);
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        throw new HttpError(405, "Method not allowed.");
      }
      if (url.pathname === "/config.js") {
        response.writeHead(200, {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-store"
        });
        response.end(request.method === "HEAD" ? undefined : `window.ATTENDLY_API_BASE = "";\nwindow.ATTENDLY_IS_PRODUCTION = ${process.env.NODE_ENV === "production"};\n`);
        return;
      }
      const file = staticFiles[url.pathname];
      if (!file) throw new HttpError(404, "Page not found.");
      const content = fs.readFileSync(path.join(__dirname, file[0]));
      response.writeHead(200, {
        "Content-Type": file[1],
        "Cache-Control": "no-cache"
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      console.error("Attendly request failed:", error);
      sendJson(response, 500, { error: "The server could not complete that request." });
    }
  });

  server.database = db;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  const server = createAppServer({ dbPath: process.env.DB_PATH });
  server.listen(port, host, () => {
    console.log(`Attendly is listening on http://${host}:${port}`);
  });
}

module.exports = { createAppServer };
