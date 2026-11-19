const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { createAppServer } = require("./server");
const { createDatabase } = require("./database");

const tempDir = mkdtempSync(path.join(os.tmpdir(), "attendly-test-"));
const server = createAppServer({ dbPath: path.join(tempDir, "test.sqlite") });
let baseUrl;

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  server.database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function api(url, options = {}) {
  return fetch(`${baseUrl}${url}`, options);
}

async function signIn(role, username, password = "attendly") {
  const response = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, username, password })
  });
  const body = await response.json();
  return {
    response,
    body,
    cookie: response.headers.get("set-cookie")?.split(";")[0]
  };
}

function jsonOptions(cookie, method, body) {
  return {
    method,
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  };
}

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

test("authenticates users by role and restricts student data", async () => {
  const anonymous = await api("/api/dashboard");
  assert.equal(anonymous.status, 401);

  const wrongRole = await signIn("faculty", "STU-2041");
  assert.equal(wrongRole.response.status, 401);

  const { response, cookie } = await signIn("student", "STU-2041");
  assert.equal(response.status, 200);
  assert.ok(cookie);

  const dashboardResponse = await api("/api/dashboard", { headers: { Cookie: cookie } });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.user.role, "student");
  assert.equal(dashboard.students.length, 1);
  assert.equal(dashboard.students[0].id, "STU-2041");
  assert.equal(dashboard.students[0].attended, 33);
  assert.equal(Object.keys(dashboard.sessions[isoDate()]).length <= 1, true);

  const forbidden = await api("/api/attendance", {
    method: "POST",
    ...jsonOptions(cookie, "POST", { date: isoDate(), section: "CS-2A", records: [] })
  });
  assert.equal(forbidden.status, 403);
});

test("saves attendance idempotently and validates each section roster", async () => {
  const { cookie } = await signIn("faculty", "faculty@campus.edu");
  const date = isoDate(10);
  const body = {
    date,
    section: "CS-2A",
    records: [
      { studentId: "STU-2041", status: "present" },
      { studentId: "STU-2042", status: "present" },
      { studentId: "STU-2043", status: "present" },
      { studentId: "STU-2044", status: "absent" },
      { studentId: "STU-2045", status: "present" }
    ]
  };

  const incomplete = await api("/api/attendance", jsonOptions(cookie, "POST", { ...body, records: body.records.slice(1) }));
  assert.equal(incomplete.status, 400);

  const firstSave = await api("/api/attendance", jsonOptions(cookie, "POST", body));
  const secondSave = await api("/api/attendance", jsonOptions(cookie, "POST", body));
  assert.equal(firstSave.status, 200);
  assert.equal(secondSave.status, 200);

  const dashboardResponse = await api(`/api/dashboard?date=${date}`, { headers: { Cookie: cookie } });
  const dashboard = await dashboardResponse.json();
  const aanya = dashboard.students.find((student) => student.id === "STU-2041");
  assert.equal(aanya.attended, 34);
  assert.equal(aanya.held, 43);
  assert.equal(dashboard.sessions[date]["STU-2044"], "absent");
});

test("OD requests are unique and approval records present attendance", async () => {
  const student = await signIn("student", "STU-2041");
  const faculty = await signIn("faculty", "faculty@campus.edu");
  const date = isoDate(12);
  const request = await api("/api/od-requests", jsonOptions(student.cookie, "POST", {
    date,
    reason: "Representing the institute at a robotics event"
  }));
  assert.equal(request.status, 201);

  const duplicate = await api("/api/od-requests", jsonOptions(student.cookie, "POST", {
    date,
    reason: "Another request for the same date"
  }));
  assert.equal(duplicate.status, 409);

  const markedAbsent = await api("/api/attendance", jsonOptions(faculty.cookie, "POST", {
    date,
    section: "CS-2A",
    records: [
      { studentId: "STU-2041", status: "absent" },
      { studentId: "STU-2042", status: "present" },
      { studentId: "STU-2043", status: "present" },
      { studentId: "STU-2044", status: "present" },
      { studentId: "STU-2045", status: "present" }
    ]
  }));
  assert.equal(markedAbsent.status, 200);
  const afterRollResponse = await api("/api/dashboard", { headers: { Cookie: student.cookie } });
  const afterRoll = (await afterRollResponse.json()).students[0];

  const facultyDashboard = await api("/api/dashboard", { headers: { Cookie: faculty.cookie } });
  const staffData = await facultyDashboard.json();
  const odRequest = staffData.requests.find((item) => item.date === date && item.studentId === "STU-2041");
  assert.ok(odRequest);

  const decision = await api(
    `/api/od-requests/${odRequest.id}/decision`,
    jsonOptions(faculty.cookie, "POST", { decision: "approved" })
  );
  assert.equal(decision.status, 200);

  const studentDashboardResponse = await api(`/api/dashboard?date=${date}`, { headers: { Cookie: student.cookie } });
  const studentData = await studentDashboardResponse.json();
  assert.equal(studentData.students[0].attended, afterRoll.attended + 1);
  assert.equal(studentData.students[0].held, afterRoll.held);
  assert.equal(studentData.sessions[date]["STU-2041"], "od");
  assert.match(studentData.activity[0].label, /^On duty/);

  const secondDecision = await api(
    `/api/od-requests/${odRequest.id}/decision`,
    jsonOptions(faculty.cookie, "POST", { decision: "approved" })
  );
  assert.equal(secondDecision.status, 409);
});

test("admins can add student records with login accounts", async () => {
  const { cookie } = await signIn("admin", "admin@campus.edu");
  const created = await api("/api/students", jsonOptions(cookie, "POST", {
    studentId: "STU-2099",
    name: "Test Student",
    course: "Computer Science · Year 2",
    section: "CS-2B",
    password: "student-temp-123"
  }));
  assert.equal(created.status, 201);

  const studentLogin = await signIn("student", "STU-2099", "student-temp-123");
  assert.equal(studentLogin.response.status, 200);
  const dashboardResponse = await api("/api/dashboard", { headers: { Cookie: studentLogin.cookie } });
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.students.length, 1);
  assert.equal(dashboard.students[0].section, "CS-2B");
  assert.equal(dashboard.students[0].held, 0);
});

test("allows configured Vercel origins to use secure API sessions", async () => {
  const previousOrigins = process.env.ATTENDLY_FRONTEND_ORIGINS;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.ATTENDLY_FRONTEND_ORIGINS = "https://attendly.example";
  process.env.NODE_ENV = "test";
  const corsServer = createAppServer({ dbPath: path.join(tempDir, "cors.sqlite") });
  await new Promise((resolve) => corsServer.listen(0, "127.0.0.1", resolve));
  process.env.NODE_ENV = "production";

  try {
    const url = `http://127.0.0.1:${corsServer.address().port}`;
    const preflight = await fetch(`${url}/api/auth/login`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://attendly.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"
      }
    });

    test("requires explicit production seed passwords", () => {
      const previous = {
        nodeEnv: process.env.NODE_ENV,
        admin: process.env.ATTENDLY_ADMIN_PASSWORD,
        faculty: process.env.ATTENDLY_FACULTY_PASSWORD,
        student: process.env.ATTENDLY_STUDENT_PASSWORD
      };
      process.env.NODE_ENV = "production";
      delete process.env.ATTENDLY_ADMIN_PASSWORD;
      delete process.env.ATTENDLY_FACULTY_PASSWORD;
      delete process.env.ATTENDLY_STUDENT_PASSWORD;
      try {
        assert.throws(() => createDatabase(":memory:"), /Set strong ATTENDLY_ADMIN_PASSWORD/);
      } finally {
        for (const [key, value] of [
          ["NODE_ENV", previous.nodeEnv],
          ["ATTENDLY_ADMIN_PASSWORD", previous.admin],
          ["ATTENDLY_FACULTY_PASSWORD", previous.faculty],
          ["ATTENDLY_STUDENT_PASSWORD", previous.student]
        ]) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://attendly.example");
    assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");

    const login = await fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { Origin: "https://attendly.example", "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin@campus.edu", password: "attendly", role: "admin" })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    assert.match(cookie, /SameSite=None/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /HttpOnly/);
  } finally {
    if (previousOrigins === undefined) delete process.env.ATTENDLY_FRONTEND_ORIGINS;
    else process.env.ATTENDLY_FRONTEND_ORIGINS = previousOrigins;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    await new Promise((resolve) => corsServer.close(resolve));
    corsServer.database.close();
  }
});
