const STORAGE_KEY = "gym_tracker_v1";
const THEME_KEY = "gym_tracker_theme_v1";
const DEFAULT_MUSCLES = ["Chest", "Back", "Legs", "Shoulders", "Biceps", "Triceps", "Core"];

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
    state.store.musclesByUser[userId] = [...DEFAULT_MUSCLES];
    saveStore();
  }
  return state.store.musclesByUser[userId];
}

function setUserMuscles(userId, muscles) {
  state.store.musclesByUser[userId] = muscles;
  saveStore();
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

  return {
    sessions,
    ...computeStreak(uniqueDates),
    weekGymDays: weekDays.size,
    monthGymDays: monthDays.size,
    weekMuscles,
    monthMuscles,
  };
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
    <div class="theme-picker" role="group" aria-label="Theme picker">
      <button type="button" class="theme-dot ${state.theme === "dark" ? "active" : ""}" data-theme="dark" title="Current dark-grey"></button>
      <button type="button" class="theme-dot pastel ${state.theme === "pastel" ? "active" : ""}" data-theme="pastel" title="Pastel pink"></button>
      <button type="button" class="theme-dot royal ${state.theme === "royal" ? "active" : ""}" data-theme="royal" title="Purple and brown"></button>
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
        <div><h1>Gym Tracker</h1><p>${escapeHtml(profileName)} (${escapeHtml(state.user.email)})</p></div>
        ${renderThemePicker()}
        <button id="logout-btn" class="ghost">Logout</button>
      </header>
      <nav class="tabs">
        ${tab("dashboard", "Dashboard")}
        ${tab("workout", "Add Workout")}
        ${tab("focus", "Body Focus")}
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
  if (state.currentView === "focus") return renderFocus(analytics.sessions);
  if (state.currentView === "streak") return renderStreak(analytics);
  return renderMuscles();
}

function metric(label, value) {
  return `<article class="metric"><h3>${label}</h3><p>${value}</p></article>`;
}

function renderDashboard(analytics) {
  const top = topPair(analytics.weekMuscles);
  return `
    <div class="metrics">
      ${metric("Current Streak", `${analytics.currentStreak} gym days`)}
      ${metric("Longest Streak", `${analytics.longestStreak} gym days`)}
      ${metric("Gym Days This Week", analytics.weekGymDays)}
      ${metric("Gym Days This Month", analytics.monthGymDays)}
    </div>
    <div class="panel">
      <h2>Most Trained This Week</h2>
      <p>${top ? `${top[0]} (${top[1]} times)` : "No workouts yet"}</p>
      <button id="go-workout">Add Workout</button>
    </div>
    <div class="panel">
      <h2>Recent Sessions</h2>
      ${renderSessions(analytics.sessions.slice(0, 6))}
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
  const muscles = getUserMuscles(state.user.id);
  const draft = state.workoutDraft;
  const builder = state.liftBuilder;
  return `
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
    <form id="muscle-add-form" class="panel">
      <h2>Muscle Group Management</h2>
      <label>Add muscle group<input type="text" name="muscleName" required /></label>
      <button type="submit">Add Muscle Group</button>
    </form>
    <div class="panel">
      <h2>Your Muscle Groups</h2>
      ${
        muscles.length
          ? muscles
              .map(
                (m, i) => `
          <div class="list-item">
            <strong>${escapeHtml(m)}</strong>
            <div class="inline-actions">
              <button class="ghost" data-rename-index="${i}">Rename</button>
              <button class="danger" data-remove-index="${i}">Remove</button>
            </div>
          </div>
        `
              )
              .join("")
          : "<p>No muscle groups yet.</p>"
      }
    </div>
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
  const muscles = getUserMuscles(state.user.id);
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
      state.store.musclesByUser[user.id] = [...DEFAULT_MUSCLES];
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

  const muscleAddForm = document.getElementById("muscle-add-form");
  if (muscleAddForm) {
    muscleAddForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = e.target.muscleName.value.trim();
      if (!name) return;
      const muscles = getUserMuscles(state.user.id);
      if (muscles.some((m) => m.toLowerCase() === name.toLowerCase())) return alert("Muscle group already exists.");
      muscles.push(name);
      setUserMuscles(state.user.id, muscles);
      e.target.reset();
      render();
    });
  }

  document.querySelectorAll("[data-remove-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.removeIndex);
      const muscles = [...getUserMuscles(state.user.id)];
      muscles.splice(idx, 1);
      setUserMuscles(state.user.id, muscles);
      render();
    });
  });

  document.querySelectorAll("[data-rename-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.renameIndex);
      const muscles = [...getUserMuscles(state.user.id)];
      const next = prompt("New muscle group name:", muscles[idx]);
      if (!next) return;
      muscles[idx] = next.trim();
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
