import { createLocalRepository, createStore, createSupabaseRepository } from "./data/store.js";
import { buildPlan } from "./domain/scheduler.js";
import { addDays, startOfDay } from "./domain/time.js";
import { createAuthController } from "./services/auth.js";
import { $, showToast } from "./ui/dom.js";
import { bindForms, openEditEventModal, openEditTaskModal, openPartialModal } from "./ui/forms.js";
import { bindNavigation } from "./ui/navigation.js";
import { renderApp, renderInsightModal } from "./ui/render.js";

const auth = createAuthController();
const authScreen = $("#authScreen");
const appRoot = $("#appRoot");
const authForm = $("#authForm");
const authError = authForm.querySelector("[data-form-error]");

let store = null;
let currentSession = null;
let selectedView = "today";
let calendarDate = new Date();
let currentPlan = null;
let unsubscribeStore = null;
let unsubscribeStatus = null;

const storeProxy = new Proxy(
  {},
  {
    get(_target, property) {
      if (!store) throw new Error("Store is not ready.");
      const value = store[property];
      return typeof value === "function" ? value.bind(store) : value;
    }
  }
);

const actions = {
  onBlockAction(action, block) {
    if (!store) return;
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
    if (!store) return;
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
    if (!store) return;
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

bindForms(storeProxy, () => currentPlan);
bindAppActions();
bindAuthActions();
setAuthModeCopy();

auth.onAuthChange((session) => {
  void activateSession(session);
});

void init();

async function init() {
  const initialSession = await auth.getSession();
  await activateSession(initialSession);
}

function bindAuthActions() {
  authForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAuth("signIn");
  });

  $("#signUpButton").addEventListener("click", () => {
    void submitAuth("signUp");
  });

  $("#signOutButton").addEventListener("click", async () => {
    await auth.signOut();
    showToast("已退出登录。");
  });
}

function bindAppActions() {
  $("#rescheduleButton").addEventListener("click", () => {
    render();
    showToast("已根据当前任务、睡眠和不可用时间重新规划。");
  });

  $("#openLoadModal").addEventListener("click", () => {
    if (!store || !currentPlan) return;
    renderInsightModal("load", store.getState(), currentPlan);
    $("#insightModal").showModal();
  });

  $("#openRiskModal").addEventListener("click", () => {
    if (!store || !currentPlan) return;
    renderInsightModal("risk", store.getState(), currentPlan);
    $("#insightModal").showModal();
  });

  $("#openClearModal").addEventListener("click", () => {
    $("#clearModal").showModal();
  });

  $("#clearForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!store) return;
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
}

async function submitAuth(action) {
  clearAuthError();
  const data = Object.fromEntries(new FormData(authForm).entries());
  const email = String(data.email || "").trim();
  const password = String(data.password || "");

  if (!email) return setAuthError("请填写邮箱。");
  if (auth.mode === "cloud" && password.length < 6) return setAuthError("云端登录需要至少 6 位密码。");

  try {
    const session = action === "signUp" ? await auth.signUp(email, password) : await auth.signIn(email, password);
    if (!session && action === "signUp") {
      showToast("注册邮件已发送，请查收邮箱完成确认。");
    }
  } catch (error) {
    setAuthError(error.message || "登录失败，请检查账号信息。");
  }
}

async function activateSession(session) {
  currentSession = session;
  unsubscribeStore?.();
  unsubscribeStatus?.();
  unsubscribeStore = null;
  unsubscribeStatus = null;

  if (!session) {
    store = null;
    currentPlan = null;
    authScreen.hidden = false;
    appRoot.hidden = true;
    return;
  }

  const repository =
    session.mode === "cloud" && auth.client
      ? createSupabaseRepository(auth.client, session.user.id)
      : createLocalRepository(session.user.id);

  store = createStore(repository);
  unsubscribeStore = store.subscribe(render);
  unsubscribeStatus = store.subscribeStatus(updateSyncStatus);
  updateProfile(session);
  authScreen.hidden = true;
  appRoot.hidden = false;
  render();
  await store.hydrate();
  render();
}

function render() {
  if (!store) return;
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

function updateProfile(session) {
  $("#profileName").textContent = session.user.email;
  $("#profileStatus").textContent = session.mode === "cloud" ? "云端同步" : "本地演示";
}

function updateSyncStatus(status) {
  if (!currentSession) return;
  const base = currentSession.mode === "cloud" ? "云端同步" : "本地演示";
  if (status.loading) {
    $("#profileStatus").textContent = "正在加载数据";
  } else if (status.saving) {
    $("#profileStatus").textContent = currentSession.mode === "cloud" ? "正在同步" : "正在保存";
  } else if (status.error) {
    $("#profileStatus").textContent = "同步异常";
    showToast(status.error);
  } else {
    $("#profileStatus").textContent = base;
  }
}

function setAuthModeCopy() {
  $("#authModeLabel").textContent = auth.mode === "cloud" ? "云端账户" : "本地演示账户";
  $("#authModeNote").textContent =
    auth.mode === "cloud"
      ? "已连接 Supabase。登录后数据会保存到云端数据库，并按用户隔离。"
      : "当前没有配置 Supabase 环境变量。你可以用任意邮箱进入本地演示模式；不同邮箱会有不同本地数据。";
}

function setAuthError(message) {
  authError.textContent = message;
  authError.hidden = false;
}

function clearAuthError() {
  authError.textContent = "";
  authError.hidden = true;
}

function daysUntilVisibleCalendar(date) {
  const today = startOfDay(new Date());
  const visibleEnd = addDays(new Date(date.getFullYear(), date.getMonth() + 1, 7), 1);
  return Math.max(21, Math.ceil((visibleEnd - today) / (24 * 60 * 60 * 1000)));
}
