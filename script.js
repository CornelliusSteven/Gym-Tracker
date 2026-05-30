const STORAGE_KEY = "gym_tracker_v1";
const THEME_KEY = "gym_tracker_theme_v1";
const DEFAULT_MUSCLES = ["Chest", "Back", "Legs", "Shoulders", "Biceps", "Triceps", "Core"];
const DEFAULT_PRIMARY = ["Chest", "Back", "Shoulder", "Leg"];
const DEFAULT_SECONDARY = ["Biceps", "Triceps", "Forearms", "Calves", "Abs"];

const state = {
  store: loadStore(),
  user: null,
  currentView: "dashboard",
  workoutDraft: null,
  liftBuilder: null,
  editingSessionId: null,
  theme: loadTheme(),
};

render();

function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "pastel" || saved === "royal") return saved;
  return "dark";
}

function loadStore() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { users: [], sessions: [], musclesByUser: {} };
  try {
    return JSON.parse(raw);
  } catch {
    return { users: [], sessions: [], musclesByUser: {} };
  }
}

function saveStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.store));
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(iso) {
  return parseIso(iso).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function weekStartMonday(date) {
  const c = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = c.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  c.setDate(c.getDate() + offset);
  return c;
}

function getUserSessions(userId) {
  return state.store.sessions
    .filter((s) => s.userId === userId)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

function getUserMuscles(userId) {
  if (!state.store.musclesByUser[userId]) {
    state.store.musclesByUser[userId] = {
      primary: [...DEFAULT_PRIMARY],
      secondary: [...DEFAULT_SECONDARY],
      customPrimary: [],
      customSecondary: [],
    };
    saveStore();
  }
  const existing = state.store.musclesByUser[userId];
  if (Array.isArray(existing)) {
    state.store.musclesByUser[userId] = {
      primary: [...DEFAULT_PRIMARY],
      secondary: [...DEFAULT_SECONDARY],
      customPrimary: existing.filter((m) => !DEFAULT_PRIMARY.includes(m)),
      customSecondary: [],
    };
    saveStore();
  }

  normalizeLegacySecondaryNames(existing);
  return state.store.musclesByUser[userId];
}

function setUserMuscles(userId, muscles) {
  state.store.musclesByUser[userId] = muscles;
  saveStore();
}

function getAllMuscles(userId) {
  const groups = getUserMuscles(userId);
  return [...groups.primary, ...groups.secondary, ...groups.customPrimary, ...groups.customSecondary];
}

function normalizeLegacySecondaryNames(groups) {
  if (!groups || !Array.isArray(groups.secondary)) return;
  const replaceMap = {
    bicep: "Biceps",
    tricep: "Triceps",
    forearm: "Forearms",
  };
  let changed = false;
  groups.secondary = groups.secondary.map((name) => {
    const key = String(name || "").trim().toLowerCase();
    if (replaceMap[key]) {
      changed = true;
      return replaceMap[key];
    }
    return name;
  });
  if (changed) saveStore();
}

function computeStreak(uniqueDatesAsc) {
  if (!uniqueDatesAsc.length) return { currentStreak: 0, longestStreak: 0 };
  let longest = 1;
  let run = 1;
  let endingRun = 1;

  for (let i = 1; i < uniqueDatesAsc.length; i += 1) {
    const prev = parseIso(uniqueDatesAsc[i - 1]);
    const cur = parseIso(uniqueDatesAsc[i]);
    const gap = Math.floor((cur - prev) / 86400000);
    if (gap < 7) {
      run += 1;
    } else {
      if (run > longest) longest = run;
      run = 1;
    }
    if (i === uniqueDatesAsc.length - 1) endingRun = run;
  }
  if (run > longest) longest = run;

  const last = parseIso(uniqueDatesAsc[uniqueDatesAsc.length - 1]);
  const now = parseIso(todayIso());
  const sinceLast = Math.floor((now - last) / 86400000);
  return { currentStreak: sinceLast >= 7 ? 0 : endingRun, longestStreak: longest };
}

function computeAnalytics(userId) {
  const sessions = getUserSessions(userId);
  const uniqueDates = [...new Set(sessions.map((s) => s.date))].sort();
  const today = parseIso(todayIso());
  const weekStart = weekStartMonday(today);
  const month = today.getMonth();
  const year = today.getFullYear();

  const weekDays = new Set();
  const monthDays = new Set();
  const weekMuscles = {};
  const monthMuscles = {};

  sessions.forEach((s) => {
    const d = parseIso(s.date);
    if (d >= weekStart && d <= today) {
      weekDays.add(s.date);
      s.muscleGroupsSnapshot.forEach((m) => (weekMuscles[m] = (weekMuscles[m] || 0) + 1));
    }
    if (d.getMonth() === month && d.getFullYear() === year) {
      monthDays.add(s.date);
      s.muscleGroupsSnapshot.forEach((m) => (monthMuscles[m] = (monthMuscles[m] || 0) + 1));
    }
  });

  const gameStats = computeGameStats(uniqueDates);

  return {
    sessions,
    ...computeStreak(uniqueDates),
    ...gameStats,
    weekGymDays: weekDays.size,
    monthGymDays: monthDays.size,
    weekMuscles,
    monthMuscles,
  };
}

function computeGameStats(uniqueDatesAsc) {
  const gymDays = uniqueDatesAsc.length;
  const xp = gymDays * 10;
  const level = Math.floor(xp / 100) + 1;
  const xpIntoLevel = xp % 100;
  const weeklyStreak = computeWeeklyStreak(uniqueDatesAsc);
  return { xp, level, xpIntoLevel, weeklyStreak };
}

function computeWeeklyStreak(uniqueDatesAsc) {
  if (!uniqueDatesAsc.length) return 0;

  const activeWeekKeys = new Set();
  uniqueDatesAsc.forEach((iso) => {
    const weekStart = weekStartMonday(parseIso(iso));
    activeWeekKeys.add(toIso(weekStart));
  });

  const sortedWeekKeys = [...activeWeekKeys].sort();
  let streak = 1;
  let bestEnding = 1;
  for (let i = 1; i < sortedWeekKeys.length; i += 1) {
    const prev = parseIso(sortedWeekKeys[i - 1]);
    const cur = parseIso(sortedWeekKeys[i]);
    const gapDays = Math.floor((cur - prev) / 86400000);
    if (gapDays === 7) {
      streak += 1;
    } else {
      streak = 1;
    }
    if (i === sortedWeekKeys.length - 1) {
      bestEnding = streak;
    }
  }

  const latestWeek = parseIso(sortedWeekKeys[sortedWeekKeys.length - 1]);
  const currentWeek = weekStartMonday(parseIso(todayIso()));
  const gapFromCurrent = Math.floor((currentWeek - latestWeek) / 86400000);
  if (gapFromCurrent > 7) return 0;
  return bestEnding;
}

function toIso(date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function topPair(mapObj) {
  return Object.entries(mapObj).sort((a, b) => b[1] - a[1])[0];
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function render() {
  const app = document.getElementById("app");
  document.body.dataset.theme = state.theme;
  app.innerHTML = state.user ? renderAuthed() : renderAuth();
  bindEvents();
}

function renderThemePicker() {
  return `
    <div class="theme-picker-wrap">
      <span class="theme-label">Theme:</span>
      <div class="theme-picker" role="group" aria-label="Theme picker">
      <button type="button" class="theme-dot ${state.theme === "dark" ? "active" : ""}" data-theme="dark" title="Current dark-grey"></button>
      <button type="button" class="theme-dot pastel ${state.theme === "pastel" ? "active" : ""}" data-theme="pastel" title="Pastel pink"></button>
      <button type="button" class="theme-dot royal ${state.theme === "royal" ? "active" : ""}" data-theme="royal" title="Purple and brown"></button>
      </div>
    </div>
  `;
}

function renderAuth() {
  return `
    <main class="shell auth-shell">
      <section class="auth-panel">
        <div class="theme-row">
          ${renderThemePicker()}
        </div>
        <h1>Gym Tracker</h1>
        <p>Track workouts, body-part balance, and streaks.</p>
        <div class="auth-grid">
          <form id="register-form" class="panel">
            <h2>Create account</h2>
            <label>Name<input type="text" name="name" required /></label>
            <label>Email<input type="email" name="email" required /></label>
            <label>Password<input type="password" name="password" required minlength="4" /></label>
            <button type="submit">Register</button>
          </form>
          <form id="login-form" class="panel">
            <h2>Login</h2>
            <label>Email<input type="email" name="email" required /></label>
            <label>Password<input type="password" name="password" required /></label>
            <button type="submit">Login</button>
          </form>
        </div>
      </section>
    </main>
  `;
}

function renderAuthed() {
  const analytics = computeAnalytics(state.user.id);
  const profileName = state.user.name && state.user.name.trim() ? state.user.name : "No name yet";
  return `
    <main class="shell">
      <header class="topbar">
        <div>
          <h1>Gym Tracker</h1>
          <p>${escapeHtml(profileName)} (${escapeHtml(state.user.email)})</p>
          ${renderThemePicker()}
        </div>
        <button id="logout-btn" class="ghost">Logout</button>
      </header>
      <nav class="tabs">
        ${tab("dashboard", "Dashboard")}
        ${tab("streak", "Streak")}
        ${tab("muscles", "Muscle Groups")}
      </nav>
      <section class="content">${renderView(analytics)}</section>
    </main>
  `;
}

function tab(id, label) {
  return `<button class="tab ${state.currentView === id ? "active" : ""}" data-tab="${id}">${label}</button>`;
}

function renderView(analytics) {
  if (state.currentView === "dashboard") return renderDashboard(analytics);
  if (state.currentView === "workout") return renderWorkout();
  if (state.currentView === "streak") return renderStreak(analytics);
  return renderMuscles();
}

function metric(label, value) {
  return `<article class="metric"><h3>${label}</h3><p>${value}</p></article>`;
}

function renderDashboard(analytics) {
  const top = topPair(analytics.weekMuscles);
  const sharePayload = getSharePayload(analytics, top);
  return `
    <div class="metrics">
      ${metric("Current Streak", `${analytics.currentStreak} gym days`)}
      ${metric("Longest Streak", `${analytics.longestStreak} gym days`)}
      ${metric("Gym Days This Week", analytics.weekGymDays)}
      ${metric("Gym Days This Month", analytics.monthGymDays)}
    </div>
    <div class="panel">
      <h2>Streak Game</h2>
      <div class="game-grid">
        <div class="game-stat"><strong>XP</strong><span>${analytics.xp}</span></div>
        <div class="game-stat"><strong>Level</strong><span>${analytics.level}</span></div>
        <div class="game-stat"><strong>Weekly Streak</strong><span>${analytics.weeklyStreak}</span></div>
      </div>
      <p>${analytics.xpIntoLevel}/100 XP to next level</p>
      <div class="xp-track"><div class="xp-fill" style="width:${analytics.xpIntoLevel}%"></div></div>
      <p>Rule: +10 XP per gym day. Weekly streak counts active weeks from Monday to Sunday.</p>
    </div>
    <div class="dashboard-row">
      <div class="panel">
        <h2>Most Trained This Week</h2>
        <p>${top ? `${top[0]} (${top[1]} times)` : "No workouts yet"}</p>
        <button id="go-workout" class="cta-add-workout">+ Add Workout</button>
      </div>
      <div class="panel">
        <h2>Recent Sessions</h2>
        ${renderSessions(analytics.sessions.slice(0, 6))}
      </div>
    </div>
    <div class="panel">
      <h2>Monthly Gym Calendar</h2>
      ${renderMonthlyCalendar(analytics.sessions)}
    </div>
    <div class="panel">
      <h2>Share This Week</h2>
      ${renderShareCard(sharePayload)}
      <div class="inline-actions">
        <button id="copy-share-summary">Copy Summary</button>
        <button id="download-share-card" class="cta-add-workout">Download Card</button>
      </div>
    </div>
    <div class="panel">
      <h2>Profile</h2>
      <form id="profile-form">
        <label>Name<input type="text" name="name" value="${escapeHtml(state.user.name || "")}" required /></label>
        <button type="submit">Save Name</button>
      </form>
    </div>
  `;
}

function getSharePayload(analytics, topMuscle) {
  const displayName = state.user?.name?.trim() ? state.user.name.trim() : state.user?.email || "Gym User";
  return {
    name: displayName,
    weeklyStreak: analytics.weeklyStreak,
    currentStreak: analytics.currentStreak,
    weekGymDays: analytics.weekGymDays,
    topMuscle: topMuscle ? `${topMuscle[0]} (${topMuscle[1]}x)` : "No workouts yet",
    level: analytics.level,
    xp: analytics.xp,
    xpIntoLevel: analytics.xpIntoLevel,
  };
}

function renderShareCard(payload) {
  return `
    <article class="share-card" id="share-card">
      <h3>${escapeHtml(payload.name)} - Weekly Gym Update</h3>
      <div class="share-grid">
        <div><strong>Current Streak</strong><span>${payload.currentStreak} days</span></div>
        <div><strong>Weekly Streak</strong><span>${payload.weeklyStreak} weeks</span></div>
        <div><strong>Gym Days</strong><span>${payload.weekGymDays} this week</span></div>
        <div><strong>Top Muscle</strong><span>${escapeHtml(payload.topMuscle)}</span></div>
        <div><strong>Level</strong><span>${payload.level}</span></div>
        <div><strong>XP</strong><span>${payload.xp} total (${payload.xpIntoLevel}/100)</span></div>
      </div>
    </article>
  `;
}

function renderMonthlyCalendar(sessions) {
  const today = parseIso(todayIso());
  const year = today.getFullYear();
  const month = today.getMonth();
  const monthName = today.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const totalDays = new Date(year, month + 1, 0).getDate();
  const gymDates = new Set(
    sessions
      .filter((s) => {
        const d = parseIso(s.date);
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .map((s) => Number(s.date.slice(8, 10)))
  );

  const dayCells = [];
  for (let day = 1; day <= totalDays; day += 1) {
    const isGym = gymDates.has(day);
    dayCells.push(`
      <div class="calendar-day ${isGym ? "gym-day" : "rest-day"}">
        <strong>${day}</strong>
        <span>${isGym ? "Gym" : "Rest"}</span>
      </div>
    `);
  }

  return `
    <p>${monthName}</p>
    <div class="calendar-grid">
      ${dayCells.join("")}
    </div>
  `;
}

function renderSessions(sessions) {
  if (!sessions.length) return "<p>No session submitted yet.</p>";
  return sessions
    .map(
      (s) => `
      <div class="list-item">
        <strong>${formatDate(s.date)}</strong>
        <span>${s.muscleGroupsSnapshot.join(", ")}</span>
        <span>${s.lifts.length} lifts</span>
      </div>
    `
    )
    .join("");
}

function ensureWorkoutState() {
  if (!state.workoutDraft) {
    state.workoutDraft = { date: todayIso(), muscleGroupsSnapshot: [], lifts: [] };
  }
  if (!state.liftBuilder) {
    state.liftBuilder = { liftName: "", setsCount: 1, unit: "kg", currentSet: 1, sets: [] };
  }
}

function renderWorkout() {
  ensureWorkoutState();
  const muscles = getAllMuscles(state.user.id);
  const draft = state.workoutDraft;
  const builder = state.liftBuilder;
  return `
    <div class="panel">
      <button id="back-dashboard" class="ghost">Back</button>
    </div>
    <form id="muscle-select-form" class="panel">
      <h2>Workout Tracker</h2>
      <p><strong>Date:</strong> ${formatDate(draft.date)}</p>
      <p>What muscle group do you want to train?</p>
      <div class="muscle-card-grid">
        ${muscles
          .map(
            (m, i) => `
          <label class="muscle-card" for="muscle_${i}">
            <input id="muscle_${i}" type="checkbox" name="muscles" value="${escapeHtml(m)}" ${draft.muscleGroupsSnapshot.includes(m) ? "checked" : ""} />
            <span class="muscle-card-body">${escapeHtml(m)}</span>
          </label>
        `
          )
          .join("")}
      </div>
      <button type="submit">Save Muscle Groups</button>
    </form>
    ${
      draft.muscleGroupsSnapshot.length
        ? `
      <form id="lift-config-form" class="panel">
        <h2>Lift Setup</h2>
        <label>Name of lifts<input type="text" name="liftName" value="${escapeHtml(builder.liftName)}" required /></label>
        <label>How many set<input type="number" name="setsCount" min="1" max="12" value="${builder.setsCount}" required /></label>
        <label>Weight unit
          <select name="unit">
            <option value="kg" ${builder.unit === "kg" ? "selected" : ""}>kg</option>
            <option value="lbs" ${builder.unit === "lbs" ? "selected" : ""}>lbs</option>
          </select>
        </label>
        <button type="submit">Start Set Input</button>
      </form>
      ${
        builder.liftName
          ? `
        <form id="set-form" class="panel">
          <h2>Set ${builder.currentSet} of ${builder.setsCount}</h2>
          <label>rep<input type="number" name="reps" min="0" required /></label>
          <label>weight (${builder.unit})<input type="number" name="weight" min="0" step="0.1" required /></label>
          <button type="submit">${builder.currentSet === builder.setsCount ? "Submit" : "Next"}</button>
        </form>
      `
          : ""
      }
      <div class="panel">
        <h2>Current Session Lifts</h2>
        ${draft.lifts.length ? renderDraftLifts(draft.lifts) : "<p>No lift added yet.</p>"}
        <button id="submit-session" ${draft.lifts.length ? "" : "disabled"}>Submit Workout Session</button>
      </div>
    `
        : ""
    }
    <div class="panel">
      <h2>Submitted Workouts</h2>
      ${renderSubmittedSessions()}
    </div>
    ${renderEditSessionPanel()}
  `;
}

function renderDraftLifts(lifts) {
  return lifts
    .map(
      (lift) => `
      <div class="list-item">
        <strong>${escapeHtml(lift.name)} (${lift.unit})</strong>
        <span>${lift.sets.length} sets</span>
        <span>${lift.sets.map((s) => `S${s.setNumber}: ${s.reps} reps @ ${s.weight}`).join(" | ")}</span>
      </div>
    `
    )
    .join("");
}

function renderFocus(sessions) {
  const today = parseIso(todayIso());
  const start = weekStartMonday(today);
  const weekRows = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
    const daySessions = sessions.filter((s) => s.date === iso);
    const muscles = [...new Set(daySessions.flatMap((s) => s.muscleGroupsSnapshot))];
    weekRows.push({ iso, muscles });
  }
  const monthly = {};
  sessions.forEach((s) => {
    const d = parseIso(s.date);
    if (d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()) {
      if (!monthly[s.date]) monthly[s.date] = new Set();
      s.muscleGroupsSnapshot.forEach((m) => monthly[s.date].add(m));
    }
  });
  return `
    <div class="panel">
      <h2>Weekly Calendar (Monday Start)</h2>
      ${weekRows
        .map(
          (r) => `
        <div class="list-item">
          <strong>${formatDate(r.iso)}</strong>
          <span class="${r.muscles.length ? "focus-trained" : ""}">${r.muscles.length ? r.muscles.join(", ") : "Rest day"}</span>
        </div>
      `
        )
        .join("")}
    </div>
    <div class="panel">
      <h2>Monthly Calendar Entries</h2>
      ${
        Object.keys(monthly).length
          ? Object.entries(monthly)
              .sort((a, b) => (a[0] < b[0] ? 1 : -1))
              .map(
                ([date, muscles]) => `
              <div class="list-item">
                <strong>${formatDate(date)}</strong>
                <span class="focus-trained">${[...muscles].join(", ")}</span>
              </div>
            `
              )
              .join("")
          : "<p>No entries this month.</p>"
      }
    </div>
  `;
}

function renderStreak(analytics) {
  return `
    <div class="metrics">
      ${metric("Current Streak", `${analytics.currentStreak} gym days`)}
      ${metric("Longest Streak", `${analytics.longestStreak} gym days`)}
      ${metric("Gym Days This Week", analytics.weekGymDays)}
      ${metric("Gym Days This Month", analytics.monthGymDays)}
    </div>
    <div class="panel"><h2>Weekly Muscle Summary</h2>${renderSummary(analytics.weekMuscles)}</div>
    <div class="panel"><h2>Monthly Muscle Summary</h2>${renderSummary(analytics.monthMuscles)}</div>
    <div class="panel"><h2>Streak Rule</h2><p>Rest days are allowed. Streak ends if you go 7 consecutive days with no workout submitted.</p></div>
  `;
}

function renderSummary(mapObj) {
  const rows = Object.entries(mapObj).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return "<p>No data yet.</p>";
  return rows
    .map(
      ([name, count]) => `
      <div class="list-item">
        <strong>${escapeHtml(name)}</strong>
        <span>${count} time${count > 1 ? "s" : ""}</span>
      </div>
    `
    )
    .join("");
}

function renderMuscles() {
  const muscles = getUserMuscles(state.user.id);
  return `
    <div class="muscle-management-grid">
      <div class="panel">
        <h2>Primary Muscle</h2>
        ${muscles.primary
          .map(
            (m, i) => `
          <div class="list-item">
            <strong>${escapeHtml(m)}</strong>
            <div class="inline-actions">
              <button class="danger" data-remove-default="primary:${i}">Remove</button>
            </div>
          </div>
        `
          )
          .join("")}
        ${
          muscles.customPrimary.length
            ? muscles.customPrimary
                .map(
                  (m, i) => `
              <div class="list-item">
                <strong>${escapeHtml(m)}</strong>
                <div class="inline-actions">
                  <button class="danger" data-remove-custom="primary:${i}">Remove</button>
                </div>
              </div>
            `
                )
                .join("")
            : ""
        }
      </div>
      <div class="panel">
        <h2>Secondary Muscle</h2>
        ${muscles.secondary
          .map(
            (m, i) => `
          <div class="list-item">
            <strong>${escapeHtml(m)}</strong>
            <div class="inline-actions">
              <button class="danger" data-remove-default="secondary:${i}">Remove</button>
            </div>
          </div>
        `
          )
          .join("")}
        ${
          muscles.customSecondary.length
            ? muscles.customSecondary
                .map(
                  (m, i) => `
              <div class="list-item">
                <strong>${escapeHtml(m)}</strong>
                <div class="inline-actions">
                  <button class="danger" data-remove-custom="secondary:${i}">Remove</button>
                </div>
              </div>
            `
                )
                .join("")
            : ""
        }
      </div>
    </div>
    <form id="muscle-add-form" class="panel">
      <h2>Add Muscle Group</h2>
      <label>Muscle name<input type="text" name="muscleName" required /></label>
      <label>Category
        <select name="muscleCategory" required>
          <option value="primary">Primary</option>
          <option value="secondary">Secondary</option>
        </select>
      </label>
      <button type="submit">Add Muscle Group</button>
    </form>
  `;
}

function renderSubmittedSessions() {
  const sessions = getUserSessions(state.user.id);
  if (!sessions.length) return "<p>No submitted workouts yet.</p>";
  return sessions
    .slice(0, 12)
    .map(
      (s) => `
      <div class="list-item">
        <strong>${formatDate(s.date)}</strong>
        <span>${s.muscleGroupsSnapshot.join(", ")}</span>
        <span>${s.lifts.length} lifts</span>
        <button data-edit-session="${s.id}">Edit Workout</button>
      </div>
    `
    )
    .join("");
}

function renderEditSessionPanel() {
  if (!state.editingSessionId) return "";
  const session = state.store.sessions.find((s) => s.id === state.editingSessionId && s.userId === state.user.id);
  if (!session) return "";
  const muscles = getAllMuscles(state.user.id);
  return `
    <form id="edit-session-form" class="panel">
      <h2>Edit Submitted Workout</h2>
      <p><strong>Date:</strong> ${formatDate(session.date)}</p>
      <p>Muscle Groups</p>
      <div class="muscle-card-grid">
        ${muscles
          .map(
            (m, i) => `
          <label class="muscle-card" for="edit_muscle_${i}">
            <input id="edit_muscle_${i}" type="checkbox" name="muscles" value="${escapeHtml(m)}" ${session.muscleGroupsSnapshot.includes(m) ? "checked" : ""} />
            <span class="muscle-card-body">${escapeHtml(m)}</span>
          </label>
        `
          )
          .join("")}
      </div>
      <div class="inline-actions">
        <button type="submit">Save Edit</button>
        <button type="button" id="cancel-edit-session" class="ghost">Cancel</button>
      </div>
    </form>
  `;
}

function bindEvents() {
  const registerForm = document.getElementById("register-form");
  if (registerForm) {
    registerForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = e.target.email.value.trim().toLowerCase();
      const name = e.target.name ? e.target.name.value.trim() : "";
      const password = e.target.password.value;
      if (state.store.users.some((u) => u.email === email)) return alert("Email already registered.");
      const user = { id: uid("user"), name, email, password };
      state.store.users.push(user);
      state.store.musclesByUser[user.id] = {
        primary: [...DEFAULT_PRIMARY],
        secondary: [...DEFAULT_SECONDARY],
        customPrimary: [],
        customSecondary: [],
      };
      saveStore();
      e.target.reset();
      alert("Registration success. Please login.");
    });
  }

  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = e.target.email.value.trim().toLowerCase();
      const password = e.target.password.value;
      const user = state.store.users.find((u) => u.email === email && u.password === password);
      if (!user) return alert("Invalid email or password.");
      state.user = user;
      state.currentView = "dashboard";
      state.workoutDraft = null;
      state.liftBuilder = null;
      state.editingSessionId = null;
      render();
    });
  }

  const logout = document.getElementById("logout-btn");
  if (logout) {
    logout.addEventListener("click", () => {
      state.user = null;
      state.currentView = "dashboard";
      state.workoutDraft = null;
      state.liftBuilder = null;
      state.editingSessionId = null;
      render();
    });
  }

  document.querySelectorAll("[data-tab]").forEach((t) => {
    t.addEventListener("click", () => {
      state.currentView = t.dataset.tab;
      render();
    });
  });

  const goWorkout = document.getElementById("go-workout");
  if (goWorkout) {
    goWorkout.addEventListener("click", () => {
      state.currentView = "workout";
      render();
    });
  }
  const backDashboard = document.getElementById("back-dashboard");
  if (backDashboard) {
    backDashboard.addEventListener("click", () => {
      state.currentView = "dashboard";
      render();
    });
  }

  const muscleSelectForm = document.getElementById("muscle-select-form");
  if (muscleSelectForm) {
    muscleSelectForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const selected = [...e.target.querySelectorAll('input[name="muscles"]:checked')].map((o) => o.value);
      if (!selected.length) return alert("Select at least one muscle group.");
      state.workoutDraft.muscleGroupsSnapshot = selected;
      render();
    });
  }

  const liftConfigForm = document.getElementById("lift-config-form");
  if (liftConfigForm) {
    liftConfigForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const liftName = e.target.liftName.value.trim();
      const setsCount = Number(e.target.setsCount.value);
      const unit = e.target.unit.value;
      if (!liftName || setsCount < 1) return;
      state.liftBuilder = { liftName, setsCount, unit, currentSet: 1, sets: [] };
      render();
    });
  }

  const setForm = document.getElementById("set-form");
  if (setForm) {
    setForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const reps = Number(e.target.reps.value);
      const weight = Number(e.target.weight.value);
      if (!Number.isFinite(reps) || !Number.isFinite(weight) || reps < 0 || weight < 0) {
        return alert("Please enter valid reps and weight.");
      }
      const b = state.liftBuilder;
      b.sets.push({ setNumber: b.currentSet, reps, weight });
      if (b.currentSet === b.setsCount) {
        state.workoutDraft.lifts.push({ id: uid("lift"), name: b.liftName, unit: b.unit, sets: b.sets });
        state.liftBuilder = { liftName: "", setsCount: 1, unit: "kg", currentSet: 1, sets: [] };
      } else {
        b.currentSet += 1;
      }
      render();
    });
  }

  const submitSession = document.getElementById("submit-session");
  if (submitSession) {
    submitSession.addEventListener("click", () => {
      if (!state.workoutDraft.lifts.length) return;
      state.store.sessions.push({
        id: uid("session"),
        userId: state.user.id,
        date: state.workoutDraft.date,
        muscleGroupsSnapshot: state.workoutDraft.muscleGroupsSnapshot,
        lifts: state.workoutDraft.lifts,
        createdAt: new Date().toISOString(),
      });
      saveStore();
      state.workoutDraft = null;
      state.liftBuilder = null;
      state.editingSessionId = null;
      state.currentView = "dashboard";
      alert("Workout session submitted.");
      render();
    });
  }

  const profileForm = document.getElementById("profile-form");
  if (profileForm) {
    profileForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = e.target.name.value.trim();
      const userIndex = state.store.users.findIndex((u) => u.id === state.user.id);
      if (userIndex === -1) return;
      state.store.users[userIndex].name = name;
      state.user = state.store.users[userIndex];
      saveStore();
      alert("Profile name updated.");
      render();
    });
  }

  const copyShareSummary = document.getElementById("copy-share-summary");
  if (copyShareSummary) {
    copyShareSummary.addEventListener("click", async () => {
      const analytics = computeAnalytics(state.user.id);
      const top = topPair(analytics.weekMuscles);
      const payload = getSharePayload(analytics, top);
      const summary = [
        `${payload.name} - Weekly Gym Update`,
        `Current Streak: ${payload.currentStreak} days`,
        `Weekly Streak: ${payload.weeklyStreak} weeks`,
        `Gym Days This Week: ${payload.weekGymDays}`,
        `Top Muscle: ${payload.topMuscle}`,
        `Level: ${payload.level}`,
        `XP: ${payload.xp} (${payload.xpIntoLevel}/100 to next level)`,
      ].join("\n");
      try {
        await navigator.clipboard.writeText(summary);
        alert("Summary copied.");
      } catch {
        alert("Clipboard blocked by browser. Please copy manually.");
      }
    });
  }

  const downloadShareCard = document.getElementById("download-share-card");
  if (downloadShareCard) {
    downloadShareCard.addEventListener("click", () => {
      const analytics = computeAnalytics(state.user.id);
      const top = topPair(analytics.weekMuscles);
      const payload = getSharePayload(analytics, top);
      downloadShareImage(payload);
    });
  }

  const muscleAddForm = document.getElementById("muscle-add-form");
  if (muscleAddForm) {
    muscleAddForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = e.target.muscleName.value.trim();
      const category = e.target.muscleCategory.value;
      if (!name) return;
      const muscles = getUserMuscles(state.user.id);
      const all = [...muscles.primary, ...muscles.secondary, ...muscles.customPrimary, ...muscles.customSecondary];
      if (all.some((m) => m.toLowerCase() === name.toLowerCase())) return alert("Muscle group already exists.");
      if (category === "primary") muscles.customPrimary.push(name);
      if (category === "secondary") muscles.customSecondary.push(name);
      setUserMuscles(state.user.id, muscles);
      e.target.reset();
      render();
    });
  }
  document.querySelectorAll("[data-remove-custom]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const payload = btn.dataset.removeCustom || "";
      const [type, idxText] = payload.split(":");
      const idx = Number(idxText);
      const muscles = getUserMuscles(state.user.id);
      if (type === "primary") muscles.customPrimary.splice(idx, 1);
      if (type === "secondary") muscles.customSecondary.splice(idx, 1);
      setUserMuscles(state.user.id, muscles);
      render();
    });
  });

  document.querySelectorAll("[data-remove-default]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const payload = btn.dataset.removeDefault || "";
      const [type, idxText] = payload.split(":");
      const idx = Number(idxText);
      const muscles = getUserMuscles(state.user.id);
      if (type === "primary") muscles.primary.splice(idx, 1);
      if (type === "secondary") muscles.secondary.splice(idx, 1);
      setUserMuscles(state.user.id, muscles);
      render();
    });
  });

  document.querySelectorAll(".theme-dot[data-theme]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.theme;
      if (!next) return;
      state.theme = next;
      localStorage.setItem(THEME_KEY, next);
      render();
    });
  });

  document.querySelectorAll("[data-edit-session]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.editingSessionId = btn.dataset.editSession;
      render();
    });
  });

  const cancelEditSession = document.getElementById("cancel-edit-session");
  if (cancelEditSession) {
    cancelEditSession.addEventListener("click", () => {
      state.editingSessionId = null;
      render();
    });
  }

  const editSessionForm = document.getElementById("edit-session-form");
  if (editSessionForm) {
    editSessionForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const selected = [...e.target.querySelectorAll('input[name="muscles"]:checked')].map((i) => i.value);
      if (!selected.length) return alert("Select at least one muscle group.");
      const idx = state.store.sessions.findIndex((s) => s.id === state.editingSessionId && s.userId === state.user.id);
      if (idx === -1) return;
      state.store.sessions[idx].muscleGroupsSnapshot = selected;
      saveStore();
      state.editingSessionId = null;
      alert("Muscle groups updated.");
      render();
    });
  }
}

function downloadShareImage(payload) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 628;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#1a1d20";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f3a530";
  ctx.fillRect(0, 0, canvas.width, 16);

  ctx.fillStyle = "#f2f3f5";
  ctx.font = "700 48px Arial";
  ctx.fillText("Weekly Gym Update", 60, 90);
  ctx.font = "600 34px Arial";
  ctx.fillText(payload.name, 60, 140);

  const rows = [
    `Current Streak: ${payload.currentStreak} days`,
    `Weekly Streak: ${payload.weeklyStreak} weeks`,
    `Gym Days This Week: ${payload.weekGymDays}`,
    `Top Muscle: ${payload.topMuscle}`,
    `Level: ${payload.level}`,
    `XP: ${payload.xp} (${payload.xpIntoLevel}/100 to next level)`,
  ];

  ctx.font = "500 32px Arial";
  ctx.fillStyle = "#e8edf1";
  rows.forEach((row, i) => {
    ctx.fillText(row, 60, 220 + i * 62);
  });

  ctx.fillStyle = "#a8afb7";
  ctx.font = "500 24px Arial";
  ctx.fillText("Generated from Gym Tracker", 60, 588);

  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = "gym-weekly-share-card.png";
  link.click();
}
