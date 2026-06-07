import test from "node:test";
import assert from "node:assert/strict";
import { buildTimelineLayout } from "../src/ui/render.js";

test("timeline layout pushes visually tall blocks apart", () => {
  const today = new Date("2026-06-07T00:00:00");
  const tomorrow = new Date("2026-06-08T00:00:00");
  const settings = {
    wake: "07:30",
    sleep: "23:30"
  };
  const blocks = [
    {
      id: "task-1",
      type: "task",
      taskId: "task-a",
      title: "查资料：课程论文",
      start: new Date("2026-06-07T07:30:00"),
      end: new Date("2026-06-07T08:00:00"),
      minutes: 30,
      startHint: "打开资料列表，先读第一段",
      missedCount: 0
    },
    {
      id: "event-1",
      type: "event",
      title: "早八课程",
      start: new Date("2026-06-07T08:00:00"),
      end: new Date("2026-06-07T09:30:00")
    },
    {
      id: "task-2",
      type: "task",
      taskId: "task-b",
      title: "统计作业",
      start: new Date("2026-06-07T09:30:00"),
      end: new Date("2026-06-07T10:30:00"),
      minutes: 60,
      startHint: "先把题目和数据文件打开",
      missedCount: 1
    }
  ];

  const layout = buildTimelineLayout(blocks, settings, today, tomorrow);

  for (let index = 1; index < layout.items.length; index += 1) {
    const previous = layout.items[index - 1];
    const current = layout.items[index];
    assert.ok(current.top >= previous.top + previous.height + 12);
  }
});
