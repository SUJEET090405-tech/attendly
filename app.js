const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-5 5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  alert: '<path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>'
};

const svg = (name, extra = "") => `<svg ${extra} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ""}</svg>`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const initials = (name) => name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
const API_BASE = String(window.ATTENDLY_API_BASE || "").replace(/\/+$/, "");
const isProduction = window.ATTENDLY_IS_PRODUCTION === true;
let data = { students: [], requests: [], sessions: {}, activity: [] };
let currentUser = null;
let currentPage = "overview";
let selectedRole = "student";
let selectedDate = todayISO();
let selectedSection = "CS-2A";
let toastTimer;

async function apiRequest(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

async function loadDashboard() {
  const payload = await apiRequest(`/api/dashboard?date=${encodeURIComponent(selectedDate)}`);
  currentUser = payload.user;
  data = payload;
}

function studentById(id) {
  return data.students.find((student) => student.id === id);
}

function attendancePercent(student) {
  return student.held ? Math.round((student.attended / student.held) * 1000) / 10 : 0;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function showToast(message) {
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.append(toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.remove(), 2800);
}

function renderLogin() {
  document.getElementById("app").innerHTML = `
    <main class="login-shell">
      <section class="login-art">
        <div class="brand">${svg("check", 'class="brand-mark"')}<span>attendly</span></div>
        <div class="art-copy">
          <div class="eyebrow">A better rhythm for campus</div>
          <h1>Every day<br>counts.</h1>
          <p>Attendance that keeps students on track and gives faculty more time to teach.</p>
        </div>
        <div class="art-bottom">One campus. One clear picture.</div>
      </section>
      <section class="login-panel">
        <div class="login-card">
          <h2>Welcome back</h2>
          <p class="login-subtitle">Sign in to your Attendly workspace.</p>
          <div class="role-tabs" role="tablist" aria-label="Choose account type">
            ${["student", "faculty", "admin"].map((role) => `<button class="role-tab ${role === selectedRole ? "active" : ""}" type="button" role="tab" aria-selected="${role === selectedRole}" data-role="${role}">${role[0].toUpperCase() + role.slice(1)}</button>`).join("")}
          </div>
          <form id="login-form">
            <div class="field">
              <label for="username">${selectedRole === "student" ? "Student ID" : "Email address"}</label>
              <div class="input-wrap">${svg("user")}<input id="username" name="username" autocomplete="username" placeholder="${selectedRole === "student" ? "e.g. STU-2041" : `name@campus.edu`}" required></div>
            </div>
            <div class="field">
              <label for="password">Password</label>
              <div class="input-wrap">${svg("lock")}<input id="password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required></div>
            </div>
            <div class="login-error" id="login-error" aria-live="polite"></div>
            <button class="primary-btn full" type="submit">Sign in ${svg("arrow")}</button>
          </form>
          <div class="demo-hint">${svg("info")}<span>${isProduction
            ? "<strong>Institute access</strong><br>Use the account details provided by your campus administrator."
            : `<strong>Demo access</strong><br>Use <strong>${demoUsername(selectedRole)}</strong> / <strong>attendly</strong>, or enter any student ID shown in the student list.`}</span></div>
        </div>
      </section>
    </main>`;
  document.querySelectorAll(".role-tab").forEach((button) => button.addEventListener("click", () => {
    selectedRole = button.dataset.role;
    renderLogin();
  }));
  document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username")).trim();
    const password = String(form.get("password")).trim();
    if (!username || !password) {
      document.getElementById("login-error").textContent = "Enter your account details to continue.";
      return;
    }
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password, role: selectedRole })
      });
      await loadDashboard();
      currentPage = "overview";
      renderApp();
    } catch (error) {
      document.getElementById("login-error").textContent = error.message;
      submit.disabled = false;
    }
  });
}

function demoUsername(role) {
  return role === "student" ? "STU-2041" : role === "faculty" ? "faculty@campus.edu" : "admin@campus.edu";
}

function navItems() {
  if (currentUser.role === "student") return [
    ["overview", "Overview", "grid"],
    ["attendance", "My attendance", "calendar"],
    ["requests", "OD requests", "file"]
  ];
  if (currentUser.role === "faculty") return [
    ["overview", "Overview", "grid"],
    ["mark", "Mark attendance", "calendar"],
    ["requests", "OD approvals", "file"],
    ["students", "Students", "people"]
  ];
  return [
    ["overview", "Overview", "grid"],
    ["students", "Students", "people"],
    ["mark", "Mark attendance", "calendar"],
    ["requests", "OD approvals", "file"]
  ];
}

function renderApp() {
  const name = currentUser.name;
  const role = currentUser.role;
  const pendingCount = role === "student"
    ? data.requests.filter((request) => request.status === "pending" && request.studentId === currentUser.studentId).length
    : data.requests.filter((request) => request.status === "pending").length;
  document.getElementById("app").innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><span class="brand-mark">${svg("check")}</span><span>attendly</span></div>
        <div class="nav-caption">Workspace</div>
        <nav class="nav-list" aria-label="Main navigation">
          ${navItems().map(([page, label, icon]) => `<button class="nav-item ${currentPage === page ? "active" : ""}" type="button" data-page="${page}">${svg(icon)}<span>${label}</span>${page === "requests" && pendingCount && role !== "student" ? `<span class="nav-count">${pendingCount}</span>` : ""}</button>`).join("")}
        </nav>
        <div class="sidebar-bottom">
          <div class="support-card"><strong>Need a hand?</strong><p>Reach out to your campus administrator for help with your account.</p></div>
          <div class="profile-mini"><div class="avatar ${role === "faculty" ? "green" : role === "admin" ? "orange" : ""}">${initials(name)}</div><div class="profile-info"><strong>${escapeHTML(name)}</strong><span>${role} account</span></div><button class="logout-icon" id="logout" type="button" aria-label="Sign out">${svg("logout")}</button></div>
        </div>
      </aside>
      <div class="main-area">
        <header class="topbar">
          <div class="topbar-left"><button class="icon-button mobile-menu" id="mobile-menu" type="button" aria-label="Open menu">${svg("menu")}</button><div class="crumbs">Attendly <span> / </span> <strong>${pageTitle(currentPage)}</strong></div></div>
          <div class="topbar-right"><span class="today-label">${new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span><button class="icon-button" id="notifications" type="button" aria-label="${pendingCount} pending notifications">${svg("bell")}${pendingCount ? '<i class="notification-dot"></i>' : ""}</button></div>
        </header>
        <main class="main-content">${renderPage()}</main>
      </div>
    </div>`;
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", async () => {
    currentPage = button.dataset.page;
    if (currentPage === "overview" && currentUser.role !== "student" && selectedDate !== todayISO()) {
      selectedDate = todayISO();
      try {
        await loadDashboard();
      } catch (error) {
        showToast(error.message);
      }
    }
    renderApp();
  }));
  document.getElementById("logout").addEventListener("click", async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
      currentUser = null;
      data = { students: [], requests: [], sessions: {}, activity: [] };
      selectedRole = "student";
      renderLogin();
    } catch (error) {
      showToast(error.message);
    }
  });
  document.getElementById("mobile-menu").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
  document.getElementById("notifications").addEventListener("click", () => {
    currentPage = currentUser.role === "student" ? "requests" : "requests";
    renderApp();
  });
  bindPageActions();
}

function pageTitle(page) {
  return ({ overview: "Overview", attendance: "My attendance", requests: currentUser.role === "student" ? "OD requests" : "OD approvals", mark: "Mark attendance", students: "Students" })[page] || "Overview";
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function studentSummary(student) {
  const percentage = attendancePercent(student);
  return `<div class="stat-card"><div class="stat-top"><span>Overall attendance</span><span class="stat-icon ${percentage < 80 ? "orange" : "green"}">${svg("chart")}</span></div><div class="stat-number">${percentage}%</div><div class="stat-note">${student.attended} of ${student.held} classes attended</div></div>
    <div class="stat-card"><div class="stat-top"><span>Classes attended</span><span class="stat-icon green">${svg("check")}</span></div><div class="stat-number">${student.attended}</div><div class="stat-note"><strong>Keep it up</strong> · Your effort adds up</div></div>
    <div class="stat-card"><div class="stat-top"><span>Classes missed</span><span class="stat-icon orange">${svg("calendar")}</span></div><div class="stat-number">${student.held - student.attended}</div><div class="stat-note">Out of ${student.held} scheduled classes</div></div>
    <div class="stat-card"><div class="stat-top"><span>OD requests</span><span class="stat-icon">${svg("file")}</span></div><div class="stat-number">${data.requests.filter((request) => request.studentId === student.id).length}</div><div class="stat-note">${data.requests.filter((request) => request.studentId === student.id && request.status === "pending").length} awaiting faculty review</div></div>`;
}

function adminFacultySummary() {
  const below = data.students.filter((student) => student.held > 0 && attendancePercent(student) < 80).length;
  const approved = data.requests.filter((request) => request.status === "approved").length;
  const sections = new Set(data.students.map((student) => student.section));
  return `<div class="stat-card"><div class="stat-top"><span>Total students</span><span class="stat-icon">${svg("people")}</span></div><div class="stat-number">${data.students.length}</div><div class="stat-note">Across ${sections.size} active section${sections.size === 1 ? "" : "s"}</div></div>
    <div class="stat-card"><div class="stat-top"><span>Average attendance</span><span class="stat-icon green">${svg("chart")}</span></div><div class="stat-number">${averageAttendance()}%</div><div class="stat-note"><strong>Across the cohort</strong> · CS-2A</div></div>
    <div class="stat-card"><div class="stat-top"><span>Below 80% threshold</span><span class="stat-icon orange">${svg("alert")}</span></div><div class="stat-number">${below}</div><div class="stat-note">Students needing attention</div></div>
    <div class="stat-card"><div class="stat-top"><span>Approved OD requests</span><span class="stat-icon green">${svg("check")}</span></div><div class="stat-number">${approved}</div><div class="stat-note">${pendingCount()} requests awaiting review</div></div>`;
}

function pendingCount() {
  return data.requests.filter((request) => request.status === "pending").length;
}

function averageAttendance() {
  if (!data.students.length) return 0;
  return Math.round(data.students.reduce((sum, student) => sum + attendancePercent(student), 0) / data.students.length);
}

function renderPage() {
  if (currentPage === "attendance") return renderStudentAttendance();
  if (currentPage === "mark") return renderMarkAttendance();
  if (currentPage === "requests") return renderRequests();
  if (currentPage === "students") return renderStudents();
  return renderOverview();
}

function renderOverview() {
  if (currentUser.role === "student") {
    const student = studentById(currentUser.studentId);
    const percent = attendancePercent(student);
    const safeClasses = Math.max(0, Math.ceil((0.8 * student.held - student.attended) / 0.2 - 1e-9));
    const activityRows = data.activity.map((item) => `<div class="list-row"><span class="stat-icon ${item.status === "present" ? "green" : "red"}">${svg(item.status === "present" ? "check" : "calendar")}</span><div class="list-meta"><strong>${escapeHTML(item.label)}</strong><span>${escapeHTML(item.date)}</span></div><span class="status-pill ${item.status}">${item.status === "present" ? "Present" : "Absent"}</span></div>`).join("");
    return `<div class="welcome-row"><div><h1>${greeting()}, ${escapeHTML(student.name.split(" ")[0])} 👋</h1><p>Here’s how your attendance is looking this semester.</p></div><div class="welcome-actions"><button class="secondary-btn" data-goto="requests">${svg("file")} Request OD</button></div></div>
      <div class="stats-grid">${studentSummary(student)}</div>
      <div class="section-title">Your semester at a glance</div>
      <div class="content-grid">
        <section class="panel"><div class="panel-header"><div><h2>Attendance trend</h2><p>Recent class attendance</p></div><span class="status-pill ${percent < 80 ? "pending" : ""}">${percent}% overall</span></div><div class="panel-body">${renderChart()}<div class="chart-key"><i></i> Present</div></div></section>
        <section class="panel"><div class="panel-header"><div><h2>Attendance check-in</h2><p>Stay on top of your 80% goal</p></div></div><div class="panel-body">${renderAttendanceCheckin(student, percent, safeClasses)}<div style="height:17px"></div><div class="mini-list">${activityRows}</div></div></section>
      </div>`;
  }
  return renderStaffOverview();
}

function renderStaffOverview() {
  const isAdmin = currentUser.role === "admin";
  const stats = adminFacultySummary();
  const sections = new Set(data.students.map((student) => student.section));
  const sectionLabel = sections.size === 1 ? "active section" : "active sections";
  const lowStudents = data.students.filter((student) => student.held > 0 && attendancePercent(student) < 80);
  const requests = data.requests.filter((request) => request.status === "pending").slice(0, 3);
  const markSession = data.sessions[todayISO()] || {};
  const todayStudents = data.students.filter((student) => student.section === "CS-2A");
  const presentToday = todayStudents.filter((student) => markSession[student.id] === "present" || markSession[student.id] === "od").length;
  return `<div class="welcome-row"><div><h1>${greeting()}, ${escapeHTML(currentUser.name.split(" ")[0])} 👋</h1><p>${isAdmin ? "Here’s what’s happening across your campus today." : "Your class overview and action items for today."}</p></div><div class="welcome-actions"><button class="primary-btn" data-goto="${isAdmin ? "students" : "mark"}">${svg(isAdmin ? "people" : "calendar")}${isAdmin ? "View students" : "Take attendance"}</button></div></div>
    <div class="stats-grid">${stats}</div>
    <div class="section-title">Today’s overview</div>
    <div class="content-grid">
      <section class="panel"><div class="panel-header"><div><h2>Section attendance</h2><p>${sections.size} ${sectionLabel} · CS-2A overview</p></div><button class="quiet-btn" data-goto="mark">Open register ${svg("arrow")}</button></div><div class="panel-body"><div class="attendance-summary"><div><strong>${presentToday}/${todayStudents.length}</strong><span>CS-2A marked present today</span></div><div class="progress-track" style="width:42%;background:#e5e2ff"><div class="progress-fill" style="width:${todayStudents.length ? presentToday / todayStudents.length * 100 : 0}%;background:var(--purple)"></div></div><span style="color:#7369c5;font-size:11px;font-weight:700">${todayStudents.length ? Math.round(presentToday / todayStudents.length * 100) : 0}%</span></div>${renderStudentTable(todayStudents.slice(0, 5), false)}</div></section>
      <div style="display:grid;gap:15px">
        <section class="panel"><div class="panel-header"><div><h2>Attendance alerts</h2><p>Students below the 80% requirement</p></div><button class="quiet-btn" data-goto="students">View all</button></div><div class="panel-body">${lowStudents.length ? `<div class="mini-list">${lowStudents.map((student) => `<div class="list-row"><div class="avatar ${escapeHTML(student.color)}">${initials(student.name)}</div><div class="list-meta"><strong>${escapeHTML(student.name)}</strong><span>${escapeHTML(student.id)}</span></div><span class="status-pill absent">${attendancePercent(student)}%</span></div>`).join("")}</div>` : '<div class="empty-state">All students are above the attendance threshold.</div>'}</div></section>
        <section class="panel"><div class="panel-header"><div><h2>OD requests</h2><p>${pendingCount()} awaiting your review</p></div><button class="quiet-btn" data-goto="requests">Review</button></div><div class="panel-body">${requests.length ? `<div class="mini-list">${requests.map((request) => { const student = studentById(request.studentId); return `<div class="list-row"><div class="avatar ${student?.color || ""}">${initials(student?.name || "Student")}</div><div class="list-meta"><strong>${escapeHTML(student?.name || "Student")}</strong><span>${formatDate(request.date)}</span></div><span class="status-pill pending">Pending</span></div>`; }).join("")}</div>` : '<div class="empty-state">No pending OD requests.</div>'}</div></section>
      </div>
    </div>`;
}

function renderChart() {
  const records = data.activity.slice(0, 7).reverse();
  const values = records.map((record) => record.status === "present" ? 100 : 8);
  const days = records.map((record) => record.date.split(",")[0]);
  return `<div class="chart-area"><div class="chart-labels"><span>100%</span><span>75%</span><span>50%</span><span>25%</span></div><div class="chart-grid"><span></span><span></span><span></span><span></span></div><div class="chart-bars">${values.map((value, index) => `<div class="chart-column ${index === records.length - 1 ? "today" : ""}"><div class="chart-bar" style="height:${value}%"></div><span class="chart-day">${days[index]}</span></div>`).join("")}</div></div>`;
}

function renderAttendanceCheckin(student, percent, safeClasses) {
  if (!student.held) {
    return `<div class="alert-card"><div class="alert-heading">${svg("info")}No attendance recorded yet</div><p>Your attendance summary will appear here after your first class.</p></div>`;
  }
  if (percent < 80) {
    return `<div class="alert-card"><div class="alert-heading">${svg("alert")}Attendance needs attention</div><p>You’re <strong>${(80 - percent).toFixed(1)}% below</strong> the 80% requirement. Attend your next <strong>${safeClasses} classes</strong> to get back on track.</p><div class="progress-track"><div class="progress-fill" style="width:${Math.min(percent, 100)}%"></div></div><div class="progress-caption"><span>${percent}% current</span><span>80% required</span></div></div>`;
  }
  return `<div class="alert-card" style="border-color:#d7efe5;background:#f4fcf8"><div class="alert-heading" style="color:#248c66">${svg("check")}You’re on track</div><p>Your attendance is above the <strong>80% requirement</strong>. Keep showing up to stay there.</p><div class="progress-track" style="background:#dcefe7"><div class="progress-fill" style="width:${Math.min(percent,100)}%;background:var(--green)"></div></div><div class="progress-caption"><span>${percent}% current</span><span>80% required</span></div></div>`;
}

function renderStudentAttendance() {
  const student = studentById(currentUser.studentId);
  const percent = attendancePercent(student);
  return `<div class="welcome-row"><div><h1>My attendance</h1><p>Track each class and keep your semester on course.</p></div><div class="welcome-actions"><button class="secondary-btn" data-goto="requests">${svg("file")} Request OD</button></div></div>
    ${student.held === 0 ? `<div class="notice-banner">${svg("info")}Attendance has not been recorded yet. Check back after your first class.</div>` : percent < 80 ? `<div class="notice-banner">${svg("alert")}Your attendance is at <strong>${percent}%</strong>. The minimum requirement is 80%—check in with your faculty if you need support.</div>` : ""}
    <div class="stats-grid">${studentSummary(student)}</div>
    <div class="section-title">Recent classes</div><section class="panel"><div class="panel-header"><div><h2>Class-by-class record</h2><p>Most recent attendance entries</p></div><span class="status-pill">${escapeHTML(student.section)}</span></div><div class="panel-body"><div class="mini-list">${data.activity.map((item) => `<div class="list-row"><span class="stat-icon ${item.status === "present" ? "green" : "red"}">${svg(item.status === "present" ? "check" : "calendar")}</span><div class="list-meta"><strong>${escapeHTML(item.label)}</strong><span>${escapeHTML(item.date)}</span></div><span class="status-pill ${item.status}">${item.status === "present" ? "Present" : "Absent"}</span></div>`).join("")}</div></div></section>`;
}

function renderStudentTable(students, withActions = false) {
  if (!students.length) return '<div class="empty-state">No students to show.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Attendance</th><th>Classes</th><th>Status</th>${withActions ? "<th>Today</th>" : ""}</tr></thead><tbody>${students.map((student) => {
    const percent = attendancePercent(student);
    const status = data.sessions[selectedDate]?.[student.id];
    const isPresent = status === "present" || status === "od";
    const attendanceLabel = student.held === 0 ? "No records" : percent < 80 ? "Below 80%" : "On track";
    return `<tr><td><div class="table-student"><div class="avatar ${escapeHTML(student.color)}">${initials(student.name)}</div><div><strong>${escapeHTML(student.name)}</strong><div style="margin-top:3px;color:#a0a6b3;font-size:9px">${escapeHTML(student.id)}</div></div></div></td><td><strong class="${student.held > 0 && percent < 80 ? "below-threshold" : ""}">${percent}%</strong></td><td>${student.attended}/${student.held}</td><td><span class="status-pill ${student.held > 0 && percent < 80 ? "absent" : ""}">${attendanceLabel}</span></td>${withActions ? `<td><div class="attendance-actions"><button class="mark-btn ${isPresent ? "selected present" : ""}" type="button" data-student="${escapeHTML(student.id)}" data-status="present">Present${status === "od" ? " · OD" : ""}</button><button class="mark-btn ${status === "absent" ? "selected absent" : ""}" type="button" data-student="${escapeHTML(student.id)}" data-status="absent">Absent</button></div></td>` : ""}</tr>`;
  }).join("")}</tbody></table></div>`;
}

function renderStudents() {
  const sections = new Set(data.students.map((student) => student.section));
  const addStudentAction = currentUser.role === "admin"
    ? `<button class="primary-btn" id="new-student">${svg("plus")}Add student</button>`
    : "";
  const createStudentDialog = currentUser.role === "admin" ? `
    <dialog id="student-dialog" class="request-dialog"><form id="student-form" method="dialog">
      <div class="dialog-heading"><div><h2>Add a student</h2><p>Create a student record and login account.</p></div><button class="dialog-close" type="button" id="close-student" aria-label="Close">×</button></div>
      <div class="field"><label for="student-name">Full name</label><input id="student-name" name="name" maxlength="80" required></div>
      <div class="field"><label for="student-id">Student ID</label><input id="student-id" name="studentId" maxlength="32" placeholder="e.g. STU-2046" required></div>
      <div class="field"><label for="student-course">Course / program</label><input id="student-course" name="course" maxlength="120" value="Computer Science · Year 2" required></div>
      <div class="field"><label for="student-section">Section</label><input id="student-section" name="section" maxlength="24" value="CS-2A" required></div>
      <div class="field"><label for="student-password">Initial password</label><input id="student-password" name="password" type="password" minlength="10" maxlength="128" autocomplete="new-password" required><span class="field-hint">At least 10 characters; share it securely with the student.</span></div>
      <div class="form-error" id="student-error" aria-live="polite"></div>
      <div class="dialog-actions"><button class="quiet-btn" type="button" id="cancel-student">Cancel</button><button class="primary-btn" type="submit">Create student</button></div>
    </form></dialog>` : "";
  return `<div class="welcome-row"><div><h1>Students</h1><p>Monitor attendance and identify students who may need support.</p></div><div class="welcome-actions"><span class="status-pill pending">${data.students.filter((student) => student.held > 0 && attendancePercent(student) < 80).length} below 80%</span>${addStudentAction}</div></div>
    <section class="panel"><div class="panel-header"><div><h2>All students</h2><p>${data.students.length} students · ${sections.size} active sections</p></div><span class="status-pill">${averageAttendance()}% cohort average</span></div><div class="panel-body"><div class="students-grid">${data.students.map((student) => { const percent = attendancePercent(student); return `<article class="student-card"><div class="student-card-top"><div class="avatar ${escapeHTML(student.color)}">${initials(student.name)}</div><div><strong>${escapeHTML(student.name)}</strong><span>${escapeHTML(student.id)} · ${escapeHTML(student.section)}</span></div></div><div class="student-card-progress"><div class="progress-track" style="background:${percent < 80 ? "#f5e5dc" : "#e4f2eb"}"><div class="progress-fill" style="width:${Math.min(percent, 100)}%;background:${percent < 80 ? "var(--orange)" : "var(--green)"}"></div></div></div><div class="student-card-bottom"><span>${student.attended} of ${student.held} classes</span><strong class="${percent < 80 ? "below-threshold" : ""}">${percent}%</strong></div></article>`; }).join("")}</div></div></section>${createStudentDialog}`;
}

function renderMarkAttendance() {
  const session = data.sessions[selectedDate] || {};
  const sectionStudents = data.students.filter((student) => student.section === selectedSection);
  const present = sectionStudents.filter((student) => session[student.id] === "present" || session[student.id] === "od").length;
  return `<div class="welcome-row"><div><h1>Mark attendance</h1><p>Record attendance for your selected section.</p></div><div class="welcome-actions"><button class="primary-btn" id="save-attendance">${svg("check")}Save attendance</button></div></div>
    <section class="panel"><div class="panel-header"><div><h2>${escapeHTML(selectedSection)} · Attendance</h2><p>Mark each student present or absent for this class.</p></div><div class="attendance-controls"><select id="attendance-section" aria-label="Attendance section">${[...new Set(data.students.map((student) => student.section))].sort().map((section) => `<option value="${escapeHTML(section)}" ${section === selectedSection ? "selected" : ""}>${escapeHTML(section)}</option>`).join("")}</select><input type="date" id="attendance-date" value="${selectedDate}" aria-label="Attendance date"><button class="quiet-btn" id="mark-all-present">Mark all present</button></div></div><div class="panel-body"><div class="attendance-summary"><div><strong>${present} / ${sectionStudents.length} present</strong><span>Saved securely to the attendance database.</span></div><span style="color:#7369c5;font-size:11px;font-weight:700">${sectionStudents.length ? Math.round(present / sectionStudents.length * 100) : 0}%</span></div><div id="attendance-table">${renderStudentTable(sectionStudents, true)}</div></div></section>`;
}

function renderRequests() {
  if (currentUser.role === "student") {
    const ownRequests = data.requests.filter((request) => request.studentId === currentUser.studentId);
    return `<div class="welcome-row"><div><h1>OD requests</h1><p>Request on-duty attendance for official college activities.</p></div><div class="welcome-actions"><button class="primary-btn" id="new-request">${svg("file")}New request</button></div></div>
      <div class="notice-banner">${svg("info")}Submit OD requests for official events, competitions, or other approved college activities. Your faculty will review each request.</div>
      <section class="panel"><div class="panel-header"><div><h2>Your requests</h2><p>Check the status of your on-duty applications.</p></div></div><div class="panel-body">${ownRequests.length ? ownRequests.map((request) => requestCard(request, false)).join("") : '<div class="empty-state">You haven’t submitted any OD requests yet.</div>'}</div></section>
      <dialog id="request-dialog" class="request-dialog"><form id="request-form" method="dialog"><div class="dialog-heading"><div><h2>New OD request</h2><p>Tell your faculty about the official activity.</p></div><button class="dialog-close" type="button" id="close-request" aria-label="Close">×</button></div><div class="field"><label for="od-date">Date of activity</label><input id="od-date" name="date" type="date" min="${todayISO()}" required></div><div class="field"><label for="od-reason">Reason for request</label><textarea id="od-reason" name="reason" placeholder="Describe the event or college activity…" maxlength="300" required></textarea></div><div class="form-error" id="request-error" aria-live="polite"></div><div class="dialog-actions"><button class="quiet-btn" type="button" id="cancel-request">Cancel</button><button class="primary-btn" type="submit">Submit request</button></div></form></dialog>`;
  }
  const requests = data.requests.slice().sort((a, b) => (a.status === "pending" ? -1 : 1) - (b.status === "pending" ? -1 : 1));
  const pending = requests.filter((request) => request.status === "pending");
  const history = requests.filter((request) => request.status !== "pending");
  return `<div class="welcome-row"><div><h1>OD approvals</h1><p>Review official-duty requests from your students.</p></div><div class="welcome-actions"><span class="status-pill pending">${pending.length} pending</span></div></div>
    <div class="section-title" style="margin-top:0">Needs your review</div><section class="panel"><div class="panel-header"><div><h2>Pending requests</h2><p>Approved requests count as present for that date.</p></div></div><div class="panel-body">${pending.length ? pending.map((request) => requestCard(request, true)).join("") : '<div class="empty-state">You’re all caught up—no pending OD requests.</div>'}</div></section>
    <div class="section-title">Request history</div><section class="panel"><div class="panel-header"><div><h2>Processed requests</h2><p>Previously approved or declined applications.</p></div></div><div class="panel-body">${history.length ? history.map((request) => requestCard(request, false)).join("") : '<div class="empty-state">Processed requests will appear here.</div>'}</div></section>`;
}

function requestCard(request, canReview) {
  const student = studentById(request.studentId);
  return `<article class="request-card"><div class="request-top"><div style="display:flex;align-items:center;gap:9px"><div class="avatar ${escapeHTML(student?.color || "")}">${initials(student?.name || "Student")}</div><div><strong>${escapeHTML(student?.name || "Student")}</strong><div style="margin-top:4px;color:#9ba1af;font-size:9px">${escapeHTML(student?.id || "")} · ${escapeHTML(student?.section || "")}</div></div></div><span class="status-pill ${request.status}">${request.status[0].toUpperCase() + request.status.slice(1)}</span></div><p class="request-reason">${escapeHTML(request.reason)}</p><div class="request-footer"><span>Activity date: ${formatDate(request.date)} · Submitted ${escapeHTML(request.created)}</span>${canReview ? `<div class="request-card-actions"><button class="quiet-btn" type="button" data-request="${escapeHTML(request.id)}" data-decision="rejected">Decline</button><button class="primary-btn" type="button" data-request="${escapeHTML(request.id)}" data-decision="approved">${svg("check")}Approve</button></div>` : ""}</div></article>`;
}

function formatDate(value) {
  if (!value) return "Date not set";
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function bindPageActions() {
  document.querySelectorAll("[data-goto]").forEach((button) => button.addEventListener("click", () => {
    currentPage = button.dataset.goto;
    renderApp();
  }));
  document.querySelectorAll("[data-student][data-status]").forEach((button) => button.addEventListener("click", () => {
    if (!data.sessions[selectedDate]) data.sessions[selectedDate] = {};
    data.sessions[selectedDate][button.dataset.student] = button.dataset.status;
    renderApp();
  }));
  document.getElementById("attendance-date")?.addEventListener("change", async (event) => {
    selectedDate = event.target.value || todayISO();
    try {
      await loadDashboard();
      renderApp();
    } catch (error) {
      showToast(error.message);
    }
  });
  document.getElementById("attendance-section")?.addEventListener("change", (event) => {
    selectedSection = event.target.value;
    renderApp();
  });
  document.getElementById("mark-all-present")?.addEventListener("click", () => {
    if (!data.sessions[selectedDate]) data.sessions[selectedDate] = {};
    data.students.filter((student) => student.section === selectedSection)
      .forEach((student) => { data.sessions[selectedDate][student.id] = "present"; });
    renderApp();
  });
  document.getElementById("save-attendance")?.addEventListener("click", saveAttendance);
  document.querySelectorAll("[data-request][data-decision]").forEach((button) => button.addEventListener("click", () => decideRequest(button.dataset.request, button.dataset.decision)));
  document.getElementById("new-request")?.addEventListener("click", () => document.getElementById("request-dialog").showModal());
  document.getElementById("close-request")?.addEventListener("click", () => document.getElementById("request-dialog").close());
  document.getElementById("cancel-request")?.addEventListener("click", () => document.getElementById("request-dialog").close());
  document.getElementById("request-form")?.addEventListener("submit", submitRequest);
  document.getElementById("new-student")?.addEventListener("click", () => document.getElementById("student-dialog").showModal());
  document.getElementById("close-student")?.addEventListener("click", () => document.getElementById("student-dialog").close());
  document.getElementById("cancel-student")?.addEventListener("click", () => document.getElementById("student-dialog").close());
  document.getElementById("student-form")?.addEventListener("submit", submitStudent);
}

async function saveAttendance() {
  const session = data.sessions[selectedDate] || {};
  const sectionStudents = data.students.filter((student) => student.section === selectedSection);
  const unmarked = sectionStudents.filter((student) => !session[student.id]);
  if (unmarked.length) {
    showToast(`Mark attendance for all ${unmarked.length} remaining student${unmarked.length === 1 ? "" : "s"} first.`);
    return;
  }
  try {
    await apiRequest("/api/attendance", {
      method: "POST",
      body: JSON.stringify({
        date: selectedDate,
        section: selectedSection,
        records: sectionStudents.map((student) => ({
          studentId: student.id,
          status: session[student.id] === "od" ? "present" : session[student.id]
        }))
      })
    });
    await loadDashboard();
    showToast(`Attendance saved for ${formatDate(selectedDate)}.`);
    renderApp();
  } catch (error) {
    showToast(error.message);
  }
}

async function decideRequest(id, decision) {
  try {
    await apiRequest(`/api/od-requests/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision })
    });
    await loadDashboard();
    showToast(decision === "approved" ? "OD approved — attendance marked present." : "OD request declined.");
    renderApp();
  } catch (error) {
    showToast(error.message);
  }
}

async function submitRequest(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const date = String(form.get("date") || "");
  const reason = String(form.get("reason") || "").trim();
  if (!date || !reason) return;
  const errorElement = document.getElementById("request-error");
  errorElement.textContent = "";
  try {
    await apiRequest("/api/od-requests", {
      method: "POST",
      body: JSON.stringify({ date, reason })
    });
    await loadDashboard();
    currentPage = "requests";
    renderApp();
    showToast("Your OD request has been sent to faculty.");
  } catch (error) {
    errorElement.textContent = error.message;
  }
}

async function submitStudent(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = Object.fromEntries(["name", "studentId", "course", "section", "password"].map((key) => [key, String(form.get(key) || "").trim()]));
  const errorElement = document.getElementById("student-error");
  errorElement.textContent = "";
  try {
    await apiRequest("/api/students", { method: "POST", body: JSON.stringify(body) });
    await loadDashboard();
    currentPage = "students";
    renderApp();
    showToast("Student record and login created.");
  } catch (error) {
    errorElement.textContent = error.message;
  }
}

async function initApp() {
  try {
    await apiRequest("/api/auth/me");
    await loadDashboard();
    renderApp();
  } catch (error) {
    renderLogin();
    if (error.message !== "Please sign in to continue.") {
      document.getElementById("login-error").textContent = error.message;
    }
  }
}

initApp();
