import { toDateInputValue } from "../domain/time.js";
import { $, closeDialog, showToast } from "./dom.js";

export function bindForms(store, getCurrentPlan) {
  const taskModal = $("#taskModal");
  const eventModal = $("#eventModal");
  const partialModal = $("#partialModal");

  ["#openTaskModal", "#openTaskModal2", "#fab"].forEach((selector) => {
    $(selector).addEventListener("click", () => openTaskModal(taskModal));
  });
  $("#openEventModal").addEventListener("click", () => openEventModal(eventModal));

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeDialog(button.closest("dialog")));
  });

  $("#taskForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    const deadline = new Date(data.deadline);
    if (!Number.isFinite(deadline.getTime())) return showToast("请填写有效的截止时间。");

    store.addTask({
      title: data.title,
      duration: Number(data.duration),
      deadline: deadline.toISOString(),
      mode: data.mode,
      dependsOn: data.dependsOn,
      minBlock: optionalNumber(data.minBlock),
      maxBlock: optionalNumber(data.maxBlock),
      startHint: data.startHint
    });
    closeDialog(taskModal);
    event.currentTarget.reset();
    showToast("任务已加入计划，并自动排程。");
  });

  $("#eventForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    const start = new Date(data.start);
    const end = new Date(data.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      return showToast("请填写有效的开始和结束时间。");
    }
    store.addEvent({
      title: data.title,
      start: start.toISOString(),
      end: end.toISOString(),
      repeating: Boolean(data.repeating)
    });
    closeDialog(eventModal);
    event.currentTarget.reset();
    showToast("日程已保存，排程会避开这段时间。");
  });

  $("#settingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    store.updateSettings({
      wake: data.wake,
      sleep: data.sleep,
      minBlock: Number(data.minBlock),
      maxBlock: Number(data.maxBlock),
      dailyBuffer: Number(data.dailyBuffer),
      deadlineBufferHours: Number(data.deadlineBuffer)
    });
    showToast("设置已保存，并重新生成计划。");
  });

  $("#partialForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    const block = getCurrentPlan().blocks.find((item) => item.id === data.blockId);
    if (!block) return closeDialog(partialModal);
    store.partiallyCompleteBlock(block, Number(data.minutes));
    closeDialog(partialModal);
    showToast("已记录部分完成，剩余时间已重排。");
  });
}

export function openPartialModal(block) {
  const modal = $("#partialModal");
  $("#partialForm").blockId.value = block.id;
  $("#partialForm").minutes.value = Math.min(15, block.minutes);
  modal.showModal();
}

function openTaskModal(modal) {
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 3);
  deadline.setHours(23, 0, 0, 0);
  $("#taskForm").deadline.value = toDateInputValue(deadline);
  modal.showModal();
}

function openEventModal(modal) {
  const start = new Date();
  start.setHours(start.getHours() + 1, 0, 0, 0);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);
  $("#eventForm").start.value = toDateInputValue(start);
  $("#eventForm").end.value = toDateInputValue(end);
  modal.showModal();
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function optionalNumber(value) {
  return value === "" || value == null ? undefined : Number(value);
}
