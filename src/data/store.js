import { addDays, atClock, iso, startOfDay } from "../domain/time.js";

const STORAGE_KEY = "startflow-state-v1";

export function createStore() {
  let state = loadState();
  const listeners = new Set();

  const notify = () => {
    saveState(state);
    listeners.forEach((listener) => listener(getState()));
  };

  const getState = () => structuredCloneCompat(state);

  const update = (updater) => {
    state = migrateState(updater(getState()));
    notify();
  };

  return {
    getState,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    addTask(task) {
      update((current) => ({
        ...current,
        tasks: [...current.tasks, { ...task, id: createId("task"), doneMinutes: 0, missedCount: 0, history: [] }]
      }));
    },
    updateTask(taskId, patch) {
      update((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                ...patch,
                dependsOn: patch.dependsOn === taskId ? "" : patch.dependsOn,
                doneMinutes: Math.min(task.doneMinutes || 0, Number(patch.duration ?? task.duration))
              }
            : task
        )
      }));
    },
    addEvent(event) {
      update((current) => ({
        ...current,
        events: [...current.events, { ...event, id: createId("event") }]
      }));
    },
    updateEvent(eventId, patch) {
      update((current) => ({
        ...current,
        events: current.events.map((event) => (event.id === eventId ? { ...event, ...patch } : event))
      }));
    },
    updateSettings(settings) {
      update((current) => ({ ...current, settings: { ...current.settings, ...settings } }));
    },
    completeBlock(block) {
      updateTaskProgress(block.taskId, block.minutes, "完成");
    },
    partiallyCompleteBlock(block, minutes) {
      updateTaskProgress(block.taskId, Math.max(0, minutes), `做了一部分：${minutes} 分钟`);
    },
    missBlock(block) {
      update((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === block.taskId
            ? {
                ...task,
                missedCount: (task.missedCount || 0) + 1,
                history: [...(task.history || []), historyItem("没能做到", block.minutes)]
              }
            : task
        )
      }));
    },
    markTaskDone(taskId) {
      update((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId
            ? { ...task, doneMinutes: task.duration, history: [...(task.history || []), historyItem("手动完成", task.duration)] }
            : task
        )
      }));
    },
    deleteTask(taskId) {
      update((current) => ({
        ...current,
        tasks: current.tasks.filter((task) => task.id !== taskId).map((task) => (task.dependsOn === taskId ? { ...task, dependsOn: "" } : task))
      }));
    },
    deleteEvent(eventId) {
      update((current) => ({
        ...current,
        events: current.events.filter((event) => event.id !== eventId)
      }));
    },
    seed() {
      state = sampleState();
      notify();
    },
    clearWorkspace() {
      update((current) => ({
        ...current,
        tasks: [],
        events: []
      }));
    }
  };

  function updateTaskProgress(taskId, minutes, label) {
    update((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              doneMinutes: Math.min(task.duration, (task.doneMinutes || 0) + minutes),
              history: [...(task.history || []), historyItem(label, minutes)]
            }
          : task
      )
    }));
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? migrateState(JSON.parse(raw)) : sampleState();
  } catch {
    return sampleState();
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(migrateState(state)));
}

export function migrateState(state) {
  return {
    version: 1,
    settings: {
      wake: state?.settings?.wake || "07:30",
      sleep: state?.settings?.sleep || "23:30",
      minBlock: Number(state?.settings?.minBlock ?? 25),
      maxBlock: Number(state?.settings?.maxBlock ?? 90),
      dailyBuffer: Number(state?.settings?.dailyBuffer ?? 30),
      deadlineBufferHours: Number(state?.settings?.deadlineBufferHours ?? 2)
    },
    tasks: Array.isArray(state?.tasks) ? state.tasks : [],
    events: Array.isArray(state?.events) ? state.events : []
  };
}

function sampleState() {
  const today = startOfDay(new Date());
  const taskA = createId("task");
  const taskB = createId("task");
  const taskC = createId("task");

  return migrateState({
    settings: {
      wake: "07:30",
      sleep: "23:30",
      minBlock: 25,
      maxBlock: 90,
      dailyBuffer: 30,
      deadlineBufferHours: 2
    },
    tasks: [
      {
        id: taskA,
        title: "查资料：课程论文",
        duration: 90,
        doneMinutes: 0,
        deadline: iso(atClock(addDays(today, 2), "20:00")),
        mode: "split",
        dependsOn: "",
        startHint: "打开资料列表，先读第一段",
        missedCount: 0,
        history: []
      },
      {
        id: taskB,
        title: "写论文初稿",
        duration: 240,
        doneMinutes: 0,
        deadline: iso(atClock(addDays(today, 5), "22:00")),
        mode: "auto",
        dependsOn: taskA,
        startHint: "打开文档，先写标题和三个小标题",
        missedCount: 0,
        history: []
      },
      {
        id: taskC,
        title: "统计作业",
        duration: 150,
        doneMinutes: 30,
        deadline: iso(atClock(addDays(today, 3), "23:00")),
        mode: "split",
        dependsOn: "",
        startHint: "先把题目和数据文件打开",
        missedCount: 1,
        history: [historyItem("做了一部分：30 分钟", 30)]
      }
    ],
    events: [
      {
        id: createId("event"),
        title: "早八课程",
        start: iso(atClock(today, "08:00")),
        end: iso(atClock(today, "09:30")),
        repeating: true
      },
      {
        id: createId("event"),
        title: "朋友聚餐",
        start: iso(atClock(addDays(today, 1), "18:30")),
        end: iso(atClock(addDays(today, 1), "21:00")),
        repeating: false
      },
      {
        id: createId("event"),
        title: "小组讨论",
        start: iso(atClock(addDays(today, 2), "14:00")),
        end: iso(atClock(addDays(today, 2), "15:30")),
        repeating: false
      }
    ]
  });
}

function historyItem(label, minutes) {
  return {
    id: createId("history"),
    label,
    minutes,
    at: new Date().toISOString()
  };
}

function createId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

function structuredCloneCompat(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
