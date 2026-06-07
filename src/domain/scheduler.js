import { buildWorkUnits, normalizeBreakdownMode, normalizeEnergy, normalizePriority } from "./breakdown.js";
import { addDays, addMinutes, atClock, minutesBetween, startOfDay } from "./time.js";

const DEFAULT_HORIZON_DAYS = 21;
const STARTER_MAX_MINUTES = 10;
const STARTER_MIN_MINUTES = 5;
const PRIORITY_SCORE = {
  low: 0,
  normal: 12,
  high: 28,
  urgent: 44
};

export function buildPlan(state, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const horizonDays = options.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const settings = normalizeSettings(state.settings);
  const tasks = state.tasks.map(normalizeTask);
  const events = expandEvents(state.events, now, horizonDays);
  const sleepBlocks = buildSleepBlocks(settings, now, horizonDays);
  const busy = [...events.map(eventToBusyBlock), ...sleepBlocks.map(eventToBusyBlock)];
  const blocks = [];
  const risks = [];
  const taskEndTimes = new Map();

  for (const task of sortTasks(tasks, { now })) {
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
    blocks: [...blocks, ...events, ...sleepBlocks].sort((a, b) => a.start - b.start),
    risks,
    settings,
    algorithm: {
      version: "startflow-v2",
      strategy: "semantic-units-weighted-slot-scheduling"
    }
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
    breakdownMode: normalizeBreakdownMode(task.breakdownMode),
    priority: normalizePriority(task.priority),
    energy: normalizeEnergy(task.energy),
    dependsOn: task.dependsOn || "",
    minBlock: task.minBlock,
    maxBlock: task.maxBlock,
    startHint: task.startHint || "",
    missedCount: numberOr(task.missedCount, 0),
    history: Array.isArray(task.history) ? task.history : []
  };
}

export function sortTasks(tasks, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
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
    .sort((a, b) => taskOrderScore(b, tasks, now) - taskOrderScore(a, tasks, now) || new Date(a.deadline) - new Date(b.deadline))
    .forEach(visit);

  return result;
}

function scheduleTask(task, { busy, settings, startAfter, latestEnd }) {
  const units = buildWorkUnits(task, settings);
  let remaining = units.reduce((sum, unit) => sum + unit.minutes, 0);
  const blocks = [];
  let cursor = startAfter;

  if (latestEnd <= startAfter) {
    return { blocks, remaining };
  }

  for (const unit of units) {
    let unitRemaining = unit.minutes;
    while (unitRemaining > 0) {
      const limits = blockLimits(task, unit, settings);
      const minMinutes = Math.min(limits.minBlock, unitRemaining);
      const slot = findBestFreeSlot({
        busy,
        startAfter: cursor,
        latestEnd,
        minMinutes,
        settings,
        task,
        unit
      });

      if (!slot) {
        return { blocks, remaining };
      }

      const minutes = chooseBlockMinutes(task, unit, {
        remaining: unitRemaining,
        available: minutesBetween(slot.start, slot.end),
        limits,
        scheduledBlocks: blocks.length
      });

      if (minutes <= 0) {
        return { blocks, remaining };
      }

      const block = {
        id: cryptoId("block"),
        type: "task",
        taskId: task.id,
        unitId: unit.id,
        title: unit.isTimeUnit ? task.title : unit.title,
        parentTitle: task.title,
        start: slot.start,
        end: addMinutes(slot.start, minutes),
        minutes,
        breakdownMode: task.breakdownMode,
        priority: task.priority,
        energy: unit.energy,
        friction: unit.friction,
        stage: unit.stage,
        isStarter: unit.isStarter,
        startHint: unit.startHint || task.startHint,
        missedCount: task.missedCount,
        score: Math.round(slot.score)
      };

      blocks.push(block);
      busy.push(taskBlockToBusyBlock(block));
      remaining -= minutes;
      unitRemaining -= minutes;
      cursor = block.end;
    }
  }

  return { blocks, remaining };
}

function findBestFreeSlot({ busy, startAfter, latestEnd, minMinutes, settings, task, unit }) {
  const candidates = listFreeSlots({ busy, startAfter, latestEnd, minMinutes, settings });
  if (!candidates.length) return null;

  return candidates
    .map((slot) => ({
      ...slot,
      score: scoreSlot(slot, { busy, startAfter, latestEnd, minMinutes, settings, task, unit })
    }))
    .sort((a, b) => b.score - a.score || a.start - b.start)[0];
}

function listFreeSlots({ busy, startAfter, latestEnd, minMinutes, settings }) {
  const cursorDay = startOfDay(startAfter);
  const lastDay = startOfDay(latestEnd);
  const slots = [];

  for (let day = cursorDay; day <= lastDay; day = addDays(day, 1)) {
    const { dayStart, dayEnd } = availabilityWindow(day, settings, startAfter, latestEnd);
    if (dayEnd <= dayStart) continue;

    const blocked = busy
      .filter((item) => item.end > dayStart && item.start < dayEnd)
      .sort((a, b) => a.start - b.start);
    let slotStart = dayStart;

    for (const item of blocked) {
      if (minutesBetween(slotStart, item.start) >= minMinutes) {
        slots.push({ start: slotStart, end: new Date(Math.min(item.start.getTime(), dayEnd.getTime())) });
      }
      if (item.end > slotStart) slotStart = item.end;
    }

    if (minutesBetween(slotStart, dayEnd) >= minMinutes) {
      slots.push({ start: slotStart, end: dayEnd });
    }
  }

  return slots;
}

function chooseBlockMinutes(task, unit, { remaining, available, limits, scheduledBlocks }) {
  const shortTail = remaining < limits.minBlock && (scheduledBlocks > 0 || !unit.isTimeUnit);
  if (shortTail || unit.isStarter || !unit.canSplit) {
    return Math.min(remaining, available);
  }

  if (unit.isTimeUnit) {
    const targetBlock = chooseTimeBlockSize(task, limits.minBlock, limits.maxBlock, remaining);
    const minutes = Math.min(remaining, targetBlock, available);
    if (minutes < limits.minBlock && remaining > limits.minBlock) return 0;
    return minutes;
  }

  const target = Math.min(limits.maxBlock, Math.max(limits.minBlock, Math.ceil(remaining / Math.ceil(remaining / limits.maxBlock))));
  return Math.min(remaining, target, available);
}

function chooseTimeBlockSize(task, minBlock, maxBlock, remaining) {
  if (task.mode === "single") return remaining;
  if (remaining <= minBlock) return remaining;
  const minimumParts = Math.ceil(remaining / maxBlock);
  const evenBlock = Math.ceil(remaining / minimumParts);
  if (evenBlock >= minBlock && evenBlock <= maxBlock) return evenBlock;
  if (task.mode === "split") return Math.min(maxBlock, Math.max(minBlock, Math.ceil(remaining / 3)));
  if (remaining <= maxBlock) return remaining;
  return Math.min(maxBlock, Math.max(minBlock, 60));
}

function blockLimits(task, unit, settings) {
  const baseMin = Math.max(10, numberOr(task.minBlock, settings.minBlock));
  const baseMax = Math.max(baseMin, numberOr(task.maxBlock, settings.maxBlock));
  const missedReduction = Math.min(30, task.missedCount * 10);
  const maxBlock = unit.isStarter ? STARTER_MAX_MINUTES : Math.max(baseMin, baseMax - missedReduction);
  const minBlock = unit.isStarter ? Math.min(STARTER_MIN_MINUTES, unit.minutes) : baseMin;

  return {
    minBlock: Math.max(1, Math.min(minBlock, unit.minutes)),
    maxBlock: Math.max(1, Math.min(maxBlock, unit.minutes))
  };
}

function scoreSlot(slot, { busy, startAfter, latestEnd, minMinutes, settings, task, unit }) {
  const delayHours = minutesBetween(startAfter, slot.start) / 60;
  const slotMinutes = minutesBetween(slot.start, slot.end);
  const hoursToDeadline = Math.max(0.25, minutesBetween(slot.start, latestEnd) / 60);
  const leftover = slotMinutes - minMinutes;
  const previous = nearestPreviousBusy(busy, slot.start);
  const next = nearestNextBusy(busy, slot.end);

  let score = 100;
  score += PRIORITY_SCORE[task.priority] || 0;
  score += dependencyUnlockValue(task, busy);
  score += Math.min(36, 160 / (hoursToDeadline + 2));
  score += energyFitScore(unit.energy, slot.start);
  score -= delayHours * (task.priority === "urgent" ? 2.4 : 1.2);
  score -= unit.friction * Math.min(12, delayHours * 0.8);
  score -= task.missedCount * Math.min(10, delayHours);

  if (leftover > 0 && leftover < settings.minBlock) score -= 8;
  if (previous?.taskId === task.id) score += 10;
  if (next?.taskId === task.id) score += 6;
  if (previous?.taskId && previous.taskId !== task.id && minutesBetween(previous.end, slot.start) <= 10) score -= 4;
  if (unit.isStarter) score -= delayHours * 2;

  return score;
}

function energyFitScore(energy, date) {
  const hour = date.getHours() + date.getMinutes() / 60;
  if (energy === "high") {
    if (hour >= 8.5 && hour <= 11.5) return 18;
    if (hour >= 13 && hour <= 16.5) return 10;
    if (hour >= 19) return -8;
    return 2;
  }
  if (energy === "medium") {
    if (hour >= 9 && hour <= 17.5) return 12;
    if (hour >= 19 && hour <= 22) return 3;
    return 0;
  }
  if (energy === "low") {
    if (hour >= 16 && hour <= 22.5) return 12;
    if (hour >= 9 && hour <= 15.5) return 6;
    return 2;
  }
  return 0;
}

function taskOrderScore(task, tasks, now) {
  const deadline = new Date(task.deadline);
  const hoursToDeadline = Math.max(0.25, (deadline.getTime() - now.getTime()) / (60 * 60 * 1000));
  const deadlinePressure = Math.min(80, 260 / (hoursToDeadline + 4));
  const dependentCount = tasks.filter((item) => item.dependsOn === task.id).length;
  const frictionBoost = Math.min(18, task.missedCount * 5);

  return deadlinePressure + (PRIORITY_SCORE[task.priority] || 0) + dependentCount * 10 + frictionBoost - task.duration / 600;
}

function dependencyUnlockValue(task, busy) {
  return busy.some((item) => item.taskId === task.id) ? 4 : 0;
}

function nearestPreviousBusy(busy, start) {
  return busy
    .filter((item) => item.end <= start)
    .sort((a, b) => b.end - a.end)[0];
}

function nearestNextBusy(busy, end) {
  return busy
    .filter((item) => item.start >= end)
    .sort((a, b) => a.start - b.start)[0];
}

function dependencyReadyAt(task, taskEndTimes, tasks) {
  if (!task.dependsOn) return new Date(0);
  const dependency = tasks.find((item) => item.id === task.dependsOn);
  if (!dependency) return new Date(0);
  if (dependency.doneMinutes >= dependency.duration) return new Date(0);
  return taskEndTimes.get(task.dependsOn) || null;
}

function availabilityWindow(day, settings, startAfter, latestEnd) {
  const wake = atClock(day, settings.wake);
  let sleep = atClock(day, settings.sleep);
  if (sleep <= wake) {
    sleep = addDays(sleep, 1);
  }

  return {
    dayStart: new Date(Math.max(wake.getTime(), startAfter.getTime())),
    dayEnd: new Date(Math.min(addMinutes(sleep, -settings.dailyBuffer).getTime(), latestEnd.getTime()))
  };
}

function buildSleepBlocks(settings, now, horizonDays) {
  const blocks = [];
  for (let offset = 0; offset < horizonDays; offset += 1) {
    const day = addDays(startOfDay(now), offset);
    const wake = atClock(day, settings.wake);
    let sleepStart = atClock(day, settings.sleep);
    if (sleepStart <= wake) {
      sleepStart = addDays(sleepStart, 1);
    }
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
  return { start: event.start, end: event.end, type: event.type || "event", taskId: event.taskId };
}

function taskBlockToBusyBlock(block) {
  return { start: block.start, end: block.end, type: "task", taskId: block.taskId, unitId: block.unitId };
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cryptoId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}
