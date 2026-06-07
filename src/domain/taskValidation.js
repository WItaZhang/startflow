import { buildPlan } from "./scheduler.js";

const MIN_VALIDATION_HORIZON_DAYS = 21;
const DRAFT_TASK_ID = "__draft_task__";
const DAY_MS = 24 * 60 * 60 * 1000;

export function validateTaskFits(state, taskId, payload, options = {}) {
  const targetId = taskId || DRAFT_TASK_ID;
  const candidateTask = buildCandidateTask(state, taskId, targetId, payload);
  const candidateState = {
    ...state,
    tasks: taskId
      ? state.tasks.map((task) => (task.id === taskId ? candidateTask : task))
      : [...state.tasks, candidateTask]
  };
  const now = options.now ? new Date(options.now) : new Date();
  const plan = buildPlan(candidateState, {
    now,
    horizonDays: horizonDaysForTasks(candidateState.tasks, now)
  });
  const risk = plan.risks.find((item) => item.taskId === targetId);

  return {
    ok: !risk,
    risk,
    plan
  };
}

export function validateEventImpact(state, eventId, payload, options = {}) {
  const candidateState = {
    ...state,
    events: eventId
      ? state.events.map((item) => (item.id === eventId ? { ...item, ...payload, id: eventId } : item))
      : [...state.events, { ...payload, id: "__draft_event__" }]
  };
  const now = options.now ? new Date(options.now) : new Date();
  const horizonDays = horizonDaysForTasks(candidateState.tasks, now);
  const previousPlan = buildPlan(state, { now, horizonDays });
  const nextPlan = buildPlan(candidateState, { now, horizonDays });
  const previousRisks = new Map(previousPlan.risks.map((risk) => [risk.taskId, risk]));
  const risks = nextPlan.risks.filter((risk) => riskGotWorse(previousRisks.get(risk.taskId), risk));

  return {
    ok: risks.length === 0,
    risks,
    plan: nextPlan
  };
}

export function formatTaskFitError(risk, settings = {}) {
  if (!risk) return "";
  if (risk.type === "dependency") {
    return "这个任务依赖的前置任务还无法先排完，请先调整前置任务、DDL 或取消依赖。";
  }

  const remaining = Number.isFinite(Number(risk.remaining)) ? Number(risk.remaining) : 0;
  const buffer = Number(settings.deadlineBufferHours || 0);
  const bufferText = buffer > 0 ? `系统会预留 ${buffer} 小时 DDL 提前量。` : "";
  return `当前约束下还差 ${remaining} 分钟，暂时不能保存。请延后 DDL、减少总时长、释放固定安排，或调整最短/最长单次。${bufferText}`;
}

export function formatEventImpactError(risks, state, settings = {}) {
  const firstRisk = risks?.[0];
  if (!firstRisk) return "";
  const task = state.tasks.find((item) => item.id === firstRisk.taskId);
  const title = task?.title || "未知任务";
  const remaining = Number.isFinite(Number(firstRisk.remaining)) ? Number(firstRisk.remaining) : 0;
  const extraCount = Math.max(0, risks.length - 1);
  const extraText = extraCount ? `，另外还有 ${extraCount} 个任务受影响` : "";
  const buffer = Number(settings.deadlineBufferHours || 0);
  const bufferText = buffer > 0 ? ` 系统还会预留 ${buffer} 小时 DDL 提前量。` : "";
  return `这段固定安排会让「${title}」排不下，还差 ${remaining} 分钟${extraText}。请先调整任务 DDL、减少时长，或换一个不会冲突的日程时间。${bufferText}`;
}

function riskGotWorse(previousRisk, nextRisk) {
  if (!previousRisk) return true;
  if (previousRisk.type !== nextRisk.type) return true;
  if (nextRisk.type === "capacity") {
    return Number(nextRisk.remaining || 0) > Number(previousRisk.remaining || 0);
  }
  return false;
}

function buildCandidateTask(state, taskId, targetId, payload) {
  const existing = taskId ? state.tasks.find((task) => task.id === taskId) : null;
  return {
    ...(existing || {}),
    ...payload,
    id: targetId,
    doneMinutes: Math.min(existing?.doneMinutes || 0, Number(payload.duration || existing?.duration || 0)),
    missedCount: existing?.missedCount || 0,
    history: Array.isArray(existing?.history) ? existing.history : []
  };
}

function horizonDaysForTasks(tasks, now) {
  const furthestDeadline = tasks.reduce((latest, task) => {
    const deadline = new Date(task.deadline);
    return Number.isFinite(deadline.getTime()) && deadline > latest ? deadline : latest;
  }, now);
  const diffDays = Math.ceil((furthestDeadline.getTime() - now.getTime()) / DAY_MS) + 2;
  return Math.max(MIN_VALIDATION_HORIZON_DAYS, diffDays);
}
