import { addDays, addMinutes, atClock, minutesBetween, startOfDay } from "./time.js";

const DEFAULT_HORIZON_DAYS = 21;

export function buildPlan(state, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const horizonDays = options.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const settings = normalizeSettings(state.settings);
  const tasks = state.tasks.map(normalizeTask);
  const events = expandEvents(state.events, now, horizonDays);
  const busy = [...events.map(eventToBusyBlock), ...buildSleepBlocks(settings, now, horizonDays)];
  const blocks = [];
  const risks = [];
  const taskEndTimes = new Map();

  for (const task of sortTasks(tasks)) {
    const remaining = Math.max(0, task.duration - task.doneMinutes);
    if (remaining === 0) {
      taskEndTimes.set(task.id, now);
      continue;
    }

    const dependencyReady = dependencyReadyAt(task, taskEndTimes, tasks);
    if (!dependencyReady) {
      risks.push({
        taskId: task.id,
        type: "dependency",
        message: `「${task.title}」依赖的任务尚未能安排完成。`
      });
      continue;
    }

    const deadline = new Date(task.deadline);
    const latestEnd = addMinutes(deadline, -settings.deadlineBufferHours * 60);
    const startAfter = new Date(Math.max(now.getTime(), dependencyReady.getTime()));
    const result = scheduleTask(task, {
      busy,
      settings,
      startAfter,
      latestEnd
    });

    blocks.push(...result.blocks);
    if (result.remaining > 0) {
      risks.push({
        taskId: task.id,
        type: "capacity",
        remaining: result.remaining,
        message: `「${task.title}」还缺 ${result.remaining} 分钟，当前可用时间不足。`
      });
    } else {
      taskEndTimes.set(task.id, result.blocks.at(-1)?.end ?? now);
    }
  }

  return {
    blocks: [...blocks, ...events, ...buildSleepBlocks(settings, now, horizonDays)]
      .sort((a, b) => a.start - b.start),
    risks,
    settings
  };
}

export function normalizeSettings(settings = {}) {
  return {
    wake: settings.wake || "07:30",
    sleep: settings.sleep || "23:30",
    minBlock: numberOr(settings.minBlock, 25),
    maxBlock: numberOr(settings.maxBlock, 90),
    dailyBuffer: numberOr(settings.dailyBuffer, 30),
    deadlineBufferHours: numberOr(settings.deadlineBufferHours, 2)
  };
}

export function normalizeTask(task) {
  return {
    id: task.id,
    title: task.title?.trim() || "未命名任务",
    duration: numberOr(task.duration, 0),
    doneMinutes: numberOr(task.doneMinutes, 0),
    deadline: task.deadline,
    mode: task.mode || "auto",
    dependsOn: task.dependsOn || "",
    minBlock: task.minBlock,
    maxBlock: task.maxBlock,
    startHint: task.startHint || "",
    missedCount: numberOr(task.missedCount, 0),
    history: Array.isArray(task.history) ? task.history : []
  };
}

export function sortTasks(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visited = new Set();
  const visiting = new Set();
  const result = [];

  const visit = (task) => {
    if (visited.has(task.id)) return;
    if (visiting.has(task.id)) return;
    visiting.add(task.id);
    if (task.dependsOn && byId.has(task.dependsOn)) visit(byId.get(task.dependsOn));
    visiting.delete(task.id);
    visited.add(task.id);
    result.push(task);
  };

  [...tasks]
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
    .forEach(visit);

  return result;
}

function scheduleTask(task, { busy, settings, startAfter, latestEnd }) {
  let remaining = Math.max(0, task.duration - task.doneMinutes);
  const blocks = [];
  const minBlock = Math.max(10, numberOr(task.minBlock, settings.minBlock));
  const maxBlock = Math.max(minBlock, numberOr(task.maxBlock, settings.maxBlock));
  const targetBlock = chooseBlockSize(task, minBlock, maxBlock, remaining);

  if (latestEnd <= startAfter) {
    return { blocks, remaining };
  }

  while (remaining > 0) {
    if (remaining < minBlock && blocks.length > 0) {
      break;
    }

    const slot = findNextFreeSlot({
      busy,
      startAfter: blocks.at(-1)?.end ?? startAfter,
      latestEnd,
      minMinutes: Math.min(minBlock, remaining),
      settings
    });

    if (!slot) break;

    let minutes = Math.min(remaining, targetBlock, minutesBetween(slot.start, slot.end));
    if (task.mode === "single" && remaining <= minutesBetween(slot.start, slot.end)) {
      minutes = remaining;
    }
    if (minutes < minBlock && remaining > minBlock) {
      break;
    }

    const block = {
      id: cryptoId("block"),
      type: "task",
      taskId: task.id,
      title: task.title,
      start: slot.start,
      end: addMinutes(slot.start, minutes),
      minutes,
      startHint: task.startHint,
      missedCount: task.missedCount
    };

    blocks.push(block);
    busy.push(taskBlockToBusyBlock(block));
    remaining -= minutes;
  }

  return { blocks, remaining };
}

function findNextFreeSlot({ busy, startAfter, latestEnd, minMinutes, settings }) {
  const cursorDay = startOfDay(startAfter);
  const lastDay = startOfDay(latestEnd);

  for (let day = cursorDay; day <= lastDay; day = addDays(day, 1)) {
    const dayStart = new Date(Math.max(atClock(day, settings.wake).getTime(), startAfter.getTime()));
    const dayEndRaw = atClock(day, settings.sleep);
    const dayEnd = new Date(Math.min(addMinutes(dayEndRaw, -settings.dailyBuffer).getTime(), latestEnd.getTime()));
    if (dayEnd <= dayStart) continue;

    const blocked = busy
      .filter((item) => item.end > dayStart && item.start < dayEnd)
      .sort((a, b) => a.start - b.start);
    let slotStart = dayStart;

    for (const item of blocked) {
      if (minutesBetween(slotStart, item.start) >= minMinutes) {
        return { start: slotStart, end: new Date(Math.min(item.start.getTime(), dayEnd.getTime())) };
      }
      if (item.end > slotStart) slotStart = item.end;
    }

    if (minutesBetween(slotStart, dayEnd) >= minMinutes) {
      return { start: slotStart, end: dayEnd };
    }
  }

  return null;
}

function chooseBlockSize(task, minBlock, maxBlock, remaining) {
  if (task.mode === "single") return remaining;
  if (remaining <= minBlock) return remaining;
  const minimumParts = Math.ceil(remaining / maxBlock);
  const evenBlock = Math.ceil(remaining / minimumParts);
  if (evenBlock >= minBlock && evenBlock <= maxBlock) return evenBlock;
  if (task.mode === "split") return Math.min(maxBlock, Math.max(minBlock, Math.ceil(remaining / 3)));
  if (remaining <= maxBlock) return remaining;
  return Math.min(maxBlock, Math.max(minBlock, 60));
}

function dependencyReadyAt(task, taskEndTimes, tasks) {
  if (!task.dependsOn) return new Date(0);
  const dependency = tasks.find((item) => item.id === task.dependsOn);
  if (!dependency) return new Date(0);
  if (dependency.doneMinutes >= dependency.duration) return new Date(0);
  return taskEndTimes.get(task.dependsOn) || null;
}

function buildSleepBlocks(settings, now, horizonDays) {
  const blocks = [];
  for (let offset = 0; offset < horizonDays; offset += 1) {
    const day = addDays(startOfDay(now), offset);
    const sleepStart = atClock(day, settings.sleep);
    const wakeNext = atClock(addDays(day, 1), settings.wake);
    blocks.push({
      id: `sleep-${offset}`,
      type: "sleep",
      title: "睡眠 / 休息",
      start: sleepStart,
      end: wakeNext
    });
  }
  return blocks;
}

function expandEvents(events, now, horizonDays) {
  const rangeStart = startOfDay(now);
  const rangeEnd = addDays(rangeStart, horizonDays);
  const expanded = [];

  for (const event of events) {
    const start = new Date(event.start);
    const end = new Date(event.end);
    if (!event.repeating) {
      if (end > rangeStart && start < rangeEnd) {
        expanded.push({ ...event, type: "event", start, end });
      }
      continue;
    }

    for (let offset = 0; offset < horizonDays; offset += 1) {
      const day = addDays(rangeStart, offset);
      if (day.getDay() !== start.getDay()) continue;
      const instanceStart = copyTime(day, start);
      const instanceEnd = copyTime(day, end);
      if (instanceEnd > rangeStart && instanceStart < rangeEnd) {
        expanded.push({
          ...event,
          id: `${event.id}-${offset}`,
          sourceId: event.id,
          type: "event",
          start: instanceStart,
          end: instanceEnd
        });
      }
    }
  }

  return expanded;
}

function copyTime(day, source) {
  const value = new Date(day);
  value.setHours(source.getHours(), source.getMinutes(), 0, 0);
  return value;
}

function eventToBusyBlock(event) {
  return { start: event.start, end: event.end, type: "event" };
}

function taskBlockToBusyBlock(block) {
  return { start: block.start, end: block.end, type: "task" };
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cryptoId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}
