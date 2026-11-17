//! Extract executable icons off the UI thread and reuse them across processes.

use std::collections::HashMap;

/// Paths are supplied by the process snapshot. A bounded cache stores both
/// icons and misses: repeated processes and polls need no extra OS work.
pub fn get_icons(exes: Vec<String>) -> HashMap<String, Option<String>> {
    use std::sync::{Mutex, OnceLock};
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    const MAX_CACHE: usize = 2048;
    const MAX_BATCH: usize = 64;
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut result = HashMap::new();
    for exe in exes.into_iter().take(MAX_BATCH) {
        if result.contains_key(&exe) {
            continue;
        }
        let cached = cache
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&exe)
            .cloned();
        let icon = cached.unwrap_or_else(|| {
            // No global cache lock while reading an executable: another batch
            // can proceed even when this one is on a slow or unavailable disk.
            let icon = extract_icon(&exe);
            let mut guard = cache.lock().unwrap_or_else(|e| e.into_inner());
            if guard.len() >= MAX_CACHE {
                guard.clear();
            }
            guard.insert(exe.clone(), icon.clone());
            icon
        });
        result.insert(exe, icon);
    }
    result
}

#[cfg(not(windows))]
fn extract_icon(_exe: &str) -> Option<String> {
    None
}

/// Windows draws both modern alpha icons and legacy AND/XOR icons. Render on
/// black and white to recover the alpha channel for both kinds of icon.
#[cfg(windows)]
fn extract_icon(exe: &str) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use image::{codecs::png::PngEncoder, ExtendedColorType, ImageEncoder};
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::{
        Graphics::Gdi::{
            CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, SelectObject,
            BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ,
        },
        UI::{
            Shell::ExtractIconExW,
            WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL, HICON},
        },
    };

    if exe.is_empty() || exe.contains('\0') || !std::path::Path::new(exe).is_absolute() {
        return None;
    }
    const SIZE: usize = 32;
    struct Icon(HICON);
    impl Drop for Icon {
        fn drop(&mut self) {
            unsafe {
                DestroyIcon(self.0);
            }
        }
    }
    struct Canvas {
        dc: HDC,
        bitmap: HBITMAP,
        old: HGDIOBJ,
    }
    impl Drop for Canvas {
        fn drop(&mut self) {
            unsafe {
                SelectObject(self.dc, self.old);
                DeleteObject(self.bitmap);
                DeleteDC(self.dc);
            }
        }
    }
    let path: Vec<u16> = OsStr::new(exe).encode_wide().chain(Some(0)).collect();
    let mut raw_icon: HICON = ptr::null_mut();
    if unsafe { ExtractIconExW(path.as_ptr(), 0, &mut raw_icon, ptr::null_mut(), 1) } == 0
        || raw_icon.is_null()
    {
        return None;
    }
    let icon = Icon(raw_icon);
    let dc = unsafe { CreateCompatibleDC(ptr::null_mut()) };
    if dc.is_null() {
        return None;
    }
    let mut info: BITMAPINFO = unsafe { std::mem::zeroed() };
    info.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: SIZE as i32,
        biHeight: -(SIZE as i32),
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB,
        ..unsafe { std::mem::zeroed() }
    };
    let mut bits = ptr::null_mut();
    let bitmap =
        unsafe { CreateDIBSection(dc, &info, DIB_RGB_COLORS, &mut bits, ptr::null_mut(), 0) };
    if bitmap.is_null() || bits.is_null() {
        if !bitmap.is_null() {
            unsafe {
                DeleteObject(bitmap);
            }
        }
        unsafe {
            DeleteDC(dc);
        }
        return None;
    }
    let old = unsafe { SelectObject(dc, bitmap) };
    if old.is_null() || old as isize == -1 {
        unsafe {
            DeleteObject(bitmap);
            DeleteDC(dc);
        }
        return None;
    }
    let canvas = Canvas { dc, bitmap, old };
    let pixels = unsafe { std::slice::from_raw_parts_mut(bits.cast::<u8>(), SIZE * SIZE * 4) };
    let mut render = |background: u8| -> Option<Vec<u8>> {
        for p in pixels.chunks_exact_mut(4) {
            p.copy_from_slice(&[background, background, background, 255]);
        }
        if unsafe {
            DrawIconEx(
                canvas.dc,
                0,
                0,
                icon.0,
                SIZE as i32,
                SIZE as i32,
                0,
                ptr::null_mut(),
                DI_NORMAL,
            )
        } == 0
        {
            return None;
        }
        unsafe {
            GdiFlush();
        }
        Some(pixels.to_vec())
    };
    let black = render(0)?;
    let white = render(255)?;
    let mut rgba = Vec::with_capacity(SIZE * SIZE * 4);
    for (black, white) in black.chunks_exact(4).zip(white.chunks_exact(4)) {
        let difference = (0..3)
            .map(|i| white[i].saturating_sub(black[i]) as u16)
            .sum::<u16>()
            / 3;
        let alpha = 255u16.saturating_sub(difference);
        let channel = |i| {
            if alpha == 0 {
                0
            } else {
                ((black[i] as u16 * 255 / alpha).min(255)) as u8
            }
        };
        rgba.extend_from_slice(&[channel(2), channel(1), channel(0), alpha as u8]);
    }
    let mut png = Vec::new();
    PngEncoder::new(&mut png)
        .write_image(&rgba, SIZE as u32, SIZE as u32, ExtendedColorType::Rgba8)
        .ok()?;
    Some(format!("data:image/png;base64,{}", STANDARD.encode(png)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_path_has_no_icon() {
        assert_eq!(get_icons(vec![String::new()]).get(""), Some(&None));
    }

    #[cfg(windows)]
    #[test]
    fn extracts_windows_executable_icon_as_png() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let exe = std::env::var("WINDIR").unwrap() + "\\explorer.exe";
        let icon = extract_icon(&exe).expect("Explorer has an executable icon");
        let png = STANDARD
            .decode(icon.strip_prefix("data:image/png;base64,").unwrap())
            .unwrap();
        let decoded = image::load_from_memory(&png).unwrap().into_rgba8();
        assert_eq!(decoded.dimensions(), (32, 32));
        assert!(decoded.pixels().any(|pixel| pixel.0[3] > 0));
        assert!(decoded.pixels().any(|pixel| pixel.0[3] < 255));
    }
}
