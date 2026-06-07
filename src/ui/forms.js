import { formatTaskFitError, validateTaskFits } from "../domain/taskValidation.js";
import { $, closeDialog, showToast } from "./dom.js";

export function bindForms(store, getCurrentPlan) {
  const taskModal = $("#taskModal");
  const eventModal = $("#eventModal");
  const partialModal = $("#partialModal");
  setupDateTimeControls();

  ["#openTaskModal", "#openTaskModal2", "#fab"].forEach((selector) => {
    $(selector).addEventListener("click", () => openTaskModal(taskModal));
  });
  $("#openEventModal").addEventListener("click", () => openEventModal(eventModal));

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeDialog(button.closest("dialog")));
  });

  $("#taskForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearFormError(form);
    syncDateTimeControls(form);
    const data = formData(form);
    const deadline = new Date(data.deadline);

    if (!data.title.trim()) return setFormError(form, "请填写任务名。");
    if (!Number.isFinite(Number(data.duration)) || Number(data.duration) <= 0) return setFormError(form, "请填写有效的预计总时长。");
    if (!Number.isFinite(deadline.getTime())) return setFormError(form, "请填写有效的截止时间。");
    if (data.minBlock && data.maxBlock && Number(data.minBlock) > Number(data.maxBlock)) return setFormError(form, "最短单次不能大于最长单次。");
    if (data.taskId && data.dependsOn === data.taskId) return setFormError(form, "任务不能依赖自己。");

    const payload = {
      title: data.title.trim(),
      duration: Number(data.duration),
      deadline: deadline.toISOString(),
      mode: data.mode,
      dependsOn: data.dependsOn,
      minBlock: optionalNumber(data.minBlock),
      maxBlock: optionalNumber(data.maxBlock),
      startHint: data.startHint.trim()
    };
    const fit = validateTaskFits(store.getState(), data.taskId, payload);
    if (!fit.ok) return setFormError(form, formatTaskFitError(fit.risk, fit.plan.settings));

    if (data.taskId) {
      store.updateTask(data.taskId, payload);
      showToast("任务已更新，并重新排程。");
    } else {
      store.addTask(payload);
      showToast("任务已加入计划，并自动排程。");
    }

    closeDialog(taskModal);
    form.reset();
  });

  $("#eventForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearFormError(form);
    syncDateTimeControls(form);
    const data = formData(form);
    const start = new Date(data.start);
    const end = new Date(data.end);

    if (!data.title.trim()) return setFormError(form, "请填写日程名。");
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      return setFormError(form, "请填写有效的开始和结束时间，结束时间必须晚于开始时间。");
    }

    const payload = {
      title: data.title.trim(),
      start: start.toISOString(),
      end: end.toISOString(),
      repeating: Boolean(data.repeating)
    };

    if (data.eventId) {
      store.updateEvent(data.eventId, payload);
      showToast("日程已更新，并重新排程。");
    } else {
      store.addEvent(payload);
      showToast("日程已保存，排程会避开这段时间。");
    }

    closeDialog(eventModal);
    form.reset();
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
    const form = event.currentTarget;
    clearFormError(form);
    const data = formData(form);
    const block = getCurrentPlan().blocks.find((item) => item.id === data.blockId);
    if (!block) return closeDialog(partialModal);

    const minutes = Number(data.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return setFormError(form, "请填写有效的完成分钟数。");

    store.partiallyCompleteBlock(block, minutes);
    closeDialog(partialModal);
    showToast("已记录部分完成，剩余时间已重排。");
  });
}

export function openEditTaskModal(task) {
  openTaskModal($("#taskModal"), task);
}

export function openEditEventModal(event) {
  openEventModal($("#eventModal"), event);
}

export function openPartialModal(block) {
  const modal = $("#partialModal");
  const form = $("#partialForm");
  clearFormError(form);
  form.blockId.value = block.id;
  form.minutes.value = Math.min(15, block.minutes);
  modal.showModal();
}

function openTaskModal(modal, task = null) {
  const form = $("#taskForm");
  const deadline = new Date();

  clearFormError(form);
  form.reset();
  $("#taskModalTitle").textContent = task ? "编辑任务" : "新建任务";
  $("#taskSubmitLabel").textContent = task ? "保存修改并排程" : "保存并排程";
  form.taskId.value = task?.id || "";
  form.title.value = task?.title || "";
  form.duration.value = task?.duration ?? 90;
  setDateTimeControl(form, "deadline", task ? new Date(task.deadline) : deadline);
  form.mode.value = task?.mode || "auto";
  form.dependsOn.value = task?.dependsOn || "";
  form.minBlock.value = task?.minBlock ?? "";
  form.maxBlock.value = task?.maxBlock ?? "";
  form.startHint.value = task?.startHint || "";
  syncDependencyOptions(task?.id || "");
  modal.showModal();
}

function openEventModal(modal, event = null) {
  const form = $("#eventForm");
  const start = new Date();
  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  clearFormError(form);
  form.reset();
  $("#eventModalTitle").textContent = event ? "编辑日程" : "新建日程";
  $("#eventSubmitLabel").textContent = event ? "保存修改并重排" : "保存并重排";
  form.eventId.value = event?.id || "";
  form.title.value = event?.title || "";
  setDateTimeControl(form, "start", event ? new Date(event.start) : start);
  setDateTimeControl(form, "end", event ? new Date(event.end) : end);
  form.repeating.checked = Boolean(event?.repeating);
  modal.showModal();
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function optionalNumber(value) {
  return value === "" || value == null ? undefined : Number(value);
}

function setFormError(form, message) {
  const error = form.querySelector("[data-form-error]");
  error.textContent = message;
  error.hidden = false;
  error.scrollIntoView({ block: "nearest" });
}

function clearFormError(form) {
  const error = form.querySelector("[data-form-error]");
  if (!error) return;
  error.textContent = "";
  error.hidden = true;
}

function syncDependencyOptions(editingTaskId) {
  const select = $("#dependsSelect");
  [...select.options].forEach((option) => {
    option.disabled = Boolean(editingTaskId) && option.value === editingTaskId;
  });
}

function setupDateTimeControls() {
  document.querySelectorAll("[data-datetime-field]").forEach((control) => {
    const hour = control.querySelector("[data-hour]");
    const minute = control.querySelector("[data-minute]");
    if (!hour.options.length) {
      hour.innerHTML = range(24).map((value) => `<option value="${pad(value)}">${pad(value)}</option>`).join("");
    }
    if (!minute.options.length) {
      minute.innerHTML = range(60).map((value) => `<option value="${pad(value)}">${pad(value)}</option>`).join("");
    }
    control.querySelectorAll("input, select").forEach((input) => {
      input.addEventListener("change", () => syncDateTimeControl(control));
    });
  });
}

function setDateTimeControl(form, fieldName, date) {
  const value = new Date(date);
  const control = form.querySelector(`[data-datetime-field="${fieldName}"]`);
  if (!control) return;
  control.querySelector("[data-date]").value = datePart(value);
  control.querySelector("[data-hour]").value = pad(value.getHours());
  control.querySelector("[data-minute]").value = pad(value.getMinutes());
  syncDateTimeControl(control);
}

function syncDateTimeControls(form) {
  form.querySelectorAll("[data-datetime-field]").forEach(syncDateTimeControl);
}

function syncDateTimeControl(control) {
  const fieldName = control.dataset.datetimeField;
  const form = control.closest("form");
  const date = control.querySelector("[data-date]").value;
  const hour = control.querySelector("[data-hour]").value;
  const minute = control.querySelector("[data-minute]").value;
  form.elements[fieldName].value = date && hour && minute ? `${date}T${hour}:${minute}` : "";
}

function datePart(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function range(length) {
  return Array.from({ length }, (_, index) => index);
}
