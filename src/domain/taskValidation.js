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
