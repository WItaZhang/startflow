import { createStore } from "./data/store.js";
import { buildPlan } from "./domain/scheduler.js";
import { addDays, startOfDay } from "./domain/time.js";
import { $, showToast } from "./ui/dom.js";
import { bindForms, openEditEventModal, openEditTaskModal, openPartialModal } from "./ui/forms.js";
import { bindNavigation } from "./ui/navigation.js";
import { renderApp, renderInsightModal } from "./ui/render.js";

const store = createStore();
let selectedView = "today";
let calendarDate = new Date();
let currentPlan = buildPlan(store.getState());

const actions = {
  onBlockAction(action, block) {
    if (action === "done") {
      store.completeBlock(block);
      showToast("已记录完成。后续计划已更新。");
    }
    if (action === "partial") {
      openPartialModal(block);
    }
    if (action === "miss") {
      store.missBlock(block);
      showToast("没关系，已把这段时间放回剩余量并重排。");
    }
  },
  onTaskAction(action, taskId) {
    if (action === "edit") {
      const task = store.getState().tasks.find((item) => item.id === taskId);
      if (task) openEditTaskModal(task);
    }
    if (action === "done") {
      store.markTaskDone(taskId);
      showToast("任务已标记完成。");
    }
    if (action === "delete") {
      store.deleteTask(taskId);
      showToast("任务已删除，相关依赖已清理。");
    }
  },
  onEventAction(action, eventId) {
    if (action === "edit") {
      const event = store.getState().events.find((item) => item.id === eventId);
      if (event) openEditEventModal(event);
    }
    if (action === "delete") {
      store.deleteEvent(eventId);
      showToast("日程已删除，并重新排程。");
    }
  }
};

bindNavigation((view) => {
  selectedView = view;
  render();
});

bindForms(store, () => currentPlan);

$("#rescheduleButton").addEventListener("click", () => {
  render();
  showToast("已根据当前任务、睡眠和不可用时间重新规划。");
});

$("#openLoadModal").addEventListener("click", () => {
  renderInsightModal("load", store.getState(), currentPlan);
  $("#insightModal").showModal();
});

$("#openRiskModal").addEventListener("click", () => {
  renderInsightModal("risk", store.getState(), currentPlan);
  $("#insightModal").showModal();
});

$("#openClearModal").addEventListener("click", () => {
  $("#clearModal").showModal();
});

$("#clearForm").addEventListener("submit", (event) => {
  event.preventDefault();
  store.clearWorkspace();
  $("#clearModal").close();
  showToast("已清理所有任务和日程，可以重新开始。");
});

$("#prevMonth").addEventListener("click", () => {
  calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
  render();
});

$("#nextMonth").addEventListener("click", () => {
  calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
  render();
});

$("#todayMonth").addEventListener("click", () => {
  calendarDate = new Date();
  render();
});

store.subscribe(render);
render();

function render() {
  const state = store.getState();
  currentPlan = buildPlan(state, {
    now: new Date(),
    horizonDays: daysUntilVisibleCalendar(calendarDate)
  });

  renderApp({
    state,
    plan: currentPlan,
    selectedView,
    calendarDate,
    actions
  });
}

function daysUntilVisibleCalendar(date) {
  const today = startOfDay(new Date());
  const visibleEnd = addDays(new Date(date.getFullYear(), date.getMonth() + 1, 7), 1);
  return Math.max(21, Math.ceil((visibleEnd - today) / (24 * 60 * 60 * 1000)));
}
