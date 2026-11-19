const { randomBytes, scryptSync } = require("node:crypto");
const { mkdirSync } = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const demoStudents = [
  { id: "STU-2041", name: "Aanya Shah", course: "Computer Science · Year 2", section: "CS-2A", attended: 33, held: 42, color: "purple" },
  { id: "STU-2042", name: "Aarav Mehta", course: "Computer Science · Year 2", section: "CS-2A", attended: 38, held: 42, color: "green" },
  { id: "STU-2043", name: "Kiara Das", course: "Computer Science · Year 2", section: "CS-2A", attended: 36, held: 43, color: "orange" },
  { id: "STU-2044", name: "Ishan Verma", course: "Computer Science · Year 2", section: "CS-2A", attended: 31, held: 42, color: "blue" },
  { id: "STU-2045", name: "Meera Rao", course: "Computer Science · Year 2", section: "CS-2A", attended: 40, held: 43, color: "purple" }
];

const subjects = [
  "Algorithms & Data Structures",
  "Database Management Systems",
  "Operating Systems",
  "Computer Networks"
];

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function addDays(date, amount) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}

function recentWeekdays(count) {
  const dates = [];
  const cursor = new Date();
  cursor.setUTCHours(12, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (dates.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

function seedDemoData(db) {
  const now = new Date().toISOString();
  const production = process.env.NODE_ENV === "production";
  const passwords = {
    admin: process.env.ATTENDLY_ADMIN_PASSWORD || (production ? "" : "attendly"),
    faculty: process.env.ATTENDLY_FACULTY_PASSWORD || (production ? "" : "attendly"),
    student: process.env.ATTENDLY_STUDENT_PASSWORD || (production ? "" : "attendly")
  };
  if (Object.values(passwords).some((password) => password.length < (production ? 12 : 1))) {
    throw new Error("Set strong ATTENDLY_ADMIN_PASSWORD, ATTENDLY_FACULTY_PASSWORD, and ATTENDLY_STUDENT_PASSWORD values before production database initialization.");
  }
  const insertStudent = db.prepare(
    "INSERT INTO students (id, name, course, section, color, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insertUser = db.prepare(
    "INSERT INTO users (username, password_hash, role, student_id, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insertAttendance = db.prepare(
    "INSERT INTO attendance_records (student_id, class_date, status, subject, marked_by, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const dates = recentWeekdays(43);

  db.exec("BEGIN IMMEDIATE");
  try {
    insertUser.run("admin@campus.edu", hashPassword(passwords.admin), "admin", null, "Campus Admin", now);
    insertUser.run("faculty@campus.edu", hashPassword(passwords.faculty), "faculty", null, "Riya Kapoor", now);

    demoStudents.forEach((student, studentIndex) => {
      insertStudent.run(student.id, student.name, student.course, student.section, student.color, now);
      insertUser.run(student.id, hashPassword(passwords.student), "student", student.id, student.name, now);
      for (let index = 0; index < student.held; index += 1) {
        const present = ((index * 17 + studentIndex * 9) % student.held) < student.attended;
        const createdAt = `${dates[dates.length - student.held + index]}T08:30:00.000Z`;
        insertAttendance.run(
          student.id,
          dates[dates.length - student.held + index],
          present ? "present" : "absent",
          subjects[(index + studentIndex) % subjects.length],
          null,
          createdAt
        );
      }
    });

    const aaravOdDate = dates[dates.length - 7];
    db.prepare(
      "UPDATE attendance_records SET status = 'od', subject = ? WHERE student_id = ? AND class_date = ?"
    ).run("College basketball team fixture", "STU-2042", aaravOdDate);

    const insertRequest = db.prepare(
      "INSERT INTO od_requests (student_id, class_date, reason, status, created_at, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    insertRequest.run(
      "STU-2041",
      addDays(now.slice(0, 10), 2),
      "Representing the college at the inter-college design showcase.",
      "pending",
      now,
      null
    );
    insertRequest.run(
      "STU-2044",
      addDays(now.slice(0, 10), 1),
      "Participating in the state-level coding competition.",
      "pending",
      now,
      null
    );
    insertRequest.run(
      "STU-2042",
      aaravOdDate,
      "College basketball team fixture.",
      "approved",
      now,
      now
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function createDatabase(filename = path.join(__dirname, "data", "attendly.sqlite")) {
  if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      course TEXT NOT NULL,
      section TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('student', 'faculty', 'admin')),
      student_id TEXT UNIQUE REFERENCES students(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CHECK ((role = 'student' AND student_id IS NOT NULL) OR (role != 'student' AND student_id IS NULL))
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      class_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'od')),
      subject TEXT NOT NULL,
      marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      UNIQUE (student_id, class_date)
    );

    CREATE INDEX IF NOT EXISTS attendance_by_date ON attendance_records(class_date);

    CREATE TABLE IF NOT EXISTS od_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      class_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS one_active_od_per_student_date
      ON od_requests(student_id, class_date)
      WHERE status IN ('pending', 'approved');

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions(expires_at);
  `);

  try {
    if (db.prepare("SELECT COUNT(*) AS count FROM users").get().count === 0) seedDemoData(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

module.exports = { createDatabase };
