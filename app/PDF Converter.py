import tkinter as tk
from tkinter import filedialog, scrolledtext
from pypdf import PdfReader
from collections import Counter
import subprocess
import os
import sys
import ctypes


# =========================
# RESOURCE PATH + ДИАГНОСТИКА
# =========================
def resource_path(relative_path):
    """Универсальная функция поиска ресурсов: работает в dev-режиме и в EXE"""
    try:
        # Если запущено из скомпилированного EXE
        base_path = sys._MEIPASS
    except Exception:
        # Если запускается обычный .py скрипт.
        base_path = os.path.dirname(os.path.abspath(__file__))

    full_path = os.path.join(base_path, relative_path)
    print(f"[DEBUG] Resource requested: {relative_path} → {full_path}")  # для отладки
    return full_path


# =========================
# GHOSTSCRIPT (ВНУТРИ EXE)
# =========================
def get_gs_path():
    gs_exe = resource_path("gswin64c.exe")
    if os.path.exists(gs_exe):
        return gs_exe

    from shutil import which
    gs = which("gswin64c")
    if gs:
        return gs

    default = r"C:\Program Files\gs\gs10.06.0\bin\gswin64c.exe"
    if os.path.exists(default):
        return default

    raise FileNotFoundError("Ghostscript не найден")


# =========================
# ИКОНКИ
# =========================
def setup_window_icon(root):
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('mycompany.pdfconverter.gui.1.0')
    except:
        pass

    # Пробуем icon.png
    png_path = resource_path("icon.png")
    if os.path.exists(png_path):
        try:
            icon_img = tk.PhotoImage(file=png_path)
            root.iconphoto(True, icon_img)
            root._icon_img = icon_img
            print(f"✅ Иконка PNG загружена: {png_path}")
            return
        except Exception as e:
            print(f"❌ Ошибка загрузки PNG: {e}")

    # Fallback на icon.ico
    ico_path = resource_path("icon.ico")
    if os.path.exists(ico_path):
        try:
            root.iconbitmap(ico_path)
            print(f"✅ Иконка ICO загружена: {ico_path}")
        except Exception as e:
            print(f"❌ Ошибка загрузки ICO: {e}")
    else:
        print("⚠️ Ни icon.png, ни icon.ico не найдены!")


# =========================
# РАБОТА С PDF И ЛОГИКА
# =========================
def log_block(box, title, content, status):
    box.configure(state="normal")
    box.insert(tk.END, "-" * 60 + "\n")
    box.insert(tk.END, f"{title}\n\n")
    box.insert(tk.END, content + "\n")
    box.insert(tk.END, f"\n{status}\n")
    box.see(tk.END)
    box.configure(state="disabled")


def ratio_class(w, h):
    r = w / h
    if abs(r - 1.414) < 0.03: return "(A-series)"
    if abs(r - 1.333) < 0.03: return "(4:3)"
    if abs(r - 1.777) < 0.03: return "(16:9)"
    if abs(r - 0.75) < 0.03:  return "(3:4)"
    if abs(r - 0.666) < 0.03: return "(2:3)"
    return f"custom ({w:.2f}:{h:.2f})"


def analyze_pdf(path, box):
    reader = PdfReader(path)
    ratios = []
    file_name = os.path.basename(path)

    for page in reader.pages:
        w = float(page.mediabox.width)
        h = float(page.mediabox.height)
        ratios.append(ratio_class(w, h))

    counter = Counter(ratios)
    content = "Unique aspect ratios:\n\n"
    for k, v in counter.items():
        content += f"{k}: {v} pages\n"

    log_block(box, f"📄 ANALYZE: {file_name}", content, "✔ done")


def resize_pdf_gs(input_path, output_path, w_ratio, h_ratio, box):
    gs_path = get_gs_path()
    file_name = os.path.basename(input_path)

    base_width = 1440
    base_height = int(base_width * h_ratio / w_ratio)

    input_path = os.path.abspath(input_path)
    output_path = os.path.abspath(output_path)

    # Инструкция на языке PostScript для принудительного изменения геометрии
    # и игнорирования оригинальных пропорций страниц
    ps_force_geometry = (
        f'<< /PageSize [{base_width} {base_height}] '
        f'/Policies << /PageSize 3 >> '
        f'>> setpagedevice'
    )

    # Измененный и строго выверенный порядок аргументов для Ghostscript
    cmd = [
            gs_path, 
            "-sDEVICE=pdfwrite", 
            "-dNOPAUSE", 
            "-dBATCH", 
            "-dFIXEDMEDIA",
            "-dAutoRotatePages=/None",      # Сохраняем оригинальную ориентацию
            f"-dDEVICEWIDTHPOINTS={base_width}",
            f"-dDEVICEHEIGHTPOINTS={base_height}",
            "-dPDFFitPage",                 # Включаем вписывание контента
            "-dUseCropBox=true",            # КРИТИЧЕСКИ ВАЖНО: масштабируем по видимой рамке, а не скрытой
            "-dUseTrimBox=true",
            f"-sOutputFile={output_path}", 
            "-c", ps_force_geometry,        # Накладываем финальный жесткий размер
            "-f", input_path
        ]

    try:
        result = subprocess.run(
            cmd, 
            check=True, 
            creationflags=subprocess.CREATE_NO_WINDOW,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8'
        )
        status = "✔ done"
    except subprocess.CalledProcessError as e:
        gs_error = e.stderr if e.stderr else e.output
        status = f"❌ Ghostscript error:\n{gs_error}"
    except Exception as e:
        status = f"❌ error: {e}"

    log_block(box, f"📐 RESIZE: {file_name}", "Running Ghostscript...", status)


# =========================
# GUI
# =========================
class App:
    def __init__(self, root):
        self.root = root
        self.input_path = None

        font_big = ("Segoe UI", 22, "bold")
        font = ("Segoe UI", 14)

        header = tk.Frame(root, bg="#f5f5f5")
        header.pack(pady=20)
        tk.Label(header, text="📄 PDF Converter", font=font_big, bg="#f5f5f5", fg="#111").pack()

        tk.Button(root, text="📂 Open PDF", command=self.open_pdf,
                  width=26, height=2, font=font).pack(pady=15)

        ratio_frame = tk.Frame(root, bg="#f5f5f5")
        ratio_frame.pack(pady=20)

        tk.Label(ratio_frame, text="Width ratio", bg="#f5f5f5", font=font).grid(row=0, column=0, padx=20)
        self.w_entry = tk.Entry(ratio_frame, width=14, font=font)
        self.w_entry.grid(row=1, column=0, padx=20, pady=5)

        tk.Label(ratio_frame, text="Height ratio", bg="#f5f5f5", font=font).grid(row=0, column=1, padx=20)
        self.h_entry = tk.Entry(ratio_frame, width=14, font=font)
        self.h_entry.grid(row=1, column=1, padx=20, pady=5)

        btn_frame = tk.Frame(root, bg="#f5f5f5")
        btn_frame.pack(pady=20)
        tk.Button(btn_frame, text="📊 Analyze", command=self.analyze,
                  width=20, height=2, font=font).grid(row=0, column=0, padx=15)
        tk.Button(btn_frame, text="📐 Resize", command=self.resize,
                  width=20, height=2, font=font).grid(row=0, column=1, padx=15)

        self.out = scrolledtext.ScrolledText(root, wrap=tk.WORD, font=("Consolas", 13),
                                             bg="#ffffff", fg="#111")
        self.out.pack(expand=True, fill="both", padx=20, pady=20)
        self.out.configure(state="disabled")

    def open_pdf(self):
        self.input_path = filedialog.askopenfilename(filetypes=[("PDF", "*.pdf")])
        if self.input_path:
            log_block(self.out, "📂 FILE LOADED", os.path.basename(self.input_path), "✔ ready")

    def analyze(self):
        if self.input_path:
            analyze_pdf(self.input_path, self.out)

    def resize(self):
        if not self.input_path:
            return
        out_path = filedialog.asksaveasfilename(defaultextension=".pdf")
        if not out_path:
            return
        try:
            wr = int(self.w_entry.get())
            hr = int(self.h_entry.get())
        except:
            log_block(self.out, "ERROR", "Invalid ratio", "failed")
            return
        resize_pdf_gs(self.input_path, out_path, wr, hr, self.out)


# =========================
# MAIN
# =========================
if __name__ == "__main__":
    root = tk.Tk()
    root.title("PDF Converter")
    root.geometry("1050x720")
    root.configure(bg="#f5f5f5")

    setup_window_icon(root)

    App(root)
    root.mainloop()