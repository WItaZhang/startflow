import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../src/domain/scheduler.js";

test("scheduler avoids fixed events", () => {
  const state = {
    settings: {
      wake: "08:00",
      sleep: "22:00",
      minBlock: 30,
      maxBlock: 90,
      dailyBuffer: 0,
      deadlineBufferHours: 0
    },
    tasks: [
      {
        id: "task-a",
        title: "写作业",
        duration: 60,
        doneMinutes: 0,
        deadline: "2026-06-06T20:00:00.000Z",
        mode: "auto",
        dependsOn: "",
        history: []
      }
    ],
    events: [
      {
        id: "event-a",
        title: "上课",
        start: "2026-06-06T08:30:00.000Z",
        end: "2026-06-06T10:30:00.000Z",
        repeating: false
      }
    ]
  };

  const plan = buildPlan(state, { now: "2026-06-06T08:00:00.000Z", horizonDays: 2 });
  const task = plan.blocks.find((block) => block.type === "task");
  assert.ok(task);
  assert.ok(task.end <= new Date("2026-06-06T08:30:00.000Z") || task.start >= new Date("2026-06-06T10:30:00.000Z"));
});

test("scheduler respects dependencies", () => {
  const state = {
    settings: {
      wake: "08:00",
      sleep: "22:00",
      minBlock: 30,
      maxBlock: 60,
      dailyBuffer: 0,
      deadlineBufferHours: 0
    },
    tasks: [
      {
        id: "task-a",
        title: "查资料",
        duration: 60,
        doneMinutes: 0,
        deadline: "2026-06-07T20:00:00.000Z",
        mode: "auto",
        dependsOn: "",
        history: []
      },
      {
        id: "task-b",
        title: "写初稿",
        duration: 60,
        doneMinutes: 0,
        deadline: "2026-06-07T21:00:00.000Z",
        mode: "auto",
        dependsOn: "task-a",
        history: []
      }
    ],
    events: []
  };

  const plan = buildPlan(state, { now: "2026-06-06T08:00:00.000Z", horizonDays: 3 });
  const first = plan.blocks.find((block) => block.taskId === "task-a");
  const second = plan.blocks.find((block) => block.taskId === "task-b");
  assert.ok(first);
  assert.ok(second);
  assert.ok(second.start >= first.end);
});

test("scheduler reports capacity risk", () => {
  const state = {
    settings: {
      wake: "08:00",
      sleep: "09:00",
      minBlock: 30,
      maxBlock: 60,
      dailyBuffer: 0,
      deadlineBufferHours: 0
    },
    tasks: [
      {
        id: "task-a",
        title: "超大任务",
        duration: 180,
        doneMinutes: 0,
        deadline: "2026-06-06T09:00:00.000Z",
        mode: "auto",
        dependsOn: "",
        history: []
      }
    ],
    events: []
  };

  const plan = buildPlan(state, { now: "2026-06-06T08:00:00.000Z", horizonDays: 1 });
  assert.equal(plan.risks.length, 1);
  assert.equal(plan.risks[0].type, "capacity");
});

test("scheduler does not create sub-minimum trailing blocks", () => {
  const state = {
    settings: {
      wake: "08:00",
      sleep: "22:00",
      minBlock: 60,
      maxBlock: 90,
      dailyBuffer: 0,
      deadlineBufferHours: 0
    },
    tasks: [
      {
        id: "task-a",
        title: "长任务",
        duration: 175,
        doneMinutes: 0,
        deadline: "2026-06-07T21:00:00.000Z",
        mode: "auto",
        dependsOn: "",
        history: []
      }
    ],
    events: []
  };

  const plan = buildPlan(state, { now: "2026-06-06T08:00:00.000Z", horizonDays: 3 });
  const taskBlocks = plan.blocks.filter((block) => block.type === "task");
  assert.equal(taskBlocks.length, 2);
  assert.ok(taskBlocks.every((block) => block.minutes >= 60));
  assert.equal(taskBlocks.reduce((sum, block) => sum + block.minutes, 0), 175);
});
