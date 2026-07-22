import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { analyzePdfWeb, downloadPdfBlob, resizePdfWeb } from "./pdf-web";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./styles.css";

// Импортируем готовые JSON-файлы из вашей папки locales
import localeRu from "../locales/ru.json";
import localeEn from "../locales/en.json";

interface PdfAnalysis {
  file_name: string;
  ratios: Record<string, number>;
}

interface PdfResizeResult {
  target_w: number;
  target_h: number;
}

async function testPdf() {
  try {
    const result = await invoke("analyze_pdf", {
      inputPath: "C:\\Users\\govgo\\Desktop\\test.pdf",
    });

    console.log(result);
  } catch (error) {
    console.error(error);
  }
}

testPdf();

// ==========================================
// 0. МЕНЕДЖЕР АВТОЛОКАЛИЗАЦИИ СИСТЕМЫ
// ==========================================
const locales: Record<string, any> = {
  ru: localeRu,
  en: localeEn,
};

const getSystemLang = (): string => {
  const primaryLang = (
    navigator.languages?.[0] ??
    navigator.language ??
    "en"
  ).toLowerCase();

  return primaryLang.startsWith("ru") ? "ru" : "en";
};

const currentLang = getSystemLang();
const currentLocale = locales[currentLang];

function t(path: string, fallback: string = ""): string {
  return (
    path.split(".").reduce((obj, key) => obj?.[key], currentLocale) || fallback
  );
}

function translateRatio(ratioKey: string): string {
  const normalizedKey = ratioKey.replace(/_/g, "-");

  const customMatch = normalizedKey.match(/^custom:([0-9.]+):([0-9.]+)$/);
  if (customMatch) {
    return `${customMatch[1]} x ${customMatch[2]}`;
  }

  const numericMatch = normalizedKey.match(/^([0-9.]+)-([0-9.]+)$/);
  if (numericMatch) {
    return `${numericMatch[1]} x ${numericMatch[2]}`;
  }

  return t(`ratios.${normalizedKey}`, ratioKey);
}

function formatString(
  template: string,
  args: Record<string, string | number>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(args)) {
    result = result.replace(new RegExp(`{{${key}}}`, "g"), String(value));
  }
  return result;
}

function getPagesString(count: number): string {
  if (currentLang === "en") {
    return formatString(t("pages_count", "{{count}} pages"), { count });
  }
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return formatString(t("pages_count_one", "{{count}} страница"), { count });
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return formatString(t("pages_count_few", "{{count}} страницы"), { count });
  }
  return formatString(t("pages_count_many", "{{count}} страниц"), { count });
}

// ==========================================
// ДИНАМИЧЕСКОЕ ОПРЕДЕЛЕНИЕ СРЕДЫ (TAURI vs WEB)
// ==========================================
const isTauri = !!(window as any).__TAURI_INTERNALS__;
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  (window.navigator as Navigator & { standalone?: boolean }).standalone ===
    true;
const blockTextSelection = isTauri || isStandalone;

// Хранилище для веб-файла
let webSelectedFile: File | null = null;

// ==========================================
// КРОССПЛАТФОРМЕННЫЕ SVG ИКОНКИ (Взамен Segoe Fluent Icons)
// ==========================================
const ICONS = {
  document: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  clear: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
  chevronDown: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  multiply: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};

// ==========================================
// 1. GLOBAL APPLICATION STATE (Reactive)
// ==========================================
const AppState = {
  _inputPath: "",
  _activePreset: "a-series",

  listeners: new Map<string, Array<(val: any) => void>>(),

  onChange(key: string, callback: (val: any) => void) {
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key)!.push(callback);
    callback((this as any)[`_${key}`]);
  },

  trigger(key: string, newVal: any) {
    this.listeners.get(key)?.forEach((cb) => cb(newVal));
  },

  get inputPath() {
    return this._inputPath;
  },
  set inputPath(val: string) {
    this._inputPath = val;
    this.trigger("inputPath", val);
  },

  get activePreset() {
    return this._activePreset;
  },
  set activePreset(val: string) {
    this._activePreset = val;
    this.trigger("activePreset", val);
  },
};

function parseAppError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);

  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.type) {
      return t(`errors.${parsed.type}`, `Backend Error: ${parsed.type}`);
    }
  } catch {
    return raw;
  }

  return raw;
}

// ==========================================
// 2. WINUI-LIKE REUSABLE COMPONENTS
// ==========================================
function WinButton(options: {
  text: string;
  variant: "standard" | "accent";
  onClick: () => void;
}) {
  const btn = document.createElement("button");
  btn.className = `btn btn-${options.variant}`;
  btn.textContent = options.text;
  btn.addEventListener("click", options.onClick);
  return btn;
}

function WinNumericInput(options: {
  placeholder: string;
  defaultValue: string;
}) {
  const input = document.createElement("input");
  input.className = "win-input";
  input.type = "number";
  input.step = "any";
  input.placeholder = options.placeholder;
  input.value = options.defaultValue;
  return input;
}

function WinLogTimeline() {
  const container = document.createElement("div");
  container.className = "log-container";

  const header = document.createElement("div");
  header.className = "log-header";
  header.innerHTML = `<label>${t("ui.timeline_label")}</label>`;

  const clearBtn = document.createElement("button");
  clearBtn.className = "btn-clear";
  clearBtn.innerHTML = `${ICONS.clear}${t("ui.clear_history")}`;

  const viewport = document.createElement("div");
  viewport.className = "log-viewport";

  header.appendChild(clearBtn);
  container.appendChild(header);
  container.appendChild(viewport);

  const setInitialState = () => {
    viewport.innerHTML = `<div class="log-placeholder">${t("ui.ready_placeholder")}</div>`;
  };
  setInitialState();

  clearBtn.addEventListener("click", setInitialState);

  const addLog = (
    title: string,
    content: string,
    type: "info" | "success" | "failed",
  ) => {
    if (viewport.querySelector(".log-placeholder")) {
      viewport.innerHTML = "";
    }

    const colors = {
      info: "var(--winui-accent)",
      success: "#107c10",
      failed: "#e81123",
    };

    const entry = document.createElement("div");
    entry.className = "log-entry";
    entry.style.borderLeft = `4px solid ${colors[type]}`;

    entry.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <div style="width: 8px; height: 8px; border-radius: 50%; background-color: ${colors[type]};"></div>
        <div style="font-weight: 400; font-size: 11px; color: var(--winui-text-secondary);">${new Date().toLocaleTimeString()}</div>
      </div>
      <div style="font-weight: 600; color: var(--winui-text-main); margin-top: 4px;">${title}</div>
      <div style="color: var(--winui-text-secondary); margin-top: 2px; white-space: pre-line; word-break: break-all;">${content}</div>
    `;

    viewport.appendChild(entry);
    viewport.scrollTop = viewport.scrollHeight;
  };

  return { element: container, addLog };
}

// ==========================================
// 3. MAIN APPLICATION INITIALIZATION
// ==========================================
window.addEventListener("DOMContentLoaded", () => {
  console.log("Window initialized");

  window.addEventListener(
    "dragover",
    (e) => {
      e.preventDefault();
    },
    { capture: true },
  );

  window.addEventListener("dragenter", (e) => e.preventDefault());
  window.addEventListener("dragleave", (e) => e.preventDefault());

  const appElement = document.querySelector("#app") || document.body;
  appElement.innerHTML = "";

  const syncViewportHeight = () => {
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    document.documentElement.style.setProperty(
      "--app-viewport-height",
      `${viewportHeight}px`,
    );
  };

  syncViewportHeight();
  window.visualViewport?.addEventListener("resize", syncViewportHeight);
  window.addEventListener("resize", syncViewportHeight);
  window.addEventListener("orientationchange", () => {
    requestAnimationFrame(syncViewportHeight);
    window.setTimeout(syncViewportHeight, 250);
  });

  if (isTauri) {
    const initThemeIconListener = () => {
      const themeQuery = window.matchMedia("(prefers-color-scheme: dark)");
      let currentIconTheme: boolean | null = null;

      // Always resolve via backend (SystemUsesLightTheme) — matchMedia is Apps theme
      // and fighting it made the taskbar icon appear stuck.
      const updateIcon = async (force = false) => {
        try {
          const resolvedIsDark = await invoke<boolean>("windows_theme_is_dark");

          if (!force && currentIconTheme === resolvedIsDark) {
            return;
          }

          await invoke("set_theme_icon", { isDark: resolvedIsDark });
          currentIconTheme = resolvedIsDark;
        } catch (err) {
          console.error("Error setting theme icon:", err);
          currentIconTheme = null;
        }
      };

      setTimeout(() => {
        void updateIcon(true);
      }, 100);

      themeQuery.addEventListener("change", () => void updateIcon(true));
      window.addEventListener("focus", () => void updateIcon(true));
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) void updateIcon(true);
      });
      window.setInterval(() => void updateIcon(false), 1500);
    };
    initThemeIconListener();

    const initAccentColorListener = () => {
      const updateAccentColor = async () => {
        try {
          const systemHex = await invoke<string>("get_accent_color");
          document.documentElement.style.setProperty(
            "--winui-accent-system",
            systemHex,
          );
        } catch (err) {
          console.warn(
            "Accent color sync skipped: Running in browser or command unavailable.",
          );
        }
      };

      updateAccentColor();
      window.addEventListener("focus", updateAccentColor);
    };
    initAccentColorListener();

    document.addEventListener("contextmenu", (e) => e.preventDefault(), {
      capture: true,
    });
  } else {
    document.addEventListener("gesturestart", (e) => e.preventDefault(), {
      passive: false,
    });
  }

  // Инжектим стили
  const styleSheet = document.createElement("style");
  styleSheet.innerText = `
    :root {
      --winui-accent-system: #0078d4;
      --winui-accent: var(--winui-accent-system);
      --winui-accent-hover: color-mix(in oklab, var(--winui-accent-system) 88%, #000000);
      --winui-accent-active: color-mix(in oklab, var(--winui-accent-system) 78%, #000000);
      --winui-accent-text: #ffffff;

      --winui-window-bg: ${isTauri ? "transparent" : "#f3f3f3"};
      --winui-card: rgba(255, 255, 255, 0.7);
      --winui-card-border: rgba(0, 0, 0, 0.07);
      --winui-card-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.02), 0 1px 2px rgba(0, 0, 0, 0.02);
      --winui-text-main: rgba(0, 0, 0, 0.9);
      --winui-text-secondary: rgba(0, 0, 0, 0.61);
      --winui-text-disabled: rgba(0, 0, 0, 0.36);
      --winui-btn-clear: rgba(55, 55, 55, 0.06);
      --winui-btn-clear-hover: rgba(55, 55, 55, 0.08);
      --winui-btn-clear-active: rgba(55, 55, 55, 0.12);
      --winui-btn-standard: rgba(255, 255, 255, 0.7);
      --winui-btn-hover: rgba(249, 249, 249, 0.7);
      --winui-btn-active: rgba(245, 245, 245, 0.5);
      --winui-btn-border: rgba(0, 0, 0, 0.1);
      --winui-btn-border-bottom: rgba(0, 0, 0, 0.2);
      --winui-control-bg: rgba(255, 255, 255, 0.7);
      --winui-control-border: rgba(0, 0, 0, 0.1);
      --winui-control-border-hover: rgba(0, 0, 0, 0.16);
      --winui-flyout-bg: #f9f9f9;
      --winui-flyout-border: rgba(0, 0, 0, 0.1);
      --winui-flyout-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
      --font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      --fluent-timing-fast: 0.08s cubic-bezier(0.1, 0.9, 0.2, 1);
      --fluent-timing-normal: 0.18s cubic-bezier(0.1, 0.9, 0.2, 1);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --winui-accent: color-mix(in oklab, var(--winui-accent-system) 85%, #ffffff);
        --winui-accent-hover: color-mix(in oklab, var(--winui-accent-system) 75%, #ffffff);
        --winui-accent-active: color-mix(in oklab, var(--winui-accent-system) 65%, #ffffff);
        --winui-accent-text: #000000;

        --winui-window-bg: ${isTauri ? "transparent" : "#1c1c1c"};
        --winui-card: rgba(255, 255, 255, 0.05);
        --winui-card-border: rgba(255, 255, 255, 0.03);
        --winui-card-shadow: 0 1px 1px rgba(0, 0, 0, 0.1);
        --winui-text-main: rgba(255, 255, 255, 0.96);
        --winui-text-secondary: rgba(255, 255, 255, 0.78);
        --winui-text-disabled: rgba(255, 255, 255, 0.44);
        --winui-btn-clear: rgba(255, 255, 255, 0.06);
        --winui-btn-clear-hover: rgba(255, 255, 255, 0.09);
        --winui-btn-clear-active: rgba(255, 255, 255, 0.04);
        --winui-btn-standard: rgba(255, 255, 255, 0.05);
        --winui-btn-hover: rgba(255, 255, 255, 0.09);
        --winui-btn-active: rgba(255, 255, 255, 0.03);
        --winui-btn-border: rgba(255, 255, 255, 0.06);
        --winui-btn-border-bottom: rgba(255, 255, 255, 0.09);
        --winui-control-bg: rgba(30, 30, 30, 0.7);
        --winui-control-border: rgba(255, 255, 255, 0.08);
        --winui-control-border-hover: rgba(255, 255, 255, 0.15);
        --winui-flyout-bg: #2c2c2c;
        --winui-flyout-border: rgba(255, 255, 255, 0.08);
        --winui-flyout-shadow: 0 8px 16px rgba(0, 0, 0, 0.4);
      }
      .log-viewport { background: rgba(0, 0, 0, 0.3) !important; }
    }

    html, body, #app { margin: 0; padding: 0; background-color: var(--winui-window-bg) !important; width: 100%; height: var(--app-viewport-height, 100dvh); min-height: 0; }
    * { ${blockTextSelection ? " user-select: none !important; -webkit-user-select: none !important; -webkit-touch-callout: none;" : ""} }
    ${!isTauri ? "html, body, #app { touch-action: manipulation; }" : ""}
    ${
      blockTextSelection
        ? `
    .win-input {
      user-select: text !important;
      -webkit-user-select: text !important;
    }
    `
        : `
    .btn, .btn-clear, .win-combobox-button, .win-combobox-item, .log-header label, .input-group label, .svg-icon {
      user-select: none;
      -webkit-user-select: none;
    }
    .log-viewport, .log-entry, .log-entry *, .file-status, .win-input {
      user-select: text !important;
      -webkit-user-select: text !important;
    }
    `
    }  `;
  document.head.appendChild(styleSheet);

  const container = document.createElement("div");
  container.className = "app-container";

  // ——————————————————————————————————————————
  // CARD 1: File Selection (Универсальный)
  // ——————————————————————————————————————————
  const fileCard = document.createElement("div");
  fileCard.className = "win-card file-card drop-zone";

  const fileInfoWrapper = document.createElement("div");
  fileInfoWrapper.className = "file-info";
  fileInfoWrapper.innerHTML = `<span class="svg-icon file-icon">${ICONS.document}</span>`;

  const textMetaBlock = document.createElement("div");
  textMetaBlock.className = "file-meta";
  textMetaBlock.innerHTML = `<div class="file-title">${t("ui.target_document")}</div>`;

  const fileStatus = document.createElement("div");
  fileStatus.className = "file-status";

  textMetaBlock.appendChild(fileStatus);
  fileInfoWrapper.appendChild(textMetaBlock);
  fileCard.appendChild(fileInfoWrapper);

  // Скрытый инпут для выбора (только для веба)
  const hiddenInput = document.createElement("input");
  hiddenInput.type = "file";
  hiddenInput.accept = ".pdf";
  hiddenInput.style.display = "none";
  fileCard.appendChild(hiddenInput);

  // Универсальная функция обработки
  const handleFile = async (file: File | string) => {
    if (typeof file === "string") {
      // Tauri путь
      AppState.inputPath = file;
      timeline.addLog(t("logs.file_loaded"), file, "info");
    } else {
      // Веб File объект
      webSelectedFile = file;
      AppState.inputPath = file.name;
      timeline.addLog(t("logs.file_loaded"), `${file.name}`, "info");
    }
  };

  if (isTauri) {
    getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          fileCard.classList.add("drag-over");
          return;
        }

        if (event.payload.type === "leave") {
          fileCard.classList.remove("drag-over");
          return;
        }

        if (event.payload.type !== "drop" || event.payload.paths.length === 0) {
          return;
        }

        fileCard.classList.remove("drag-over");
        handleFile(event.payload.paths[0]);
      })
      .catch((err) => {
        console.error("Failed to register Tauri drag-and-drop listener", err);
      });
  }

  // Логика Drag & Drop для fileCard
  fileCard.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation(); // Важно для предотвращения всплытия
    fileCard.classList.add("drag-over");
  });

  fileCard.addEventListener("dragleave", (e) => {
    e.preventDefault();
    fileCard.classList.remove("drag-over");
  });

  fileCard.addEventListener("drop", async (e) => {
    console.log("Drop event triggered");
    e.preventDefault();
    e.stopPropagation();

    fileCard.classList.remove("drag-over");

    const path = e.dataTransfer?.getData("text/plain");
    const uriList = e.dataTransfer?.getData("text/uri-list");
    const file = e.dataTransfer?.files[0];

    // Присваиваем значение только если что-то пришло
    const rawPath = path || uriList;

    if (isTauri && rawPath) {
      // Теперь TypeScript знает, что rawPath точно есть, так как мы проверили его в условии
      const cleanPath = rawPath
        .replace(/^(file:\/\/|text\/uri-list:)/, "")
        .trim();
      handleFile(cleanPath);
    } else if (file && file.type === "application/pdf") {
      handleFile(file);
    }
  });

  // Логика выбора файла (при клике)
  fileCard.addEventListener("click", async () => {
    if (isTauri) {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (selected && typeof selected === "string") handleFile(selected);
    } else {
      hiddenInput.click();
    }
  });

  hiddenInput.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) handleFile(file);
  });

  AppState.onChange("inputPath", (path) => {
    if (path) {
      fileStatus.textContent = path.split(/[\\/]/).pop() || path;
      fileStatus.style.color = "var(--winui-text-main)";
    } else {
      fileStatus.textContent = t("ui.no_file_selected");
      fileStatus.style.color = "var(--winui-text-secondary)";
    }
  });

  // ——————————————————————————————————————————
  // CARD 2: Grid Layout Parameters & Presets
  // ——————————————————————————————————————————
  const gridCard = document.createElement("div");
  gridCard.className = "win-card controls-card";

  const gridRow = document.createElement("div");
  gridRow.className = "input-grid-row";

  const comboGroup = document.createElement("div");
  comboGroup.className = "input-group";
  comboGroup.innerHTML = `<label>${t("ui.preset_label")}</label>`;

  const comboContainer = document.createElement("div");
  comboContainer.className = "win-combobox-container";

  const comboBtn = document.createElement("div");
  comboBtn.className = "win-combobox-button";
  comboBtn.innerHTML = `<span>${t("presets.a_series")}</span>${ICONS.chevronDown}`;

  const comboFlyout = document.createElement("div");
  comboFlyout.className = "win-combobox-flyout";
  comboFlyout.innerHTML = `
        <div class="win-combobox-item selected" data-value="a_series">${t("presets.a_series")}</div>
        <div class="win-combobox-item" data-value="letter">${t("presets.letter")}</div>
        <div class="win-combobox-item" data-value="legal">${t("presets.legal")}</div>
        <div class="win-combobox-item" data-value="16_9">${t("presets.sixteen_nine")}</div>
        <div class="win-combobox-item" data-value="4_3">${t("presets.four_three")}</div>
        <div class="win-combobox-item" data-value="2_3">${t("presets.two_three")}</div>
        <div class="win-combobox-item" data-value="custom">${t("presets.custom")}</div>
      `;

  comboContainer.appendChild(comboBtn);
  comboContainer.appendChild(comboFlyout);
  comboGroup.appendChild(comboContainer);

  const wGroup = document.createElement("div");
  wGroup.className = "input-group";
  wGroup.innerHTML = `<label>${t("ui.width_label")}</label>`;
  const wEntry = WinNumericInput({ placeholder: "1", defaultValue: "1" });
  wGroup.appendChild(wEntry);

  const separatorWrapper = document.createElement("div");
  separatorWrapper.className = "input-separator-wrapper";
  separatorWrapper.innerHTML = ICONS.multiply;

  const hGroup = document.createElement("div");
  hGroup.className = "input-group";
  hGroup.innerHTML = `<label>${t("ui.height_label")}</label>`;
  const hEntry = WinNumericInput({
    placeholder: "1.414",
    defaultValue: "1.414",
  });
  hGroup.appendChild(hEntry);

  gridRow.appendChild(comboGroup);
  gridRow.appendChild(wGroup);
  gridRow.appendChild(separatorWrapper);
  gridRow.appendChild(hGroup);
  gridCard.appendChild(gridRow);

  // ==========================================
  // ИНТЕЛЛЕКТУАЛЬНАЯ ЛОГИКА КОМБОБОКСА И ВВОДА
  // ==========================================
  let isProgrammaticChange = false;

  function toggleFlyout(show: boolean) {
    if (show) {
      comboBtn.classList.add("open");
      comboFlyout.style.display = "block";
      setTimeout(() => comboFlyout.classList.add("show"), 10);
    } else {
      comboBtn.classList.remove("open");
      comboFlyout.classList.remove("show");
      setTimeout(() => {
        if (!comboFlyout.classList.contains("show"))
          comboFlyout.style.display = "none";
      }, 150);
    }
  }

  comboBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFlyout(!comboBtn.classList.contains("open"));
  });

  document.addEventListener("click", () => toggleFlyout(false));
  comboFlyout.addEventListener("click", (e) => e.stopPropagation());

  function autoDetectPreset(w: number, h: number): string {
    if (!w || !h || w <= 0 || h <= 0) return "custom";

    // Считаем чистое соотношение сторон W / H без принудительного переворота
    const currentRatio = w / h;

    // Допускаем небольшую погрешность для дробных чисел (например, 1.414 для A-серии)
    const epsilon = 0.005;

    // Список строгих пропорций (ориентация важна!)
    const presets = [
      { name: "a_series", ratio: 1 / 1.414 },
      { name: "letter", ratio: 8.5 / 11 },
      { name: "legal", ratio: 8.5 / 14 },
      { name: "16_9", ratio: 16 / 9 },
      { name: "4_3", ratio: 4 / 3 },
      { name: "2_3", ratio: 2 / 3 },
    ];

    // Ищем совпадение
    const match = presets.find(
      (p) => Math.abs(currentRatio - p.ratio) < epsilon,
    );

    return match ? match.name : "custom";
  }

  function updatePresetVisuals(value: string) {
    comboFlyout.querySelectorAll(".win-combobox-item").forEach((item) => {
      const el = item as HTMLElement;
      if (el.dataset.value === value) {
        el.classList.add("selected");
        comboBtn.querySelector("span")!.textContent = el.textContent;
      } else {
        el.classList.remove("selected");
      }
    });
    AppState.activePreset = value;
  }

  // Слушатель ручного ввода числовых значений
  const handleInputChange = () => {
    if (isProgrammaticChange) return;

    // Преобразуем строковые значения инпутов в числа
    const widthNum = parseFloat(wEntry.value);
    const heightNum = parseFloat(hEntry.value);

    // Передаем валидные числа, чтобы TypeScript был доволен
    const detected = autoDetectPreset(widthNum, heightNum);
    updatePresetVisuals(detected);
  };

  wEntry.addEventListener("input", handleInputChange);
  hEntry.addEventListener("input", handleInputChange);

  // Выбор пресета из выпадающего списка
  comboFlyout.querySelectorAll(".win-combobox-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      const target = e.currentTarget as HTMLElement;
      const value = target.dataset.value || "custom";

      updatePresetVisuals(value);

      isProgrammaticChange = true;
      if (value === "a_series") {
        wEntry.value = "1";
        hEntry.value = "1.414";
      } else if (value === "letter") {
        wEntry.value = "8.5";
        hEntry.value = "11";
      } else if (value === "legal") {
        wEntry.value = "8.5";
        hEntry.value = "14";
      } else if (value === "16_9") {
        // Было sixteen_nine
        wEntry.value = "16";
        hEntry.value = "9";
      } else if (value === "4_3") {
        // Было four_three
        wEntry.value = "4";
        hEntry.value = "3";
      } else if (value === "2_3") {
        // Было two_three
        wEntry.value = "2";
        hEntry.value = "3";
      } else if (value === "custom") {
        wEntry.value = "";
        hEntry.value = "";
        wEntry.focus();
      }
      isProgrammaticChange = false;

      toggleFlyout(false);
    });
  });

  AppState.onChange("activePreset", (preset) => {
    if (isProgrammaticChange) return;

    if (document.activeElement === wEntry || document.activeElement === hEntry)
      return;

    isProgrammaticChange = true;
    if (preset === "a_series") {
      wEntry.value = "1";
      hEntry.value = "1.414";
    } else if (preset === "letter") {
      wEntry.value = "8.5";
      hEntry.value = "11";
    } else if (preset === "legal") {
      wEntry.value = "8.5";
      hEntry.value = "14";
    } else if (preset === "16_9") {
      // Было sixteen_nine
      wEntry.value = "16";
      hEntry.value = "9";
    } else if (preset === "4_3") {
      // Было four_three
      wEntry.value = "4";
      hEntry.value = "3";
    } else if (preset === "2_3") {
      // Было two_three
      wEntry.value = "2";
      hEntry.value = "3";
    }
    isProgrammaticChange = false;
  });

  // ——————————————————————————————————————————
  // LAYER 3: Action Buttons & Timeline
  // ——————————————————————————————————————————
  // Инициализируем таймлайн СРАЗУ, чтобы кнопки могли отправлять в него логи
  const timeline = WinLogTimeline();

  const actionRow = document.createElement("div");
  actionRow.className = "action-row";

  const analyzeBtn = WinButton({
    text: t("ui.analyze_btn"),
    variant: "standard",
    onClick: async () => {
      if (!AppState.inputPath)
        return timeline.addLog(
          t("logs.action_required"),
          t("logs.select_file_first"),
          "failed",
        );

      // Общая функция обработки результатов анализа для Tauri и Web сред
      const processAnalysisResult = (res: PdfAnalysis) => {
        let logContent = `${t("file")}: ${res.file_name}\n${t("ratios_found")}\n`;

        let mostFrequentPreset = "";
        let maxPagesCount = 0;

        for (const [ratioKey, count] of Object.entries(res.ratios)) {
          logContent += `  • ${translateRatio(ratioKey)} : ${getPagesString(count)}\n`;

          // Ищем самый популярный формат в документе
          if (count > maxPagesCount) {
            maxPagesCount = count;
            mostFrequentPreset = ratioKey;
          }
        }

        timeline.addLog(
          t("logs.analysis_completed"),
          logContent.trim(),
          "info",
        );

        // Подставляем вычисленные бэкендом параметры в интерфейс с локализацией
        if (mostFrequentPreset) {
          if (mostFrequentPreset.startsWith("custom:")) {
            const parts = mostFrequentPreset.split(":");
            const rawW = parseFloat(parts[1]);
            const rawH = parseFloat(parts[2]);

            // Сокращаем до красивых целых пропорций
            const simple = getSimplestRatio(rawW, rawH);

            // Локализованный лог для кастомных размеров
            const customMsg = formatString(
              t(
                "logs.suggestion_custom",
                "Большинство страниц имеют формат {{w_raw}}x{{h_raw}} pt.\nАвтоматически установлены пропорции: {{w}} : {{h}}",
              ),
              {
                w_raw: Math.round(rawW),
                h_raw: Math.round(rawH),
                w: simple.w,
                h: simple.h,
              },
            );

            timeline.addLog(
              t("logs.suggestion_title", "Рекомендация"),
              customMsg,
              "info",
            );

            // Меняем значения инпутов
            isProgrammaticChange = true;
            updatePresetVisuals("custom");
            wEntry.value = String(simple.w);
            hEntry.value = String(simple.h);
            isProgrammaticChange = false;
          } else {
            // Локализованный лог для стандартных пресетов
            const presetMsg = formatString(
              t(
                "logs.suggestion_preset",
                'Большинство страниц соответствуют пресету "{{preset}}". Он выбран автоматически.',
              ),
              { preset: translateRatio(mostFrequentPreset) },
            );

            timeline.addLog(
              t("logs.suggestion_title", "Рекомендация"),
              presetMsg,
              "info",
            );

            // Блокируем зацикливание обработчиков ввода
            isProgrammaticChange = true;

            // Обновляем визуальный выбор в комбобоксе и реактивный стейт
            updatePresetVisuals(mostFrequentPreset);
            AppState.activePreset = mostFrequentPreset;

            // Принудительно заполняем инпуты числами
            if (mostFrequentPreset === "a_series") {
              wEntry.value = "1";
              hEntry.value = "1.414";
            } else if (mostFrequentPreset === "letter") {
              wEntry.value = "8.5";
              hEntry.value = "11";
            } else if (mostFrequentPreset === "legal") {
              wEntry.value = "8.5";
              hEntry.value = "14";
            } else if (mostFrequentPreset === "16_9") {
              wEntry.value = "16";
              hEntry.value = "9";
            } else if (mostFrequentPreset === "4_3") {
              wEntry.value = "4";
              hEntry.value = "3";
            } else if (mostFrequentPreset === "2_3") {
              wEntry.value = "2";
              hEntry.value = "3";
            }

            isProgrammaticChange = false;
          }
        }
      };

      if (isTauri) {
        try {
          const res = await invoke<PdfAnalysis>("analyze_pdf", {
            inputPath: AppState.inputPath,
          });
          processAnalysisResult(res);
        } catch (err) {
          timeline.addLog(
            t("logs.analysis_error"),
            parseAppError(err),
            "failed",
          );
        }
      } else {
        try {
          const res = await analyzePdfWeb(webSelectedFile);
          processAnalysisResult(res);
        } catch (err) {
          timeline.addLog(
            t("logs.analysis_error"),
            parseAppError(err),
            "failed",
          );
        }
      }
    },
  });
  analyzeBtn.classList.add("action-button");

  const generateBtn = WinButton({
    text: t("ui.generate_btn"),
    variant: "accent",
    onClick: async () => {
      if (!AppState.inputPath)
        return timeline.addLog(
          t("logs.action_required"),
          t("logs.select_file_first"),
          "failed",
        );

      const wr = parseFloat(wEntry.value) || 1;
      const hr = parseFloat(hEntry.value) || 1;

      if (isTauri) {
        const outputPath = await save({
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (!outputPath) return;

        try {
          const res = await invoke<PdfResizeResult>("resize_pdf", {
            inputPath: AppState.inputPath,
            outputPath,
            wRatio: wr,
            hRatio: hr,
          });
          const successContent = formatString(t("resize_success"), {
            w: Math.round(res.target_w),
            h: Math.round(res.target_h),
          });
          timeline.addLog(
            t("logs.generation_success"),
            successContent,
            "success",
          );
        } catch (err) {
          timeline.addLog(
            t("logs.generation_error"),
            parseAppError(err),
            "failed",
          );
        }
      } else {
        if (!webSelectedFile) return;

        try {
          const res = await resizePdfWeb(webSelectedFile, wr, hr);
          downloadPdfBlob(res.blob, `resized_${webSelectedFile.name}`);
          const successContent = formatString(t("resize_success"), {
            w: Math.round(res.target_w),
            h: Math.round(res.target_h),
          });
          timeline.addLog(
            t("logs.generation_success"),
            successContent,
            "success",
          );
        } catch (err) {
          timeline.addLog(
            t("logs.generation_error"),
            parseAppError(err),
            "failed",
          );
        }
      }
    },
  });
  generateBtn.classList.add("action-button");

  actionRow.appendChild(analyzeBtn);
  actionRow.appendChild(generateBtn);

  container.appendChild(fileCard);
  container.appendChild(gridCard);
  container.appendChild(actionRow);
  container.appendChild(timeline.element);

  appElement.appendChild(container);
});

// Функция для поиска Наибольшего Общего Делителя (алгоритм Евклида)
function gcd(a: number, b: number): number {
  return b < 0.00001 ? a : gcd(b, a % b);
}

// Приводит дробное или большое соотношение к красивым целым числам (например, 16 и 9)
function getSimplestRatio(w: number, h: number): { w: number; h: number } {
  const aspect = w / h;

  const commonRatios = [
    { w: 16, h: 9 },
    { w: 4, h: 3 },
    { w: 3, h: 4 },
    { w: 9, h: 16 },
    { w: 2, h: 3 },
    { w: 3, h: 2 },
    { w: 1, h: 1 },
    { w: 5, h: 7 },
  ];

  for (const r of commonRatios) {
    if (Math.abs(aspect - r.w / r.h) < 0.01) {
      return r;
    }
  }

  const precision = 100;
  const gcdVal = gcd(Math.round(w * precision), Math.round(h * precision));

  return {
    w: Math.round(w * precision) / gcdVal,
    h: Math.round(h * precision) / gcdVal,
  };
}
