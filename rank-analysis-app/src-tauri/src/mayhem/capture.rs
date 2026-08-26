//! # A3.1 屏幕区域捕获 + 三卡标题带几何（跨平台纯函数在此，GDI 实现见 gdi 子模块）
//!
//! ## 几何层（全平台编译、可单测）
//!
//! 强化三选一的卡片在屏幕中央横向排布。本模块用**基准分辨率比例常数**
//! （1920×1080 下标定）描述三张卡的标题文本带，运行时按主显示器分辨率
//! 线性缩放——不同分辨率/宽高比下只需微调常数即可重新校准（F1 手动流程）。
//!
//! ## 捕获层（Windows only）
//!
//! v1 采用 GDI `BitBlt`：零新增依赖、无边框窗口下可靠；独占全屏拿不到内容，
//! 届时提示用户切换为无边框窗口（与 Overlay 兼容性矩阵 §B5 一致）。
//! Windows Graphics Capture 升级路径记录在 feature-expansion-plan §A3.1。

use serde::Serialize;

/// 基准分辨率（标定常数所在坐标系）。
pub const BASE_WIDTH: i32 = 1920;
pub const BASE_HEIGHT: i32 = 1080;

// ---- 标定常数：1920×1080 下三卡标题带的相对位置（占屏幕比例）----
// 初值按社区截图目测给出；正式启用前必须用真实对局截图校准一次。
/// 卡片行顶部 y 比例
const CARD_ROW_Y: f32 = 0.34;
/// 标题带高度比例
const BAND_H: f32 = 0.055;
/// 单卡宽度比例（含左右内边距）
const CARD_W: f32 = 0.17;
/// 相邻卡片中心间距比例
const CARD_PITCH: f32 = 0.195;
/// 三卡组中心的 x 比例（约屏幕中央）
const GROUP_CENTER_X: f32 = 0.50;

/// 归一化矩形（像素坐标，已缩放到目标分辨率）。
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// 单个标题带的活跃度统计（触发时机启发式输入）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BandStat {
    pub slot: u8,
    pub rect: Rect,
    /// 亮度标准差（0-255）：纯色≈0，文字/图标内容显著更高
    pub stddev: f64,
}

/// RGBA 缓冲的亮度标准差（Rec.601 亮度）。
///
/// 纯色画面 ≈0；带文字/图标的游戏画面通常 >20。纯函数，合成缓冲即可单测。
pub fn luma_stddev(rgba: &[u8]) -> f64 {
    let n = rgba.len() / 4;
    if n == 0 {
        return 0.0;
    }
    let mut sum = 0f64;
    let mut sq = 0f64;
    for px in rgba.chunks_exact(4) {
        let l = 0.299 * px[0] as f64 + 0.587 * px[1] as f64 + 0.114 * px[2] as f64;
        sum += l;
        sq += l * l;
    }
    let mean = sum / n as f64;
    ((sq / n as f64) - mean * mean).sqrt()
}

/// 抓取并分析三张卡的标题带。
///
/// `grab` 为注入的截屏函数（生产传 GDI，测试传合成缓冲），使本层完全可测。
pub fn analyze_bands(
    screen: (i32, i32),
    grab: &dyn Fn(i32, i32, i32, i32) -> Result<Vec<u8>, String>,
) -> Result<Vec<BandStat>, String> {
    slot_band_rects(screen)
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let rgba = grab(r.x, r.y, r.w, r.h)?;
            Ok(BandStat {
                slot: i as u8,
                rect: *r,
                stddev: luma_stddev(&rgba),
            })
        })
        .collect()
}

/// 把基准坐标系的矩形缩放并钳制进目标屏幕范围。
pub fn scale_rect(base: (i32, i32), base_rect: Rect, target: (i32, i32)) -> Rect {
    let fx = target.0 as f32 / base.0 as f32;
    let fy = target.1 as f32 / base.1 as f32;
    let x = (base_rect.x as f32 * fx).round() as i32;
    let y = (base_rect.y as f32 * fy).round() as i32;
    let w = (base_rect.w as f32 * fx).round() as i32;
    let h = (base_rect.h as f32 * fy).round() as i32;
    let x = x.clamp(0, target.0.saturating_sub(1));
    let y = y.clamp(0, target.1.saturating_sub(1));
    let w = w.clamp(1, target.0 - x);
    let h = h.clamp(1, target.1 - y);
    Rect { x, y, w, h }
}

/// 计算当前分辨率下左/中/右三张卡的标题带矩形（顺序即卡位）。
pub fn slot_band_rects(screen: (i32, i32)) -> [Rect; 3] {
    let sw = screen.0 as f32;
    let sh = screen.1 as f32;
    let band_w = sw * CARD_W;
    let band_h = sh * BAND_H;
    let y = sh * CARD_ROW_Y;
    let center_x = sw * GROUP_CENTER_X;

    let offsets = [-CARD_PITCH, 0.0, CARD_PITCH];
    let mut out = [Rect {
        x: 0,
        y: 0,
        w: 1,
        h: 1,
    }; 3];
    for (i, off) in offsets.iter().enumerate() {
        // 先在基准系里表达再统一缩放，保证与 scale_rect 的钳制语义一致
        let bx = ((center_x + sw * off - band_w / 2.0) / sw * BASE_WIDTH as f32) as i32;
        let by = (y / sh * BASE_HEIGHT as f32) as i32;
        out[i] = scale_rect(
            (BASE_WIDTH, BASE_HEIGHT),
            Rect {
                x: bx,
                y: by,
                w: (band_w / sw * BASE_WIDTH as f32) as i32,
                h: (band_h / sh * BASE_HEIGHT as f32) as i32,
            },
            screen,
        );
    }
    out
}

/// 把 RGBA 缓冲编码为 32 位无压缩 BMP（自上而下视觉、文件内自下而上存储）。
///
/// 用途：A3 校准——把三张卡的标题带实际截取内容导出给前端预览，
/// 用户据此调整 [`slot_band_rects`] 的标定常数。零依赖手写头部。
///
/// 输入按行主序 RGBA；输出标准 BITMAPFILEHEADER(14)+INFOHEADER(40)+像素，
/// 通道转回 BMP 要求的 B,G,R,A。32bpp 行宽天然 4 字节对齐，无需行填充。
pub fn encode_bmp_rgba(rgba: &[u8], w: i32, h: i32) -> Vec<u8> {
    let data_len = (w.max(0) as usize) * (h.max(0) as usize) * 4;
    let mut out = Vec::with_capacity(54 + data_len);
    // BITMAPFILEHEADER
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&((54 + data_len) as u32).to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // reserved1
    out.extend_from_slice(&0u16.to_le_bytes()); // reserved2
    out.extend_from_slice(&54u32.to_le_bytes()); // offBits
                                                 // BITMAPINFOHEADER
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&(w as i32).to_le_bytes());
    out.extend_from_slice(&(h as i32).to_le_bytes()); // 正值 = 自下而上
    out.extend_from_slice(&1u16.to_le_bytes()); // planes
    out.extend_from_slice(&32u16.to_le_bytes()); // bpp
    out.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
    out.extend_from_slice(&(data_len as u32).to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // x pels
    out.extend_from_slice(&0u32.to_le_bytes()); // y pels
    out.extend_from_slice(&0u32.to_le_bytes()); // clr used
    out.extend_from_slice(&0u32.to_le_bytes()); // clr important

    if data_len == 0 || rgba.len() < data_len {
        return out;
    }
    let stride = (w * 4) as usize;
    for y in (0..h).rev() {
        let start = y as usize * stride;
        for px in rgba[start..start + stride].chunks_exact(4) {
            out.push(px[2]); // B
            out.push(px[1]); // G
            out.push(px[0]); // R
            out.push(px[3]); // A
        }
    }
    out
}

#[cfg(test)]
mod geometry_tests {
    use super::*;

    #[test]
    fn luma_stddev_should_be_zero_for_flat_and_high_for_content() {
        // 纯黑帧
        assert_eq!(luma_stddev(&vec![0u8; 64 * 4]), 0.0);
        // 黑白棋盘：stddev 接近 128
        let mut buf = Vec::new();
        for i in 0..256 {
            let v = if i % 2 == 0 { 0u8 } else { 255u8 };
            buf.extend_from_slice(&[v, v, v, 255]);
        }
        let sd = luma_stddev(&buf);
        assert!((sd - 128.0).abs() < 1.0, "got {sd}");
        // 空缓冲安全
        assert_eq!(luma_stddev(&[]), 0.0);
    }

    #[test]
    fn analyze_bands_should_map_slots_and_propagate_grab_errors() {
        let screen = (1920, 1080);
        let ok = analyze_bands(screen, &|_x, _y, _w, _h| Ok(vec![128u8; 400 * 4]));
        assert_eq!(ok.expect("ok").len(), 3);

        let err = analyze_bands(screen, &|_x, _y, _w, _h| Err("boom".into()));
        assert!(err.is_err());
    }

    #[test]
    fn bmp_encoder_should_write_valid_header_and_bottom_up_bgra_rows() {
        // 2x2 图：像素 R,G,B,A 顺序（capture.rs 输出口径）
        let rgba: Vec<u8> = vec![
            1, 2, 3, 255, 4, 5, 6, 255, // 顶行
            7, 8, 9, 255, 10, 11, 12, 255, // 底行
        ];
        let bmp = encode_bmp_rgba(&rgba, 2, 2);

        assert_eq!(&bmp[0..2], b"BM");
        // offBits = 54
        let off = u32::from_le_bytes([bmp[10], bmp[11], bmp[12], bmp[13]]);
        assert_eq!(off, 54);
        // 尺寸字段：宽 2、高 2（正数 → 自下而上）、32bpp、BI_RGB=0
        assert_eq!(i32::from_le_bytes(bmp[18..22].try_into().unwrap()), 2);
        assert_eq!(i32::from_le_bytes(bmp[22..26].try_into().unwrap()), 2);
        assert_eq!(u16::from_le_bytes(bmp[28..30].try_into().unwrap()), 32);
        assert_eq!(u32::from_le_bytes(bmp[30..34].try_into().unwrap()), 0);
        // 文件大小 = 头 + 数据
        assert_eq!(
            u32::from_le_bytes(bmp[2..6].try_into().unwrap()),
            (54 + 16) as u32
        );

        // 第一条输出像素行应是输入的**底**行，且通道已转 BGR(A)
        assert_eq!(&bmp[54..62], &[12, 11, 10, 255, 9, 8, 7, 255]);
        // 第二条是顶行
        assert_eq!(&bmp[62..70], &[6, 5, 4, 255, 3, 2, 1, 255]);
    }

    #[test]
    fn bmp_encoder_should_tolerate_empty_buffer() {
        let bmp = encode_bmp_rgba(&[], 0, 0);
        assert_eq!(bmp.len(), 54);
        assert_eq!(u32::from_le_bytes(bmp[2..6].try_into().unwrap()), 54);
    }

    #[test]
    fn rects_should_scale_linearly_and_stay_in_bounds() {
        // 2K 分辨率：等比放大
        let r = scale_rect(
            (1920, 1080),
            Rect {
                x: 100,
                y: 100,
                w: 300,
                h: 50,
            },
            (3840, 2160),
        );
        assert_eq!(
            r,
            Rect {
                x: 200,
                y: 200,
                w: 600,
                h: 100
            }
        );

        // 越界钳制：源矩形部分出屏时收边而不是越界
        let clamped = scale_rect(
            (1920, 1080),
            Rect {
                x: 1900,
                y: 0,
                w: 400,
                h: 50,
            },
            (1920, 1080),
        );
        assert_eq!((clamped.x, clamped.w), (1900, 20));
    }

    #[test]
    fn slot_bands_should_order_left_to_right_and_center_on_1080p() {
        let bands = slot_band_rects((1920, 1080));
        assert_eq!(bands.len(), 3);
        for w in bands.windows(2) {
            assert!(w[0].x < w[1].x, "卡位必须从左到右");
        }
        // 中卡中心 ≈ 屏幕中心（±4px 舍入容差）
        let mid_center = bands[1].x + bands[1].w / 2;
        assert!((mid_center - 960).abs() <= 4);
        // 高度一致（同一行）
        assert_eq!(bands[0].h, bands[1].h);
    }

    #[test]
    fn slot_bands_should_adapt_to_ultrawide() {
        let bands = slot_band_rects((3440, 1440));
        for b in &bands {
            assert!(b.x >= 0 && b.y >= 0);
            assert!(b.x + b.w <= 3440 && b.y + b.h <= 1440);
        }
    }
}

#[cfg(windows)]
pub mod gdi {
    //! GDI BitBlt 区域抓取（v1）。独占全屏不可用 → 引导用户改无边框窗口。

    use std::mem::size_of;
    use std::ptr::null_mut;

    use winapi::um::wingdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
        SelectObject,
    };
    use winapi::um::wingdi::{BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY};
    // 注意：winapi 的模块按头文件组织——GDI 函数在 wingdi，窗口函数在 winuser，
    // 不存在 user32/gdi32 模块名。
    use winapi::um::winuser::{GetSystemMetrics, GetWindowDC, ReleaseDC};

    /// 抓取结果：BGRA 已转 RGBA 的像素缓冲。
    pub struct RegionRgba {
        pub width: i32,
        pub height: i32,
        pub rgba: Vec<u8>,
    }

    /// 主显示器尺寸（SM_CXSCREEN/CYSCREEN）。
    pub fn primary_screen_size() -> (i32, i32) {
        unsafe { (GetSystemMetrics(0), GetSystemMetrics(1)) } // SM_CXSCREEN=0, SM_CYSCREEN=1
    }

    /// 抓取屏幕指定区域并转为 RGBA（自上而下行序）。
    ///
    /// 失败路径全部走 Err(String)，不 panic；GDI 句柄在任何分支都会释放。
    pub fn capture_region_rgba(x: i32, y: i32, w: i32, h: i32) -> Result<RegionRgba, String> {
        if w <= 0 || h <= 0 {
            return Err("capture region size must be positive".into());
        }
        unsafe {
            let hdc_screen = GetWindowDC(null_mut());
            if hdc_screen.is_null() {
                return Err("GetWindowDC failed".into());
            }
            let hdc_mem = CreateCompatibleDC(hdc_screen);
            if hdc_mem.is_null() {
                ReleaseDC(null_mut(), hdc_screen);
                return Err("CreateCompatibleDC failed".into());
            }
            let hbmp = CreateCompatibleBitmap(hdc_screen, w, h);
            if hbmp.is_null() {
                DeleteDC(hdc_mem);
                ReleaseDC(null_mut(), hdc_screen);
                return Err("CreateCompatibleBitmap failed".into());
            }
            // HBITMAP__ 裸指针 → HGDIOBJ(*mut c_void)：SelectObject/DeleteObject 形参口径
            let hobj = hbmp as *mut winapi::ctypes::c_void;
            let old = SelectObject(hdc_mem, hobj);

            let ok = BitBlt(hdc_mem, 0, 0, w, h, hdc_screen, x, y, SRCCOPY) != 0;
            if !ok {
                SelectObject(hdc_mem, old);
                DeleteObject(hobj);
                DeleteDC(hdc_mem);
                ReleaseDC(null_mut(), hdc_screen);
                return Err(format!("BitBlt failed at ({x},{y}) {w}x{h}"));
            }

            let mut bmi: BITMAPINFO = std::mem::zeroed();
            bmi.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
            // biHeight 取负：请求自上而下的行序
            bmi.bmiHeader.biWidth = w;
            bmi.bmiHeader.biHeight = -h;
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 32;
            bmi.bmiHeader.biCompression = BI_RGB;

            let mut buf = vec![0u8; (w * h * 4) as usize];
            let got = GetDIBits(
                hdc_mem,
                hbmp,
                0,
                h as u32,
                buf.as_mut_ptr() as *mut _,
                &mut bmi,
                DIB_RGB_COLORS,
            );
            SelectObject(hdc_mem, old);
            DeleteObject(hobj);
            DeleteDC(hdc_mem);
            ReleaseDC(null_mut(), hdc_screen);

            if got == 0 {
                return Err("GetDIBits failed".into());
            }

            // BGRA → RGBA
            for px in buf.chunks_exact_mut(4) {
                px.swap(0, 2);
            }
            Ok(RegionRgba {
                width: w,
                height: h,
                rgba: buf,
            })
        }
    }
}
