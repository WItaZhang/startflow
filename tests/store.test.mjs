import test from "node:test";
import assert from "node:assert/strict";
import { createLocalRepository, createStore, createSupabaseRepository } from "../src/data/store.js";

test("local repositories keep user workspaces isolated", async () => {
  installMemoryStorage();

  const alice = createStore(createLocalRepository("alice"));
  await alice.hydrate();
  assert.equal(alice.getState().tasks.length, 3);
  alice.clearWorkspace();
  await flushPromises();
  assert.equal(alice.getState().tasks.length, 0);

  const bob = createStore(createLocalRepository("bob"));
  await bob.hydrate();
  assert.equal(bob.getState().tasks.length, 3);

  const aliceAgain = createStore(createLocalRepository("alice"));
  await aliceAgain.hydrate();
  assert.equal(aliceAgain.getState().tasks.length, 0);
});

test("store serializes saves so stale snapshots cannot overwrite newer state", async () => {
  installMemoryStorage();
  const saves = [];
  const gates = [];
  const repository = {
    loadCachedState: () => ({
      version: 1,
      settings: {
        wake: "07:30",
        sleep: "23:30",
        minBlock: 25,
        maxBlock: 90,
        dailyBuffer: 30,
        deadlineBufferHours: 2
      },
      tasks: [],
      events: []
    }),
    async loadState() {
      return this.loadCachedState();
    },
    saveState(state) {
      const gate = createDeferred();
      saves.push(JSON.parse(JSON.stringify(state)));
      gates.push(gate);
      return gate.promise;
    }
  };

  const store = createStore(repository);
  store.updateSettings({ wake: "08:00" });
  await flushPromises();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].settings.wake, "08:00");

  store.updateSettings({ wake: "09:00" });
  await flushPromises();
  assert.equal(saves.length, 1);

  gates[0].resolve();
  await waitFor(() => saves.length === 2);
  assert.equal(saves[1].settings.wake, "09:00");

  gates[1].resolve();
  await waitFor(() => store.getStatus().saving === false);
  assert.equal(store.getStatus().error, "");
});

test("supabase repository saves normalized rows and deletes stale rows", async () => {
  installMemoryStorage();
  const db = createFakeSupabase();
  const repository = createSupabaseRepository(db.client, "user-1");
  const state = {
    version: 1,
    settings: {
      wake: "08:00",
      sleep: "23:00",
      minBlock: 30,
      maxBlock: 90,
      dailyBuffer: 20,
      deadlineBufferHours: 1
    },
    tasks: [
      {
        id: "task-a",
        title: "Write report",
        duration: 120,
        doneMinutes: 30,
        deadline: "2026-06-08T18:00:00.000Z",
        mode: "auto",
        dependsOn: "",
        minBlock: 30,
        maxBlock: 60,
        startHint: "Open notes",
        missedCount: 1,
        history: [{ id: "history-a", label: "做了一部分：30 分钟", minutes: 30, at: "2026-06-07T10:00:00.000Z" }]
      }
    ],
    events: [
      {
        id: "event-a",
        title: "Class",
        start: "2026-06-08T09:00:00.000Z",
        end: "2026-06-08T10:00:00.000Z",
        repeating: true
      }
    ]
  };

  await repository.saveState(state);
  assert.equal(db.tables.user_settings.length, 1);
  assert.equal(db.tables.tasks.length, 1);
  assert.equal(db.tables.events.length, 1);
  assert.equal(db.tables.task_history.length, 1);
  assert.equal(db.tables.tasks[0].done_minutes, 30);

  await repository.saveState({ ...state, tasks: [], events: [] });
  assert.equal(db.tables.tasks.length, 0);
  assert.equal(db.tables.events.length, 0);
  assert.equal(db.tables.task_history.length, 0);
});

test("supabase repository loads normalized rows into app state", async () => {
  installMemoryStorage();
  const db = createFakeSupabase({
    user_settings: [
      {
        user_id: "user-1",
        wake: "08:30",
        sleep: "22:30",
        min_block: 40,
        max_block: 80,
        daily_buffer: 10,
        deadline_buffer_hours: 3
      }
    ],
    tasks: [
      {
        user_id: "user-1",
        id: "task-a",
        title: "Exam prep",
        duration: 180,
        done_minutes: 60,
        deadline: "2026-06-09T20:00:00.000Z",
        mode: "split",
        depends_on: null,
        min_block: 30,
        max_block: 90,
        start_hint: "Read outline",
        missed_count: 2
      }
    ],
    events: [
      {
        user_id: "user-1",
        id: "event-a",
        title: "Lunch",
        start_at: "2026-06-08T12:00:00.000Z",
        end_at: "2026-06-08T13:00:00.000Z",
        repeating: false
      }
    ],
    task_history: [
      {
        user_id: "user-1",
        task_id: "task-a",
        id: "history-a",
        label: "完成",
        minutes: 60,
        happened_at: "2026-06-07T12:00:00.000Z"
      }
    ]
  });

  const state = await createSupabaseRepository(db.client, "user-1").loadState();
  assert.equal(state.settings.wake, "08:30");
  assert.equal(state.tasks[0].title, "Exam prep");
  assert.equal(state.tasks[0].doneMinutes, 60);
  assert.equal(state.tasks[0].history[0].label, "完成");
  assert.equal(state.events[0].title, "Lunch");
});

function installMemoryStorage() {
  const values = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    }
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function waitFor(assertion, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (assertion()) return;
    await flushPromises();
  }
  throw new Error("Timed out waiting for condition.");
}

function createFakeSupabase(seed = {}) {
  const tables = {
    user_settings: [...(seed.user_settings || [])],
    tasks: [...(seed.tasks || [])],
    events: [...(seed.events || [])],
    task_history: [...(seed.task_history || [])]
  };

  const client = {
    from(table) {
      return new FakeQuery(tables, table);
    }
  };

  return { client, tables };
}

class FakeQuery {
  constructor(tables, table) {
    this.tables = tables;
    this.table = table;
    this.filters = [];
    this.orderBy = null;
    this.operation = "select";
  }

  select() {
    this.operation = "select";
    return this;
  }

  eq(column, value) {
    this.filters.push({ column, value });
    return this;
  }

  order(column, options = {}) {
    this.orderBy = { column, ascending: options.ascending !== false };
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.execute(true));
  }

  upsert(rows) {
    const values = Array.isArray(rows) ? rows : [rows];
    for (const row of values) {
      const index = this.tables[this.table].findIndex((item) => samePrimaryKey(this.table, item, row));
      if (index >= 0) {
        this.tables[this.table][index] = { ...this.tables[this.table][index], ...row };
      } else {
        this.tables[this.table].push({ ...row });
      }
    }
    return Promise.resolve({ error: null });
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  then(resolve, reject) {
    return Promise.resolve(this.execute(false)).then(resolve, reject);
  }

  execute(single) {
    const rows = this.tables[this.table].filter((row) =>
      this.filters.every((filter) => row[filter.column] === filter.value)
    );
    if (this.operation === "delete") {
      this.tables[this.table] = this.tables[this.table].filter((row) => !rows.includes(row));
      return { error: null };
    }

    const sorted = this.orderBy
      ? [...rows].sort((a, b) => String(a[this.orderBy.column]).localeCompare(String(b[this.orderBy.column])))
      : rows;
    return { data: single ? sorted[0] || null : sorted.map((row) => ({ ...row })), error: null };
  }
}

function samePrimaryKey(table, left, right) {
  if (table === "user_settings") return left.user_id === right.user_id;
  if (table === "task_history") return left.user_id === right.user_id && left.task_id === right.task_id && left.id === right.id;
  return left.user_id === right.user_id && left.id === right.id;
}
