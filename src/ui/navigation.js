import { $$ } from "./dom.js";

export function bindNavigation(onChange) {
  const navButtons = $$("[data-view]");
  const shortcutButtons = $$("[data-view-shortcut]");

  const activate = (view) => {
    $$("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    $$("[data-view-shortcut]").forEach((button) => button.classList.toggle("active", button.dataset.viewShortcut === view));
    $$(".view").forEach((section) => section.classList.toggle("active", section.id === `${view}View`));
    onChange(view);
  };

  navButtons.forEach((button) => button.addEventListener("click", () => activate(button.dataset.view)));
  shortcutButtons.forEach((button) => button.addEventListener("click", () => activate(button.dataset.viewShortcut)));

  return { activate };
}
