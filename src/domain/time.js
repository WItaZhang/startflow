export const MINUTE = 60 * 1000;
export const DAY = 24 * 60 * MINUTE;

export function startOfDay(date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * DAY);
}

export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * MINUTE);
}

export function minutesBetween(start, end) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / MINUTE));
}

export function parseClock(clock) {
  const [hours, minutes] = String(clock || "00:00").split(":").map(Number);
  return { hours: hours || 0, minutes: minutes || 0 };
}

export function atClock(date, clock) {
  const value = startOfDay(date);
  const { hours, minutes } = parseClock(clock);
  value.setHours(hours, minutes, 0, 0);
  return value;
}

export function toDateInputValue(date) {
  const value = new Date(date);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
}

export function formatDate(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(date);
}

export function formatMonth(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long"
  }).format(date);
}

export function formatTime(date) {
  const value = new Date(date);
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

export function formatRange(start, end) {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

export function iso(date) {
  return new Date(date).toISOString();
}

export function clampDate(date, min, max) {
  return new Date(Math.min(Math.max(date.getTime(), min.getTime()), max.getTime()));
}
