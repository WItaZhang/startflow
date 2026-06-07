import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../src/domain/scheduler.js";
import { validateEventImpact, validateSettingsImpact, validateTaskFits, wouldCreateDependencyCycle } from "../src/domain/taskValidation.js";

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

test("scheduler never overlaps task blocks with busy blocks", () => {
  const state = {
    settings: {
      wake: "07:30",
      sleep: "23:30",
      minBlock: 30,
      maxBlock: 60,
      dailyBuffer: 0,
      deadlineBufferHours: 0
    },
    tasks: [
      {
        id: "paper",
        title: "Paper reading",
        duration: 150,
        doneMinutes: 0,
        deadline: "2026-06-07T18:00:00.000Z",
        mode: "auto",
        dependsOn: "",
        history: []
      },
      {
        id: "stats",
        title: "Stats homework",
        duration: 120,
        doneMinutes: 0,
        deadline: "2026-06-07T20:00:00.000Z",
        mode: "auto",
        dependsOn: "",
        history: []
      }
    ],
    events: [
      {
        id: "class",
        title: "Class",
        start: "2026-06-07T08:00:00.000Z",
        end: "2026-06-07T09:30:00.000Z",
        repeating: false
      },
      {
        id: "lunch",
        title: "Lunch",
        start: "2026-06-07T12:00:00.000Z",
        end: "2026-06-07T13:00:00.000Z",
        repeating: false
      }
    ]
  };

  const plan = buildPlan(state, { now: "2026-06-07T07:30:00.000Z", horizonDays: 1 });
  const taskBlocks = plan.blocks.filter((block) => block.type === "task");
  const busyBlocks = plan.blocks.filter((block) => block.type !== "task");

  for (const taskBlock of taskBlocks) {
    for (const busyBlock of busyBlocks) {
      assert.equal(overlaps(taskBlock, busyBlock), false, `${taskBlock.title} overlaps ${busyBlock.title}`);
    }
  }

  for (let index = 0; index < taskBlocks.length; index += 1) {
    for (let other = index + 1; other < taskBlocks.length; other += 1) {
      assert.equal(overlaps(taskBlocks[index], taskBlocks[other]), false, "task blocks overlap each other");
    }
  }
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

test("task validation rejects circular dependencies", () => {
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
        title: "Task A",
        duration: 30,
        doneMinutes: 0,
        deadline: "2026-06-07T20:00:00.000Z",
        mode: "auto",
        dependsOn: "task-b",
        history: []
      },
      {
        id: "task-b",
        title: "Task B",
        duration: 30,
        doneMinutes: 0,
        deadline: "2026-06-07T21:00:00.000Z",
        mode: "auto",
        dependsOn: "",
        history: []
      }
    ],
    events: []
  };

  const result = validateTaskFits(
    state,
    "task-b",
    {
      title: "Task B",
      duration: 30,
      deadline: "2026-06-07T21:00:00.000Z",
      mode: "auto",
      dependsOn: "task-a",
      startHint: ""
    },
    { now: "2026-06-06T08:00:00.000Z" }
  );

  assert.equal(wouldCreateDependencyCycle(state.tasks, "task-b", "task-a"), true);
  assert.equal(result.ok, false);
  assert.equal(result.risk.type, "dependency-cycle");
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
        deadline: "2026-06-06T09:00:00",
        mode: "auto",
        dependsOn: "",
        history: []
      }
    ],
    events: []
  };

  const plan = buildPlan(state, { now: "2026-06-06T08:00:00", horizonDays: 1 });
  assert.equal(plan.risks.length, 1);
  assert.equal(plan.risks[0].type, "capacity");
  assert.equal(plan.risks[0].remaining, 120);
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

test("scheduler supports sleep times after midnight", () => {
  const state = {
    settings: {
      wake: "09:00",
      sleep: "01:00",
      minBlock: 60,
      maxBlock: 60,
      dailyBuffer: 0,
      deadlineBufferHours: 0
    },
    tasks: [
      {
        id: "night-task",
        title: "Night study",
        duration: 60,
        doneMinutes: 0,
        deadline: "2026-06-08T00:30:00",
        mode: "auto",
        dependsOn: "",
        history: []
      }
    ],
    events: []
  };

  const plan = buildPlan(state, { now: "2026-06-07T22:00:00", horizonDays: 2 });
  const taskBlocks = plan.blocks.filter((block) => block.taskId === "night-task");
  const sleepBlocks = plan.blocks.filter((block) => block.type === "sleep");

  assert.equal(plan.risks.length, 0);
  assert.equal(taskBlocks.length, 1);
  assert.equal(taskBlocks[0].start.getHours(), 22);
  assert.equal(taskBlocks[0].minutes, 60);
  assert.ok(sleepBlocks.some((block) => block.start.getHours() === 1 && block.end.getHours() === 9));
});

test("task validation rejects a task that cannot fit", () => {
  const state = {
    settings: {
      wake: "08:00",
      sleep: "09:00",
      minBlock: 30,
      maxBlock: 60,
      dailyBuffer: 0,
      deadlineBufferHours: 0
    },
    tasks: [],
    events: []
  };

  const result = validateTaskFits(
    state,
    "",
    {
      title: "Exam prep",
      duration: 180,
      deadline: "2026-06-06T09:00:00",
      mode: "auto",
      dependsOn: "",
      startHint: ""
    },
    { now: "2026-06-06T08:00:00" }
  );

  assert.equal(result.ok, false);
  assert.equal(result.risk.type, "capacity");
  assert.equal(result.risk.remaining, 120);
});

test("event validation rejects a fixed event that creates new capacity risk", () => {
  const state = {
    settings: {
      wake: "08:00",
      sleep: "22:00",
      minBlock: 60,
      maxBlock: 60,
      dailyBuffer: 0,
      deadlineBufferHours: 0
    },
    tasks: [
      {
        id: "task-a",
        title: "Morning task",
        duration: 60,
        doneMinutes: 0,
        deadline: "2026-06-06T10:00:00",
        mode: "auto",
        dependsOn: "",
        history: []
      }
    ],
    events: []
  };

  const result = validateEventImpact(
    state,
    "",
    {
      title: "Class",
      start: "2026-06-06T08:00:00",
      end: "2026-06-06T09:30:00",
      repeating: false
    },
    { now: "2026-06-06T08:00:00" }
  );

  assert.equal(result.ok, false);
  assert.equal(result.risks.length, 1);
  assert.equal(result.risks[0].taskId, "task-a");
  assert.equal(result.risks[0].type, "capacity");
});

test("event validation ignores unchanged existing risks", () => {
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
        id: "old-risk",
        title: "Already too large",
        duration: 180,
        doneMinutes: 0,
        deadline: "2026-06-06T09:00:00",
        mode: "auto",
        dependsOn: "",
        history: []
      }
    ],
    events: []
  };

  const result = validateEventImpact(
    state,
    "",
    {
      title: "Dinner",
      start: "2026-06-07T18:00:00",
      end: "2026-06-07T19:00:00",
      repeating: false
    },
    { now: "2026-06-06T08:00:00" }
  );

  assert.equal(result.ok, true);
});

test("settings validation rejects settings that create new capacity risk", () => {
  const state = {
    settings: {
      wake: "08:00",
      sleep: "12:00",
      minBlock: 60,
      maxBlock: 60,
      dailyBuffer: 0,
      deadlineBufferHours: 0
    },
    tasks: [
      {
        id: "early-task",
        title: "Early task",
        duration: 60,
        doneMinutes: 0,
        deadline: "2026-06-06T09:30:00",
        mode: "auto",
        dependsOn: "",
        history: []
      }
    ],
    events: []
  };

  const result = validateSettingsImpact(
    state,
    {
      wake: "09:00",
      sleep: "12:00",
      minBlock: 60,
      maxBlock: 60,
      dailyBuffer: 0,
      deadlineBufferHours: 0
    },
    { now: "2026-06-06T08:00:00" }
  );

  assert.equal(result.ok, false);
  assert.equal(result.risks.length, 1);
  assert.equal(result.risks[0].taskId, "early-task");
});

test("settings validation ignores existing risks that do not worsen", () => {
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
        id: "old-risk",
        title: "Already too large",
        duration: 180,
        doneMinutes: 0,
        deadline: "2026-06-06T09:00:00",
        mode: "auto",
        dependsOn: "",
        history: []
      }
    ],
    events: []
  };

  const result = validateSettingsImpact(
    state,
    {
      wake: "07:00",
      sleep: "09:00",
      minBlock: 30,
      maxBlock: 60,
      dailyBuffer: 0,
      deadlineBufferHours: 0
    },
    { now: "2026-06-06T08:00:00" }
  );

  assert.equal(result.ok, true);
});

test("scheduler accepts a 300 minute task when the available window is enough", () => {
  const state = {
    settings: {
      wake: "08:00",
      sleep: "23:00",
      minBlock: 60,
      maxBlock: 90,
      dailyBuffer: 0,
      deadlineBufferHours: 2
    },
    tasks: [
      {
        id: "mlsys",
        title: "mlsys考试",
        duration: 300,
        doneMinutes: 0,
        deadline: "2026-06-06T15:00:00",
        mode: "auto",
        dependsOn: "",
        history: []
      }
    ],
    events: []
  };

  const plan = buildPlan(state, { now: "2026-06-06T08:00:00", horizonDays: 1 });
  const taskBlocks = plan.blocks.filter((block) => block.taskId === "mlsys");

  assert.equal(plan.risks.length, 0);
  assert.equal(taskBlocks.reduce((sum, block) => sum + block.minutes, 0), 300);
  assert.ok(taskBlocks.every((block) => block.minutes >= 60));
});

test("task validation accepts a 300 minute task when the available window is enough", () => {
  const state = {
    settings: {
      wake: "08:00",
      sleep: "23:00",
      minBlock: 60,
      maxBlock: 90,
      dailyBuffer: 0,
      deadlineBufferHours: 2
    },
    tasks: [],
    events: []
  };

  const result = validateTaskFits(
    state,
    "",
    {
      title: "mlsys考试",
      duration: 300,
      deadline: "2026-06-06T15:00:00",
      mode: "auto",
      dependsOn: "",
      startHint: ""
    },
    { now: "2026-06-06T08:00:00" }
  );

  assert.equal(result.ok, true);
});

test("task validation only blocks the task being saved", () => {
  const state = {
    settings: {
      wake: "08:00",
      sleep: "10:00",
      minBlock: 30,
      maxBlock: 60,
      dailyBuffer: 0,
      deadlineBufferHours: 0
    },
    tasks: [
      {
        id: "old-risk",
        title: "Too large",
        duration: 180,
        doneMinutes: 0,
        deadline: "2026-06-06T10:00:00.000Z",
        mode: "auto",
        dependsOn: "",
        history: []
      }
    ],
    events: []
  };

  const result = validateTaskFits(
    state,
    "",
    {
      title: "Small task",
      duration: 30,
      deadline: "2026-06-07T10:00:00.000Z",
      mode: "auto",
      dependsOn: "",
      startHint: ""
    },
    { now: "2026-06-06T08:00:00.000Z" }
  );

  assert.equal(result.ok, true);
});

function overlaps(left, right) {
  return left.start < right.end && right.start < left.end;
}
