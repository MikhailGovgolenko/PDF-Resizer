import tkinter as tk
from tkinter import filedialog
import customtkinter as ctk
from pypdf import PdfReader, PdfWriter
from collections import Counter
import os
import sys
import ctypes
from PIL import Image, ImageDraw

ctk.set_appearance_mode("light")  
ctk.set_default_color_theme("blue")  

def create_vector_icon(icon_type, color="#007AFF"):
    size = (64, 64)  
    img = Image.new("RGBA", size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)
    
    if icon_type == "folder":
        draw.rounded_rectangle([4, 16, 60, 56], radius=4, fill=color)
        draw.rounded_rectangle([4, 8, 28, 24], radius=3, fill=color)
        draw.rectangle([4, 16, 28, 24], fill=color)
    elif icon_type == "chart":
        draw.rounded_rectangle([8, 36, 20, 56], radius=2, fill=color)
        draw.rounded_rectangle([26, 12, 38, 56], radius=2, fill=color)
        draw.rounded_rectangle([44, 24, 56, 56], radius=2, fill=color)
    elif icon_type == "gear":
        draw.rounded_rectangle([6, 14, 58, 22], radius=2, fill=color)
        draw.rounded_rectangle([6, 42, 58, 50], radius=2, fill=color)
        draw.ellipse([38, 8, 50, 28], fill=color)
        draw.ellipse([14, 36, 26, 56], fill=color)

    target_img = img.resize((26, 26), resample=Image.Resampling.LANCZOS)
    return ctk.CTkImage(light_image=target_img, dark_image=target_img, size=(26, 26))

def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_path, relative_path)

def setup_window_icon(root):
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(
            'mycompany.pdfconverter.gui.1.0'
        )
    except:
        pass

    ico_path = resource_path("icon.ico")
    png_path = resource_path("icon.png")

    print(f"[Debug] Ожидаемый путь к ICO: {ico_path}")
    print(f"[Debug] Ожидаемый путь к PNG: {png_path}")


    if os.path.exists(ico_path):
        try:
            root.wm_iconbitmap(ico_path)
            print(f"✅ ICO icon loaded successfully: {ico_path}")
            return
        except Exception as e:
            print(f"❌ ICO load error: {e}")


    if os.path.exists(png_path):
        try:
            icon_img = tk.PhotoImage(file=png_path)
            root.iconphoto(True, icon_img)
            root._icon_img = icon_img
            print(f"✅ PNG icon loaded successfully: {png_path}")
            return
        except Exception as e:
            print(f"❌ PNG load error: {e}")

    print("⚠️ icon.png and icon.ico not found! Оставлена стандартная иконка Tkinter.")
def log_block(box, title, content, status):
    box.configure(state="normal")
    box.insert(tk.END, "—" * 60 + "\n")
    box.insert(tk.END, f"[{status.upper()}] {title}\n\n")
    box.insert(tk.END, content + "\n\n")
    box.see(tk.END)
    box.configure(state="disabled")

def ratio_class(w, h):
    r = w / h
    if abs(r - 1.414) < 0.03: return "A-series"
    if abs(r - 1.333) < 0.03: return "4:3"
    if abs(r - 1.777) < 0.03: return "16:9"
    if abs(r - 0.75) < 0.03:  return "3:4"
    if abs(r - 0.666) < 0.03: return "2:3"
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
    content = "Unique aspect ratios found:\n"
    for k, v in counter.items():
        content += f"  • {k}: {v} pages\n"

    log_block(box, f"ANALYZE: {file_name}", content, "info")

def resize_pdf_pure_python(input_path, output_path, w_ratio, h_ratio, box):
    file_name = os.path.basename(input_path)
    try:
        reader = PdfReader(input_path)
        writer = PdfWriter()

        target_width = 595.0
        target_height = target_width * h_ratio / w_ratio

        for original_page in reader.pages:
            current_width = float(original_page.mediabox.width)
            current_height = float(original_page.mediabox.height)

            fit_x = target_width / current_width
            fit_y = target_height / current_height
            scale = min(fit_x, fit_y)

            new_content_w = current_width * scale
            new_content_h = current_height * scale

            offset_x = (target_width - new_content_w) / 2
            offset_y = (target_height - new_content_h) / 2

            page = writer.add_page(original_page)
            page.scale(scale, scale)
            
            page.mediabox.left = -offset_x
            page.mediabox.bottom = -offset_y
            page.mediabox.right = target_width - offset_x
            page.mediabox.top = target_height - offset_y

            page.cropbox.left = page.mediabox.left
            page.cropbox.bottom = page.mediabox.bottom
            page.cropbox.right = page.mediabox.right
            page.cropbox.top = page.mediabox.top
            
            if hasattr(page, 'bleedbox'): page.bleedbox = page.mediabox
            if hasattr(page, 'trimbox'):  page.trimbox = page.mediabox
            if hasattr(page, 'artbox'):   page.artbox = page.mediabox

            page.compress_content_streams()

        with open(output_path, "wb") as f:
            writer.write(f)
            
        status = "success"
        content = f"Target grid: {target_width:.0f} x {target_height:.0f} points.\nAll pages adjusted seamlessly."
    except Exception as e:
        status = "error"
        content = str(e)

    log_block(box, f"RESIZE: {file_name}", content, status)

class App:
    def __init__(self, root):
        self.input_path = None

        self.glass_bg = "#FFFFFF"            
        self.glass_inner = "#F0F4F8"         
        self.accent_liquid = "#007AFF"       
        self.text_main = "#2C3E50"           
        self.text_muted = "#7F8C8D"          

        self.img_folder = create_vector_icon("folder", color=self.accent_liquid)
        self.img_chart = create_vector_icon("chart", color=self.text_main)
        self.img_gear = create_vector_icon("gear", color="#FFFFFF")

        font_label = ("Segoe UI", 16, "bold")       
        font_input = ("Segoe UI", 20, "bold")       
        font_main_btn = ("Segoe UI", 18, "bold")    
        font_terminal = ("Consolas", 13)            

        main_frame = ctk.CTkFrame(root, fg_color="transparent")
        main_frame.pack(fill="both", expand=True, padx=30, pady=30)

        self.btn_open = ctk.CTkButton(
            main_frame, text="Select source PDF", font=font_main_btn,
            image=self.img_folder, compound="left",
            fg_color="#E6F0FA", hover_color="#D1E4F7", text_color=self.accent_liquid,
            corner_radius=6, height=65, border_width=1, border_color="#B9D7F2",
            command=self.open_pdf
        )
        self.btn_open.pack(fill="x", pady=(0, 25))

        settings_card = ctk.CTkFrame(
            main_frame, fg_color=self.glass_bg, corner_radius=12,
            border_width=1, border_color="#E0E6ED"
        )
        settings_card.pack(fill="x", pady=(0, 25))

        grid_input = ctk.CTkFrame(settings_card, fg_color="transparent")
        grid_input.pack(pady=16, padx=16, fill="x")

        grid_input.grid_columnconfigure(0, weight=1, uniform="sym")
        grid_input.grid_columnconfigure(1, weight=0)
        grid_input.grid_columnconfigure(2, weight=1, uniform="sym")


        ctk.CTkLabel(grid_input, text="Width ratio", font=font_label, text_color=self.text_main, justify="center").grid(row=0, column=0, sticky="ew", padx=(0, 15))
        ctk.CTkLabel(grid_input, text="Height ratio", font=font_label, text_color=self.text_main, justify="center").grid(row=0, column=2, sticky="ew", padx=(15, 0))


        self.w_entry = ctk.CTkEntry(
            grid_input, font=font_input, height=56, justify="center", 
            fg_color=self.glass_inner, border_color="#D1D9E0", text_color="#000000",
            corner_radius=6, border_width=1
        )
        self.w_entry.grid(row=1, column=0, sticky="ew", padx=(0, 15), pady=(8, 0))

        self.lbl_cross = ctk.CTkLabel(grid_input, text="✕", font=("Segoe UI", 14, "bold"), text_color="#95A5A6")
        self.lbl_cross.grid(row=1, column=1, sticky="nsew", pady=(8, 0))

        self.h_entry = ctk.CTkEntry(
            grid_input, font=font_input, height=56, justify="center", 
            fg_color=self.glass_inner, border_color="#D1D9E0", text_color="#000000",
            corner_radius=6, border_width=1
        )
        self.h_entry.grid(row=1, column=2, sticky="ew", padx=(15, 0), pady=(8, 0))

        actions_frame = ctk.CTkFrame(main_frame, fg_color="transparent")
        actions_frame.pack(fill="x", pady=(0, 25))

        actions_frame.grid_columnconfigure(0, weight=1, uniform="sym")
        actions_frame.grid_columnconfigure(1, weight=1, uniform="sym")

        self.btn_analyze = ctk.CTkButton(
            actions_frame, text="Analyze", font=font_main_btn,
            image=self.img_chart, compound="left",
            fg_color="#F0F2F5", hover_color="#E2E5E9", text_color=self.text_main,
            corner_radius=6, height=58, border_width=1, border_color="#DCDFE4", 
            command=self.analyze
        )
        self.btn_analyze.grid(row=0, column=0, sticky="ew", padx=(0, 15))

        self.btn_resize = ctk.CTkButton(
            actions_frame, text="Generate PDF", font=font_main_btn,
            image=self.img_gear, compound="left",
            fg_color=self.accent_liquid, hover_color="#0062CC", text_color="#FFFFFF",
            corner_radius=6, height=58, 
            command=self.resize
        )
        self.btn_resize.grid(row=0, column=1, sticky="ew", padx=(15, 0))

        ctk.CTkLabel(main_frame, text="Process Logs", font=("Segoe UI", 15, "bold"), text_color=self.text_muted).pack(anchor="w", pady=(0, 8), padx=5)
        
        self.out = ctk.CTkTextbox(
            main_frame, font=font_terminal,
            fg_color=self.glass_bg, text_color="#2C3E50", 
            border_width=1, border_color="#E0E6ED", corner_radius=12,
            activate_scrollbars=True
        )
        self.out.pack(expand=True, fill="both")
        self.out.configure(state="disabled")

    def open_pdf(self):
        self.input_path = filedialog.askopenfilename(filetypes=[("PDF Documents", "*.pdf")])
        if self.input_path:
            filename = os.path.basename(self.input_path)
            self.btn_open.configure(text=f"  {filename}", fg_color="#E1F5FE", text_color="#0288D1", border_color="#B3E5FC")
            log_block(self.out, "FILE LOADED", filename, "ready")

    def analyze(self):
        if self.input_path:
            analyze_pdf(self.input_path, self.out)
        else:
            log_block(self.out, "ACTION REQUIRED", "Please choose a source PDF file first.", "alert")

    def resize(self):
        if not self.input_path:
            log_block(self.out, "ACTION REQUIRED", "Please choose a source PDF file first.", "alert")
            return
        out_path = filedialog.asksaveasfilename(defaultextension=".pdf", filetypes=[("PDF Documents", "*.pdf")])
        if not out_path:
            return
        try:
            wr = int(self.w_entry.get())
            hr = int(self.h_entry.get())
        except:
            log_block(self.out, "VALIDATION ERROR", "Aspect ratios must be integers (e.g. 1 and 1).", "failed")
            return
        
        resize_pdf_pure_python(self.input_path, out_path, wr, hr, self.out)

if __name__ == "__main__":
    root = ctk.CTk()
    root.title("PDF Converter")
    root.geometry("550x650")
    root.minsize(550, 650)
    root.configure(fg_color="#F4F7FA")

    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except:
        pass

    setup_window_icon(root)
    App(root)
    root.mainloop()