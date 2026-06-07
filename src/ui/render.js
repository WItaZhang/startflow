import { addDays, formatDate, formatMonth, formatRange, formatTime, minutesBetween, startOfDay } from "../domain/time.js";
import { $, escapeHtml } from "./dom.js";

export function renderApp({ state, plan, selectedView, calendarDate, actions }) {
  renderStats(state, plan);
  renderTimeline(plan, actions);
  renderNextList(plan);
  renderTaskLibrary(state, actions);
  renderEventLibrary(state, actions);
  renderCalendar(plan, calendarDate);
  renderSettings(state);
  renderTaskDependencyOptions(state);
  updateViewTitles(selectedView);
}

function renderStats(state, plan) {
  const unfinished = state.tasks.filter((task) => task.doneMinutes < task.duration);
  $("#taskCount").textContent = `${unfinished.length} 个`;
  $("#riskCount").textContent = `${plan.risks.length} 个`;
  $("#loadRange").textContent = highLoadRange(plan.blocks) || "暂无";
  $("#todayDateLabel").textContent = formatDate(new Date());
}

function renderTimeline(plan, actions) {
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  const blocks = plan.blocks.filter((block) => block.end > today && block.start < tomorrow);
  const timeline = $("#timeline");

  if (!blocks.length) {
    timeline.innerHTML = `<div class="empty-state">今天没有排入任务。可以新建任务，或添加课程、聚餐等不可用时间后自动重排。</div>`;
    return;
  }

  timeline.innerHTML = blocks.map(renderTimelineBlock).join("");
  timeline.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const block = blocks.find((item) => item.id === button.dataset.blockId);
      if (!block) return;
      actions.onBlockAction(button.dataset.action, block);
    });
  });
}

function renderTimelineBlock(block) {
  const isTask = block.type === "task";
  const className = `schedule-block ${escapeHtml(block.type)}${isTask && block.missedCount ? " missed" : ""}`;
  const icon = block.type === "event" ? "event" : block.type === "sleep" ? "bedtime" : "bolt";
  const hint = isTask ? block.startHint || "先做 10 分钟也算开始" : "";
  const actions = isTask
    ? `<div class="block-actions">
        <button class="mini-button done" data-action="done" data-block-id="${escapeHtml(block.id)}">完成</button>
        <button class="mini-button partial" data-action="partial" data-block-id="${escapeHtml(block.id)}">做了一部分</button>
        <button class="mini-button miss" data-action="miss" data-block-id="${escapeHtml(block.id)}">没能做到</button>
      </div>`
    : "";

  return `<div class="time-row">
    <div class="time-label">${formatTime(block.start)}</div>
    <article class="${className}">
      <div class="block-top">
        <div>
          <p class="block-title">${escapeHtml(block.title)}</p>
          <p class="block-meta">${formatRange(block.start, block.end)}${isTask ? ` · ${block.minutes} 分钟` : ""}</p>
          ${hint ? `<p class="hint">${escapeHtml(hint)}</p>` : ""}
        </div>
        <span class="material-symbols-outlined">${icon}</span>
      </div>
      ${actions}
    </article>
  </div>`;
}

function renderNextList(plan) {
  const upcoming = plan.blocks
    .filter((block) => block.type === "task" && block.end > new Date())
    .slice(0, 5);

  $("#nextList").innerHTML = upcoming.length
    ? upcoming
        .map(
          (block) => `<article class="next-card">
            <div class="card-head">
              <div>
                <strong>${escapeHtml(block.title)}</strong>
                <span>${formatDate(block.start)} · ${formatRange(block.start, block.end)}</span>
              </div>
              <span class="tag">${block.minutes}m</span>
            </div>
          </article>`
        )
        .join("")
    : `<div class="empty-state">暂无接下来的任务块。</div>`;
}

function renderTaskLibrary(state, actions) {
  const tasks = [...state.tasks].sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

  $("#taskLibrary").innerHTML = tasks.length
    ? tasks.map((task) => renderTaskCard(task, state)).join("")
    : `<div class="empty-state">还没有任务。先添加一个任务名、预计时长和 DDL，系统会自动拆成时间块。</div>`;

  $("#taskLibrary").querySelectorAll("[data-task-action]").forEach((button) => {
    button.addEventListener("click", () => actions.onTaskAction(button.dataset.taskAction, button.dataset.taskId));
  });
}

function renderTaskCard(task, state) {
  const done = Math.min(task.duration, task.doneMinutes || 0);
  const percent = task.duration ? Math.round((done / task.duration) * 100) : 0;
  const dependency = task.dependsOn ? state.tasks.find((item) => item.id === task.dependsOn)?.title : "";
  const statusClass = percent >= 100 ? "done" : task.missedCount ? "risk" : "";
  const statusText = percent >= 100 ? "已完成" : task.missedCount ? `没能做到 ${task.missedCount} 次` : "进行中";

  return `<article class="task-card">
    <div class="card-head">
      <div>
        <strong>${escapeHtml(task.title)}</strong>
        <span>DDL ${formatDate(new Date(task.deadline))} ${formatTime(new Date(task.deadline))}</span>
      </div>
      <span class="status-pill ${statusClass}">${statusText}</span>
    </div>
    <div class="task-progress"><span style="width: ${percent}%"></span></div>
    <div class="block-meta">${done}/${task.duration} 分钟 · ${modeLabel(task.mode)}${dependency ? ` · 依赖：${escapeHtml(dependency)}` : ""}</div>
    <div class="card-actions">
      <button class="mini-button partial" data-task-action="edit" data-task-id="${escapeHtml(task.id)}">编辑</button>
      <button class="mini-button done" data-task-action="done" data-task-id="${escapeHtml(task.id)}">标记完成</button>
      <button class="mini-button miss" data-task-action="delete" data-task-id="${escapeHtml(task.id)}">删除</button>
    </div>
  </article>`;
}

function renderEventLibrary(state, actions) {
  $("#eventLibrary").innerHTML = state.events.length
    ? state.events
        .map(
          (event) => `<article class="event-card">
            <div class="card-head">
              <div>
                <strong>${escapeHtml(event.title)}</strong>
                <span>${formatDate(new Date(event.start))} · ${formatRange(new Date(event.start), new Date(event.end))}</span>
              </div>
              <span class="tag">${event.repeating ? "每周" : "单次"}</span>
            </div>
            <div class="card-actions">
              <button class="mini-button miss" data-event-action="delete" data-event-id="${escapeHtml(event.id)}">删除</button>
            </div>
          </article>`
        )
        .join("")
    : `<div class="empty-state">还没有固定安排。添加课表、聚餐、会议后，系统会自动避开这些时间。</div>`;

  $("#eventLibrary").querySelectorAll("[data-event-action]").forEach((button) => {
    button.addEventListener("click", () => actions.onEventAction(button.dataset.eventAction, button.dataset.eventId));
  });
}

function renderCalendar(plan, calendarDate) {
  const monthStart = startOfDay(new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1));
  const gridStart = addDays(monthStart, -((monthStart.getDay() + 6) % 7));
  const todayKey = dayKey(new Date());

  $("#monthTitle").textContent = formatMonth(calendarDate);
  $("#calendarGrid").innerHTML = Array.from({ length: 42 }, (_, index) => {
    const day = addDays(gridStart, index);
    const inMonth = day.getMonth() === calendarDate.getMonth();
    const key = dayKey(day);
    const dayBlocks = plan.blocks.filter((block) => dayKey(block.start) === key && block.type !== "sleep").slice(0, 4);

    return `<div class="day-cell ${inMonth ? "" : "muted"} ${key === todayKey ? "today" : ""}">
      <span class="day-number">${day.getDate()}</span>
      <div class="day-items">
        ${dayBlocks
          .map((block) => `<div class="day-chip ${escapeHtml(block.type)}">${escapeHtml(block.type === "task" ? block.title : block.title)}</div>`)
          .join("")}
      </div>
    </div>`;
  }).join("");
}

function renderSettings(state) {
  const form = $("#settingsForm");
  form.wake.value = state.settings.wake;
  form.sleep.value = state.settings.sleep;
  form.minBlock.value = state.settings.minBlock;
  form.maxBlock.value = state.settings.maxBlock;
  form.dailyBuffer.value = state.settings.dailyBuffer;
  form.deadlineBuffer.value = state.settings.deadlineBufferHours;
}

function renderTaskDependencyOptions(state) {
  const select = $("#dependsSelect");
  select.innerHTML = `<option value="">无</option>${state.tasks
    .map((task) => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.title)}</option>`)
    .join("")}`;
}

function updateViewTitles(selectedView) {
  const titles = {
    today: ["今日概览", "把今天变成能开始的几个时间块"],
    tasks: ["任务库", "管理任务、依赖和不可用时间"],
    calendar: ["日历", "查看自动排好的整月计划"],
    settings: ["设置", "调整睡眠时间和排程偏好"]
  };
  const [eyebrow, title] = titles[selectedView] || titles.today;
  $("#viewEyebrow").textContent = eyebrow;
  $("#viewTitle").textContent = title;
}

function highLoadRange(blocks) {
  const byDay = new Map();
  for (const block of blocks) {
    if (block.type !== "task") continue;
    const key = dayKey(block.start);
    byDay.set(key, (byDay.get(key) || 0) + minutesBetween(block.start, block.end));
  }
  const heavy = [...byDay.entries()].filter(([, minutes]) => minutes >= 180);
  if (!heavy.length) return "暂无";
  const first = new Date(heavy[0][0]);
  const last = new Date(heavy.at(-1)[0]);
  return heavy.length === 1 ? formatDate(first) : `${formatDate(first)} - ${formatDate(last)}`;
}

function modeLabel(mode) {
  return {
    auto: "系统帮我安排",
    single: "尽量一次做完",
    split: "不要一次做完"
  }[mode] || "系统帮我安排";
}

function dayKey(date) {
  return startOfDay(new Date(date)).toISOString().slice(0, 10);
}
