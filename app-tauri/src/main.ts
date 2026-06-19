import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

// ==========================================
// 1. GLOBAL APPLICATION STATE (Реактивный)
// ==========================================
const AppState = {
  _inputPath: "",
  _activePreset: "a-series",

  // Слушатели изменений состояния (аналог Binding в WinUI)
  listeners: new Map<string, Array<(val: any) => void>>(),

  onChange(key: string, callback: (val: any) => void) {
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key)!.push(callback);
    // Сразу вызываем один раз для инициализации стартового значения
    callback((this as any)[`_${key}`]);
  },

  trigger(key: string, newVal: any) {
    this.listeners.get(key)?.forEach(cb => cb(newVal));
  },

  // Геттеры и сеттеры для чистого синтаксиса
  get inputPath() { return this._inputPath; },
  set inputPath(val: string) { this._inputPath = val; this.trigger("inputPath", val); },

  get activePreset() { return this._activePreset; },
  set activePreset(val: string) { this._activePreset = val; this.trigger("activePreset", val); }
};

// ==========================================
// 2. WINUI-LIKE REUSABLE COMPONENTS
// ==========================================

// Базовая фабрика для кнопок
function WinButton(options: { text: string; variant: "standard" | "accent"; onClick: () => void }) {
  const btn = document.createElement("button");
  btn.className = `btn btn-${options.variant}`;
  btn.textContent = options.text;
  btn.addEventListener("click", options.onClick);
  return btn;
}

// Поле ввода числовых значений
function WinNumericInput(options: { placeholder: string; defaultValue: string }) {
  const input = document.createElement("input");
  input.className = "win-input";
  input.type = "number";
  input.step = "any";
  input.placeholder = options.placeholder;
  input.value = options.defaultValue;
  return input;
}

// Компонент лога (Process Timeline)
function WinLogTimeline() {
  const container = document.createElement("div");
  container.className = "log-container";

  const header = document.createElement("div");
  header.className = "log-header";
  header.innerHTML = `<label>Process Timeline</label>`;

  const clearBtn = document.createElement("button");
  clearBtn.className = "btn-clear";
  clearBtn.innerHTML = `<i class="f-icon" style="font-size: 12px;">&#xE74D;</i>Clear history`;

  const viewport = document.createElement("div");
  viewport.className = "log-viewport";
  
  header.appendChild(clearBtn);
  container.appendChild(header);
  container.appendChild(viewport);

  const setInitialState = () => {
    viewport.innerHTML = `<div class="log-placeholder">The system is ready to work...</div>`;
  };
  setInitialState();

  clearBtn.addEventListener("click", setInitialState);

  // Публичный метод для добавления записей (инкапсуляция логики)
  const addLog = (title: string, content: string, type: "info" | "success" | "failed") => {
    if (viewport.querySelector(".log-placeholder")) {
      viewport.innerHTML = "";
    }
    const entry = document.createElement("div");
    entry.className = "log-entry";
    if (type === "success") entry.style.borderLeft = "4px solid var(--winui-accent)";
    if (type === "failed") entry.style.borderLeft = "4px solid #e81123";

    entry.innerHTML = `
      <div style="font-weight: 400; font-size: 11px; color: var(--winui-text-secondary);">${new Date().toLocaleTimeString()}</div>
      <div style="font-weight: 400; color: var(--winui-text-main); margin-top: 2px;">${title}</div>
      <div style="color: var(--winui-text-secondary); margin-top: 1px; white-space: pre-line; word-break: break-all;">${content}</div>
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

  // ------------------------------------------
  // ДОБАВЛЕНО: Отслеживание темы для иконки окна
  // ------------------------------------------
  const initThemeIconListener = () => {
    const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const updateIcon = async (isDark: boolean) => {
      try {
        await invoke("set_theme_icon", { isDark });
      } catch (err) {
        console.error("Не удалось синхронизировать иконку окна:", err);
      }
    };

    // Проверяем тему один раз при холодном старте приложения
    updateIcon(themeQuery.matches);

    // Подписываемся на динамическое изменение темы в Windows (на лету)
    themeQuery.addEventListener('change', (e) => updateIcon(e.matches));
  };
  
  initThemeIconListener();
  // ------------------------------------------

  // Отключаем дефолтное контекстное меню браузера (клик правой кнопкой мыши)
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  }, { capture: true });

  // Вшиваем стили один раз (палитра Mica Alt / Acrylic из прошлых шагов)
  const styleSheet = document.createElement("style");
  styleSheet.innerText = `
    :root {
      --winui-accent: #0078d4; --winui-accent-hover: #106ebe; --winui-accent-active: #005a9e; --winui-accent-text: #ffffff;
      --winui-window-bg: transparent;
      --winui-card: rgba(255, 255, 255, 0.7);
      --winui-card-border: rgba(0, 0, 0, 0.07);
      --winui-card-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.02), 0 1px 2px rgba(0, 0, 0, 0.02);
      --winui-text-main: rgba(0, 0, 0, 0.9); --winui-text-secondary: rgba(0, 0, 0, 0.61); --winui-text-disabled: rgba(0, 0, 0, 0.36);
      --winui-btn-standard: rgba(255, 255, 255, 0.7); --winui-btn-hover: rgba(249, 249, 249, 0.5); --winui-btn-active: rgba(245, 245, 245, 0.0);
      --winui-btn-border: rgba(0, 0, 0, 0.06); --winui-btn-border-bottom: rgba(0, 0, 0, 0.16); --winui-btn-shadow: 0 1px 2px rgba(0, 0, 0, 0.0);
      --winui-control-bg: rgba(255, 255, 255, 0.7); --winui-control-border: rgba(0, 0, 0, 0.06); --winui-control-border-hover: rgba(0, 0, 0, 0.08);
      --winui-flyout-bg: rgba(243, 243, 243); --winui-flyout-border: rgba(0, 0, 0, 0.08); --winui-flyout-shadow: 0 8px 16px rgba(0, 0, 0, 0.08), 0 1px 4px rgba(0, 0, 0, 0.04);
      --font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif;
      --font-icons: 'Segoe Fluent Icons', 'Segoe MDL2 Assets', sans-serif;
      --fluent-timing-fast: 0.067s cubic-bezier(0.1, 0.9, 0.2, 1); --fluent-timing-normal: 0.15s cubic-bezier(0.1, 0.9, 0.2, 1);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --winui-accent: #60cdff; --winui-accent-hover: #4cc3ff; --winui-accent-active: #0091f7; --winui-accent-text: #000000;
        --winui-card: rgba(255, 255, 255, 0.05); --winui-card-border: rgba(255, 255, 255, 0.03); --winui-card-shadow: 0 1px 1px rgba(0, 0, 0, 0.1);
        --winui-text-main: rgba(255, 255, 255, 0.96); --winui-text-secondary: rgba(255, 255, 255, 0.78); --winui-text-disabled: rgba(255, 255, 255, 0.44);
        --winui-btn-standard: rgba(255, 255, 255, 0.05); --winui-btn-hover: rgba(255, 255, 255, 0.09); --winui-btn-active: rgba(255, 255, 255, 0.03);
        --winui-btn-border: rgba(255, 255, 255, 0.04); --winui-btn-border-bottom: rgba(255, 255, 255, 0.06); --winui-btn-shadow: none;
        --winui-control-bg: rgba(45, 45, 45, 0.6); --winui-control-border: rgba(255, 255, 255, 0.08); --winui-control-border-hover: rgba(255, 255, 255, 0.05);
        --winui-flyout-bg: rgba(44, 44, 44); --winui-flyout-border: rgba(255, 255, 255, 0.06); --winui-flyout-shadow: 0 8px 16px rgba(0, 0, 0, 0.3), 0 1px 4px rgba(0, 0, 0, 0.1);
      }
      .log-viewport { background: rgba(0, 0, 0, 0.2) !important; }
    }
    html, body { margin: 0; padding: 0; background-color: var(--winui-window-bg) !important; height: 100vh; overflow: hidden; }
    
    /* Полный запрет выделения текста по всему приложению */
    * { 
      box-sizing: border-box; 
      font-family: var(--font-family); 
      -webkit-font-smoothing: antialiased; 
      user-select: none !important; 
      -webkit-user-select: none !important; 
    }
    
    .app-container { padding: 24px; height: 100vh; display: flex; flex-direction: column; gap: 16px; background: transparent; }
    .win-card { background: var(--winui-card); border: 1px solid var(--winui-card-border); border-radius: 8px; padding: 16px; box-shadow: var(--winui-card-shadow); }
    .f-icon { font-family: var(--font-icons); font-style: normal; display: inline-block; vertical-align: middle; line-height: 1; }
    .btn, .btn-clear, .win-combobox-button, .win-input { outline: none !important; }
    .btn { height: 32px; padding: 0 16px; border-radius: 4px; font-size: 14px; font-weight: 400; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: background-color var(--fluent-timing-fast), border-color var(--fluent-timing-fast); }
    .btn-standard { background: var(--winui-btn-standard); color: var(--winui-text-main); border: 1px solid var(--winui-btn-border); border-bottom: 1px solid var(--winui-btn-border-bottom); box-shadow: var(--winui-btn-shadow); }
    .btn-standard:hover { background: var(--winui-btn-hover); border-color: var(--winui-control-border-hover) !important; }
    .btn-standard:active { background: var(--winui-btn-active); border-color: var(--winui-btn-border) !important; border-bottom-color: var(--winui-btn-border) !important; box-shadow: none; }
    .btn-accent { background: var(--winui-accent); color: var(--winui-accent-text); border: 1px solid transparent !important; box-shadow: var(--winui-btn-shadow); font-weight: 500; }
    .btn-accent:hover { background: var(--winui-accent-hover); }
    .btn-accent:active { background: var(--winui-accent-active); box-shadow: none; }
    .btn:disabled { background: var(--winui-btn-standard) !important; color: var(--winui-text-disabled) !important; border-color: var(--winui-btn-border) !important; border-bottom-color: var(--winui-btn-border) !important; box-shadow: none !important; cursor: default; pointer-events: none; opacity: 1; }
    .btn-clear { background: transparent; border: 4px solid transparent !important; color: var(--winui-text-secondary); font-size: 12px; cursor: pointer; padding: 4px 20px; border-radius: 4px; display: inline-flex; align-items: center; gap: 6px; transition: background-color var(--fluent-timing-fast), color var(--fluent-timing-fast); }
    .btn-clear:hover { background: var(--winui-btn-hover); color: var(--winui-text-main); }
    
    /* Сетка параметров с центрированием */
    .input-grid-row { display: grid; grid-template-columns: 1.6fr 1fr auto 1fr; gap: 12px; align-items: end; }
    .input-group { display: flex; flex-direction: column; gap: 6px; align-items: center; text-align: center; }
    .input-group label { font-size: 12px; font-weight: 400; color: var(--winui-text-main); width: 100%; }
    
    /* Поля ввода (для инпутов выделение/ввод текста разрешены) */
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
      user-select: text !important; 
      -webkit-user-select: text !important; 
    }
    .win-input::-webkit-outer-spin-button, .win-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .win-input:hover:not(:disabled) { border-color: var(--winui-control-border-hover) !important; }
    .win-input:focus:not(:disabled) { background: var(--winui-card); border-color: var(--winui-control-border) !important; border-bottom: 2px solid var(--winui-accent) !important; box-shadow: none !important; }
    .win-input:disabled { background: rgba(128, 128, 128, 0.05) !important; color: var(--winui-text-disabled); border-color: var(--winui-btn-border) !important; cursor: not-allowed; pointer-events: none; }
    
    .win-combobox-container { position: relative; width: 100%; }
    .win-combobox-button { width: 100%; height: 32px; background: var(--winui-control-bg); border: 1px solid var(--winui-control-border); border-bottom: 1px solid rgba(0, 0, 0, 0.45); border-radius: 4px; padding: 0 32px 0 12px; font-size: 14px; color: var(--winui-text-main); display: flex; align-items: center; justify-content: center; cursor: pointer; position: relative; transition: background-color var(--fluent-timing-fast), border-color var(--fluent-timing-fast); }
    @media (prefers-color-scheme: dark) { .win-combobox-button { border-bottom-color: rgba(255, 255, 255, 0.4); } }
    .win-combobox-button::after { content: "\\E70D"; font-family: var(--font-icons); position: absolute; right: 12px; font-size: 10px; color: var(--winui-text-secondary); }
    .win-combobox-button:hover { border-color: var(--winui-control-border-hover) !important; background: var(--winui-btn-hover); }
    .win-combobox-button.open { border-color: var(--winui-control-border) !important; border-bottom: 2px solid var(--winui-accent) !important; background: var(--winui-card); }
    .input-separator-wrapper { height: 32px; display: flex; align-items: center; justify-content: center; }
    .separator-x { font-family: var(--font-icons); font-size: 10px; color: var(--winui-text-secondary); }
    .win-combobox-flyout { position: absolute; top: 36px; left: 0; width: 100%; background: var(--winui-flyout-bg); border: 1px solid var(--winui-flyout-border); border-radius: 8px; box-shadow: var(--winui-flyout-shadow); z-index: 1000; padding: 4px 0; display: none; opacity: 0; transform: translateY(-8px); transition: opacity var(--fluent-timing-normal), transform var(--fluent-timing-normal); backdrop-filter: blur(20px) saturate(140%); -webkit-backdrop-filter: blur(20px) saturate(140%); }
    .win-combobox-flyout.show { display: block; opacity: 1; transform: translateY(0); }
    .win-combobox-item { padding: 6px 16px; font-size: 14px; color: var(--winui-text-main); cursor: pointer; margin: 2px 4px; border-radius: 4px; position: relative; transition: background-color var(--fluent-timing-fast); text-align: left; }
    .win-combobox-item:hover { background-color: var(--winui-btn-hover); }
    .win-combobox-item.selected { background-color: var(--winui-btn-active); font-weight: 400; }
    .win-combobox-item.selected::before { content: ""; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 3px; height: 16px; background-color: var(--winui-accent); border-radius: 2px; }
    
    /* Лог и плейсхолдер готовности системы (для логов возможность скопировать текст сохранена) */
    .log-container { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .log-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; padding: 0 2px; }
    .log-header label { font-size: 13px; font-weight: 400; color: var(--winui-text-main); }
    .log-viewport { 
      flex: 1; 
      background: rgba(255, 255, 255, 0.15); 
      border: 1px solid var(--winui-card-border); 
      border-radius: 6px; 
      padding: 12px; 
      overflow-y: auto; 
      font-family: 'Cascadia Code', 'Consolas', monospace; 
      font-size: 12px; 
      line-height: 1.5; 
      color: var(--winui-text-main); 
      user-select: text !important; 
      -webkit-user-select: text !important; 
    }
    .log-viewport::-webkit-scrollbar { width: 4px; }
    .log-viewport::-webkit-scrollbar-track { background: transparent; }
    .log-viewport::-webkit-scrollbar-thumb { background: rgba(128, 128, 128, 0.2); border-radius: 10px; }
    .log-viewport::-webkit-scrollbar-thumb:hover { background: rgba(128, 128, 128, 0.4); }
    .log-placeholder { color: var(--winui-text-disabled) !important; font-style: italic; text-align: center; padding-top: 10px; user-select: none !important; -webkit-user-select: none !important; }
    .log-entry { margin-bottom: 6px; padding: 8px 12px; border-radius: 4px; border: 1px solid var(--winui-card-border); background: color-mix(in srgb, var(--winui-accent) 3%, var(--winui-card)); text-align: left; }
  `;
  document.head.appendChild(styleSheet);

  const container = document.createElement("div");
  container.className = "app-container";

  // ——————————————————————————————————————————
  // КАРТОЧКА 1: Выбор файла (Target Document)
  // ——————————————————————————————————————————
  const fileCard = document.createElement("div");
  fileCard.className = "win-card";
  fileCard.style.cssText = "display: flex; align-items: center; justify-content: space-between; gap: 16px;";

  const fileInfoWrapper = document.createElement("div");
  fileInfoWrapper.style.cssText = "display: flex; align-items: center; gap: 14px; min-width: 0;";
  fileInfoWrapper.innerHTML = `<i class="f-icon" style="font-size: 20px; color: var(--winui-accent); opacity: 0.9;">&#xE8A5;</i>`;

  const textMetaBlock = document.createElement("div");
  textMetaBlock.style.minWidth = "0";
  textMetaBlock.innerHTML = `<div style="font-size: 14px; font-weight: 400; color: var(--winui-text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Target Document</div>`;

  const fileStatus = document.createElement("div");
  fileStatus.style.cssText = "font-size: 12px; color: var(--winui-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
  
  textMetaBlock.appendChild(fileStatus);
  fileInfoWrapper.appendChild(textMetaBlock);
  fileCard.appendChild(fileInfoWrapper);

  const browseBtn = WinButton({
    text: "Browse",
    variant: "standard",
    onClick: async () => {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (selected && typeof selected === "string") {
        AppState.inputPath = selected;
        timeline.addLog("Файл загружен", selected, "info");
      }
    }
  });
  fileCard.appendChild(browseBtn);

  // Привязка данных (Data Binding) к изменению пути к файлу
  AppState.onChange("inputPath", (path) => {
    if (path) {
      fileStatus.textContent = path.split(/[\\/]/).pop() || path;
      fileStatus.style.color = "var(--winui-text-main)";
    } else {
      fileStatus.textContent = "No file selected";
      fileStatus.style.color = "var(--winui-text-secondary)";
    }
  });

  // ——————————————————————————————————————————
  // КАРТОЧКА 2: Сетка параметров (Grid Layout)
  // ——————————————————————————————————————————
  const gridCard = document.createElement("div");
  gridCard.className = "win-card";

  const gridRow = document.createElement("div");
  gridRow.className = "input-grid-row";

  // Группа ComboBox
  const comboGroup = document.createElement("div");
  comboGroup.className = "input-group";
  comboGroup.innerHTML = `<label>Aspect ratio preset</label>`;

  const comboContainer = document.createElement("div");
  comboContainer.className = "win-combobox-container";

  const comboBtn = document.createElement("div");
  comboBtn.className = "win-combobox-button";
  comboBtn.textContent = "A-Series (A4, A3...)";

  const comboFlyout = document.createElement("div");
  comboFlyout.className = "win-combobox-flyout";
  comboFlyout.innerHTML = `
    <div class="win-combobox-item selected" data-value="a-series">A-Series (A4, A3...)</div>
    <div class="win-combobox-item" data-value="16-9">Widescreen (16:9)</div>
    <div class="win-combobox-item" data-value="4-3">Standard (4:3)</div>
    <div class="win-combobox-item" data-value="custom">Custom (Manual)</div>
  `;

  comboContainer.appendChild(comboBtn);
  comboContainer.appendChild(comboFlyout);
  comboGroup.appendChild(comboContainer);

  // Текстовые поля ввода соотношений сторон
  const wGroup = document.createElement("div");
  wGroup.className = "input-group";
  wGroup.innerHTML = `<label>Width ratio</label>`;
  const wEntry = WinNumericInput({ placeholder: "1", defaultValue: "1" });
  wGroup.appendChild(wEntry);

  const separatorWrapper = document.createElement("div");
  separatorWrapper.className = "input-separator-wrapper";
  separatorWrapper.innerHTML = `<div class="separator-x">&#xE947;</div>`;

  const hGroup = document.createElement("div");
  hGroup.className = "input-group";
  hGroup.innerHTML = `<label>Height ratio</label>`;
  const hEntry = WinNumericInput({ placeholder: "1.414", defaultValue: "1.414" });
  hGroup.appendChild(hEntry);

  gridRow.appendChild(comboGroup);
  gridRow.appendChild(wGroup);
  gridRow.appendChild(separatorWrapper);
  gridRow.appendChild(hGroup);
  gridCard.appendChild(gridRow);

  // Управление поведением выпадающего списка
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

  comboFlyout.querySelectorAll(".win-combobox-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      const target = e.currentTarget as HTMLElement;
      comboFlyout.querySelectorAll(".win-combobox-item").forEach(el => el.classList.remove("selected"));
      target.classList.add("selected");

      comboBtn.textContent = target.textContent;
      AppState.activePreset = target.getAttribute("data-value") || "a-series";
    });
  });

  // Логика автозаполнения полей в зависимости от пресета (State binding)
  AppState.onChange("activePreset", (preset) => {
    if (preset === "a-series") {
      wEntry.value = "1"; hEntry.value = "1.414"; wEntry.disabled = true; hEntry.disabled = true;
    } else if (preset === "16-9") {
      wEntry.value = "16"; hEntry.value = "9"; wEntry.disabled = true; hEntry.disabled = true;
    } else if (preset === "4-3") {
      wEntry.value = "4"; hEntry.value = "3"; wEntry.disabled = true; hEntry.disabled = true;
    } else if (preset === "custom") {
      wEntry.value = ""; hEntry.value = ""; wEntry.disabled = false; hEntry.disabled = false;
      wEntry.focus();
    }
  });

  // ——————————————————————————————————————————
  // СЛОЙ ДЕЙСТВИЙ (Action Buttons & Timeline)
  // ——————————————————————————————————————————
  const actionRow = document.createElement("div");
  actionRow.style.cssText = "display: flex; gap: 8px;";

  const analyzeBtn = WinButton({
    text: "Analyze",
    variant: "standard",
    onClick: async () => {
      if (!AppState.inputPath) return timeline.addLog("Action Required", "Please select a PDF file first.", "failed");
      try {
        const res = await invoke("analyze_pdf", { inputPath: AppState.inputPath });
        timeline.addLog("Анализ завершен", res as string, "info");
      } catch (err) {
        timeline.addLog("Ошибка анализа", String(err), "failed");
      }
    }
  });
  analyzeBtn.style.flex = "1";

  const generateBtn = WinButton({
    text: "Generate PDF",
    variant: "accent",
    onClick: async () => {
      if (!AppState.inputPath) return timeline.addLog("Action Required", "Please select a PDF file first.", "failed");

      const wr = parseFloat(wEntry.value) || 1;
      const hr = parseFloat(hEntry.value) || 1;

      const outputPath = await save({ filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (!outputPath) return;

      try {
        const res = await invoke("resize_pdf", {
          inputPath: AppState.inputPath,
          outputPath,
          wRatio: wr,
          hRatio: hr,
        });
        timeline.addLog("Генерация успешна", res as string, "success");
      } catch (err) {
        timeline.addLog("Ошибка", String(err), "failed");
      }
    }
  });
  generateBtn.style.flex = "1";

  actionRow.appendChild(analyzeBtn);
  actionRow.appendChild(generateBtn);

  // Создаем изолированный инстанс логов
  const timeline = WinLogTimeline();

  // Собираем всё дерево в контейнер
  container.appendChild(fileCard);
  container.appendChild(gridCard);
  container.appendChild(actionRow);
  container.appendChild(timeline.element);

  appElement.appendChild(container);
});