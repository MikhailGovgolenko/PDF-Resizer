import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { analyzePdfWeb, downloadPdfBlob, resizePdfWeb } from "./pdf-web";

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

// ==========================================
// 0. МЕНЕДЖЕР АВТОЛОКАЛИЗАЦИИ СИСТЕМЫ
// ==========================================
const locales: Record<string, any> = {
  ru: localeRu,
  en: localeEn
};

const getSystemLang = (): string => {
  const primaryLang =
    (navigator.languages?.[0] ?? navigator.language ?? "en")
      .toLowerCase();

  return primaryLang.startsWith("ru") ? "ru" : "en";
};

const currentLang = getSystemLang();
const currentLocale = locales[currentLang];


function t(path: string, fallback: string = ""): string {
  return path.split('.').reduce((obj, key) => obj?.[key], currentLocale) || fallback;
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

function formatString(template: string, args: Record<string, string | number>): string {
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
  (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
const blockTextSelection = isTauri || isStandalone;

// Хранилище для веб-файла (так как в браузере нет доступа к путям файловой системы)
let webSelectedFile: File | null = null;

// ==========================================
// КРОССПЛАТФОРМЕННЫЕ SVG ИКОНКИ (Взамен Segoe Fluent Icons)
// ==========================================
const ICONS = {
  document: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  clear: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
  chevronDown: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  multiply: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
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
    this.listeners.get(key)?.forEach(cb => cb(newVal));
  },

  get inputPath() { return this._inputPath; },
  set inputPath(val: string) { this._inputPath = val; this.trigger("inputPath", val); },

  get activePreset() { return this._activePreset; },
  set activePreset(val: string) { this._activePreset = val; this.trigger("activePreset", val); }
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
function WinButton(options: { text: string; variant: "standard" | "accent"; onClick: () => void }) {
  const btn = document.createElement("button");
  btn.className = `btn btn-${options.variant}`;
  btn.textContent = options.text;
  btn.addEventListener("click", options.onClick);
  return btn;
}

function WinNumericInput(options: { placeholder: string; defaultValue: string }) {
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
  header.innerHTML = `<label>${t('ui.timeline_label')}</label>`;

  const clearBtn = document.createElement("button");
  clearBtn.className = "btn-clear";
  clearBtn.innerHTML = `${ICONS.clear}${t('ui.clear_history')}`;

  const viewport = document.createElement("div");
  viewport.className = "log-viewport";
  
  header.appendChild(clearBtn);
  container.appendChild(header);
  container.appendChild(viewport);

  const setInitialState = () => {
    viewport.innerHTML = `<div class="log-placeholder">${t('ui.ready_placeholder')}</div>`;
  };
  setInitialState();

  clearBtn.addEventListener("click", setInitialState);

  const addLog = (title: string, content: string, type: "info" | "success" | "failed") => {
    if (viewport.querySelector(".log-placeholder")) {
      viewport.innerHTML = "";
    }
    
    const colors = {
      info: "var(--winui-accent)",
      success: "#107c10", 
      failed: "#e81123"   
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
  const appElement = document.querySelector("#app") || document.body;
  appElement.innerHTML = "";

  const syncViewportHeight = () => {
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    document.documentElement.style.setProperty("--app-viewport-height", `${viewportHeight}px`);
  };

  syncViewportHeight();
  window.visualViewport?.addEventListener("resize", syncViewportHeight);
  window.addEventListener("resize", syncViewportHeight);
  window.addEventListener("orientationchange", () => {
    requestAnimationFrame(syncViewportHeight);
    window.setTimeout(syncViewportHeight, 250);
  });

  // Кроссплатформенная синхронизация темы и акцента (только в Tauri)
  if (isTauri) {
    const initThemeIconListener = () => {
      const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const updateIcon = async (isDark: boolean) => {
        try { 
          await invoke("set_theme_icon", { isDark }); 
        } catch (err) { 
          console.error("Error setting theme icon:", err); 
        }
      };
      
      // Задержка для гарантии инициализации окна
      setTimeout(() => {
        updateIcon(themeQuery.matches);
      }, 100);
      
      themeQuery.addEventListener('change', (e) => updateIcon(e.matches));
    };
    initThemeIconListener();

    // ДИНАМИЧЕСКАЯ СИНХРОНИЗАЦИЯ АКЦЕНТНОГО ЦВЕТА
    const initAccentColorListener = () => {
      const updateAccentColor = async () => {
        try {
          // Пытаемся получить цвет из Rust (Tauri)
          const systemHex = await invoke<string>("get_accent_color");
          document.documentElement.style.setProperty('--winui-accent-system', systemHex);
        } catch (err) {
          // Если мы в браузере или команда не найдена, 
          // оставляем дефолтный синий цвет (--winui-accent-system в CSS)
          console.warn("Accent color sync skipped: Running in browser or command unavailable.");
        }
      };
    
      updateAccentColor();
      // Обновляем при фокусе окна, если пользователь сменил цвет в настройках Windows
      window.addEventListener("focus", updateAccentColor);
    };
    initAccentColorListener();

    document.addEventListener("contextmenu", (e) => e.preventDefault(), { capture: true });
  } else {
    document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
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
      
      --winui-window-bg: ${isTauri ? 'transparent' : '#f3f3f3'};
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
        
        --winui-window-bg: ${isTauri ? 'transparent' : '#1c1c1c'};
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

    html, body, #app { margin: 0; padding: 0; background-color: var(--winui-window-bg) !important; width: 100%; height: var(--app-viewport-height, 100dvh); min-height: 0; overflow: hidden;${!isTauri ? " touch-action: manipulation;" : ""} }
    * { box-sizing: border-box; font-family: var(--font-family); -webkit-font-smoothing: antialiased;${blockTextSelection ? " user-select: none !important; -webkit-user-select: none !important; -webkit-touch-callout: none;" : ""} }
    ${blockTextSelection ? `
    .win-input {
      user-select: text !important;
      -webkit-user-select: text !important;
    }
    ` : `
    .btn, .btn-clear, .win-combobox-button, .win-combobox-item, .log-header label, .input-group label, .svg-icon {
      user-select: none;
      -webkit-user-select: none;
    }
    .log-viewport, .log-entry, .log-entry *, .file-status, .win-input {
      user-select: text !important;
      -webkit-user-select: text !important;
    }
    `}
    
    .app-container { padding: calc(24px + env(safe-area-inset-top, 0px)) calc(24px + env(safe-area-inset-right, 0px)) calc(24px + env(safe-area-inset-bottom, 0px)) calc(24px + env(safe-area-inset-left, 0px)); height: var(--app-viewport-height, 100dvh); min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 16px; background: transparent; max-width: calc(800px + env(safe-area-inset-left, 0px) + env(safe-area-inset-right, 0px)); margin: 0 auto; width: 100%; }
    .win-card { background: var(--winui-card); border: 1px solid var(--winui-card-border); border-radius: 8px; padding: 16px; box-shadow: var(--winui-card-shadow); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
    .file-card { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px !important; }
    .controls-card { position: relative; z-index: 20; overflow: visible; }
    
    .svg-icon { display: inline-flex; align-items: center; justify-content: center; color: currentColor; }
    .btn, .btn-clear, .win-combobox-button, .win-input {
      outline: none !important;
    }

    .btn {
      height: 32px;
      padding: 0 16px;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 400;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: background-color var(--fluent-timing-fast), border-color var(--fluent-timing-fast);
    }

    .btn-standard {
      background: var(--winui-btn-standard);
      color: var(--winui-text-main);
      border: 1px solid var(--winui-btn-border);
      border-bottom: 1px solid var(--winui-btn-border-bottom);
      box-shadow: var(--winui-btn-shadow);
    }
    .btn-standard:hover {
      background: var(--winui-btn-hover);
      border-color: var(--winui-control-border-hover) !important;
    }
    .btn-standard:active {
      background: var(--winui-btn-active);
      border-color: var(--winui-btn-border) !important;
      border-bottom-color: var(--winui-btn-border) !important;
      box-shadow: none;
    }

    .btn-accent {
      background: var(--winui-accent);
      color: var(--winui-accent-text);
      border: 1px solid transparent !important;
      box-shadow: var(--winui-btn-shadow);
      font-weight: 500;
    }
    .btn-accent:hover {
      background: var(--winui-accent-hover);
    }
    .btn-accent:active {
      background: var(--winui-accent-active);
      box-shadow: none;
    }

    .btn:disabled {
      background: var(--winui-btn-standard) !important;
      color: var(--winui-text-disabled) !important;
      border-color: var(--winui-btn-border) !important;
      border-bottom-color: var(--winui-btn-border) !important;
      box-shadow: none !important;
      cursor: default;
      pointer-events: none;
      opacity: 1;
    }
    
    .btn-clear {
      height: 32px;
      background: transparent;
      border: 1px solid transparent !important;
      color: var(--winui-text-main);
      font-size: 13px;
      cursor: pointer;
      padding: 0 12px;
      border-radius: 4px;
      font-weight: 400;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all var(--fluent-timing-fast) ease;
      box-shadow: none !important;
      outline: none;
    }
    
    .btn-clear:hover {
      background: var(--winui-btn-clear-hover);
    }
    
    .btn-clear:active {
      background: var(--winui-btn-clear-active);
    }
    
    .input-grid-row {
         display: grid;
         grid-template-columns: 1.6fr 1fr auto 1fr;
         gap: 12px;
         align-items: end;
       }
   
       .input-group {
         display: flex;
         flex-direction: column;
         gap: 6px;
         align-items: center;
         text-align: center;
       }
       .input-group label {
         font-size: 12px;
         font-weight: 400;
         color: var(--winui-text-main);
         width: 100%;
       }
       
       .win-input { 
         width: 100%; 
         height: 32px; 
         background: var(--winui-control-bg); 
         border: 1px solid var(--winui-control-border); 
         border-radius: 4px; 
         padding: 0 12px; 
         box-shadow: none !important; 
         font-size: 14px; 
         color: var(--winui-text-main); 
         text-align: center; 
         transition: background-color var(--fluent-timing-fast), border-color var(--fluent-timing-fast); 
         -moz-appearance: textfield; 
       }
       .win-input::-webkit-outer-spin-button, .win-input::-webkit-inner-spin-button {
         -webkit-appearance: none;
         margin: 0;
       }
       .win-input:hover:not(:disabled) {
         border-color: var(--winui-control-border-hover) !important;
       }
       .win-input:focus:not(:disabled) {
         background: var(--winui-card);
         border-color: var(--winui-control-border) !important;
         border-bottom: 2px solid var(--winui-accent) !important;
         box-shadow: none !important;
       }
       .win-input:disabled {
         background: rgba(128, 128, 128, 0.05) !important;
         color: var(--winui-text-disabled);
         border-color: var(--winui-btn-border) !important;
         cursor: not-allowed;
         pointer-events: none;
       }
       
       .win-combobox-container {
         position: relative;
         width: 100%;
       }
   
       .win-combobox-button {
         width: 100%;
         height: 32px;
         background: var(--winui-control-bg);
         border: 1px solid var(--winui-control-border);
         border-bottom: 1px solid rgba(0, 0, 0, 0.45);
         border-radius: 4px;
         font-size: 14px;
         color: var(--winui-text-main);
         display: flex;
         align-items: center;
         justify-content: center;
         cursor: pointer;
         position: relative;
         transition: background-color var(--fluent-timing-fast), border-color var(--fluent-timing-fast);
       }

       .win-combobox-button svg {
           position: absolute;
           right: 12px;
           top: 50%;
           transform: translateY(-50%);
       }
       
       @media (prefers-color-scheme: dark) {
         .win-combobox-button {
           border-bottom-color: rgba(255, 255, 255, 0.4);
         }
       }

       .win-combobox-button:hover {
         border-color: var(--winui-control-border-hover) !important;
         background: var(--winui-btn-hover);
       }
       .win-combobox-button.open {
         border-color: var(--winui-control-border) !important;
         border-bottom: 2px solid var(--winui-accent) !important;
         background: var(--winui-card);
       }
   
       .input-separator-wrapper {
         height: 32px;
         display: flex;
         align-items: center;
         justify-content: center;
         color: var(--winui-text-secondary);
       }
       .separator-x {
         font-family: var(--font-icons);
         font-size: 10px;
         color: var(--winui-text-secondary);
       }
   
       .win-combobox-flyout {
         position: absolute;
         top: 36px;
         left: 0;
         width: 100%;
         background: var(--winui-flyout-bg);
         border: 1px solid var(--winui-flyout-border);
         border-radius: 8px;
         box-shadow: var(--winui-flyout-shadow);
         z-index: 30;
         padding: 4px 0;
         display: none;
         opacity: 0;
         transform: translateY(-8px);
         transition: opacity var(--fluent-timing-normal), transform var(--fluent-timing-normal);
         pointer-events: none;
       }
       .win-combobox-flyout.show {
         display: block;
         opacity: 1;
         transform: translateY(0);
         pointer-events: auto;
       }
   
       .win-combobox-item {
         min-height: 36px;
         padding: 7px 16px;
         font-size: 14px;
         color: var(--winui-text-main);
         cursor: pointer;
         margin: 2px 4px;
         border-radius: 4px;
         position: relative;
         transition: background-color var(--fluent-timing-fast);
         display: flex;
         align-items: center;
         text-align: left;
         touch-action: manipulation;
       }
       .win-combobox-item:hover {
         background-color: rgba(0, 0, 0, 0.04);
         color: var(--winui-text-main);
       }
       .win-combobox-item.selected {
         background-color: rgba(0, 0, 0, 0.04);
         font-weight: 400;
       }
       .win-combobox-item.selected::before {
         content: "";
         position: absolute;
         left: 0;
         top: 50%;
         transform: translateY(-50%);
         width: 3px;
         height: 16px;
         background-color: var(--winui-accent);
         border-radius: 2px;
       }

       @media (prefers-color-scheme: dark) {
         .win-combobox-item:hover {
           background-color: rgba(255, 255, 255, 0.04);
         }
         .win-combobox-item.selected {
           background-color: rgba(255, 255, 255, 0.04);
         }
       }
        
    .log-container { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .log-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; padding: 0 2px; }
    .log-header label { font-size: 13px; color: var(--winui-text-main); }
    .log-viewport { flex: 1; min-height: 0; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; background: rgba(255, 255, 255, 0.4); border: 1px solid var(--winui-card-border); border-radius: 6px; padding: 12px; overflow-y: auto; font-family: monospace; font-size: 12px; line-height: 1.5; color: var(--winui-text-main); }
    .log-placeholder { color: var(--winui-text-disabled) !important;  text-align: center; padding-top: 10px; }
    .log-entry { margin-bottom: 6px; padding: 8px 12px; border-radius: 4px; border: 1px solid var(--winui-card-border); background: color-mix(in oklab, var(--winui-accent) 2%, var(--winui-card)); text-align: left; }

    .log-viewport::-webkit-scrollbar {
      width: 14px; 
      background: transparent;
    }
    
    .log-viewport::-webkit-scrollbar-track {
      background: transparent;
      margin: 4px 0; 
    }
    
    .log-viewport::-webkit-scrollbar-thumb {
      background-clip: padding-box;
      border: 4px solid transparent; 
      background-color: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      transition: background-color 0.2s ease, border-width 0.2s ease;
    }
    
    .log-viewport::-webkit-scrollbar-thumb:hover {
      background-color: rgba(0, 0, 0, 0.4);
      border-width: 3px; 
    }

    @media (prefers-color-scheme: dark) {
      .log-viewport::-webkit-scrollbar-thumb {
        background-color: rgba(255, 255, 255, 0.2);
      }
      .log-viewport::-webkit-scrollbar-thumb:hover {
        background-color: rgba(255, 255, 255, 0.35);
      }
    }
  `;
  document.head.appendChild(styleSheet);

  const container = document.createElement("div");
  container.className = "app-container";

  // ——————————————————————————————————————————
  // CARD 1: File Selection (Гибридный выбор)
  // ——————————————————————————————————————————
  const fileCard = document.createElement("div");
  fileCard.className = "win-card file-card";

  const fileInfoWrapper = document.createElement("div");
  fileInfoWrapper.style.cssText = "display: flex; align-items: center; gap: 14px; min-width: 0;";
  fileInfoWrapper.innerHTML = `<span class="svg-icon" style="color: var(--winui-accent);">${ICONS.document}</span>`;

  const textMetaBlock = document.createElement("div");
  textMetaBlock.style.minWidth = "0";
  textMetaBlock.innerHTML = `<div style="font-size: 14px; font-weight: 400; color: var(--winui-text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t('ui.target_document')}</div>`;

  const fileStatus = document.createElement("div");
  fileStatus.className = "file-status";
  fileStatus.style.cssText = "font-size: 12px; color: var(--winui-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
  
  textMetaBlock.appendChild(fileStatus);
  fileInfoWrapper.appendChild(textMetaBlock);
  fileCard.appendChild(fileInfoWrapper);

  const browseBtn = WinButton({
    text: t('ui.browse'),
    variant: "standard",
    onClick: async () => {
      if (isTauri) {
        const selected = await open({
          multiple: false,
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (selected && typeof selected === "string") {
          AppState.inputPath = selected;
          timeline.addLog(t('logs.file_loaded'), selected, "info");
        }
      } else {
        const webInput = document.createElement("input");
        webInput.type = "file";
        webInput.accept = ".pdf";
        webInput.onchange = (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) {
            webSelectedFile = file;
            AppState.inputPath = file.name;
            timeline.addLog(t('logs.file_loaded'), `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`, "info");
          }
        };
        webInput.click();
      }
    }
  });
  fileCard.appendChild(browseBtn);

  AppState.onChange("inputPath", (path) => {
    if (path) {
      fileStatus.textContent = path.split(/[\\/]/).pop() || path;
      fileStatus.style.color = "var(--winui-text-main)";
    } else {
      fileStatus.textContent = t('ui.no_file_selected');
      fileStatus.style.color = "var(--winui-text-secondary)";
    }
  });

  // ——————————————————————————————————————————
  // CARD 2: Grid Layout Parameters
  // ——————————————————————————————————————————
  const gridCard = document.createElement("div");
  gridCard.className = "win-card controls-card";

  const gridRow = document.createElement("div");
  gridRow.className = "input-grid-row";

  const comboGroup = document.createElement("div");
  comboGroup.className = "input-group";
  comboGroup.innerHTML = `<label>${t('ui.preset_label')}</label>`;

  const comboContainer = document.createElement("div");
  comboContainer.className = "win-combobox-container";

  const comboBtn = document.createElement("div");
  comboBtn.className = "win-combobox-button";
  comboBtn.innerHTML = `<span>${t('presets.a_series')}</span>${ICONS.chevronDown}`;

  const comboFlyout = document.createElement("div");
  comboFlyout.className = "win-combobox-flyout";
  comboFlyout.innerHTML = `
    <div class="win-combobox-item selected" data-value="a-series">${t('presets.a_series')}</div>
    <div class="win-combobox-item" data-value="2-3">${t('presets.two_three')}</div>
    <div class="win-combobox-item" data-value="3-4">${t('presets.standard')}</div>
    <div class="win-combobox-item" data-value="custom">${t('presets.custom')}</div>
  `;

  comboContainer.appendChild(comboBtn);
  comboContainer.appendChild(comboFlyout);
  comboGroup.appendChild(comboContainer);

  const wGroup = document.createElement("div");
  wGroup.className = "input-group";
  wGroup.innerHTML = `<label>${t('ui.width_label')}</label>`;
  const wEntry = WinNumericInput({ placeholder: "1", defaultValue: "1" });
  wGroup.appendChild(wEntry);

  const separatorWrapper = document.createElement("div");
  separatorWrapper.className = "input-separator-wrapper";
  separatorWrapper.innerHTML = ICONS.multiply;

  const hGroup = document.createElement("div");
  hGroup.className = "input-group";
  hGroup.innerHTML = `<label>${t('ui.height_label')}</label>`;
  const hEntry = WinNumericInput({ placeholder: "1.414", defaultValue: "1.414" });
  hGroup.appendChild(hEntry);

  gridRow.appendChild(comboGroup);
  gridRow.appendChild(wGroup);
  gridRow.appendChild(separatorWrapper);
  gridRow.appendChild(hGroup);
  gridCard.appendChild(gridRow);

  // Флаг, показывающий, был ли выбор пресета инициирован пользователем (trusted event)
  let lastPresetChangeManual = false;

  function toggleFlyout(show: boolean) {
    if (show) {
      comboBtn.classList.add("open");
      comboFlyout.style.display = "block";
      setTimeout(() => comboFlyout.classList.add("show"), 10);
    } else {
      comboBtn.classList.remove("open");
      comboFlyout.classList.remove("show");
      setTimeout(() => {
        if (!comboFlyout.classList.contains("show")) comboFlyout.style.display = "none";
      }, 150);
    }
  }

  comboBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFlyout(!comboBtn.classList.contains("open"));
  });

  document.addEventListener("click", () => toggleFlyout(false));
  comboFlyout.addEventListener("click", (e) => e.stopPropagation());

  comboFlyout.querySelectorAll(".win-combobox-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      const target = e.currentTarget as HTMLElement;
      // Определяем, был ли клик инициирован пользователем (trusted event)
      const isManual = (e instanceof MouseEvent) ? e.isTrusted : false;
      // Помечаем, что последующая смена пресета была ручной — это поможет
      // обработчику onChange отличить ручной выбор от программного.
      lastPresetChangeManual = isManual;

      comboFlyout.querySelectorAll(".win-combobox-item").forEach(el => el.classList.remove("selected"));
      target.classList.add("selected");

      comboBtn.querySelector("span")!.textContent = target.textContent;

      const value = target.getAttribute("data-value") || "a-series";
      if (value === "custom" && isManual) {
        // Если пользователь явно выбрал "custom", очищаем поля ввода.
        wEntry.value = "";
        hEntry.value = "";
        wEntry.disabled = false; hEntry.disabled = false;
      }

      AppState.activePreset = value;
      toggleFlyout(false);

      // Сбрасываем флаг ASAP, чтобы он не влиял на последующие программные изменения.
      setTimeout(() => { lastPresetChangeManual = false; }, 0);
    });
  });

  AppState.onChange("activePreset", (preset) => {
    if (preset === "a-series") {
      wEntry.value = "1"; hEntry.value = "1.414"; wEntry.disabled = false; hEntry.disabled = false;
    } else if (preset === "2-3") {
      wEntry.value = "2"; hEntry.value = "3"; wEntry.disabled = false; hEntry.disabled = false;
    } else if (preset === "3-4") {
      wEntry.value = "3"; hEntry.value = "4"; wEntry.disabled = false; hEntry.disabled = false;
    } else if (preset === "custom") {
      // Разблокируем поля. Если переход был программный (не ручной) и оба поля пусты —
      // устанавливаем значения по умолчанию. Если же выбор сделал пользователь вручную,
      // поля уже были очищены в обработчике клика, и дефолты не ставим.
      wEntry.disabled = false; hEntry.disabled = false;
      if (!lastPresetChangeManual && wEntry.value === "" && hEntry.value === "") {
        wEntry.value = "1"; hEntry.value = "1.414";
      }
      wEntry.focus();
    }
  });

  // Автоматический переход на "custom" при изменении полей ввода
  const selectCustomPreset = () => {
    if (AppState.activePreset !== "custom") {
      const customItem = comboFlyout.querySelector('[data-value="custom"]') as HTMLElement;
      if (customItem) customItem.click();
    }
  };

  wEntry.addEventListener("input", selectCustomPreset);
  hEntry.addEventListener("input", selectCustomPreset);

  // ——————————————————————————————————————————
  // LAYER 3: Action Buttons & Timeline (Гибридные команды)
  // ——————————————————————————————————————————
  const actionRow = document.createElement("div");
  actionRow.style.cssText = "display: flex; gap: 8px;";

  const analyzeBtn = WinButton({
    text: t('ui.analyze_btn'),
    variant: "standard",
    onClick: async () => {
      if (!AppState.inputPath) return timeline.addLog(t('logs.action_required'), t('logs.select_file_first'), "failed");
      
      if (isTauri) {
        try {
          const res = await invoke<PdfAnalysis>("analyze_pdf", { inputPath: AppState.inputPath });
          let logContent = `${t('file')}: ${res.file_name}\n${t('ratios_found')}\n`;
          for (const [ratioKey, count] of Object.entries(res.ratios)) {
            logContent += `  • ${translateRatio(ratioKey)} : ${getPagesString(count)}\n`;
          }
          timeline.addLog(t('logs.analysis_completed'), logContent.trim(), "info");
        } catch (err) {
          timeline.addLog(t('logs.analysis_error'), parseAppError(err), "failed");
        }
      } else {
        try {
          const res = await analyzePdfWeb(webSelectedFile);
          let logContent = `${t('file')}: ${res.file_name}\n${t('ratios_found')}\n`;
          for (const [ratioKey, count] of Object.entries(res.ratios)) {
            logContent += `  • ${translateRatio(ratioKey)} : ${getPagesString(count)}\n`;
          }
          timeline.addLog(t('logs.analysis_completed'), logContent.trim(), "info");
        } catch (err) {
          timeline.addLog(t('logs.analysis_error'), parseAppError(err), "failed");
        }
      }
    }
  });
  analyzeBtn.style.flex = "1";

  const generateBtn = WinButton({
    text: t('ui.generate_btn'),
    variant: "accent",
    onClick: async () => {
      if (!AppState.inputPath) return timeline.addLog(t('logs.action_required'), t('logs.select_file_first'), "failed");

      const wr = parseFloat(wEntry.value) || 1;
      const hr = parseFloat(hEntry.value) || 1;

      if (isTauri) {
        const outputPath = await save({ filters: [{ name: "PDF", extensions: ["pdf"] }] });
        if (!outputPath) return;

        try {
          const res = await invoke<PdfResizeResult>("resize_pdf", {
            inputPath: AppState.inputPath,
            outputPath,
            wRatio: wr,
            hRatio: hr,
          });
          const successContent = formatString(t("resize_success"), { w: Math.round(res.target_w), h: Math.round(res.target_h) });
          timeline.addLog(t('logs.generation_success'), successContent, "success");
        } catch (err) {
          timeline.addLog(t('logs.generation_error'), parseAppError(err), "failed");
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
          timeline.addLog(t('logs.generation_success'), successContent, "success");
        } catch (err) {
          timeline.addLog(t('logs.generation_error'), parseAppError(err), "failed");
        }
      }
    }
  });
  generateBtn.style.flex = "1";

  actionRow.appendChild(analyzeBtn);
  actionRow.appendChild(generateBtn);

  const timeline = WinLogTimeline();

  container.appendChild(fileCard);
  container.appendChild(gridCard);
  container.appendChild(actionRow);
  container.appendChild(timeline.element);

  appElement.appendChild(container);
});
