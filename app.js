const DAYS = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
  { key: "sun", label: "일" }
];
const HOURS = Array.from({ length: 17 }, (_, i) => `${String(i + 6).padStart(2, "0")}:00`);
const LESSONS_PER_TUITION = 4;
const GOAL_TYPES = { year: "연간", month: "월간", week: "주간" };
const CATEGORY_LABELS = { school: "학교", practice: "연습", lesson: "레슨", homework: "과제", rest: "휴식" };
const ROLE_LABELS = { teacher: "선생님", student: "학생", guardian: "보호자" };
const NAV = [
  { view: "dashboard", label: "대시보드", icon: "홈" },
  { view: "goals", label: "목표", icon: "목" },
  { view: "schedule", label: "시간표", icon: "시" },
  { view: "practice", label: "연습 결과", icon: "연" },
  { view: "lessons", label: "레슨 일지", icon: "레" },
  { view: "weekly", label: "주간 회고", icon: "주" },
  { view: "students", label: "학생 관리", icon: "학", teacherOnly: true },
  { view: "guardians", label: "보호자", icon: "보", teacherOnly: true }
];

// ── Supabase ──
const SUPABASE_URL = "https://twnnjvuyokjkyqbqkhqi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3bm5qdnV5b2tqa3lxYnFraHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MjMwNDIsImV4cCI6MjEwMDk5OTA0Mn0.YvKGDLXjKDnjLw1IuWIvqp7dyi_ikBcwlOh36fhccmE";
const FUNCTIONS_URL = "https://twnnjvuyokjkyqbqkhqi.supabase.co/functions/v1/manage-users";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Day key ↔ int ──
const DAY_TO_INT = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
const INT_TO_DAY = { 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat", 7: "sun" };
function dayKeyToInt(k) { return DAY_TO_INT[k] || 1; }
function intToDayKey(n) { return INT_TO_DAY[n] || "mon"; }

// ── State ──
let state = emptyState();
let session = { userId: "" };
let ui = { view: "dashboard", selectedStudentId: "", editingSlot: null };

const app = document.querySelector("#app");

document.addEventListener("submit", handleSubmit);
document.addEventListener("click", handleClick);
document.addEventListener("change", handleChange);
document.addEventListener("input", handleInput);
document.addEventListener("keydown", handleKeydown);

initApp();

async function initApp() {
  const { data: { session: s } } = await sb.auth.getSession();
  if (s?.user) await loadStateFromSupabase(s.user);
  render();
}

function emptyState() {
  return { users: [], goals: [], schedules: [], practiceLogs: [], lessons: [], assignments: [], tuitionPayments: [], weeklyReviews: [] };
}

// ── DB loading ──
async function loadStateFromSupabase(authUser) {
  const { data: profile } = await sb.from("profiles").select("*").eq("id", authUser.id).single();
  if (!profile) return;
  if (profile.role === "teacher") await loadTeacherState(profile);
  else if (profile.role === "student") await loadStudentState(profile);
  else if (profile.role === "guardian") await loadGuardianState(profile);
}

async function loadTeacherState(profile) {
  const [studentsRes, linksRes] = await Promise.all([
    sb.from("students").select("*, profiles(id, username)").eq("teacher_id", profile.id),
    sb.from("guardian_students").select("*, profiles!guardian_id(id, full_name, username, role)").eq("teacher_id", profile.id)
  ]);
  const students = studentsRes.data || [];
  const links = linksRes.data || [];
  const studentIds = students.map(s => s.id);

  let goals = [], scheds = [], logs = [], lessons = [], assignments = [], payments = [], reviews = [];
  if (studentIds.length) {
    const r = await Promise.all([
      sb.from("goals").select("*").in("student_id", studentIds),
      sb.from("schedules").select("*").in("student_id", studentIds),
      sb.from("practice_logs").select("*").in("student_id", studentIds),
      sb.from("lessons").select("*").in("student_id", studentIds),
      sb.from("assignments").select("*").in("student_id", studentIds),
      sb.from("tuition_payments").select("*").in("student_id", studentIds),
      sb.from("weekly_reviews").select("*").in("student_id", studentIds)
    ]);
    goals = r[0].data || []; scheds = r[1].data || []; logs = r[2].data || [];
    lessons = r[3].data || []; assignments = r[4].data || []; payments = r[5].data || []; reviews = r[6].data || [];
  }

  const guardianMap = new Map();
  const guardianStudentMap = new Map();
  links.forEach(lk => {
    if (!guardianMap.has(lk.guardian_id)) guardianMap.set(lk.guardian_id, lk.profiles);
    if (!guardianStudentMap.has(lk.guardian_id)) guardianStudentMap.set(lk.guardian_id, []);
    guardianStudentMap.get(lk.guardian_id).push(lk.student_id);
  });
  const guardianRelMap = new Map();
  links.forEach(lk => { if (lk.relationship && !guardianRelMap.has(lk.guardian_id)) guardianRelMap.set(lk.guardian_id, lk.relationship); });

  const teacherUser = { id: profile.id, role: "teacher", name: profile.full_name, username: profile.username };
  const studentUsers = students.map(s => ({
    id: s.id, _authId: s.profile_id, role: "student",
    name: s.full_name, username: s.profiles?.username || "",
    instrument: s.instrument || "", grade: s.grade_level || "", selfPayer: Boolean(s.self_payer)
  }));
  const guardianUsers = Array.from(guardianMap.entries()).map(([gId, gProfile]) => ({
    id: gId, role: "guardian",
    name: gProfile?.full_name || "", username: gProfile?.username || "",
    relation: guardianRelMap.get(gId) || "보호자",
    studentIds: guardianStudentMap.get(gId) || []
  }));

  state = {
    users: [teacherUser, ...studentUsers, ...guardianUsers],
    goals: mapGoals(goals), schedules: mapSchedules(scheds), practiceLogs: mapPracticeLogs(logs),
    lessons: mapLessons(lessons), assignments: mapAssignments(assignments),
    tuitionPayments: mapTuitionPayments(payments), weeklyReviews: mapWeeklyReviews(reviews)
  };
  session = { userId: profile.id };
  if (!studentUsers.find(s => s.id === ui.selectedStudentId) && studentUsers.length) {
    ui.selectedStudentId = studentUsers[0].id;
  }
}

async function loadStudentState(profile) {
  const { data: rec } = await sb.from("students").select("*").eq("profile_id", profile.id).single();
  if (!rec) return;
  const sid = rec.id;
  const r = await Promise.all([
    sb.from("goals").select("*").eq("student_id", sid),
    sb.from("schedules").select("*").eq("student_id", sid),
    sb.from("practice_logs").select("*").eq("student_id", sid),
    sb.from("lessons").select("*").eq("student_id", sid),
    sb.from("assignments").select("*").eq("student_id", sid),
    sb.from("tuition_payments").select("*").eq("student_id", sid),
    sb.from("weekly_reviews").select("*").eq("student_id", sid)
  ]);
  state = {
    users: [{ id: sid, _authId: profile.id, role: "student", name: rec.full_name, username: profile.username,
      instrument: rec.instrument || "", grade: rec.grade_level || "", selfPayer: Boolean(rec.self_payer) }],
    goals: mapGoals(r[0].data || []), schedules: mapSchedules(r[1].data || []),
    practiceLogs: mapPracticeLogs(r[2].data || []), lessons: mapLessons(r[3].data || []),
    assignments: mapAssignments(r[4].data || []), tuitionPayments: mapTuitionPayments(r[5].data || []),
    weeklyReviews: mapWeeklyReviews(r[6].data || [])
  };
  session = { userId: sid };
  ui.selectedStudentId = sid;
}

async function loadGuardianState(profile) {
  const { data: links } = await sb.from("guardian_students").select("*, students(*)").eq("guardian_id", profile.id);
  const studentIds = (links || []).map(lk => lk.student_id);
  const matchedStudents = (links || []).map(lk => lk.students).filter(Boolean);

  let goals = [], scheds = [], logs = [], lessons = [], assignments = [], reviews = [];
  if (studentIds.length) {
    const r = await Promise.all([
      sb.from("goals").select("*").in("student_id", studentIds),
      sb.from("schedules").select("*").in("student_id", studentIds),
      sb.from("practice_logs").select("*").in("student_id", studentIds),
      sb.from("lessons").select("*").in("student_id", studentIds),
      sb.from("assignments").select("*").in("student_id", studentIds),
      sb.from("weekly_reviews").select("*").in("student_id", studentIds)
    ]);
    goals = r[0].data || []; scheds = r[1].data || []; logs = r[2].data || [];
    lessons = r[3].data || []; assignments = r[4].data || []; reviews = r[5].data || [];
  }
  state = {
    users: [
      { id: profile.id, role: "guardian", name: profile.full_name, username: profile.username,
        relation: links?.[0]?.relationship || "보호자", studentIds },
      ...matchedStudents.map(s => ({
        id: s.id, role: "student", name: s.full_name, username: "",
        instrument: s.instrument || "", grade: s.grade_level || "", selfPayer: Boolean(s.self_payer)
      }))
    ],
    goals: mapGoals(goals), schedules: mapSchedules(scheds), practiceLogs: mapPracticeLogs(logs),
    lessons: mapLessons(lessons), assignments: mapAssignments(assignments),
    tuitionPayments: [], weeklyReviews: mapWeeklyReviews(reviews)
  };
  session = { userId: profile.id };
  if (studentIds.length) ui.selectedStudentId = studentIds[0];
}

// ── Mapping ──
function mapGoals(rows) {
  return rows.map(r => ({ id: r.id, studentId: r.student_id, type: r.type, title: r.title,
    detail: r.detail || "", dueDate: r.due_date || "", progress: r.progress || 0, done: Boolean(r.done) }));
}
function mapSchedules(rows) {
  return rows.map(r => ({ id: r.id, studentId: r.student_id, day: intToDayKey(r.day_of_week),
    hour: String(r.starts_at).slice(0, 5), title: r.title, category: r.category, done: Boolean(r.done) }));
}
function mapPracticeLogs(rows) {
  return rows.map(r => ({ id: r.id, studentId: r.student_id, date: r.practiced_on,
    minutes: r.minutes || 0, goalId: r.goal_id || "", achieved: Boolean(r.achieved),
    photo: r.photo_path || "", materialLink: r.material_link || "", notes: r.notes || "" }));
}
function mapLessons(rows) {
  return rows.map(r => ({ id: r.id, studentId: r.student_id, date: r.lesson_on,
    content: r.content || "", assignment: r.assignment || "", assignmentDue: r.assignment_due || "",
    feedback: r.feedback || "", studentMemo: r.student_memo || "" }));
}
function mapAssignments(rows) {
  return rows.map(r => ({ id: r.id, studentId: r.student_id, lessonId: r.lesson_id || "",
    title: r.title, dueDate: r.due_date || "", feedback: r.feedback || "",
    completed: Boolean(r.completed), completedAt: r.completed_at || "" }));
}
function mapTuitionPayments(rows) {
  return rows.map(r => ({ id: r.id, studentId: r.student_id, cycleNo: r.cycle_no,
    lessonFrom: r.lesson_from, lessonTo: r.lesson_to, paid: Boolean(r.paid), paidAt: r.paid_at || "" }));
}
function mapWeeklyReviews(rows) {
  return rows.map(r => ({ id: r.id, studentId: r.student_id, weekStart: r.week_start,
    scheduleResult: r.schedule_result || "", reflection: r.reflection || "",
    selfFeedback: r.self_feedback || "", teacherFeedback: r.teacher_feedback || "" }));
}

// ── Edge Function helper ──
async function callEdge(payload, withJwt = true) {
  const headers = { "Content-Type": "application/json" };
  if (withJwt) {
    const { data: { session: s } } = await sb.auth.getSession();
    if (s?.access_token) headers["Authorization"] = `Bearer ${s.access_token}`;
  }
  const res = await fetch(FUNCTIONS_URL, { method: "POST", headers, body: JSON.stringify(payload) });
  return res.json();
}

// ── Render ──
function render() {
  const currentUser = getCurrentUser();
  if (!currentUser) { renderLogin(); return; }
  if (currentUser.role === "student") {
    ui.selectedStudentId = currentUser.id;
  } else if (!getSelectedStudent()) {
    ui.selectedStudentId = getAccessibleStudents(currentUser)[0]?.id || "";
  }
  renderShell(currentUser);
}

function renderLogin() {
  app.innerHTML = `
    <main class="login-shell">
      <section class="login-panel" aria-label="로그인">
        <div class="login-copy">
          <h1>클래스 노트</h1>
          <p>레슨 &amp; 연습 기록 관리</p>
        </div>
        <form class="login-form" data-form="login">
          <div class="field">
            <label for="username">계정</label>
            <input id="username" name="username" autocomplete="username" required />
          </div>
          <div class="field">
            <label for="password">비밀번호</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required />
          </div>
          <button class="button primary" type="submit">로그인</button>
        </form>
        <details style="margin-top: 24px;">
          <summary style="cursor:pointer; color: var(--text-muted, #888);">선생님 최초 가입</summary>
          <form class="login-form" data-form="register-teacher" style="margin-top: 16px;">
            <div class="field">
              <label for="regName">이름</label>
              <input id="regName" name="name" required placeholder="예: 김도훈 선생님" />
            </div>
            <div class="field">
              <label for="regUsername">계정</label>
              <input id="regUsername" name="username" required autocomplete="off" />
            </div>
            <div class="field">
              <label for="regPassword">비밀번호</label>
              <input id="regPassword" name="password" type="password" required autocomplete="new-password" />
            </div>
            <button class="button primary" type="submit">가입</button>
          </form>
        </details>
      </section>
    </main>
  `;
}

function renderShell(currentUser) {
  const student = getSelectedStudent();
  if (currentUser.role !== "teacher" && ["students", "guardians"].includes(ui.view)) ui.view = "dashboard";
  if (currentUser.role === "guardian") ui.editingSlot = null;

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand"><span class="brand-mark">CN</span><span>클래스 노트</span></div>
        <div class="topbar-actions">
          <div class="session-chip" title="${escapeHtml(currentUser.name)}">
            <span class="session-dot"></span>
            <span>${escapeHtml(currentUser.name)} · ${getRoleLabel(currentUser.role)}</span>
          </div>
          <button class="icon-button" type="button" data-action="logout" aria-label="로그아웃" title="로그아웃">↩</button>
        </div>
      </header>
      <div class="layout">
        <aside class="sidebar">
          <div class="sidebar-inner">
            ${renderStudentSelectorArea(currentUser, student)}
            <nav class="nav" aria-label="주요 메뉴">
              ${NAV.filter(item => !item.teacherOnly || currentUser.role === "teacher")
                .map(item => `<button class="nav-button ${ui.view === item.view ? "active" : ""}" type="button" data-view="${item.view}"><span class="nav-icon">${item.icon}</span><span>${item.label}</span></button>`)
                .join("")}
            </nav>
          </div>
        </aside>
        <main class="main">${renderCurrentView(currentUser, student)}</main>
      </div>
    </div>
    <div id="toast" class="toast hidden" role="status"></div>
  `;
}

function renderStudentSelectorArea(currentUser, student) {
  const accessibleStudents = getAccessibleStudents(currentUser);
  if (currentUser.role === "teacher") return renderStudentPicker(student, "관리 학생", accessibleStudents);
  if (currentUser.role === "guardian" && accessibleStudents.length > 1) return renderStudentPicker(student, "열람 학생", accessibleStudents);
  return renderStudentBadge(student);
}

function renderStudentPicker(student, label = "관리 학생", students = getStudents()) {
  return `
    <div class="student-picker">
      <label for="studentSelect">${label}</label>
      <select id="studentSelect" data-action="select-student">
        ${students.map(item => `<option value="${item.id}" ${student?.id === item.id ? "selected" : ""}>${escapeHtml(item.name)} · ${escapeHtml(item.instrument || "전공 미정")}</option>`).join("")}
      </select>
    </div>
  `;
}

function renderStudentBadge(student) {
  if (!student) return "";
  return `<div class="notice"><strong>${escapeHtml(student.name)}</strong><br />${escapeHtml(student.grade || "학년 미정")} · ${escapeHtml(student.instrument || "전공 미정")}</div>`;
}

function renderCurrentView(currentUser, student) {
  if (!student && !["students", "guardians"].includes(ui.view)) {
    return `<section class="page-head"><div><h1>학생이 없습니다</h1><p>${currentUser.role === "guardian" ? "매칭된 학생이 없습니다." : "학생 관리에서 계정을 먼저 추가하세요."}</p></div></section>`;
  }
  switch (ui.view) {
    case "goals": return renderGoals(currentUser, student);
    case "schedule": return renderSchedule(currentUser, student);
    case "practice": return renderPractice(currentUser, student);
    case "lessons": return renderLessons(currentUser, student);
    case "weekly": return renderWeekly(currentUser, student);
    case "students": return renderStudents(currentUser);
    case "guardians": return renderGuardians(currentUser);
    case "dashboard": default: return renderDashboard(currentUser, student);
  }
}

function renderDashboard(currentUser, student) {
  const today = toDateInputValue(new Date());
  const todayKey = getDayKey(today);
  const weekStart = getWeekStart(today);
  const goals = getStudentGoals(student.id);
  const logs = getStudentPracticeLogs(student.id);
  const weekLogs = logs.filter(log => isDateInWeek(log.date, weekStart));
  const assignments = getStudentAssignments(student.id);
  const activeAssignments = assignments.filter(a => !a.completed);
  const todaySlots = state.schedules.filter(s => s.studentId === student.id && s.day === todayKey).sort((a, b) => a.hour.localeCompare(b.hour));
  const completedGoals = goals.filter(g => g.done).length;
  const goalRate = goals.length ? Math.round((completedGoals / goals.length) * 100) : 0;
  const weekMinutes = weekLogs.reduce((sum, log) => sum + Number(log.minutes || 0), 0);
  const achievedCount = weekLogs.filter(log => log.achieved).length;
  const scheduleSlots = state.schedules.filter(s => s.studentId === student.id);
  const scheduleDone = scheduleSlots.filter(s => s.done).length;

  return `
    <section class="page-head">
      <div>
        <h1>대시보드</h1>
        <p>${escapeHtml(student.name)} · ${escapeHtml(student.grade || "학년 미정")} · ${escapeHtml(student.instrument || "전공 미정")}</p>
      </div>
      ${renderDashboardToolbar(currentUser)}
    </section>
    ${currentUser.role === "teacher" ? renderTeacherDashboardOverview() : ""}
    ${renderTuitionNotice(currentUser, student)}
    ${renderDashboardAgenda(todaySlots, activeAssignments, currentUser, today)}
    <section class="grid four" style="margin-top: 16px;">
      ${renderMetric("이번 주 연습", `${weekMinutes}분`, `${weekLogs.length}개 기록`)}
      ${renderMetric("목표 달성", `${goalRate}%`, `${completedGoals}/${goals.length || 0}개 완료`)}
      ${renderMetric("연습 체크", `${achievedCount}회`, "목표한 연습 완료")}
      ${renderMetric("시간표 완료", `${scheduleDone}/${scheduleSlots.length || 0}`, "주간 계획 기준")}
    </section>
    <section class="grid two" style="margin-top: 16px;">
      <div class="surface">
        <div class="surface-header"><h2>주간 연습일지</h2><span class="pill green">${formatKoreanDate(weekStart)} 시작</span></div>
        <div class="surface-body">${weekLogs.length ? renderPracticeList(weekLogs.slice(0, 4), true, currentUser) : renderEmpty("이번 주 연습 기록이 없습니다.")}</div>
      </div>
      <div class="surface">
        <div class="surface-header"><h2>최근 레슨</h2><button class="icon-button" type="button" data-view="lessons" aria-label="레슨 일지로 이동">→</button></div>
        <div class="surface-body">${renderRecentLessons(student.id)}</div>
      </div>
    </section>
  `;
}

function renderDashboardToolbar(currentUser) {
  if (currentUser.role === "teacher") return `<div class="toolbar"><button class="button primary" type="button" data-view="lessons">레슨 작성</button><button class="button" type="button" data-view="practice">연습 보기</button><button class="button" type="button" data-view="students">학생 관리</button></div>`;
  return `<div class="toolbar"><button class="button" type="button" data-view="goals">목표 보기</button><button class="button primary" type="button" data-view="practice">연습 기록</button></div>`;
}

function renderDashboardAgenda(todaySlots, activeAssignments, currentUser, today) {
  return `
    <section class="surface dashboard-agenda">
      <div class="surface-header">
        <h2>오늘 체크</h2>
        <div class="item-meta">
          <span class="pill ${activeAssignments.length ? "amber" : "green"}">과제 ${activeAssignments.length}개</span>
          <span class="pill blue">일정 ${todaySlots.length}개</span>
          <span class="pill">${formatKoreanDate(today)}</span>
        </div>
      </div>
      <div class="surface-body">
        <div class="agenda-grid">
          <div class="agenda-column">
            <div class="section-title-row"><h3>진행 과제</h3><button class="button" type="button" data-view="lessons">레슨 일지</button></div>
            ${activeAssignments.length ? renderAssignmentList(activeAssignments, currentUser) : renderEmpty("진행 중인 과제가 없습니다.")}
          </div>
          <div class="agenda-column">
            <div class="section-title-row"><h3>오늘 일정</h3><button class="button" type="button" data-view="schedule">시간표</button></div>
            ${todaySlots.length ? renderSlotList(todaySlots) : renderEmpty("오늘 등록된 일정이 없습니다.")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderTeacherDashboardOverview() {
  const today = toDateInputValue(new Date());
  const weekStart = getWeekStart(today);
  const summaries = getStudents()
    .map(student => getStudentManagementSummary(student, today, weekStart))
    .sort((a, b) => b.priority - a.priority || a.student.name.localeCompare(b.student.name, "ko"));
  const attentionCount = summaries.filter(s => s.needsAttention).length;
  return `
    <section class="surface management-overview">
      <div class="surface-header">
        <h2>관리 요약</h2>
        <div class="item-meta">
          <span class="pill ${attentionCount ? "amber" : "green"}">확인 필요 ${attentionCount}명</span>
          <span class="pill">전체 ${summaries.length}명</span>
        </div>
      </div>
      <div class="surface-body">${summaries.length ? `<div class="management-list">${summaries.map(renderManagementRow).join("")}</div>` : renderEmpty("등록된 학생이 없습니다.")}</div>
    </section>
  `;
}

function renderManagementRow(summary) {
  const { student, latestLesson, latestLessonNo, tuitionSummary, assignmentCount, activeAssignments, overdueAssignments, dueTodayAssignments, nextAssignment, weekMinutes, weekLogs, reviewDone } = summary;
  const assignmentTone = overdueAssignments.length ? "coral" : dueTodayAssignments.length ? "amber" : activeAssignments.length ? "blue" : "green";
  const assignmentText = overdueAssignments.length ? `마감 지남 ${overdueAssignments.length}개` : dueTodayAssignments.length ? `오늘 마감 ${dueTodayAssignments.length}개` : activeAssignments.length ? `진행 과제 ${activeAssignments.length}개` : assignmentCount ? "과제 완료" : "과제 없음";
  const tuitionTone = tuitionSummary.unpaidCycles.length ? "coral" : "green";
  const tuitionText = tuitionSummary.unpaidCycles.length ? `수업료 필요 ${tuitionSummary.unpaidCycles.length}건` : `수업료 ${tuitionSummary.nextDueIn}회 남음`;
  const note = tuitionSummary.unpaidCycles.length ? `${formatTuitionCycleLabel(tuitionSummary.unpaidCycles[0])} 수업료 납부 확인 필요` : nextAssignment ? getPreviewText(nextAssignment.title, 54) : "진행 중인 과제가 없습니다.";
  return `
    <div class="management-row ${student.id === ui.selectedStudentId ? "selected" : ""}">
      <div class="management-student"><strong>${escapeHtml(student.name)}</strong><span>${escapeHtml(student.grade || "학년 미정")} · ${escapeHtml(student.instrument || "전공 미정")}</span></div>
      <div class="management-status">
        <span class="pill ${tuitionTone}">${tuitionText}</span>
        <span class="pill ${assignmentTone}">${assignmentText}</span>
        <span class="pill">${weekMinutes}분 · ${weekLogs.length}개 기록</span>
        <span class="pill ${reviewDone ? "green" : "amber"}">회고 ${reviewDone ? "작성" : "미작성"}</span>
        <span class="pill">${latestLesson ? `${latestLessonNo}회차 · ${formatKoreanDate(latestLesson.date)}` : "레슨 없음"}</span>
      </div>
      <p class="management-note">${escapeHtml(note)}</p>
      <div class="management-actions">
        <button class="button" type="button" data-action="open-student-view" data-id="${student.id}" data-target-view="dashboard">대시보드</button>
        <button class="button" type="button" data-action="open-student-view" data-id="${student.id}" data-target-view="lessons">레슨</button>
      </div>
    </div>
  `;
}

function renderTuitionNotice(currentUser, student) {
  if (!canViewTuitionNotice(currentUser, student)) return "";
  const summary = getTuitionSummary(student.id);
  const unpaidCycles = summary.unpaidCycles;
  const recentPaidCycle = summary.cycles.filter(c => c.paid).at(-1);
  return `
    <section class="surface tuition-notice ${unpaidCycles.length ? "attention" : ""}">
      <div class="surface-header">
        <h2>수업료 알림</h2>
        <div class="item-meta">
          <span class="pill blue">현재 ${summary.lessonCount}회차</span>
          <span class="pill ${unpaidCycles.length ? "coral" : "green"}">${unpaidCycles.length ? `납부 필요 ${unpaidCycles.length}건` : `다음 알림 ${summary.nextDueIn}회 남음`}</span>
        </div>
      </div>
      <div class="surface-body">
        ${unpaidCycles.length
          ? `<div class="tuition-list">${unpaidCycles.map(cycle => renderTuitionCycleAlert(cycle, currentUser)).join("")}</div>`
          : `<div class="tuition-clear"><strong>현재 납부 알림이 없습니다.</strong><span>${recentPaidCycle ? `${formatTuitionCycleLabel(recentPaidCycle)} 납부 확인 완료` : `${summary.nextCycleStart}-${summary.nextCycleEnd}회차가 채워지면 알림이 표시됩니다.`}</span>${currentUser.role === "teacher" && recentPaidCycle ? `<button class="button" type="button" data-action="mark-tuition-unpaid" data-student-id="${student.id}" data-cycle-no="${recentPaidCycle.cycleNo}">납부 확인 취소</button>` : ""}</div>`
        }
      </div>
    </section>
  `;
}

function renderTuitionCycleAlert(cycle, currentUser) {
  const message = currentUser.role === "teacher" ? "보호자에게 납부 안내가 필요한 회차입니다." : "4회차 단위 수업이 완료되어 수업료 납부 안내가 필요한 상태입니다.";
  return `
    <article class="tuition-cycle">
      <div class="tuition-cycle-main">
        <h3>${formatTuitionCycleLabel(cycle)} 수업료</h3>
        <div class="item-meta"><span class="pill coral">납부 필요</span><span class="pill">${cycle.completedOn ? `${formatKoreanDate(cycle.completedOn)} ${cycle.toSession}회차 완료` : `${cycle.toSession}회차 완료`}</span></div>
      </div>
      <p class="item-text">${message}</p>
      ${currentUser.role === "teacher" ? `<button class="button primary" type="button" data-action="mark-tuition-paid" data-student-id="${cycle.studentId}" data-cycle-no="${cycle.cycleNo}">납부 확인</button>` : ""}
    </article>
  `;
}

function renderGoals(currentUser, student) {
  const goals = getStudentGoals(student.id);
  const readOnly = isReadOnlyUser(currentUser);
  return `
    <section class="page-head"><div><h1>목표</h1><p>연간, 월간, 주간 목표를 나누어 관리합니다.</p></div></section>
    ${readOnly ? "" : renderGoalForm()}
    <section class="grid three" style="margin-top: 16px;">
      ${Object.entries(GOAL_TYPES).map(([type, label]) => renderGoalColumn(label, type, goals.filter(g => g.type === type), readOnly)).join("")}
    </section>
  `;
}

function renderGoalForm() {
  return `
    <section class="surface">
      <div class="surface-header"><h2>목표 추가</h2></div>
      <div class="surface-body">
        <form class="form-grid" data-form="add-goal">
          <div class="field"><label for="goalType">구분</label><select id="goalType" name="type" required><option value="year">연간 목표</option><option value="month">월간 목표</option><option value="week">주간 목표</option></select></div>
          <div class="field"><label for="goalTitle">목표</label><input id="goalTitle" name="title" required placeholder="예: 자작곡 한 코러스 완성" /></div>
          <div class="field"><label for="goalDue">완료 예정일</label><input id="goalDue" name="dueDate" type="date" /></div>
          <div class="field"><label for="goalProgress">진행률</label><input id="goalProgress" name="progress" type="number" min="0" max="100" value="0" /></div>
          <div class="field full"><label for="goalDetail">메모</label><textarea id="goalDetail" name="detail" placeholder="세부 연습 방향"></textarea></div>
          <div class="field full"><button class="button primary" type="submit">추가</button></div>
        </form>
      </div>
    </section>
  `;
}

function renderGoalColumn(label, type, goals, readOnly = false) {
  return `
    <div class="surface">
      <div class="surface-header"><h2>${label} 목표</h2><span class="pill">${goals.length}개</span></div>
      <div class="surface-body">${goals.length ? `<div class="list">${goals.map(g => renderGoalCard(g, readOnly)).join("")}</div>` : renderEmpty(`${label} 목표가 없습니다.`)}</div>
    </div>
  `;
}

function renderGoalCard(goal, readOnly = false) {
  return `
    <article class="item-card">
      <div class="item-top">
        <div>
          <h3 class="item-title">${escapeHtml(goal.title)}</h3>
          <div class="item-meta" style="margin-top: 8px;">
            <span class="pill ${goal.done ? "green" : "blue"}">${goal.done ? "완료" : "진행"}</span>
            ${goal.dueDate ? `<span class="pill">${formatKoreanDate(goal.dueDate)}</span>` : ""}
          </div>
        </div>
        ${readOnly ? "" : `<button class="icon-button" type="button" data-action="delete-goal" data-id="${goal.id}" aria-label="목표 삭제" title="목표 삭제">×</button>`}
      </div>
      ${goal.detail ? `<p class="item-text">${escapeHtml(goal.detail)}</p>` : ""}
      <div class="goal-track">
        <div class="progress-row">
          <input type="range" min="0" max="100" value="${Number(goal.progress || 0)}" data-action="update-goal-progress" data-id="${goal.id}" aria-label="진행률" ${readOnly ? "disabled" : ""} />
          <strong>${Number(goal.progress || 0)}%</strong>
        </div>
        <label class="checkline"><input type="checkbox" data-action="toggle-goal" data-id="${goal.id}" ${goal.done ? "checked" : ""} ${readOnly ? "disabled" : ""} /><span>달성 여부</span></label>
      </div>
    </article>
  `;
}

function renderSchedule(currentUser, student) {
  const readOnly = isReadOnlyUser(currentUser);
  const selectedSlot = readOnly ? null : ui.editingSlot;
  return `
    <section class="page-head">
      <div><h1>시간표</h1><p>학교 시간표처럼 하루하루 시간 단위 일정을 작성합니다.</p></div>
      ${readOnly ? "" : `<div class="toolbar"><button class="button" type="button" data-action="clear-schedule-done">완료 초기화</button></div>`}
    </section>
    <section class="table-wrap">
      <table class="timetable" aria-label="주간 시간표">
        <thead><tr><th class="time-col">시간</th>${DAYS.map(d => `<th>${d.label}</th>`).join("")}</tr></thead>
        <tbody>${HOURS.map(hour => `<tr><th class="time-col">${hour}</th>${DAYS.map(d => renderScheduleCell(student.id, d.key, hour, readOnly)).join("")}</tr>`).join("")}</tbody>
      </table>
    </section>
    ${selectedSlot ? renderScheduleModal(student, selectedSlot) : ""}
  `;
}

function renderScheduleModal(student, selectedSlot) {
  const slot = findScheduleSlot(student.id, selectedSlot.day, selectedSlot.hour);
  const dayLabel = DAYS.find(d => d.key === selectedSlot.day)?.label || "";
  return `
    <div class="modal-layer" role="presentation">
      <button class="modal-scrim" type="button" data-action="close-slot-editor" aria-label="일정 팝업 닫기"></button>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="slotEditorTitle">
        <div class="modal-header">
          <div><h2 id="slotEditorTitle">${slot ? "일정 수정" : "일정 추가"}</h2><p>${dayLabel}요일 ${selectedSlot.hour}</p></div>
          <button class="icon-button" type="button" data-action="close-slot-editor" aria-label="닫기" title="닫기">×</button>
        </div>
        <form class="form-grid one modal-body" data-form="save-slot">
          <input type="hidden" name="day" value="${selectedSlot.day}" />
          <input type="hidden" name="hour" value="${selectedSlot.hour}" />
          <div class="field"><label for="slotTitle">일정</label><input id="slotTitle" name="title" value="${escapeAttribute(slot?.title || "")}" placeholder="예: 레슨, 코드 연습, 곡 작업, 학교" required /></div>
          <div class="field"><label for="slotCategory">구분</label><select id="slotCategory" name="category">${Object.entries(CATEGORY_LABELS).map(([key, label]) => `<option value="${key}" ${slot?.category === key ? "selected" : ""}>${label}</option>`).join("")}</select></div>
          <label class="checkline"><input type="checkbox" name="done" ${slot?.done ? "checked" : ""} /><span>완료 체크</span></label>
          <div class="modal-actions">
            ${slot ? `<button class="button danger" type="button" data-action="delete-slot" data-id="${slot.id}">삭제</button>` : `<span></span>`}
            <div class="toolbar"><button class="button" type="button" data-action="close-slot-editor">취소</button><button class="button primary" type="submit">저장</button></div>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderScheduleCell(studentId, day, hour, readOnly = false) {
  const slot = findScheduleSlot(studentId, day, hour);
  const dayLabel = DAYS.find(d => d.key === day)?.label || "";
  const active = ui.editingSlot?.day === day && ui.editingSlot?.hour === hour;
  const ariaLabel = slot ? `${dayLabel}요일 ${hour} ${slot.title} 수정` : readOnly ? `${dayLabel}요일 ${hour} 일정 없음` : `${dayLabel}요일 ${hour} 일정 추가`;
  const classes = ["slot-button", active ? "active" : "", slot ? `slot-${slot.category}` : "", slot?.done ? "slot-done" : ""].filter(Boolean).join(" ");
  return `<td><button class="${classes}" type="button" data-action="edit-slot" data-day="${day}" data-hour="${hour}" aria-label="${escapeAttribute(ariaLabel)}" ${readOnly ? "disabled" : ""}>${slot ? `<span class="slot-title">${escapeHtml(slot.title)}</span><span class="slot-category">${CATEGORY_LABELS[slot.category] || "일정"}${slot.done ? " · 완료" : ""}</span>` : `<span class="slot-empty">${readOnly ? "" : "+"}</span>`}</button></td>`;
}

function renderPractice(currentUser, student) {
  const goals = getStudentGoals(student.id);
  const logs = getStudentPracticeLogs(student.id);
  const readOnly = isReadOnlyUser(currentUser);
  return `
    <section class="page-head"><div><h1>연습 결과</h1><p>연습 사진, 자료 링크, 달성 여부를 기록합니다.</p></div></section>
    ${readOnly ? "" : renderPracticeForm(goals)}
    <section class="surface" style="margin-top: 16px;">
      <div class="surface-header"><h2>연습일지</h2><span class="pill">${logs.length}개</span></div>
      <div class="surface-body">${logs.length ? renderPracticeList(logs, false, currentUser) : renderEmpty("연습 기록이 없습니다.")}</div>
    </section>
  `;
}

function renderPracticeForm(goals) {
  return `
    <section class="surface">
      <div class="surface-header"><h2>연습 기록 추가</h2></div>
      <div class="surface-body">
        <form class="form-grid" data-form="add-practice">
          <div class="field"><label for="practiceDate">날짜</label><input id="practiceDate" name="date" type="date" value="${toDateInputValue(new Date())}" required /></div>
          <div class="field"><label for="practiceMinutes">연습 시간</label><input id="practiceMinutes" name="minutes" type="number" min="0" step="5" placeholder="분" required /></div>
          <div class="field"><label for="practiceGoal">연결 목표</label><select id="practiceGoal" name="goalId"><option value="">선택 안 함</option>${goals.map(g => `<option value="${g.id}">${escapeHtml(GOAL_TYPES[g.type])} · ${escapeHtml(g.title)}</option>`).join("")}</select></div>
          <div class="field"><label for="practicePhoto">연습 결과 사진</label><input id="practicePhoto" name="photo" type="file" accept="image/*" capture="environment" /></div>
          <div class="field full"><label for="materialLink">자료 링크</label><input id="materialLink" name="materialLink" type="url" placeholder="https://drive.google.com/..." /></div>
          <div class="field full"><label for="practiceNotes">연습 메모</label><textarea id="practiceNotes" name="notes" placeholder="오늘 해낸 것, 막힌 부분, 다음 연습 포인트"></textarea></div>
          <div class="field full"><label class="checkline"><input type="checkbox" name="achieved" /><span>목표한 연습 달성</span></label></div>
          <div class="field full"><button class="button primary" type="submit">기록</button></div>
        </form>
      </div>
    </section>
  `;
}

function renderPracticeList(logs, compact = false, currentUser = null) {
  const readOnly = isReadOnlyUser(currentUser);
  return `
    <div class="list">
      ${logs.sort((a, b) => b.date.localeCompare(a.date)).map(log => {
        const goal = state.goals.find(g => g.id === log.goalId);
        const href = safeUrl(log.materialLink);
        return `
          <article class="item-card">
            <div class="item-top">
              <div>
                <h3 class="item-title">${formatKoreanDate(log.date)} · ${Number(log.minutes || 0)}분</h3>
                <div class="item-meta" style="margin-top: 8px;">
                  <span class="pill ${log.achieved ? "green" : "amber"}">${log.achieved ? "달성" : "미달성"}</span>
                  ${goal ? `<span class="pill blue">${escapeHtml(goal.title)}</span>` : ""}
                </div>
              </div>
              ${compact || readOnly ? "" : `<button class="icon-button" type="button" data-action="delete-practice" data-id="${log.id}" aria-label="연습 기록 삭제" title="연습 기록 삭제">×</button>`}
            </div>
            <div class="media-row">
              ${log.photo ? `<img class="photo-thumb" src="${log.photo}" alt="연습 결과 사진" />` : ""}
              ${href ? `<a href="${href}" target="_blank" rel="noreferrer">자료 링크 열기</a>` : ""}
            </div>
            ${log.notes ? `<p class="item-text">${escapeHtml(log.notes)}</p>` : ""}
            ${compact || readOnly ? "" : `<label class="checkline"><input type="checkbox" data-action="toggle-practice-achieved" data-id="${log.id}" ${log.achieved ? "checked" : ""} /><span>목표한 연습 달성</span></label>`}
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderLessons(currentUser, student) {
  const lessons = getStudentLessons(student.id);
  const sessionMap = getLessonSessionMap(student.id);
  const canWriteTeacherFields = currentUser.role === "teacher";
  const canWriteStudentMemo = currentUser.role === "student";
  return `
    <section class="page-head"><div><h1>레슨 일지</h1><p>레슨 회차와 날짜, 레슨 내용, 과제 피드백을 확인합니다.</p></div></section>
    <section class="surface">
      <div class="surface-header"><h2>레슨 회차</h2><span class="pill blue">${lessons.length}회</span></div>
      <div class="surface-body">${lessons.length ? renderLessonTimeline(lessons, sessionMap) : renderEmpty("레슨 기록이 없습니다.")}</div>
    </section>
    ${canWriteTeacherFields || canWriteStudentMemo ? `
      <section class="surface" style="margin-top: 16px;">
        <div class="surface-header"><h2>${canWriteTeacherFields ? "레슨 일지 작성" : "내 레슨 메모"}</h2></div>
        <div class="surface-body">${canWriteTeacherFields ? renderTeacherLessonForm() : renderStudentLessonMemoForm(student.id)}</div>
      </section>` : ""}
    <section class="surface" style="margin-top: 16px;">
      <div class="surface-header"><h2>레슨 기록</h2><span class="pill">${lessons.length}개</span></div>
      <div class="surface-body">${lessons.length ? renderLessonList(lessons, currentUser, sessionMap) : renderEmpty("레슨 기록이 없습니다.")}</div>
    </section>
  `;
}

function renderLessonTimeline(lessons, sessionMap) {
  const oldestFirst = [...lessons].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return `
    <div class="lesson-timeline">
      ${oldestFirst.map(lesson => `
        <div class="timeline-item">
          <span class="timeline-dot"></span>
          <div>
            <div class="item-meta">
              <span class="pill blue">${sessionMap.get(lesson.id)}회차</span>
              <span class="pill">${formatKoreanFullDate(lesson.date)}</span>
              ${lesson.assignmentDue ? `<span class="pill amber">과제 ${formatKoreanDate(lesson.assignmentDue)}</span>` : ""}
              ${renderLessonAssignmentStatusPill(lesson)}
            </div>
            ${lesson.content ? `<p class="item-text" style="margin-top: 8px;">${escapeHtml(getPreviewText(lesson.content, 72))}</p>` : ""}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderTeacherLessonForm() {
  return `
    <form class="form-grid" data-form="add-lesson">
      <div class="field"><label for="lessonDate">날짜</label><input id="lessonDate" name="date" type="date" value="${toDateInputValue(new Date())}" required /></div>
      <div class="field"><label for="assignmentDue">과제 마감</label><input id="assignmentDue" name="assignmentDue" type="date" /></div>
      <div class="field full"><label for="lessonContent">레슨 내용</label><textarea id="lessonContent" name="content" placeholder="오늘 다룬 내용"></textarea></div>
      <div class="field full"><label for="lessonAssignment">과제</label><textarea id="lessonAssignment" name="assignment" placeholder="다음 레슨까지 해올 과제"></textarea></div>
      <div class="field full"><label for="lessonFeedback">과제 피드백</label><textarea id="lessonFeedback" name="feedback" placeholder="과제에 대한 피드백"></textarea></div>
      <div class="field full"><button class="button primary" type="submit">저장</button></div>
    </form>
  `;
}

function renderStudentLessonMemoForm(studentId) {
  const latestLesson = getStudentLessons(studentId)[0];
  if (!latestLesson) return renderEmpty("레슨 기록이 없습니다.");
  return `
    <form class="form-grid one" data-form="save-student-lesson-memo">
      <input type="hidden" name="lessonId" value="${latestLesson.id}" />
      <div class="field"><label for="studentMemo">내 메모</label><textarea id="studentMemo" name="studentMemo" placeholder="레슨 후 기억할 점">${escapeHtml(latestLesson.studentMemo || "")}</textarea></div>
      <button class="button primary" type="submit">저장</button>
    </form>
  `;
}

function renderLessonList(lessons, currentUser, sessionMap) {
  return `
    <div class="list">
      ${lessons.map(lesson => `
        <article class="item-card">
          <div class="item-top">
            <div>
              <h3 class="item-title">${sessionMap.get(lesson.id)}회차 · ${formatKoreanFullDate(lesson.date)}</h3>
              <div class="item-meta" style="margin-top: 8px;">${lesson.assignmentDue ? `<span class="pill amber">과제 ${formatKoreanDate(lesson.assignmentDue)}</span>` : ""}</div>
            </div>
            ${currentUser.role === "teacher" ? `<button class="icon-button" type="button" data-action="delete-lesson" data-id="${lesson.id}" aria-label="레슨 삭제" title="레슨 삭제">×</button>` : ""}
          </div>
          ${lesson.content ? `<p class="item-text"><strong>레슨 내용</strong><br />${escapeHtml(lesson.content)}</p>` : ""}
          ${lesson.assignment ? `<p class="item-text"><strong>과제</strong><br />${escapeHtml(lesson.assignment)}</p>` : ""}
          ${renderLessonAssignmentStatusBlock(lesson, currentUser)}
          ${renderLessonFeedbackBlock(lesson, currentUser)}
          ${lesson.studentMemo ? `<p class="item-text"><strong>학생 메모</strong><br />${escapeHtml(lesson.studentMemo)}</p>` : ""}
        </article>
      `).join("")}
    </div>
  `;
}

function renderLessonAssignmentStatusPill(lesson) {
  const assignments = getLessonAssignments(lesson.id);
  if (!assignments.length && !lesson.assignment) return "";
  const completedCount = assignments.filter(a => a.completed).length;
  const totalCount = assignments.length || 1;
  const allCompleted = completedCount === totalCount && totalCount > 0;
  return `<span class="pill ${allCompleted ? "green" : "blue"}">과제 ${allCompleted ? "완료" : "진행"} ${completedCount}/${totalCount}</span>`;
}

function renderLessonAssignmentStatusBlock(lesson, currentUser) {
  const assignments = getLessonAssignments(lesson.id);
  if (!assignments.length && !lesson.assignment) return "";
  if (!assignments.length) return `<div class="assignment-status"><span class="pill amber">과제 진행 0/1</span></div>`;
  const readOnly = isReadOnlyUser(currentUser);
  return `
    <div class="assignment-status">
      <div class="item-meta">${assignments.map(a => `<span class="pill ${a.completed ? "green" : "blue"}">${a.completed ? "과제 완료" : "과제 진행"}${a.completedAt ? ` · ${formatKoreanDate(a.completedAt)}` : ""}</span>`).join("")}</div>
      ${readOnly ? "" : assignments.map(a => `<label class="checkline"><input type="checkbox" data-action="toggle-assignment" data-id="${a.id}" ${a.completed ? "checked" : ""} /><span>과제 완료</span></label>`).join("")}
    </div>
  `;
}

function renderLessonFeedbackBlock(lesson, currentUser) {
  if (currentUser.role !== "teacher") return lesson.feedback ? `<p class="item-text"><strong>과제 피드백</strong><br />${escapeHtml(lesson.feedback)}</p>` : "";
  return `
    <form class="form-grid one" data-form="save-lesson-feedback">
      <input type="hidden" name="lessonId" value="${lesson.id}" />
      <div class="field"><label for="feedback-${lesson.id}">과제 피드백</label><textarea id="feedback-${lesson.id}" name="feedback">${escapeHtml(lesson.feedback || "")}</textarea></div>
      <button class="button" type="submit">피드백 저장</button>
    </form>
  `;
}

function renderWeekly(currentUser, student) {
  const today = toDateInputValue(new Date());
  const weekStart = getWeekStart(today);
  const currentReview = state.weeklyReviews.find(r => r.studentId === student.id && r.weekStart === weekStart);
  const weekLogs = getStudentPracticeLogs(student.id).filter(log => isDateInWeek(log.date, weekStart));
  const weekSlots = state.schedules.filter(s => s.studentId === student.id);
  const doneSlots = weekSlots.filter(s => s.done);
  const weekMinutes = weekLogs.reduce((sum, log) => sum + Number(log.minutes || 0), 0);
  const reviews = state.weeklyReviews.filter(r => r.studentId === student.id).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  const readOnly = isReadOnlyUser(currentUser);
  return `
    <section class="page-head"><div><h1>주간 회고</h1><p>일주일 동안의 연습일지, 스케줄, 성과를 돌아봅니다.</p></div></section>
    <section class="grid three">
      ${renderMetric("주간 연습", `${weekMinutes}분`, `${weekLogs.length}개 일지`)}
      ${renderMetric("일정 성과", `${doneSlots.length}/${weekSlots.length || 0}`, "시간표 완료")}
      ${renderMetric("달성 체크", `${weekLogs.filter(log => log.achieved).length}회`, "목표한 연습")}
    </section>
    <section class="surface" style="margin-top: 16px;">
      <div class="surface-header"><h2>${formatKoreanDate(weekStart)} 주간 정리</h2></div>
      <div class="surface-body">${readOnly ? renderWeeklyReviewReadOnly(currentReview) : renderWeeklyReviewForm(currentUser, currentReview, weekStart)}</div>
    </section>
    <section class="grid two" style="margin-top: 16px;">
      <div class="surface">
        <div class="surface-header"><h2>이번 주 연습일지</h2><span class="pill">${weekLogs.length}개</span></div>
        <div class="surface-body">${weekLogs.length ? renderPracticeList(weekLogs, true, currentUser) : renderEmpty("이번 주 연습 기록이 없습니다.")}</div>
      </div>
      <div class="surface">
        <div class="surface-header"><h2>이전 회고</h2><span class="pill">${reviews.length}개</span></div>
        <div class="surface-body">${reviews.length ? `<div class="list">${reviews.map(renderReviewCard).join("")}</div>` : renderEmpty("저장된 회고가 없습니다.")}</div>
      </div>
    </section>
  `;
}

function renderWeeklyReviewForm(currentUser, currentReview, weekStart) {
  return `
    <form class="form-grid" data-form="save-weekly-review">
      <input type="hidden" name="reviewId" value="${currentReview?.id || ""}" />
      <div class="field"><label for="weekStart">주 시작일</label><input id="weekStart" name="weekStart" type="date" value="${currentReview?.weekStart || weekStart}" required /></div>
      <div class="field"><label for="scheduleResult">스케줄과 성과</label><textarea id="scheduleResult" name="scheduleResult" placeholder="계획한 일정과 실제 성과">${escapeHtml(currentReview?.scheduleResult || "")}</textarea></div>
      <div class="field full"><label for="reflection">지난 한 주 돌아보기</label><textarea id="reflection" name="reflection" placeholder="잘된 점, 어려웠던 점, 변화한 점">${escapeHtml(currentReview?.reflection || "")}</textarea></div>
      <div class="field full"><label for="selfFeedback">본인 피드백</label><textarea id="selfFeedback" name="selfFeedback" placeholder="다음 주의 나에게 남기는 피드백">${escapeHtml(currentReview?.selfFeedback || "")}</textarea></div>
      <div class="field full"><label for="teacherFeedback">선생님 피드백</label><textarea id="teacherFeedback" name="teacherFeedback" ${currentUser.role !== "teacher" ? "readonly" : ""}>${escapeHtml(currentReview?.teacherFeedback || "")}</textarea></div>
      <div class="field full"><button class="button primary" type="submit">저장</button></div>
    </form>
  `;
}

function renderWeeklyReviewReadOnly(review) {
  if (!review) return renderEmpty("이번 주 회고가 없습니다.");
  return renderReviewCard(review);
}

function renderReviewCard(review) {
  return `
    <article class="item-card">
      <div class="item-top"><h3 class="item-title">${formatKoreanDate(review.weekStart)} 주간</h3><span class="pill blue">회고</span></div>
      ${review.scheduleResult ? `<p class="item-text"><strong>스케줄과 성과</strong><br />${escapeHtml(review.scheduleResult)}</p>` : ""}
      ${review.reflection ? `<p class="item-text"><strong>돌아보기</strong><br />${escapeHtml(review.reflection)}</p>` : ""}
      ${review.selfFeedback ? `<p class="item-text"><strong>본인 피드백</strong><br />${escapeHtml(review.selfFeedback)}</p>` : ""}
      ${review.teacherFeedback ? `<p class="item-text"><strong>선생님 피드백</strong><br />${escapeHtml(review.teacherFeedback)}</p>` : ""}
    </article>
  `;
}

function renderStudents(currentUser) {
  if (currentUser.role !== "teacher") { ui.view = "dashboard"; return ""; }
  const students = getStudents();
  return `
    <section class="page-head"><div><h1>학생 관리</h1><p>학생별 로그인 계정과 임시 비밀번호를 관리합니다.</p></div></section>
    <section class="surface">
      <div class="surface-header"><h2>학생 추가</h2></div>
      <div class="surface-body">
        <form class="form-grid" data-form="add-student">
          <div class="field"><label for="studentName">이름</label><input id="studentName" name="name" required /></div>
          <div class="field"><label for="studentUsername">계정</label><input id="studentUsername" name="username" required autocomplete="off" /></div>
          <div class="field"><label for="studentPassword">임시 비밀번호</label><input id="studentPassword" name="password" required autocomplete="off" /></div>
          <div class="field"><label for="studentInstrument">전공/파트</label><input id="studentInstrument" name="instrument" placeholder="기타, 작곡, 보컬" /></div>
          <div class="field"><label for="studentGrade">학년</label><input id="studentGrade" name="grade" placeholder="중2" /></div>
          <div class="field full"><label class="checkline"><input type="checkbox" name="selfPayer" /><span>성인 학생이라 본인에게 수업료 알림 표시</span></label></div>
          <div class="field"><label>&nbsp;</label><button class="button primary" type="submit">추가</button></div>
        </form>
      </div>
    </section>
    <section class="surface" style="margin-top: 16px;">
      <div class="surface-header"><h2>학생 계정</h2><span class="pill">${students.length}명</span></div>
      <div class="surface-body">
        <table class="account-table">
          <thead><tr><th>이름</th><th>계정</th><th>비밀번호 변경</th><th>전공/파트</th><th>학년</th><th>보호자</th><th>수업료 알림</th><th>관리</th></tr></thead>
          <tbody>
            ${students.map(student => `
              <tr>
                <td data-label="이름">${escapeHtml(student.name)}</td>
                <td data-label="계정">${escapeHtml(student.username)}</td>
                <td data-label="비밀번호 변경">
                  <form class="form-grid" data-form="update-password" style="grid-template-columns: minmax(100px, 1fr) auto; gap: 8px;">
                    <input type="hidden" name="studentId" value="${student.id}" />
                    <input name="password" placeholder="새 비밀번호" autocomplete="off" aria-label="비밀번호" />
                    <button class="icon-button" type="submit" aria-label="비밀번호 저장" title="비밀번호 저장">✓</button>
                  </form>
                </td>
                <td data-label="전공/파트">${escapeHtml(student.instrument || "")}</td>
                <td data-label="학년">${escapeHtml(student.grade || "")}</td>
                <td data-label="보호자">${renderMatchedGuardianNames(student.id)}</td>
                <td data-label="수업료 알림"><label class="checkline"><input type="checkbox" data-action="toggle-self-payer" data-id="${student.id}" ${student.selfPayer ? "checked" : ""} /><span>학생 본인</span></label></td>
                <td data-label="관리">
                  <div class="toolbar" style="justify-content: flex-start;">
                    <button class="button" type="button" data-action="manage-student" data-id="${student.id}">열기</button>
                    <button class="icon-button" type="button" data-action="delete-student" data-id="${student.id}" aria-label="학생 삭제" title="학생 삭제">×</button>
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderGuardians(currentUser) {
  if (currentUser.role !== "teacher") { ui.view = "dashboard"; return ""; }
  const guardians = getGuardians();
  const students = getStudents();
  return `
    <section class="page-head"><div><h1>보호자</h1><p>보호자 계정과 학생 기록 열람 매칭을 관리합니다.</p></div></section>
    <section class="surface">
      <div class="surface-header"><h2>보호자 추가</h2></div>
      <div class="surface-body">
        <form class="form-grid" data-form="add-guardian">
          <div class="field"><label for="guardianName">이름</label><input id="guardianName" name="name" required /></div>
          <div class="field"><label for="guardianRelation">관계</label><input id="guardianRelation" name="relation" placeholder="어머니" /></div>
          <div class="field"><label for="guardianUsername">계정</label><input id="guardianUsername" name="username" required autocomplete="off" /></div>
          <div class="field"><label for="guardianPassword">임시 비밀번호</label><input id="guardianPassword" name="password" required autocomplete="off" /></div>
          <div class="field full"><label>학생 매칭</label>${renderStudentMatchChecks(students, [])}</div>
          <div class="field full"><button class="button primary" type="submit">추가</button></div>
        </form>
      </div>
    </section>
    <section class="surface" style="margin-top: 16px;">
      <div class="surface-header"><h2>보호자 계정</h2><span class="pill">${guardians.length}명</span></div>
      <div class="surface-body">
        ${guardians.length ? `
          <table class="account-table">
            <thead><tr><th>이름</th><th>계정</th><th>비밀번호 변경</th><th>관계</th><th>학생 매칭</th><th>관리</th></tr></thead>
            <tbody>${guardians.map(g => renderGuardianRow(g, students)).join("")}</tbody>
          </table>
        ` : renderEmpty("보호자 계정이 없습니다.")}
      </div>
    </section>
  `;
}

function renderGuardianRow(guardian, students) {
  return `
    <tr>
      <td data-label="이름">${escapeHtml(guardian.name)}</td>
      <td data-label="계정">${escapeHtml(guardian.username)}</td>
      <td data-label="비밀번호 변경">
        <form class="form-grid" data-form="update-guardian-password" style="grid-template-columns: minmax(100px, 1fr) auto; gap: 8px;">
          <input type="hidden" name="guardianId" value="${guardian.id}" />
          <input name="password" placeholder="새 비밀번호" autocomplete="off" aria-label="보호자 비밀번호" />
          <button class="icon-button" type="submit" aria-label="보호자 비밀번호 저장" title="비밀번호 저장">✓</button>
        </form>
      </td>
      <td data-label="관계">${escapeHtml(guardian.relation || "보호자")}</td>
      <td data-label="학생 매칭">
        <form class="form-grid one" data-form="update-guardian-match">
          <input type="hidden" name="guardianId" value="${guardian.id}" />
          ${renderStudentMatchChecks(students, guardian.studentIds || [])}
          <button class="button" type="submit">매칭 저장</button>
        </form>
      </td>
      <td data-label="관리"><button class="icon-button" type="button" data-action="delete-guardian" data-id="${guardian.id}" aria-label="보호자 삭제" title="보호자 삭제">×</button></td>
    </tr>
  `;
}

function renderStudentMatchChecks(students, selectedIds) {
  if (!students.length) return renderEmpty("학생 계정이 없습니다.");
  return `<div class="match-list">${students.map(s => `<label class="checkline match-check"><input type="checkbox" name="studentIds" value="${s.id}" ${selectedIds.includes(s.id) ? "checked" : ""} /><span>${escapeHtml(s.name)} · ${escapeHtml(s.instrument || "전공 미정")}</span></label>`).join("")}</div>`;
}

function renderMatchedGuardianNames(studentId) {
  const names = getGuardians().filter(g => g.studentIds?.includes(studentId)).map(g => `${g.name}${g.relation ? `(${g.relation})` : ""}`);
  return names.length ? escapeHtml(names.join(", ")) : `<span class="item-text">없음</span>`;
}

function renderMetric(label, value, note) {
  return `<div class="surface metric"><span class="metric-label">${label}</span><strong class="metric-value">${value}</strong><span class="metric-note">${note}</span></div>`;
}

function renderSlotList(slots) {
  return `<div class="list">${slots.map(slot => `<article class="item-card"><div class="item-top"><div><h3 class="item-title">${slot.hour} · ${escapeHtml(slot.title)}</h3><div class="item-meta" style="margin-top: 8px;"><span class="pill blue">${CATEGORY_LABELS[slot.category] || "일정"}</span><span class="pill ${slot.done ? "green" : "amber"}">${slot.done ? "완료" : "예정"}</span></div></div></div></article>`).join("")}</div>`;
}

function renderAssignmentList(assignments, currentUser) {
  const readOnly = isReadOnlyUser(currentUser);
  return `
    <div class="list">
      ${assignments.sort(compareAssignmentsByDueDate).map(assignment => {
        const lessonLabel = getAssignmentLessonLabel(assignment);
        return `
          <article class="item-card">
            <div class="item-top">
              <div>
                <h3 class="item-title">${escapeHtml(assignment.title)}</h3>
                <div class="item-meta" style="margin-top: 8px;">
                  ${lessonLabel ? `<span class="pill">${lessonLabel}</span>` : ""}
                  ${renderAssignmentDuePill(assignment)}
                  <span class="pill ${assignment.completed ? "green" : "blue"}">${assignment.completed ? `완료${assignment.completedAt ? ` · ${formatKoreanDate(assignment.completedAt)}` : ""}` : "진행"}</span>
                </div>
              </div>
            </div>
            ${assignment.feedback ? `<p class="item-text">${escapeHtml(assignment.feedback)}</p>` : ""}
            ${readOnly ? "" : `<label class="checkline"><input type="checkbox" data-action="toggle-assignment" data-id="${assignment.id}" ${assignment.completed ? "checked" : ""} /><span>과제 완료</span></label>`}
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderAssignmentDuePill(assignment) {
  if (assignment.completed) return "";
  if (!assignment.dueDate) return `<span class="pill blue">마감 없음</span>`;
  const today = toDateInputValue(new Date());
  if (assignment.dueDate < today) return `<span class="pill coral">마감 지남 · ${formatKoreanDate(assignment.dueDate)}</span>`;
  if (assignment.dueDate === today) return `<span class="pill amber">오늘 마감</span>`;
  return `<span class="pill amber">${formatKoreanDate(assignment.dueDate)} 마감</span>`;
}

function getAssignmentLessonLabel(assignment) {
  if (!assignment.lessonId) return "";
  const lessonNo = getLessonSessionMap(assignment.studentId).get(assignment.lessonId);
  return lessonNo ? `${lessonNo}회차 과제` : "";
}

function renderRecentLessons(studentId) {
  const lessons = getStudentLessons(studentId).slice(0, 3);
  const sessionMap = getLessonSessionMap(studentId);
  if (!lessons.length) return renderEmpty("레슨 기록이 없습니다.");
  return `
    <div class="list">
      ${lessons.map(lesson => `
        <article class="item-card">
          <div class="item-top">
            <h3 class="item-title">${sessionMap.get(lesson.id)}회차 · ${formatKoreanDate(lesson.date)}</h3>
            <div class="item-meta">
              ${lesson.assignmentDue ? `<span class="pill amber">과제 ${formatKoreanDate(lesson.assignmentDue)}</span>` : ""}
              ${renderLessonAssignmentStatusPill(lesson)}
            </div>
          </div>
          ${lesson.content ? `<p class="item-text">${escapeHtml(lesson.content)}</p>` : ""}
        </article>
      `).join("")}
    </div>
  `;
}

function renderEmpty(message) { return `<div class="empty">${message}</div>`; }

// ── Handlers ──
async function handleSubmit(event) {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  const type = form.dataset.form;
  const formData = new FormData(form);

  if (type === "register-teacher") {
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    const name = String(formData.get("name") || "").trim();
    const result = await callEdge({ action: "register-teacher", username, password, name }, false);
    if (result.error) { showToast(result.error); return; }
    if (result.session) {
      await sb.auth.setSession(result.session);
      await loadStateFromSupabase(result.session.user);
    }
    ui.view = "dashboard";
    render();
    return;
  }

  if (type === "login") {
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    const { data, error } = await sb.auth.signInWithPassword({ email: `${username}@classnote.app`, password });
    if (error) { showToast("계정 또는 비밀번호를 확인해주세요."); return; }
    await loadStateFromSupabase(data.user);
    ui.view = "dashboard";
    render();
    return;
  }

  const currentUser = getCurrentUser();
  const student = getSelectedStudent();
  const studentOptionalForms = ["add-student", "add-guardian", "update-guardian-password", "update-guardian-match"];
  if (!currentUser || (!student && !studentOptionalForms.includes(type))) return;
  if (isReadOnlyUser(currentUser)) { showToast("보호자 계정은 열람만 가능합니다."); return; }

  if (type === "add-goal") {
    const { data: newGoal, error } = await sb.from("goals").insert({
      student_id: student.id,
      type: String(formData.get("type") || "week"),
      title: String(formData.get("title") || "").trim(),
      detail: String(formData.get("detail") || "").trim() || null,
      due_date: String(formData.get("dueDate") || "") || null,
      progress: clamp(Number(formData.get("progress") || 0), 0, 100),
      done: false
    }).select().single();
    if (!error) { state.goals.push(mapGoals([newGoal])[0]); render(); showToast("목표를 추가했습니다."); }
    return;
  }

  if (type === "save-slot") {
    const day = String(formData.get("day") || "");
    const hour = String(formData.get("hour") || "");
    const { data: slot, error } = await sb.from("schedules").upsert({
      student_id: student.id,
      day_of_week: dayKeyToInt(day),
      starts_at: `${hour}:00`,
      title: String(formData.get("title") || "").trim(),
      category: String(formData.get("category") || "practice"),
      done: formData.get("done") === "on"
    }, { onConflict: "student_id,day_of_week,starts_at" }).select().single();
    if (!error) {
      const existing = findScheduleSlot(student.id, day, hour);
      const mapped = mapSchedules([slot])[0];
      if (existing) Object.assign(existing, mapped); else state.schedules.push(mapped);
    }
    ui.editingSlot = null;
    render();
    showToast("시간표를 저장했습니다.");
    return;
  }

  if (type === "add-practice") {
    const file = form.querySelector('input[name="photo"]')?.files?.[0];
    const photo = file ? await resizeImageFile(file) : "";
    const goalId = String(formData.get("goalId") || "");
    const { data: log, error } = await sb.from("practice_logs").insert({
      student_id: student.id,
      practiced_on: String(formData.get("date") || toDateInputValue(new Date())),
      minutes: Number(formData.get("minutes") || 0),
      goal_id: goalId || null,
      achieved: formData.get("achieved") === "on",
      photo_path: photo || null,
      material_link: String(formData.get("materialLink") || "").trim() || null,
      notes: String(formData.get("notes") || "").trim() || null
    }).select().single();
    if (!error) { state.practiceLogs.push(mapPracticeLogs([log])[0]); render(); showToast("연습 기록을 추가했습니다."); }
    return;
  }

  if (type === "add-lesson") {
    const assignment = String(formData.get("assignment") || "").trim();
    const feedback = String(formData.get("feedback") || "").trim();
    const assignmentDue = String(formData.get("assignmentDue") || "");
    const { data: lesson, error } = await sb.from("lessons").insert({
      student_id: student.id,
      lesson_on: String(formData.get("date") || toDateInputValue(new Date())),
      content: String(formData.get("content") || "").trim() || null,
      assignment: assignment || null,
      assignment_due: assignmentDue || null,
      feedback: feedback || null,
      student_memo: null
    }).select().single();
    if (error) return;
    state.lessons.push(mapLessons([lesson])[0]);
    if (assignment) {
      const { data: aRec } = await sb.from("assignments").insert({
        student_id: student.id, lesson_id: lesson.id, title: assignment,
        due_date: assignmentDue || null, feedback: feedback || null, completed: false
      }).select().single();
      if (aRec) state.assignments.push(mapAssignments([aRec])[0]);
    }
    const lessonCount = state.lessons.filter(l => l.studentId === student.id).length;
    render();
    showToast(lessonCount > 0 && lessonCount % LESSONS_PER_TUITION === 0 ? "레슨 일지를 저장했습니다. 수업료 알림이 생성되었습니다." : "레슨 일지를 저장했습니다.");
    return;
  }

  if (type === "save-lesson-feedback") {
    const lessonId = String(formData.get("lessonId") || "");
    const lesson = state.lessons.find(l => l.id === lessonId);
    if (lesson && currentUser.role === "teacher") {
      const feedback = String(formData.get("feedback") || "").trim();
      await sb.from("lessons").update({ feedback: feedback || null }).eq("id", lessonId);
      await sb.from("assignments").update({ feedback: feedback || null }).eq("lesson_id", lessonId);
      lesson.feedback = feedback;
      state.assignments.filter(a => a.lessonId === lessonId).forEach(a => a.feedback = feedback);
      render(); showToast("피드백을 저장했습니다.");
    }
    return;
  }

  if (type === "save-student-lesson-memo") {
    const lessonId = String(formData.get("lessonId") || "");
    const lesson = state.lessons.find(l => l.id === lessonId);
    if (lesson && lesson.studentId === student.id) {
      const studentMemo = String(formData.get("studentMemo") || "").trim();
      await sb.from("lessons").update({ student_memo: studentMemo || null }).eq("id", lessonId);
      lesson.studentMemo = studentMemo;
      render(); showToast("메모를 저장했습니다.");
    }
    return;
  }

  if (type === "save-weekly-review") {
    const weekStart = String(formData.get("weekStart") || getWeekStart(toDateInputValue(new Date())));
    const reviewId = String(formData.get("reviewId") || "");
    const existing = state.weeklyReviews.find(r => r.id === reviewId) ||
      state.weeklyReviews.find(r => r.studentId === student.id && r.weekStart === weekStart);
    const dbPayload = {
      student_id: student.id,
      week_start: weekStart,
      schedule_result: String(formData.get("scheduleResult") || "").trim() || null,
      reflection: String(formData.get("reflection") || "").trim() || null,
      self_feedback: String(formData.get("selfFeedback") || "").trim() || null
    };
    if (currentUser.role === "teacher") {
      dbPayload.teacher_feedback = String(formData.get("teacherFeedback") || "").trim() || null;
    }
    if (existing) {
      await sb.from("weekly_reviews").update(dbPayload).eq("id", existing.id);
      Object.assign(existing, mapWeeklyReviews([{
        id: existing.id, student_id: student.id, week_start: weekStart,
        schedule_result: dbPayload.schedule_result, reflection: dbPayload.reflection,
        self_feedback: dbPayload.self_feedback,
        teacher_feedback: currentUser.role === "teacher" ? dbPayload.teacher_feedback : existing.teacherFeedback
      }])[0]);
    } else {
      const { data: rev } = await sb.from("weekly_reviews").insert(dbPayload).select().single();
      if (rev) state.weeklyReviews.push(mapWeeklyReviews([rev])[0]);
    }
    render(); showToast("주간 회고를 저장했습니다.");
    return;
  }

  if (type === "add-student" && currentUser.role === "teacher") {
    const result = await callEdge({
      action: "create", role: "student",
      username: String(formData.get("username") || "").trim(),
      password: String(formData.get("password") || ""),
      name: String(formData.get("name") || "").trim(),
      instrument: String(formData.get("instrument") || "").trim(),
      grade: String(formData.get("grade") || "").trim(),
      selfPayer: formData.get("selfPayer") === "on"
    });
    if (result.error) { showToast(result.error); return; }
    const { data: { session: s } } = await sb.auth.getSession();
    await loadStateFromSupabase(s.user);
    ui.selectedStudentId = result.id;
    ui.view = "dashboard";
    render(); showToast("학생 계정을 추가했습니다.");
    return;
  }

  if (type === "update-password" && currentUser.role === "teacher") {
    const targetUser = state.users.find(u => u.id === String(formData.get("studentId") || ""));
    const newPw = String(formData.get("password") || "").trim();
    if (targetUser?._authId && newPw) {
      const result = await callEdge({ action: "update-password", authId: targetUser._authId, newPassword: newPw });
      if (result.error) { showToast(result.error); return; }
      showToast("비밀번호를 저장했습니다.");
    }
    return;
  }

  if (type === "add-guardian" && currentUser.role === "teacher") {
    const result = await callEdge({
      action: "create", role: "guardian",
      username: String(formData.get("username") || "").trim(),
      password: String(formData.get("password") || ""),
      name: String(formData.get("name") || "").trim(),
      relation: String(formData.get("relation") || "보호자").trim(),
      studentIds: getMatchedStudentIds(formData)
    });
    if (result.error) { showToast(result.error); return; }
    const { data: { session: s } } = await sb.auth.getSession();
    await loadStateFromSupabase(s.user);
    render(); showToast("보호자 계정을 추가했습니다.");
    return;
  }

  if (type === "update-guardian-password" && currentUser.role === "teacher") {
    const guardian = state.users.find(u => u.id === String(formData.get("guardianId") || "") && u.role === "guardian");
    const newPw = String(formData.get("password") || "").trim();
    if (guardian && newPw) {
      const result = await callEdge({ action: "update-password", authId: guardian.id, newPassword: newPw });
      if (result.error) { showToast(result.error); return; }
      showToast("보호자 비밀번호를 저장했습니다.");
    }
    return;
  }

  if (type === "update-guardian-match" && currentUser.role === "teacher") {
    const guardian = state.users.find(u => u.id === String(formData.get("guardianId") || "") && u.role === "guardian");
    if (guardian) {
      const newStudentIds = getMatchedStudentIds(formData);
      const result = await callEdge({ action: "update-guardian-match", guardianAuthId: guardian.id, studentIds: newStudentIds });
      if (result.error) { showToast(result.error); return; }
      guardian.studentIds = newStudentIds;
      render(); showToast("보호자 매칭을 저장했습니다.");
    }
    return;
  }
}

async function handleClick(event) {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) { ui.view = viewButton.dataset.view; ui.editingSlot = null; render(); return; }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.action;
  const currentUser = getCurrentUser();
  const student = getSelectedStudent();

  if (action === "logout") {
    await sb.auth.signOut();
    state = emptyState(); session = { userId: "" };
    ui = { view: "dashboard", selectedStudentId: "", editingSlot: null };
    render(); return;
  }

  if (!currentUser) return;

  if (isReadOnlyUser(currentUser) && isRecordMutationAction(action)) {
    showToast("보호자 계정은 열람만 가능합니다."); return;
  }

  if (action === "edit-slot") {
    ui.editingSlot = { day: actionButton.dataset.day, hour: actionButton.dataset.hour };
    render(); window.setTimeout(() => document.querySelector("#slotTitle")?.focus(), 0); return;
  }
  if (action === "close-slot-editor") { ui.editingSlot = null; render(); return; }

  if (action === "delete-slot" && student) {
    const slotId = actionButton.dataset.id;
    await sb.from("schedules").delete().eq("id", slotId);
    state.schedules = state.schedules.filter(s => s.id !== slotId);
    ui.editingSlot = null; render(); showToast("일정을 삭제했습니다."); return;
  }

  if (action === "clear-schedule-done" && student) {
    const ids = state.schedules.filter(s => s.studentId === student.id).map(s => s.id);
    if (ids.length) await sb.from("schedules").update({ done: false }).in("id", ids);
    state.schedules.filter(s => s.studentId === student.id).forEach(s => s.done = false);
    render(); showToast("완료 체크를 초기화했습니다."); return;
  }

  if (action === "delete-goal" && student) {
    const goalId = actionButton.dataset.id;
    await sb.from("goals").delete().eq("id", goalId);
    state.goals = state.goals.filter(g => g.id !== goalId);
    state.practiceLogs.forEach(log => { if (log.goalId === goalId) log.goalId = ""; });
    render(); showToast("목표를 삭제했습니다."); return;
  }

  if (action === "delete-practice") {
    const logId = actionButton.dataset.id;
    await sb.from("practice_logs").delete().eq("id", logId);
    state.practiceLogs = state.practiceLogs.filter(l => l.id !== logId);
    render(); showToast("연습 기록을 삭제했습니다."); return;
  }

  if (action === "delete-lesson" && currentUser.role === "teacher") {
    const lessonId = actionButton.dataset.id;
    await sb.from("lessons").delete().eq("id", lessonId);
    state.lessons = state.lessons.filter(l => l.id !== lessonId);
    state.assignments = state.assignments.filter(a => a.lessonId !== lessonId);
    render(); showToast("레슨 기록을 삭제했습니다."); return;
  }

  if (action === "mark-tuition-paid" && currentUser.role === "teacher") {
    const studentId = actionButton.dataset.studentId;
    const cycleNo = Number(actionButton.dataset.cycleNo || 0);
    if (!studentId || cycleNo <= 0) return;
    const summary = getTuitionSummary(studentId);
    const cycle = summary.cycles.find(c => c.cycleNo === cycleNo);
    if (!cycle) return;
    const existing = state.tuitionPayments.find(p => p.studentId === studentId && p.cycleNo === cycleNo);
    const today = toDateInputValue(new Date());
    if (existing) {
      await sb.from("tuition_payments").update({ paid: true, paid_at: today }).eq("id", existing.id);
      existing.paid = true; existing.paidAt = today;
    } else {
      const { data: payment } = await sb.from("tuition_payments").insert({
        student_id: studentId, cycle_no: cycleNo,
        lesson_from: cycle.fromSession, lesson_to: cycle.toSession,
        paid: true, paid_at: today
      }).select().single();
      if (payment) state.tuitionPayments.push(mapTuitionPayments([payment])[0]);
    }
    render(); showToast("수업료 납부 확인을 저장했습니다."); return;
  }

  if (action === "mark-tuition-unpaid" && currentUser.role === "teacher") {
    const studentId = actionButton.dataset.studentId;
    const cycleNo = Number(actionButton.dataset.cycleNo || 0);
    const payment = state.tuitionPayments.find(p => p.studentId === studentId && p.cycleNo === cycleNo);
    if (payment) {
      await sb.from("tuition_payments").update({ paid: false, paid_at: null }).eq("id", payment.id);
      payment.paid = false; payment.paidAt = "";
      render(); showToast("수업료 납부 확인을 취소했습니다.");
    }
    return;
  }

  if (action === "open-student-view" && currentUser.role === "teacher") {
    ui.selectedStudentId = actionButton.dataset.id;
    ui.view = actionButton.dataset.targetView || "dashboard";
    ui.editingSlot = null; render(); return;
  }

  if (action === "manage-student" && currentUser.role === "teacher") {
    ui.selectedStudentId = actionButton.dataset.id; ui.view = "dashboard"; render(); return;
  }

  if (action === "delete-guardian" && currentUser.role === "teacher") {
    const guardianId = actionButton.dataset.id;
    const guardian = state.users.find(u => u.id === guardianId && u.role === "guardian");
    if (guardian) {
      const result = await callEdge({ action: "delete", authId: guardian.id });
      if (result.error) { showToast(result.error); return; }
      state.users = state.users.filter(u => u.id !== guardianId);
      render(); showToast("보호자 계정을 삭제했습니다.");
    }
    return;
  }

  if (action === "delete-student" && currentUser.role === "teacher") {
    const studentId = actionButton.dataset.id;
    const target = state.users.find(u => u.id === studentId && u.role === "student");
    if (target) {
      const result = await callEdge({ action: "delete", authId: target._authId, studentId });
      if (result.error) { showToast(result.error); return; }
      state.users = state.users.filter(u => u.id !== studentId);
      getGuardians().forEach(g => { g.studentIds = (g.studentIds || []).filter(id => id !== studentId); });
      ["goals", "schedules", "practiceLogs", "lessons", "assignments", "tuitionPayments", "weeklyReviews"].forEach(key => {
        state[key] = state[key].filter(item => item.studentId !== studentId);
      });
      ui.selectedStudentId = getStudents()[0]?.id || "";
      render(); showToast("학생 정보를 삭제했습니다.");
    }
    return;
  }
}

async function handleChange(event) {
  const target = event.target;
  const action = target.dataset.action;
  const currentUser = getCurrentUser();

  if (action === "select-student") { ui.selectedStudentId = target.value; ui.editingSlot = null; render(); return; }

  if (isReadOnlyUser(currentUser) && action) {
    if ("checked" in target) target.checked = !target.checked;
    showToast("보호자 계정은 열람만 가능합니다."); return;
  }

  if (action === "toggle-goal") {
    const goal = state.goals.find(g => g.id === target.dataset.id);
    if (goal) {
      goal.done = target.checked;
      if (target.checked && goal.progress < 100) goal.progress = 100;
      await sb.from("goals").update({ done: goal.done, progress: goal.progress }).eq("id", goal.id);
      render(); showToast("목표 달성 여부를 저장했습니다.");
    }
    return;
  }

  if (action === "toggle-practice-achieved") {
    const log = state.practiceLogs.find(l => l.id === target.dataset.id);
    if (log) {
      log.achieved = target.checked;
      await sb.from("practice_logs").update({ achieved: log.achieved }).eq("id", log.id);
      render(); showToast("연습 달성 여부를 저장했습니다.");
    }
    return;
  }

  if (action === "toggle-self-payer" && currentUser?.role === "teacher") {
    const s = state.users.find(u => u.id === target.dataset.id && u.role === "student");
    if (s) {
      s.selfPayer = target.checked;
      await callEdge({ action: "update-student", studentId: s.id, selfPayer: s.selfPayer });
      render(); showToast(target.checked ? "학생 본인에게 수업료 알림을 표시합니다." : "학생 본인 수업료 알림을 해제했습니다.");
    }
    return;
  }

  if (action === "toggle-assignment") {
    const a = state.assignments.find(a => a.id === target.dataset.id);
    if (a) {
      a.completed = target.checked;
      a.completedAt = target.checked ? toDateInputValue(new Date()) : "";
      await sb.from("assignments").update({ completed: a.completed, completed_at: a.completedAt || null }).eq("id", a.id);
      render(); showToast("과제 상태를 저장했습니다.");
    }
  }
}

let progressTimer = 0;
function handleInput(event) {
  const target = event.target;
  if (target.dataset.action !== "update-goal-progress") return;
  if (isReadOnlyUser(getCurrentUser())) { showToast("보호자 계정은 열람만 가능합니다."); render(); return; }
  const goal = state.goals.find(g => g.id === target.dataset.id);
  if (!goal) return;
  goal.progress = clamp(Number(target.value || 0), 0, 100);
  goal.done = goal.progress >= 100;
  const card = target.closest(".item-card");
  const strong = card?.querySelector(".progress-row strong");
  if (strong) strong.textContent = `${goal.progress}%`;
  clearTimeout(progressTimer);
  progressTimer = window.setTimeout(async () => {
    await sb.from("goals").update({ progress: goal.progress, done: goal.done }).eq("id", goal.id);
  }, 600);
}

function handleKeydown(event) {
  if (event.key !== "Escape" || !ui.editingSlot) return;
  ui.editingSlot = null; render();
}

// ── Data accessors ──
function getCurrentUser() { return state.users.find(u => u.id === session.userId) || null; }
function getStudents() { return state.users.filter(u => u.role === "student"); }
function getGuardians() { return state.users.filter(u => u.role === "guardian"); }
function getAccessibleStudents(user) {
  if (!user) return [];
  if (user.role === "teacher") return getStudents();
  if (user.role === "student") return getStudents().filter(s => s.id === user.id);
  if (user.role === "guardian") {
    const ids = new Set(Array.isArray(user.studentIds) ? user.studentIds : []);
    return getStudents().filter(s => ids.has(s.id));
  }
  return [];
}
function getSelectedStudent() {
  const currentUser = getCurrentUser();
  if (currentUser?.role === "student") return currentUser;
  return getAccessibleStudents(currentUser).find(s => s.id === ui.selectedStudentId) || null;
}
function getStudentGoals(studentId) { return state.goals.filter(g => g.studentId === studentId); }
function getStudentPracticeLogs(studentId) { return state.practiceLogs.filter(l => l.studentId === studentId); }
function getStudentLessons(studentId) {
  return state.lessons.filter(l => l.studentId === studentId).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}
function getStudentAssignments(studentId) { return state.assignments.filter(a => a.studentId === studentId); }
function getLessonAssignments(lessonId) { return state.assignments.filter(a => a.lessonId === lessonId); }

function getStudentManagementSummary(student, today, weekStart) {
  const assignments = getStudentAssignments(student.id);
  const activeAssignments = assignments.filter(a => !a.completed).sort(compareAssignmentsByDueDate);
  const overdueAssignments = activeAssignments.filter(a => a.dueDate && a.dueDate < today);
  const dueTodayAssignments = activeAssignments.filter(a => a.dueDate === today);
  const lessons = getStudentLessons(student.id);
  const latestLesson = lessons[0];
  const lessonSessionMap = getLessonSessionMap(student.id);
  const tuitionSummary = getTuitionSummary(student.id);
  const weekLogs = getStudentPracticeLogs(student.id).filter(log => isDateInWeek(log.date, weekStart));
  const weekMinutes = weekLogs.reduce((sum, log) => sum + Number(log.minutes || 0), 0);
  const review = state.weeklyReviews.find(r => r.studentId === student.id && r.weekStart === weekStart);
  const reviewDone = !!review && Boolean(review.scheduleResult || review.reflection || review.selfFeedback || review.teacherFeedback);
  const needsAttention = Boolean(tuitionSummary.unpaidCycles.length || overdueAssignments.length || dueTodayAssignments.length || !reviewDone);
  const priority = tuitionSummary.unpaidCycles.length * 130 + overdueAssignments.length * 100 + dueTodayAssignments.length * 60 + (reviewDone ? 0 : 25) + activeAssignments.length * 6 + (weekLogs.length ? 0 : 5);
  return { student, assignmentCount: assignments.length, activeAssignments, overdueAssignments, dueTodayAssignments, tuitionSummary, nextAssignment: activeAssignments[0], latestLesson, latestLessonNo: latestLesson ? lessonSessionMap.get(latestLesson.id) : 0, weekLogs, weekMinutes, reviewDone, needsAttention, priority };
}

function getTuitionSummary(studentId) {
  const lessons = state.lessons.filter(l => l.studentId === studentId).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const lessonCount = lessons.length;
  const completedCycleCount = Math.floor(lessonCount / LESSONS_PER_TUITION);
  const payments = state.tuitionPayments || [];
  const cycles = Array.from({ length: completedCycleCount }, (_, i) => {
    const cycleNo = i + 1;
    const fromSession = i * LESSONS_PER_TUITION + 1;
    const toSession = cycleNo * LESSONS_PER_TUITION;
    const payment = payments.find(p => p.studentId === studentId && Number(p.cycleNo) === cycleNo);
    return { studentId, cycleNo, fromSession, toSession, completedOn: lessons[toSession - 1]?.date || "", paid: Boolean(payment?.paid), paidAt: payment?.paidAt || "" };
  });
  const remainingInCycle = lessonCount % LESSONS_PER_TUITION;
  const nextDueIn = LESSONS_PER_TUITION - remainingInCycle;
  const nextCycleNo = completedCycleCount + 1;
  return { lessonCount, cycles, unpaidCycles: cycles.filter(c => !c.paid), nextDueIn, nextCycleStart: (nextCycleNo - 1) * LESSONS_PER_TUITION + 1, nextCycleEnd: nextCycleNo * LESSONS_PER_TUITION };
}

function getLessonSessionMap(studentId) {
  return new Map(state.lessons.filter(l => l.studentId === studentId).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).map((l, i) => [l.id, i + 1]));
}
function findScheduleSlot(studentId, day, hour) { return state.schedules.find(s => s.studentId === studentId && s.day === day && s.hour === hour); }
function getRoleLabel(role) { return ROLE_LABELS[role] || "사용자"; }
function isReadOnlyUser(user) { return user?.role === "guardian"; }
function canViewTuitionNotice(user, student) {
  if (!user || !student) return false;
  if (user.role === "teacher" || user.role === "guardian") return true;
  return user.role === "student" && user.id === student.id && Boolean(student.selfPayer);
}
function isRecordMutationAction(action) {
  return ["edit-slot","delete-slot","clear-schedule-done","delete-goal","delete-practice","delete-lesson","mark-tuition-paid","mark-tuition-unpaid","toggle-goal","toggle-practice-achieved","toggle-assignment","toggle-self-payer","update-goal-progress"].includes(action);
}
function getMatchedStudentIds(formData) { return formData.getAll("studentIds").map(v => String(v || "").trim()).filter(Boolean); }
function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
function compareAssignmentsByDueDate(a, b) { return (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31") || a.title.localeCompare(b.title, "ko"); }
function toDateInputValue(date) { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function addDays(date, count) { const d = new Date(date); d.setDate(d.getDate() + count); return d; }
function getWeekStart(dateString) { const date = new Date(`${dateString}T12:00:00`); const day = (date.getDay() + 6) % 7; date.setDate(date.getDate() - day); return toDateInputValue(date); }
function isDateInWeek(dateString, weekStartString) { const date = new Date(`${dateString}T12:00:00`); const start = new Date(`${weekStartString}T00:00:00`); const end = new Date(start); end.setDate(end.getDate() + 7); return date >= start && date < end; }
function getDayKey(dateString) { const date = new Date(`${dateString}T12:00:00`); return ["sun","mon","tue","wed","thu","fri","sat"][date.getDay()]; }
function formatKoreanDate(dateString) { if (!dateString) return ""; const d = new Date(`${dateString}T12:00:00`); return `${d.getMonth()+1}월 ${d.getDate()}일`; }
function formatKoreanFullDate(dateString) { if (!dateString) return ""; const d = new Date(`${dateString}T12:00:00`); return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`; }
function formatTuitionCycleLabel(cycle) { return `${cycle.fromSession}-${cycle.toSession}회차`; }
function getPreviewText(value, maxLength) { const text = String(value || "").replace(/\s+/g, " ").trim(); return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`; }
function escapeHtml(value) { return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
function escapeAttribute(value) { return escapeHtml(value).replaceAll("`","&#096;"); }
function safeUrl(value) { const raw = String(value || "").trim(); if (!raw) return ""; try { const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`; const url = new URL(normalized); if (url.protocol === "http:" || url.protocol === "https:") return url.href; } catch { return ""; } return ""; }

function resizeImageFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSide = 1200;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      image.onerror = () => resolve("");
      image.src = reader.result;
    };
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

let toastTimer = 0;
function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 2200);
}
