// FreshAF business hours (Evert, 21 Nov 2026): every booked job's timings count business
// hours only. A request sent at 20:00 does not run its answer window down overnight, and a
// booked slot has to start inside business hours. The hours are an admin setting
// (business_open / business_close, South African time, the same every day of the week).
//
// Times here are "wall" milliseconds: South African clock time read as if it were UTC, the
// same frame routes/orders.js uses, so the server's own timezone never shifts anything.
// South Africa is UTC+2 all year, with no daylight saving.
const { getSetting } = require('./db');

const SAST_MS = 2 * 3600e3;
const DAY_MS = 24 * 3600e3;

function toMinutes(text, fallback) {
  const m = String(text || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 24 * 60 ? v : fallback;
}

function hours() {
  const open = toMinutes(getSetting('business_open', '07:00'), 7 * 60);
  let close = toMinutes(getSetting('business_close', '18:00'), 18 * 60);
  if (close <= open) close = Math.min(24 * 60, open + 60); // never an empty day
  return { open, close };
}

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
function label() { const { open, close } = hours(); return `${hhmm(open)} and ${hhmm(close)}`; }

function wallNow() { return Date.now() + SAST_MS; }
function dayStart(ms) { return Math.floor(ms / DAY_MS) * DAY_MS; }
function minuteOfDay(ms) { return Math.floor((ms - dayStart(ms)) / 60000); }

// Whether a booked slot may start at this time.
function isOpenAt(ms) {
  const { open, close } = hours();
  const m = minuteOfDay(ms);
  return m >= open && m < close;
}

// Move forward through business hours only.
function addBusinessHours(ms, h) {
  const { open, close } = hours();
  let left = h * 60;
  let t = ms;
  for (let i = 0; i < 400; i++) {
    const d = dayStart(t);
    const o = d + open * 60000;
    const c = d + close * 60000;
    if (t < o) t = o;
    if (t >= c) { t = d + DAY_MS + open * 60000; continue; }
    const avail = (c - t) / 60000;
    if (left <= avail) return t + left * 60000;
    left -= avail;
    t = d + DAY_MS + open * 60000;
  }
  return t;
}

// Move backward through business hours only.
function subtractBusinessHours(ms, h) {
  const { open, close } = hours();
  let left = h * 60;
  let t = ms;
  for (let i = 0; i < 400; i++) {
    const d = dayStart(t);
    const o = d + open * 60000;
    const c = d + close * 60000;
    if (t > c) t = c;
    if (t <= o) { t = d - DAY_MS + close * 60000; continue; }
    const avail = (t - o) / 60000;
    if (left <= avail) return t - left * 60000;
    left -= avail;
    t = d - DAY_MS + close * 60000;
  }
  return t;
}

// The earliest slot a customer may book, leadH business hours from now, on a 15-minute
// mark and inside business hours.
function earliestSlot(leadH) {
  let t = addBusinessHours(wallNow(), leadH);
  t = Math.ceil(t / (15 * 60000)) * 15 * 60000;
  if (!isOpenAt(t)) {
    const { open } = hours();
    t = minuteOfDay(t) < open ? dayStart(t) + open * 60000 : dayStart(t) + DAY_MS + open * 60000;
  }
  return t;
}

const wallText = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
// A wall time as the UTC SQL datetime the database compares with datetime('now').
const wallToUtcSql = (ms) => new Date(ms - SAST_MS).toISOString().slice(0, 19).replace('T', ' ');

module.exports = {
  hours, label, hhmm, wallNow, isOpenAt, addBusinessHours, subtractBusinessHours,
  earliestSlot, wallText, wallToUtcSql, SAST_MS,
};
