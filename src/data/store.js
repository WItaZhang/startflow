import { addDays, atClock, iso, startOfDay } from "../domain/time.js";

const STORAGE_KEY = "startflow-state-v1";

export function createStore(repository = createLocalRepository("guest")) {
  let state = migrateState(repository.loadCachedState?.() || sampleState());
  const listeners = new Set();
  const statusListeners = new Set();
  let status = { loading: false, saving: false, error: "" };
  let saveVersion = 0;

  const setStatus = (patch) => {
    status = { ...status, ...patch };
    statusListeners.forEach((listener) => listener(getStatus()));
  };

  const notify = (options = {}) => {
    listeners.forEach((listener) => listener(getState()));
    if (!options.skipSave) {
      queueSave();
    }
  };

  const getState = () => structuredCloneCompat(state);
  const getStatus = () => ({ ...status });

  const update = (updater) => {
    state = migrateState(updater(getState()));
    notify();
  };

  async function hydrate() {
    setStatus({ loading: true, error: "" });
    try {
      const remoteState = await repository.loadState?.();
      if (remoteState) {
        state = migrateState(remoteState);
      }
      notify({ skipSave: true });
      setStatus({ loading: false });
    } catch (error) {
      setStatus({ loading: false, error: error.message || "数据加载失败，正在使用本地缓存。" });
      notify({ skipSave: true });
    }
  }

  function queueSave() {
    const version = ++saveVersion;
    const snapshot = getState();
    setStatus({ saving: true, error: "" });
    Promise.resolve()
      .then(() => repository.saveState?.(snapshot))
      .then(() => {
        if (version === saveVersion) setStatus({ saving: false });
      })
      .catch((error) => {
        if (version === saveVersion) {
          setStatus({ saving: false, error: error.message || "数据保存失败，请稍后重试。" });
        }
      });
  }

  return {
    getState,
    getStatus,
    hydrate,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
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
        tasks: current.tasks
          .filter((task) => task.id !== taskId)
          .map((task) => (task.dependsOn === taskId ? { ...task, dependsOn: "" } : task))
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

export function createLocalRepository(userId = "guest") {
  const scopedKey = `${STORAGE_KEY}:${userId}`;

  return {
    loadCachedState() {
      return readStoredState(scopedKey) || readStoredState(STORAGE_KEY);
    },
    async loadState() {
      return this.loadCachedState();
    },
    async saveState(state) {
      localStorage.setItem(scopedKey, JSON.stringify(migrateState(state)));
    }
  };
}

export function createSupabaseRepository(client, userId) {
  const cache = createLocalRepository(userId);

  return {
    loadCachedState() {
      return cache.loadCachedState();
    },
    async loadState() {
      const { data, error } = await client
        .from("user_states")
        .select("state")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) throw error;
      if (data?.state) {
        await cache.saveState(data.state);
        return data.state;
      }

      const initial = cache.loadCachedState() || sampleState();
      await this.saveState(initial);
      return initial;
    },
    async saveState(state) {
      const nextState = migrateState(state);
      await cache.saveState(nextState);
      const { error } = await client.from("user_states").upsert({
        user_id: userId,
        state: nextState,
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
    }
  };
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

export function sampleState() {
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

function readStoredState(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? migrateState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
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
