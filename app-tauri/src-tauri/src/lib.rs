use lopdf::{Dictionary, Document, Object, Stream};
use std::collections::HashMap;
use std::path::Path;
use tauri::Manager;

fn get_ratio_class(w: f32, h: f32) -> String {
    if h == 0.0 { return "Invalid".to_string(); }
    let r = w / h;
    if (r - 1.4142).abs() < 0.03 { return "A-series".to_string(); }
    if (r - 1.3333).abs() < 0.03 { return "4:3".to_string(); }
    if (r - 1.7777).abs() < 0.03 { return "16:9".to_string(); }
    if (r - 0.7500).abs() < 0.03 { return "3:4".to_string(); }
    if (r - 0.6666).abs() < 0.03 { return "2:3".to_string(); }
    format!("{:.2}:{:.2} (custom)", w, h)
}

fn parse_dimensions(array: &[Object]) -> Option<(f32, f32)> {
    if array.len() < 4 { return None; }
    let left = array[0].as_float().ok()?;
    let bottom = array[1].as_float().ok()?;
    let right = array[2].as_float().ok()?;
    let top = array[3].as_float().ok()?;
    
    let w = (right - left).abs();
    let h = (top - bottom).abs();
    Some((w, h))
}

// 1. PDF ANALYSIS COMMAND
#[tauri::command]
fn analyze_pdf(input_path: String) -> Result<String, String> {
    if input_path.is_empty() { return Err("Input path is empty".to_string()); }

    let doc = Document::load(&input_path)
        .map_err(|e| format!("Failed to open PDF: {}", e))?;
    
    let mut ratios_count: HashMap<String, u32> = HashMap::new();
    let pages = doc.get_pages();

    for (_page_num, page_id) in &pages {
        let page_dict = doc.get_object(*page_id)
            .and_then(Object::as_dict)
            .map_err(|e| format!("Failed to read page structure: {}", e))?;
        
        if let Ok(media_box_obj) = page_dict.get(b"MediaBox") {
            if let Ok(arr) = media_box_obj.as_array() {
                if let Some((w, h)) = parse_dimensions(arr) {
                    let class_name = get_ratio_class(w, h);
                    *ratios_count.entry(class_name).or_insert(0) += 1;
                }
            }
        }
    }

    let file_name = Path::new(&input_path).file_name().unwrap_or_default().to_string_lossy();
    let mut content = format!("File: {}\nUnique aspect ratios found:\n", file_name);
    for (ratio, count) in ratios_count {
        content.push_str(&format!("  • {}: {} pages\n", ratio, count));
    }
    Ok(content)
}

// 2. RESIZE COMMAND
#[tauri::command]
fn resize_pdf(input_path: String, output_path: String, w_ratio: f64, h_ratio: f64) -> Result<String, String> {
    if input_path.is_empty() || output_path.is_empty() {
        return Err("Input or output path is empty".to_string());
    }
    if w_ratio <= 0.0 || h_ratio <= 0.0 {
        return Err("Aspect ratio coefficients must be greater than zero".to_string());
    }

    let mut doc = Document::load(&input_path)
        .map_err(|e| format!("Failed to load source PDF: {}", e))?;
    
    let target_w = 595.0f32; 
    let target_h = target_w * (h_ratio as f32) / (w_ratio as f32);

    let page_ids: Vec<lopdf::ObjectId> = doc.get_pages().values().cloned().collect();

    for page_id in page_ids {
        let (prepend_ops, contents_obj_clone) = {
            let page_dict = doc.get_object(page_id)
                .and_then(Object::as_dict)
                .map_err(|e| format!("Failed to read page structure: {}", e))?;

            let mut current_width = 595.0f32;
            let mut current_height = 842.0f32;
            let mut orig_left = 0.0f32;
            let mut orig_bottom = 0.0f32;

            if let Ok(media_box_obj) = page_dict.get(b"MediaBox") {
                if let Ok(arr) = media_box_obj.as_array() {
                    if arr.len() >= 4 {
                        let left = arr[0].as_float().unwrap_or(0.0);
                        let bottom = arr[1].as_float().unwrap_or(0.0);
                        let right = arr[2].as_float().unwrap_or(0.0);
                        let top = arr[3].as_float().unwrap_or(0.0);
                        
                        orig_left = left.min(right);
                        orig_bottom = bottom.min(top);
                        current_width = (right - left).abs();
                        current_height = (top - bottom).abs();
                    }
                }
            }

            let mut rotation = page_dict.get(b"Rotate")
                .and_then(Object::as_i64)
                .unwrap_or(0) % 360;
                
            if rotation < 0 { rotation += 360; }

            let ops_string = match rotation {
                90 => {
                    let fit_x = target_w / current_height;
                    let fit_y = target_h / current_width;
                    let scale = fit_x.min(fit_y);

                    let new_content_w = current_height * scale;
                    let new_content_h = current_width * scale;

                    let offset_x = (target_w - new_content_w) / 2.0f32;
                    let offset_y = (target_h - new_content_h) / 2.0f32;

                    let tx = offset_x - (orig_bottom * scale);
                    let ty = offset_y + (current_width * scale) + (orig_left * scale);

                    format!("q\n0 {:.4} {:.4} 0 {:.4} {:.4} cm\n", -scale, scale, tx, ty)
                },
                180 => {
                    let fit_x = target_w / current_width;
                    let fit_y = target_h / current_height;
                    let scale = fit_x.min(fit_y);

                    let new_content_w = current_width * scale;
                    let new_content_h = current_height * scale;

                    let offset_x = (target_w - new_content_w) / 2.0f32;
                    let offset_y = (target_h - new_content_h) / 2.0f32;

                    let tx = offset_x + (current_width * scale) + (orig_left * scale);
                    let ty = offset_y + (current_height * scale) + (orig_bottom * scale);

                    format!("q\n{:.4} 0 0 {:.4} {:.4} {:.4} cm\n", -scale, -scale, tx, ty)
                },
                270 => {
                    let fit_x = target_w / current_height;
                    let fit_y = target_h / current_width;
                    let scale = fit_x.min(fit_y);

                    let new_content_w = current_height * scale;
                    let new_content_h = current_width * scale;

                    let offset_x = (target_w - new_content_w) / 2.0f32;
                    let offset_y = (target_h - new_content_h) / 2.0f32;

                    let tx = offset_x + (current_height * scale) + (orig_bottom * scale);
                    let ty = offset_y - (orig_left * scale);

                    format!("q\n0 {:.4} {:.4} 0 {:.4} {:.4} cm\n", scale, -scale, tx, ty)
                },
                _ => {
                    let fit_x = target_w / current_width;
                    let fit_y = target_h / current_height;
                    let scale = fit_x.min(fit_y);

                    let new_content_w = current_width * scale;
                    let new_content_h = current_height * scale;

                    let offset_x = (target_w - new_content_w) / 2.0f32;
                    let offset_y = (target_h - new_content_h) / 2.0f32;

                    let tx = offset_x - (orig_left * scale);
                    let ty = offset_y - (orig_bottom * scale);

                    format!("q\n{:.4} 0 0 {:.4} {:.4} {:.4} cm\n", scale, scale, tx, ty)
                }
            };

            let contents = page_dict.get(b"Contents").cloned().unwrap_or(Object::Array(vec![]));
            (ops_string.into_bytes(), contents)
        };

        let prepend_stream = Stream::new(Dictionary::new(), prepend_ops);
        let prepend_ref = doc.add_object(prepend_stream);

        let append_stream = Stream::new(Dictionary::new(), b"\nQ\n".to_vec());
        let append_ref = doc.add_object(append_stream);

        let page_dict_mut = doc.get_object_mut(page_id)
            .and_then(Object::as_dict_mut)
            .map_err(|e| format!("Failed to modify page structure: {}", e))?;

        let new_media_box = Object::Array(vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(target_w),
            Object::Real(target_h),
        ]);

        page_dict_mut.set(b"MediaBox", new_media_box.clone());
        page_dict_mut.set(b"CropBox", new_media_box.clone());
        
        if page_dict_mut.has(b"BleedBox") { page_dict_mut.set(b"BleedBox", new_media_box.clone()); }
        if page_dict_mut.has(b"TrimBox")  { page_dict_mut.set(b"TrimBox",  new_media_box.clone()); }
        if page_dict_mut.has(b"ArtBox")   { page_dict_mut.set(b"ArtBox",   new_media_box.clone()); }

        page_dict_mut.set(b"Rotate", Object::Integer(0));

        let mut new_contents_array = vec![Object::Reference(prepend_ref)];
        match contents_obj_clone {
            Object::Array(arr) => { new_contents_array.extend(arr); },
            Object::Reference(ref_id) => { new_contents_array.push(Object::Reference(ref_id)); },
            _ => {}
        }
        new_contents_array.push(Object::Reference(append_ref));
        
        page_dict_mut.set(b"Contents", Object::Array(new_contents_array));
    }

    // Clean up outdated trailer values to allow immediate re-entry processing
    doc.trailer.remove(b"Prev");
    doc.trailer.remove(b"XRefStm");
    doc.compress();

    doc.save(&output_path)
        .map_err(|e| format!("Failed to save final PDF file: {}", e))?;

    Ok(format!(
        "Target canvas: {:.0} x {:.0} pt.\nAll pages adapted successfully.",
        target_w, target_h
    ))
}

// 3. SET THEME ICON COMMAND
#[tauri::command]
fn set_theme_icon(window: tauri::Window, is_dark: bool) -> Result<(), String> {
    let icon_bytes: &[u8] = if is_dark {
        include_bytes!("../../assets/icon-dark.png") 
    } else {
        include_bytes!("../../assets/icon-light.png")
    };

    let icon = tauri::image::Image::from_bytes(icon_bytes)
        .map_err(|e| format!("Failed to parse icon bytes: {}", e))?;

    window.set_icon(icon)
        .map_err(|e| format!("Failed to set window icon: {}", e))?;

    Ok(())
}

// 4. GET SYSTEM ACCENT COLOR COMMAND
#[tauri::command]
fn get_accent_color() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(dwm_key) = hkcu.open_subkey("Software\\Microsoft\\Windows\\DWM") {
            // Указываем u32 для значения, а для типа строки разрешаем компилятору сделать вывод самому
            if let Ok(colorization) = dwm_key.get_value::<u32, _>("ColorizationColor") {
                // Цвет в реестре Windows хранится в формате 0xAARRGGBB
                let r = ((colorization >> 16) & 0xFF) as u8;
                let g = ((colorization >> 8) & 0xFF) as u8;
                let b = (colorization & 0xFF) as u8;
                return Ok(format!("#{:02X}{:02X}{:02X}", r, g, b));
            }
        }
    }
    
    // Дефолтный синий цвет для остальных платформ или на случай сбоя чтения реестра
    Ok("#0078D4".to_string())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
                    width: 550.0,
                    height: 670.0,
                })));
                #[cfg(target_os = "windows")]
                {
                    use window_vibrancy::apply_mica;
                    let window_clone = window.clone();
                    let _ = window.run_on_main_thread(move || {
                        let _ = apply_mica(&window_clone, None);
                        let _ = window_clone.show();
                    });
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = window.show();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            analyze_pdf, 
            resize_pdf, 
            set_theme_icon, 
            get_accent_color // Передаём новую команду фронтенду
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}