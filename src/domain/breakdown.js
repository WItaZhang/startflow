const STARTER_MAX_MINUTES = 10;
const STARTER_MIN_MINUTES = 5;

const TASK_TYPES = [
  {
    type: "writing",
    pattern: /写|论文|报告|初稿|文案|文章|总结|essay|paper|report|draft|write/i,
    starter: "打开文档，写下标题和 3 个小标题",
    stages: [
      { title: "搭出结构和小标题", weight: 0.16, energy: "medium", friction: 2 },
      { title: "完成主体草稿", weight: 0.48, energy: "high", friction: 3, canSplit: true },
      { title: "补证据、例子或引用", weight: 0.22, energy: "medium", friction: 2, canSplit: true },
      { title: "快速通读并标出要改的地方", weight: 0.14, energy: "low", friction: 1 }
    ]
  },
  {
    type: "research",
    pattern: /查|资料|阅读|读|调研|文献|research|read|reading|literature/i,
    starter: "打开资料列表，先读第一段并标 1 个关键词",
    stages: [
      { title: "确定资料范围", weight: 0.18, energy: "medium", friction: 2 },
      { title: "阅读并做标记", weight: 0.48, energy: "medium", friction: 2, canSplit: true },
      { title: "整理可用结论", weight: 0.22, energy: "high", friction: 3 },
      { title: "留下下一步引用线索", weight: 0.12, energy: "low", friction: 1 }
    ]
  },
  {
    type: "study",
    pattern: /作业|考试|复习|题|课程|学习|背|study|exam|homework|quiz|problem/i,
    starter: "打开题目和资料，先处理第一小问",
    stages: [
      { title: "浏览要求并圈出难点", weight: 0.16, energy: "medium", friction: 2 },
      { title: "完成第一轮解题或复习", weight: 0.5, energy: "high", friction: 3, canSplit: true },
      { title: "检查错题和薄弱点", weight: 0.22, energy: "medium", friction: 2, canSplit: true },
      { title: "整理提交或记忆卡片", weight: 0.12, energy: "low", friction: 1 }
    ]
  },
  {
    type: "coding",
    pattern: /代码|开发|bug|实现|接口|项目|deploy|code|bug|feature|api|test|release/i,
    starter: "打开项目，定位要改的文件或问题",
    stages: [
      { title: "复现问题或确认目标", weight: 0.18, energy: "medium", friction: 2 },
      { title: "实现最小可用改动", weight: 0.44, energy: "high", friction: 3, canSplit: true },
      { title: "本地测试和修复边界", weight: 0.26, energy: "high", friction: 3, canSplit: true },
      { title: "收尾、记录和准备上线", weight: 0.12, energy: "low", friction: 1 }
    ]
  },
  {
    type: "admin",
    pattern: /邮件|报销|预约|整理|提交|申请|回复|admin|email|submit|apply|form/i,
    starter: "打开入口，先完成第一个字段或第一条回复",
    stages: [
      { title: "收集需要的信息", weight: 0.28, energy: "low", friction: 1 },
      { title: "逐项处理清单", weight: 0.46, energy: "medium", friction: 2, canSplit: true },
      { title: "检查并提交", weight: 0.26, energy: "low", friction: 1 }
    ]
  }
];

const GENERIC_TYPE = {
  type: "generic",
  starter: "打开相关材料，只做第一步",
  stages: [
    { title: "明确完成标准", weight: 0.18, energy: "medium", friction: 2 },
    { title: "推进主要工作", weight: 0.52, energy: "medium", friction: 2, canSplit: true },
    { title: "检查并收尾", weight: 0.3, energy: "low", friction: 1 }
  ]
};

export function buildWorkUnits(task, settings = {}) {
  const duration = Math.max(0, numberOr(task.duration, 0));
  const doneMinutes = Math.min(duration, Math.max(0, numberOr(task.doneMinutes, 0)));
  const units = task.breakdownMode === "semantic" ? buildSemanticUnits(task, settings, duration) : buildTimeUnits(task, duration);
  return removeCompletedMinutes(units, doneMinutes);
}

export function normalizeBreakdownMode(value) {
  return value === "semantic" ? "semantic" : "time";
}

export function normalizePriority(value) {
  return ["low", "normal", "high", "urgent"].includes(value) ? value : "normal";
}

export function normalizeEnergy(value) {
  return ["auto", "low", "medium", "high"].includes(value) ? value : "auto";
}

export function inferTaskType(title = "") {
  const match = TASK_TYPES.find((item) => item.pattern.test(title));
  return match?.type || "generic";
}

function buildTimeUnits(task, duration) {
  if (duration <= 0) return [];
  return [
    {
      id: `${task.id}:time`,
      taskId: task.id,
      title: task.title,
      minutes: duration,
      originalMinutes: duration,
      stage: "time",
      energy: resolveEnergy(task.energy, "medium"),
      friction: task.missedCount ? 3 : 2,
      canSplit: task.mode !== "single",
      isStarter: false,
      isTimeUnit: true,
      startHint: task.startHint || "先做 10 分钟也算开始"
    }
  ];
}

function buildSemanticUnits(task, settings, duration) {
  if (duration <= 0) return [];
  const profile = TASK_TYPES.find((item) => item.type === inferTaskType(task.title)) || GENERIC_TYPE;
  const starterMinutes = Math.min(duration, Math.max(STARTER_MIN_MINUTES, Math.min(STARTER_MAX_MINUTES, Math.round(duration * 0.12))));
  const starter = {
    id: `${task.id}:starter`,
    taskId: task.id,
    title: `启动：${profile.starter}`,
    minutes: starterMinutes,
    originalMinutes: starterMinutes,
    stage: "starter",
    energy: "low",
    friction: 1,
    canSplit: false,
    isStarter: true,
    isTimeUnit: false,
    startHint: task.startHint || profile.starter
  };

  const remaining = duration - starterMinutes;
  if (remaining <= 0) return [starter];

  const stageMinutes = allocateByWeight(remaining, profile.stages.map((stage) => stage.weight));
  const maxUnitMinutes = Math.max(25, Math.min(numberOr(task.maxBlock, settings.maxBlock ?? 90), 90));
  const units = [starter];

  profile.stages.forEach((stage, index) => {
    const minutes = stageMinutes[index];
    if (minutes <= 0) return;
    const chunks = splitStageMinutes(minutes, stage.canSplit ? maxUnitMinutes : minutes);
    chunks.forEach((chunkMinutes, chunkIndex) => {
      const suffix = chunks.length > 1 ? `（${chunkIndex + 1}/${chunks.length}）` : "";
      units.push({
        id: `${task.id}:${stage.title}:${chunkIndex}`,
        taskId: task.id,
        title: `${stage.title}${suffix}`,
        minutes: chunkMinutes,
        originalMinutes: chunkMinutes,
        stage: profile.type,
        energy: resolveEnergy(task.energy, stage.energy),
        friction: stage.friction,
        canSplit: Boolean(stage.canSplit),
        isStarter: false,
        isTimeUnit: false,
        startHint: task.startHint || profile.starter
      });
    });
  });

  return units;
}

function removeCompletedMinutes(units, doneMinutes) {
  let consumed = doneMinutes;
  return units
    .map((unit) => {
      const remaining = Math.max(0, unit.minutes - consumed);
      consumed = Math.max(0, consumed - unit.minutes);
      return remaining > 0
        ? {
            ...unit,
            minutes: remaining
          }
        : null;
    })
    .filter(Boolean);
}

function allocateByWeight(total, weights) {
  const sum = weights.reduce((value, weight) => value + weight, 0) || 1;
  const raw = weights.map((weight) => (total * weight) / sum);
  const base = raw.map(Math.floor);
  let remainder = total - base.reduce((value, minutes) => value + minutes, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (let index = 0; remainder > 0; index += 1) {
    base[order[index % order.length].index] += 1;
    remainder -= 1;
  }

  return base;
}

function splitStageMinutes(minutes, maxMinutes) {
  if (minutes <= maxMinutes) return [minutes];
  const count = Math.ceil(minutes / maxMinutes);
  return allocateByWeight(minutes, Array.from({ length: count }, () => 1));
}

function resolveEnergy(taskEnergy, fallback) {
  return taskEnergy && taskEnergy !== "auto" ? taskEnergy : fallback;
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
