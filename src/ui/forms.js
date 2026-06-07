import {
  formatEventImpactError,
  formatSettingsImpactError,
  formatTaskFitError,
  validateEventImpact,
  validateSettingsImpact,
  validateTaskFits,
  wouldCreateDependencyCycle
} from "../domain/taskValidation.js";
import { $, closeDialog, showToast } from "./dom.js";

export function bindForms(store, getCurrentPlan) {
  const taskModal = $("#taskModal");
  const eventModal = $("#eventModal");
  const partialModal = $("#partialModal");
  setupDateTimeControls();
  setupBreakdownControls();

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

    if (wouldCreateDependencyCycle(store.getState().tasks, data.taskId, data.dependsOn)) {
      return setFormError(form, "任务依赖关系不能形成循环。");
    }

    const payload = {
      title: data.title.trim(),
      duration: Number(data.duration),
      deadline: deadline.toISOString(),
      mode: data.mode,
      breakdownMode: data.breakdownMode === "semantic" ? "semantic" : "time",
      priority: normalizePriorityInput(data.priority),
      energy: normalizeEnergyInput(data.energy),
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
    const impact = validateEventImpact(store.getState(), data.eventId, payload);
    if (!impact.ok) {
      return setFormError(form, formatEventImpactError(impact.risks, store.getState(), impact.plan.settings));
    }

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
    const form = event.currentTarget;
    clearFormError(form);
    const data = formData(form);
    const settings = {
      wake: data.wake,
      sleep: data.sleep,
      minBlock: Number(data.minBlock),
      maxBlock: Number(data.maxBlock),
      dailyBuffer: Number(data.dailyBuffer),
      deadlineBufferHours: Number(data.deadlineBuffer)
    };
    if (settings.minBlock > settings.maxBlock) return setFormError(form, "最短单次不能大于最长单次。");
    const impact = validateSettingsImpact(store.getState(), settings);
    if (!impact.ok) {
      return setFormError(form, formatSettingsImpactError(impact.risks, store.getState(), impact.plan.settings));
    }

    store.updateSettings(settings);
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
  form.priority.value = task?.priority || "normal";
  form.energy.value = task?.energy || "auto";
  setBreakdownMode(form, task?.breakdownMode || "time");
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

function normalizePriorityInput(value) {
  return ["low", "normal", "high", "urgent"].includes(value) ? value : "normal";
}

function normalizeEnergyInput(value) {
  return ["auto", "low", "medium", "high"].includes(value) ? value : "auto";
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
    enhanceDateTimeControl(control);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-datetime-field]")) closeDateTimePopovers();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDateTimePopovers();
  });
}

function setupBreakdownControls() {
  document.querySelectorAll("[data-breakdown-toggle]").forEach((toggle) => {
    const form = toggle.closest("form");
    const field = form?.elements.breakdownMode;
    if (!form || !field || toggle.dataset.enhanced) return;

    toggle.dataset.enhanced = "true";
    toggle.querySelectorAll("[data-breakdown-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        field.value = button.dataset.breakdownChoice === "semantic" ? "semantic" : "time";
        renderBreakdownToggle(toggle, field.value);
      });
    });
    renderBreakdownToggle(toggle, field.value || "time");
  });
}

function setBreakdownMode(form, mode) {
  const field = form.elements.breakdownMode;
  const toggle = form.querySelector("[data-breakdown-toggle]");
  const value = mode === "semantic" ? "semantic" : "time";
  if (field) field.value = value;
  if (toggle) renderBreakdownToggle(toggle, value);
}

function renderBreakdownToggle(toggle, mode) {
  toggle.querySelectorAll("[data-breakdown-choice]").forEach((option) => {
    option.classList.toggle("active", option.dataset.breakdownChoice === mode);
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
  renderDateTimeControl(control);
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
  updateDateTimeLabel(control);
}

function enhanceDateTimeControl(control) {
  if (control.dataset.enhanced) return;
  control.dataset.enhanced = "true";
  const dateInput = control.querySelector("[data-date]");
  dateInput.type = "hidden";
  control.querySelector(".time-wheel")?.setAttribute("hidden", "");

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "datetime-trigger";
  trigger.dataset.datetimeTrigger = "true";
  trigger.innerHTML = `<span data-datetime-label></span><span class="material-symbols-outlined">calendar_month</span>`;

  const popover = document.createElement("div");
  popover.className = "datetime-popover";
  popover.hidden = true;
  popover.innerHTML = `
    <div class="datetime-calendar">
      <div class="datetime-calendar-head">
        <button type="button" class="icon-button small" data-month-prev aria-label="上一月"><span class="material-symbols-outlined">chevron_left</span></button>
        <strong data-month-label></strong>
        <button type="button" class="icon-button small" data-month-next aria-label="下一月"><span class="material-symbols-outlined">chevron_right</span></button>
      </div>
      <div class="datetime-weekdays">${["日", "一", "二", "三", "四", "五", "六"].map((day) => `<span>${day}</span>`).join("")}</div>
      <div class="datetime-days" data-calendar-days></div>
    </div>
    <div class="datetime-time-panel">
      <div class="datetime-wheel-list" data-hour-wheel aria-label="小时"></div>
      <span class="datetime-colon">:</span>
      <div class="datetime-wheel-list" data-minute-wheel aria-label="分钟"></div>
    </div>`;

  control.prepend(popover);
  control.prepend(trigger);

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = popover.hidden;
    closeDateTimePopovers();
    popover.hidden = !willOpen;
    if (willOpen) {
      control.dataset.pickerMonth = monthKey(selectedDate(control));
      renderDateTimeControl(control);
      requestAnimationFrame(() => scrollSelectedWheelItems(control));
    }
  });

  popover.querySelector("[data-month-prev]").addEventListener("click", () => shiftPickerMonth(control, -1));
  popover.querySelector("[data-month-next]").addEventListener("click", () => shiftPickerMonth(control, 1));

  renderDateTimeControl(control);
}

function renderDateTimeControl(control) {
  updateDateTimeLabel(control);
  renderCalendar(control);
  renderTimeWheels(control);
}

function renderCalendar(control) {
  const date = selectedDate(control);
  const monthDate = control.dataset.pickerMonth ? monthFromKey(control.dataset.pickerMonth) : new Date(date.getFullYear(), date.getMonth(), 1);
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
  const selectedKey = datePart(date);
  const todayKey = datePart(new Date());
  const days = control.querySelector("[data-calendar-days]");
  const label = control.querySelector("[data-month-label]");
  if (!days || !label) return;

  label.textContent = `${firstOfMonth.getFullYear()}年 ${firstOfMonth.getMonth() + 1}月`;
  days.innerHTML = range(42)
    .map((index) => {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + index);
      const key = datePart(day);
      const classes = [
        day.getMonth() === firstOfMonth.getMonth() ? "" : "muted",
        key === selectedKey ? "selected" : "",
        key === todayKey ? "today" : ""
      ]
        .filter(Boolean)
        .join(" ");
      return `<button type="button" class="${classes}" data-date-choice="${key}">${day.getDate()}</button>`;
    })
    .join("");

  days.querySelectorAll("[data-date-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      control.querySelector("[data-date]").value = button.dataset.dateChoice;
      syncDateTimeControl(control);
      renderDateTimeControl(control);
    });
  });
}

function renderTimeWheels(control) {
  renderWheel(control, "[data-hour-wheel]", 24, control.querySelector("[data-hour]").value, (value) => {
    control.querySelector("[data-hour]").value = value;
  });
  renderWheel(control, "[data-minute-wheel]", 60, control.querySelector("[data-minute]").value, (value) => {
    control.querySelector("[data-minute]").value = value;
  });
}

function renderWheel(control, selector, length, currentValue, selectValue) {
  const wheel = control.querySelector(selector);
  if (!wheel) return;
  wheel.innerHTML = range(length)
    .map((value) => {
      const text = pad(value);
      return `<button type="button" class="${text === currentValue ? "selected" : ""}" data-wheel-value="${text}">${text}</button>`;
    })
    .join("");
  wheel.querySelectorAll("[data-wheel-value]").forEach((button) => {
    button.addEventListener("click", () => {
      selectValue(button.dataset.wheelValue);
      syncDateTimeControl(control);
      renderTimeWheels(control);
      requestAnimationFrame(() => scrollSelectedWheelItems(control));
    });
  });
}

function scrollSelectedWheelItems(control) {
  control.querySelectorAll(".datetime-wheel-list").forEach((wheel) => {
    const selected = wheel.querySelector(".selected");
    selected?.scrollIntoView({ block: "center" });
  });
}

function updateDateTimeLabel(control) {
  const label = control.querySelector("[data-datetime-label]");
  if (!label) return;
  const date = control.querySelector("[data-date]").value;
  const hour = control.querySelector("[data-hour]").value;
  const minute = control.querySelector("[data-minute]").value;
  label.textContent = date && hour && minute ? `${date.replaceAll("-", "/")} ${hour}:${minute}` : "选择时间";
}

function shiftPickerMonth(control, offset) {
  const base = control.dataset.pickerMonth ? monthFromKey(control.dataset.pickerMonth) : selectedDate(control);
  const next = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  control.dataset.pickerMonth = monthKey(next);
  renderCalendar(control);
}

function selectedDate(control) {
  const date = control.querySelector("[data-date]").value || datePart(new Date());
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day || 1);
}

function monthKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function monthFromKey(key) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function closeDateTimePopovers() {
  document.querySelectorAll(".datetime-popover").forEach((popover) => {
    popover.hidden = true;
  });
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
