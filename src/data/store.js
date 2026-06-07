import { addDays, atClock, iso, startOfDay } from "../domain/time.js";

const STORAGE_KEY = "startflow-state-v1";

export function createStore(repository = createLocalRepository("guest")) {
  let state = migrateState(repository.loadCachedState?.() || sampleState());
  const listeners = new Set();
  const statusListeners = new Set();
  let status = { loading: false, saving: false, error: "" };
  let pendingSaveState = null;
  let saveInFlight = false;

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
    pendingSaveState = getState();
    if (!saveInFlight) {
      void flushSaveQueue();
    }
  }

  async function flushSaveQueue() {
    saveInFlight = true;
    setStatus({ saving: true, error: "" });

    while (pendingSaveState) {
      const snapshot = pendingSaveState;
      pendingSaveState = null;
      try {
        await repository.saveState?.(snapshot);
      } catch (error) {
        pendingSaveState = pendingSaveState || snapshot;
        saveInFlight = false;
        setStatus({ saving: false, error: error.message || "数据保存失败，请稍后重试。" });
        return;
      }
    }

    saveInFlight = false;
    setStatus({ saving: false });
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
      const [settingsResult, tasksResult, eventsResult, historyResult] = await Promise.all([
        client.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
        client.from("tasks").select("*").eq("user_id", userId).order("deadline", { ascending: true }),
        client.from("events").select("*").eq("user_id", userId).order("start_at", { ascending: true }),
        client.from("task_history").select("*").eq("user_id", userId).order("happened_at", { ascending: true })
      ]);

      throwIfSupabaseError(settingsResult, tasksResult, eventsResult, historyResult);

      const hasRemoteData =
        Boolean(settingsResult.data) ||
        Boolean(tasksResult.data?.length) ||
        Boolean(eventsResult.data?.length) ||
        Boolean(historyResult.data?.length);

      if (!hasRemoteData) {
        const legacyState = await loadLegacyUserState(client, userId);
        if (legacyState) {
          await this.saveState(legacyState);
          return legacyState;
        }

        const initial = cache.loadCachedState() || sampleState();
        await this.saveState(initial);
        return initial;
      }

      const remoteState = stateFromSupabaseRows({
        settings: settingsResult.data,
        tasks: tasksResult.data || [],
        events: eventsResult.data || [],
        history: historyResult.data || []
      });
      await cache.saveState(remoteState);
      return remoteState;
    },
    async saveState(state) {
      const nextState = migrateState(state);
      await cache.saveState(nextState);
      await saveNormalizedState(client, userId, nextState);
    }
  };
}

async function loadLegacyUserState(client, userId) {
  const result = await client
    .from("user_states")
    .select("state")
    .eq("user_id", userId)
    .maybeSingle();

  if (result.error) {
    if (isMissingRelationError(result.error)) return null;
    throw result.error;
  }

  return result.data?.state ? migrateState(result.data.state) : null;
}

function isMissingRelationError(error) {
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message || "");
}

async function saveNormalizedState(client, userId, state) {
  const settingsResult = await client.from("user_settings").upsert(settingsToSupabaseRow(userId, state.settings));
  throwIfSupabaseError(settingsResult);

  const taskRows = state.tasks.map((task) => taskToSupabaseRow(userId, task));
  if (taskRows.length) {
    throwIfSupabaseError(await client.from("tasks").upsert(taskRows));
  }

  const eventRows = state.events.map((event) => eventToSupabaseRow(userId, event));
  if (eventRows.length) {
    throwIfSupabaseError(await client.from("events").upsert(eventRows));
  }

  throwIfSupabaseError(await client.from("task_history").delete().eq("user_id", userId));
  const historyRows = state.tasks.flatMap((task) => (task.history || []).map((item) => historyToSupabaseRow(userId, task.id, item)));
  if (historyRows.length) {
    throwIfSupabaseError(await client.from("task_history").upsert(historyRows));
  }

  await deleteMissingRows(client, userId, "events", state.events.map((event) => event.id));
  await deleteMissingRows(client, userId, "tasks", state.tasks.map((task) => task.id));
}

async function deleteMissingRows(client, userId, table, idsToKeep) {
  const keep = new Set(idsToKeep);
  const { data, error } = await client.from(table).select("id").eq("user_id", userId);
  if (error) throw error;
  const staleIds = (data || []).map((row) => row.id).filter((id) => !keep.has(id));

  for (const id of staleIds) {
    const result = await client.from(table).delete().eq("user_id", userId).eq("id", id);
    throwIfSupabaseError(result);
  }
}

function stateFromSupabaseRows({ settings, tasks, events, history }) {
  const historyByTask = new Map();
  for (const item of history) {
    const list = historyByTask.get(item.task_id) || [];
    list.push({
      id: item.id,
      label: item.label,
      minutes: Number(item.minutes || 0),
      at: item.happened_at
    });
    historyByTask.set(item.task_id, list);
  }

  return migrateState({
    version: 1,
    settings: settings
      ? {
          wake: settings.wake,
          sleep: settings.sleep,
          minBlock: settings.min_block,
          maxBlock: settings.max_block,
          dailyBuffer: settings.daily_buffer,
          deadlineBufferHours: settings.deadline_buffer_hours
        }
      : undefined,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      duration: Number(task.duration || 0),
      doneMinutes: Number(task.done_minutes || 0),
      deadline: task.deadline,
      mode: task.mode,
      dependsOn: task.depends_on || "",
      minBlock: nullableNumber(task.min_block),
      maxBlock: nullableNumber(task.max_block),
      startHint: task.start_hint || "",
      missedCount: Number(task.missed_count || 0),
      history: historyByTask.get(task.id) || []
    })),
    events: events.map((event) => ({
      id: event.id,
      title: event.title,
      start: event.start_at,
      end: event.end_at,
      repeating: Boolean(event.repeating)
    }))
  });
}

function settingsToSupabaseRow(userId, settings) {
  return {
    user_id: userId,
    wake: settings.wake,
    sleep: settings.sleep,
    min_block: settings.minBlock,
    max_block: settings.maxBlock,
    daily_buffer: settings.dailyBuffer,
    deadline_buffer_hours: settings.deadlineBufferHours
  };
}

function taskToSupabaseRow(userId, task) {
  return {
    user_id: userId,
    id: task.id,
    title: task.title,
    duration: task.duration,
    done_minutes: Math.min(task.doneMinutes || 0, task.duration),
    deadline: task.deadline,
    mode: task.mode || "auto",
    depends_on: task.dependsOn || null,
    min_block: nullableNumber(task.minBlock),
    max_block: nullableNumber(task.maxBlock),
    start_hint: task.startHint || "",
    missed_count: task.missedCount || 0
  };
}

function eventToSupabaseRow(userId, event) {
  return {
    user_id: userId,
    id: event.id,
    title: event.title,
    start_at: event.start,
    end_at: event.end,
    repeating: Boolean(event.repeating)
  };
}

function historyToSupabaseRow(userId, taskId, item) {
  return {
    user_id: userId,
    task_id: taskId,
    id: item.id,
    label: item.label,
    minutes: Number(item.minutes || 0),
    happened_at: item.at || new Date().toISOString()
  };
}

function throwIfSupabaseError(...results) {
  const failure = results.find((result) => result?.error);
  if (failure) throw failure.error;
}

function nullableNumber(value) {
  return value === "" || value == null || Number.isNaN(Number(value)) ? null : Number(value);
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
