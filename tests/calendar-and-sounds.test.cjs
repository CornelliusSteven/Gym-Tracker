const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

// Run the actual app functions without starting Supabase or touching user data.
const source = readFileSync(path.join(__dirname, "..", "script.js"), "utf8")
  .replace(/^import .*;\r?\n/, "")
  .replace("await init();", "");
const styles = readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

function harness({ storedSound, storageBlocked = false, createdAt = "2024-01-15T12:00:00+07:00" } = {}) {
  let clock = 1000;
  const storage = new Map(storedSound ? [["gymboard_button_sounds_v1", storedSound]] : []);
  const listeners = [];
  const elements = new Map();
  const audioContexts = [];
  const tones = [];
  const gains = [];
  const focused = [];
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [2026, 8, 1, 12])); }
  }
  class TestAudioContext {
    constructor() { this.state = "running"; this.currentTime = 1; this.destination = {}; audioContexts.push(this); }
    async resume() { this.state = "running"; }
    createOscillator() {
      const tone = {
        frequency: {
          values: [],
          setValueAtTime(value, at) { this.values.push({ method: "set", value, at }); },
          exponentialRampToValueAtTime(value, at) { this.values.push({ method: "ramp", value, at }); },
        },
        connect() {}, disconnect() { this.disconnected = true; },
        start(at) { this.started = at; }, stop(at) { this.stopped = at; },
      };
      tones.push(tone);
      return tone;
    }
    createGain() {
      const gain = {
        gain: {
          values: [],
          setValueAtTime(value, at) { this.values.push({ method: "set", value, at }); },
          linearRampToValueAtTime(value, at) { this.values.push({ method: "linear", value, at }); },
          exponentialRampToValueAtTime(value, at) { this.values.push({ method: "exponential", value, at }); },
        },
        connect() {}, disconnect() { this.disconnected = true; },
      };
      gains.push(gain);
      return gain;
    }
  }
  const document = {
    visibilityState: "visible",
    addEventListener: (...args) => listeners.push(args),
    getElementById: (id) => elements.get(id) || null,
    querySelectorAll: () => [],
  };
  const context = vm.createContext({
    Date: TestDate, document, window: { AudioContext: TestAudioContext },
    performance: { now: () => clock },
    localStorage: {
      getItem(key) { if (storageBlocked && key !== "gym_tracker_theme_v1") throw Error("Storage unavailable"); return storage.get(key) ?? null; },
      setItem(key, value) { if (storageBlocked) throw Error("Storage unavailable"); storage.set(key, value); },
    },
  });
  vm.runInContext(source, context);
  const state = vm.runInContext("state", context);
  state.authUser = { created_at: createdAt };
  state.muscles = [{ name: "Chest", category: "primary" }, { name: "Back", category: "primary" }];
  function element(id) {
    return {
      id, events: {}, dataset: {}, disabled: false,
      addEventListener(type, handler) { this.events[type] = handler; },
      focus() { focused.push(id); },
    };
  }
  function mountCalendar() {
    const calendar = {
      set innerHTML(html) {
        this.html = html;
        for (const id of ["calendar-month-select", "calendar-year-select", "calendar-previous", "calendar-next", "calendar-current"]) {
          const control = element(id);
          control.disabled = new RegExp(`<button id="${id}"[^>]*\\sdisabled`).test(html);
          elements.set(id, control);
        }
        this.days = [...html.matchAll(/data-calendar-date="([^"]+)"/g)].map((match) => {
          const day = element(match[1]);
          day.dataset.calendarDate = match[1];
          return day;
        });
      },
      querySelector: (selector) => elements.get(selector.slice(1)),
      querySelectorAll() { return this.days; },
    };
    elements.set("monthly-calendar", calendar);
    calendar.innerHTML = context.renderMonthlyCalendar(state.sessions);
    context.bindCalendarEvents();
    return calendar;
  }
  return { context, state, storage, document, listeners, elements, audioContexts, tones, gains, focused, mountCalendar,
    advance: (ms = 100) => { clock += ms; },
    fire(id, type, value) { const target = elements.get(id); target.value = value; target.events[type]({ target }); },
  };
}

test("calendar defaults to current month and disables forward navigation", () => {
  const { context } = harness();
  const html = context.renderMonthlyCalendar([]);
  assert.equal((html.match(/data-calendar-date=/g) || []).length, 30);
  assert.match(html, /data-calendar-date="2026-09-01"/);
  assert.match(html, /aria-current="date"/);
  assert.match(html, /id="calendar-next"[^>]* disabled/);
  assert.doesNotMatch(html, /<option value="9"/);
});

test("calendar uses selected month, handles leap years, and keeps Rest labels", () => {
  const { context, state } = harness();
  for (const [month, days] of [["2024-02", 29], ["2025-02", 28], ["2025-12", 31]]) {
    state.calendarMonth = month;
    const html = context.renderMonthlyCalendar([]);
    assert.equal((html.match(/data-calendar-date=/g) || []).length, days);
    assert.equal((html.match(/<span>Rest<\/span>/g) || []).length, days);
    assert.match(html, new RegExp(`data-calendar-date="${month}-${days}"`));
  }
});

test("calendar counts unique gym dates only in the selected month and preserves muscle labels", () => {
  const { context, state } = harness();
  state.calendarMonth = "2026-08";
  const html = context.renderMonthlyCalendar([
    { date: "2026-08-05", lifts: [{ muscleGroup: "Chest" }] },
    { date: "2026-08-05", lifts: [{ muscleGroup: "Back" }] },
    { date: "2026-08-06", muscleGroupsSnapshot: ["Chest"], lifts: [] },
    { date: "2026-09-01", lifts: [{ muscleGroup: "Chest" }] },
  ]);
  assert.match(html, /2 gym days/);
  assert.match(html, /Chest, Back/);
  assert.doesNotMatch(html, /data-calendar-date="2026-09/);
});

test("year choices start at account creation, not the earliest workout or selected month", () => {
  const { context, state } = harness();
  state.sessions = [{ date: "2010-03-01" }];
  state.calendarMonth = "2009-01";
  assert.deepEqual(Array.from(context.getCalendarYears()), [2026, 2025, 2024]);
  assert.equal(context.toIso(context.getCalendarMonth()), "2024-01-01");
});

test("August 2026 signup only allows August through the current month", () => {
  const h = harness({ createdAt: "2026-08-15T12:00:00+07:00" });
  const calendar = h.mountCalendar();
  assert.deepEqual(Array.from(h.context.getCalendarYears()), [2026]);
  const monthSelect = calendar.html.match(/<select id="calendar-month-select">([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...monthSelect.matchAll(/value="(\d+)"/g)].map((match) => Number(match[1])), [7, 8]);
  h.fire("calendar-previous", "click");
  assert.equal(h.state.calendarMonth, "2026-08");
  assert.equal(h.elements.get("calendar-previous").disabled, true);
  assert.equal(h.focused.at(-1), "calendar-month-select");
  h.fire("calendar-previous", "click");
  assert.equal(h.state.calendarMonth, "2026-08");
  h.fire("calendar-month-select", "change", "0");
  assert.equal(h.state.calendarMonth, "2026-08");
});

test("selecting the signup year clamps early months without changing the default current month", () => {
  const h = harness({ createdAt: "2025-08-20T12:00:00+07:00" });
  assert.equal(h.context.toIso(h.context.getCalendarMonth()), "2026-09-01");
  h.state.calendarMonth = "2026-02";
  const calendar = h.mountCalendar();
  h.fire("calendar-year-select", "change", "2025");
  assert.equal(h.state.calendarMonth, "2025-08");
  const months = calendar.html.match(/<select id="calendar-month-select">([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...months.matchAll(/value="(\d+)"/g)].map((match) => Number(match[1])), [7, 8, 9, 10, 11]);
});

test("new accounts have only this month and no previous or next navigation", () => {
  const h = harness({ createdAt: "2026-09-01T12:00:00+07:00" });
  h.mountCalendar();
  assert.equal(h.elements.get("calendar-previous").disabled, true);
  assert.equal(h.elements.get("calendar-next").disabled, true);
  assert.equal(h.elements.get("calendar-current").disabled, true);
});

test("signup bounds use local calendar time and prefer auth creation over the profile", () => {
  const localSignup = new Date(2026, 7, 1, 0, 15).toISOString();
  const h = harness({ createdAt: localSignup });
  h.state.profile = { created_at: "2026-09-01T12:00:00+07:00" };
  assert.equal(h.context.toIso(h.context.getCalendarBounds().start), "2026-08-01");
  h.state.authUser.created_at = "invalid";
  assert.equal(h.context.toIso(h.context.getCalendarBounds().start), "2026-09-01");
  h.state.profile = null;
  assert.equal(h.context.toIso(h.context.getCalendarBounds().start), "2026-09-01");
});

test("calendar navigation crosses years, changes selectors, returns to this month, and preserves drafts", () => {
  const h = harness();
  h.state.calendarMonth = "2026-01";
  h.state.workoutDraft = { date: "2026-09-01", lifts: [{ name: "Existing draft" }] };
  const draft = JSON.stringify(h.state.workoutDraft);
  const calendar = h.mountCalendar();
  h.fire("calendar-previous", "click");
  assert.equal(h.state.calendarMonth, "2025-12");
  h.fire("calendar-next", "click");
  assert.equal(h.state.calendarMonth, "2026-01");
  h.fire("calendar-year-select", "change", "2024");
  h.fire("calendar-month-select", "change", "1");
  assert.equal(h.state.calendarMonth, "2024-02");
  assert.match(calendar.html, /2024-02-29/);
  h.fire("calendar-current", "click");
  assert.equal(h.state.calendarMonth, "2026-09");
  assert.equal(h.focused.at(-1), "calendar-month-select");
  assert.equal(JSON.stringify(h.state.workoutDraft), draft);
});

test("choosing the current year from a later historical month clamps to this month", () => {
  const h = harness();
  h.state.calendarMonth = "2025-12";
  h.mountCalendar();
  h.fire("calendar-year-select", "change", "2026");
  assert.equal(h.state.calendarMonth, "2026-09");
  for (const invalid of ["2027-01", "2026-13", "bad"]) {
    h.state.calendarMonth = invalid;
    assert.equal(h.context.toIso(h.context.getCalendarMonth()), "2026-09-01");
  }
});

test("day detail opens for the selected historical date without losing its month", () => {
  const h = harness();
  h.state.calendarMonth = "2025-08";
  const calendar = h.mountCalendar();
  h.context.render = () => {};
  calendar.days[4].events.click();
  assert.equal(h.state.currentView, "calendarDay");
  assert.equal(h.state.selectedCalendarDate, "2025-08-05");
  assert.equal(h.state.calendarMonth, "2025-08");
  assert.match(h.context.renderCalendarDayPage(), /Rest day/);
  h.context.bindEvents();
  const html = h.context.renderMonthlyCalendar([]);
  assert.match(html, /selected-day[^>]*data-calendar-date="2025-08-05"/);
});

test("sound is enabled by default, remembers mute, and tolerates blocked storage", () => {
  const h = harness();
  assert.equal(h.state.buttonSoundsEnabled, true);
  assert.equal(h.audioContexts.length, 0);
  h.context.saveButtonSoundsPreference(false);
  assert.equal(h.storage.get("gymboard_button_sounds_v1"), "off");
  assert.equal(h.context.loadButtonSoundsPreference(), false);
  assert.equal(harness({ storedSound: "off" }).state.buttonSoundsEnabled, false);
  const blocked = harness({ storageBlocked: true });
  assert.doesNotThrow(() => blocked.context.saveButtonSoundsPreference(false));
  assert.equal(blocked.state.buttonSoundsEnabled, false);
});

test("sound uses a short, bright tek profile, reuses its context, cleans up, and mutes", async () => {
  const h = harness();
  await h.context.playButtonSound();
  await h.context.playButtonSound();
  assert.equal(h.tones.length, 1);
  assert.equal(h.tones[0].type, "triangle");
  assert.deepEqual(h.tones[0].frequency.values.map(({ method, value }) => [method, value]), [["set", 560], ["ramp", 328]]);
  assert.equal(h.gains[0].gain.values[1].value, 0.1224);
  assert.ok(h.tones[0].stopped - h.tones[0].started < 0.031);
  h.tones[0].onended();
  assert.equal(h.tones[0].disconnected, true);
  assert.equal(h.gains[0].disconnected, true);
  h.advance();
  await h.context.playButtonSound();
  assert.equal(h.tones.length, 2);
  assert.equal(h.audioContexts.length, 1);
  h.context.saveButtonSoundsPreference(false);
  h.advance();
  await h.context.playButtonSound();
  assert.equal(h.tones.length, 2);
});

test("sound resumes after backgrounding and fails silently for unavailable or blocked audio", async () => {
  const h = harness();
  await h.context.playButtonSound();
  h.audioContexts[0].state = "suspended";
  h.advance();
  await h.context.playButtonSound();
  assert.equal(h.audioContexts[0].state, "running");
  assert.equal(h.tones.length, 2);
  h.document.visibilityState = "hidden";
  h.advance();
  await h.context.playButtonSound();
  assert.equal(h.tones.length, 2);
  h.document.visibilityState = "visible";
  h.audioContexts[0].state = "suspended";
  h.audioContexts[0].resume = async () => { throw Error("Audio blocked"); };
  await assert.doesNotReject(() => h.context.playButtonSound());
  const unsupported = harness();
  unsupported.context.window.AudioContext = undefined;
  await assert.doesNotReject(() => unsupported.context.playButtonSound());
  assert.equal(unsupported.tones.length, 0);
});

test("sound ignores delayed resume and rechecks mute before playing", async () => {
  const h = harness();
  await h.context.playButtonSound();
  h.advance();
  h.audioContexts[0].state = "suspended";
  h.audioContexts[0].resume = async function () { h.advance(250); this.state = "running"; };
  await h.context.playButtonSound();
  assert.equal(h.tones.length, 1);
  h.advance();
  h.audioContexts[0].state = "suspended";
  h.audioContexts[0].resume = async function () { h.state.buttonSoundsEnabled = false; this.state = "running"; };
  await h.context.playButtonSound();
  assert.equal(h.tones.length, 1);
});

test("one delegated listener covers buttons and muscle inputs without sounding for disabled or scripted clicks", () => {
  const h = harness();
  let played = 0;
  h.context.playButtonSound = () => { played += 1; };
  h.context.registerButtonSounds();
  h.context.registerButtonSounds();
  assert.equal(h.listeners.length, 1);
  const [type, listener, options] = h.listeners[0];
  assert.equal(type, "click");
  assert.equal(options.capture, true);
  const control = { dataset: {}, matches: () => false, closest: (selector) => selector === "#app" ? {} : null };
  const event = { isTrusted: true, target: { closest: (selector) => {
    assert.ok(selector.includes('input[type="radio"]'));
    assert.ok(selector.includes('input[type="checkbox"]'));
    return control;
  } } };
  listener(event);
  assert.equal(played, 1);
  listener({ ...event, isTrusted: false });
  control.matches = () => true;
  listener(event);
  control.matches = () => false;
  control.dataset.clickSound = "off";
  listener(event);
  listener({ isTrusted: true, target: { closest: () => null } });
  assert.equal(played, 1);
});

test("sound switch updates in place without discarding an unsaved profile name", () => {
  const h = harness();
  const events = {};
  const status = {};
  const attributes = {};
  let previews = 0;
  const toggle = {
    addEventListener: (type, handler) => { events[type] = handler; },
    setAttribute: (name, value) => { attributes[name] = value; },
    querySelector: () => status,
  };
  h.elements.set("button-sounds-toggle", toggle);
  h.context.render = () => { throw Error("Do not rerender while editing the profile"); };
  h.context.playButtonSound = () => { previews += 1; };
  h.context.bindEvents();
  events.click();
  assert.equal(attributes["aria-checked"], "false");
  assert.equal(status.textContent, "Off");
  assert.equal(previews, 0);
  events.click();
  assert.equal(attributes["aria-checked"], "true");
  assert.equal(status.textContent, "On");
  assert.equal(previews, 1);
});

test("screen flow motion stays brief and provides a reduced-motion fallback", () => {
  assert.match(styles, /\.content > :not\(\.panel\)[\s\S]*?animation: screen-flow-in 280ms/);
  assert.match(styles, /\.panel[\s\S]*?animation: reveal 280ms/);
  assert.match(styles, /button:active:not\(:disabled\)[\s\S]*?scale\(0\.97\)/);
  const reducedMotion = styles.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(reducedMotion, /\.content > :not\(\.panel\)/);
  assert.match(reducedMotion, /animation: none/);
  assert.match(reducedMotion, /transition: none/);
});

test("Today and Yesterday update in place without rerendering the workout screen", () => {
  const h = harness();
  const dateInput = { value: "2026-09-04" };
  const today = {
    dataset: { workoutDateOption: "2026-09-04" },
    classList: { toggle(_name, active) { this.active = active; } },
    setAttribute(_name, value) { this.pressed = value; },
  };
  const yesterday = {
    dataset: { workoutDateOption: "2026-09-03" },
    classList: { toggle(_name, active) { this.active = active; } },
    setAttribute(_name, value) { this.pressed = value; },
  };
  const form = {
    elements: { workoutDate: dateInput },
    querySelectorAll: () => [today, yesterday],
  };
  h.context.render = () => { throw Error("Date selection must not rerender the screen"); };
  assert.doesNotThrow(() => h.context.updateWorkoutDateSelection(form, "2026-09-03"));
  assert.equal(dateInput.value, "2026-09-03");
  assert.equal(today.classList.active, false);
  assert.equal(today.pressed, "false");
  assert.equal(yesterday.classList.active, true);
  assert.equal(yesterday.pressed, "true");
});
