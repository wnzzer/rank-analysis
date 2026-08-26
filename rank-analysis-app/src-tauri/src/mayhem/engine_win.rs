//! # Windows.Media.Ocr 引擎实现（A3.2，`ocr-win` feature 门控）
//!
//! 仅在 `--features ocr-win` 且 Windows 目标下编译。链路：
//! RGBA bytes → DataWriter/DetachBuffer → IBuffer → SoftwareBitmap(Bgra8)
//! → OcrEngine::TryCreateFromUserProfileLanguages → RecognizeAsync → 行文本。
//!
//! ## 前提与限制
//!
//! - 系统需安装中文语言包（OCR 依赖 `TryCreateFromUserProfileLanguages`），
//!   失败时错误信息会明确提示
//! - `CreateCopyFromBuffer` 假定**预乘 alpha**：GDI 抓屏的 alpha 恒为 255
//!   （等效不透明），预乘语义下无影响，无需转换
//! - WinRT 工厂调用要求 MTA 套间：模块用 [`init_apartment_once`] 保证一次初始化，
//!   tokio worker 线程可直接调用

use windows::core::ApartmentType;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;

use std::sync::Once;

static INIT_APARTMENT: Once = Once::new();

/// 幂等把当前进程初始化为 MTA（WinRT 静态工厂的前置条件）。
///
/// 已初始化（任意套间）时忽略错误——重复 init 的 RPC_E_CHANGED_MODE 不算致命，
/// 后续调用按现有套间继续。
fn init_apartment_once() {
    INIT_APARTMENT.call_once(|| {
        // 刻意忽略结果：失败场景（已以 STA 初始化）下 WinRT 多数工厂仍可用
        let _ = windows::core::init_apartment(ApartmentType::MTA);
    });
}

/// 对一块 BGRA 像素缓冲做 OCR，返回识别出的行文本（自上而下）。
///
/// # 参数
/// - `rgba`: BGRA 序列化的像素数据（capture.rs 输出已转为 RGBA 命名但字节序
///   实际是 B,G,R,A——与 Bgra8 位图格式一一对应）
/// - `w`/`h`: 像素尺寸；必须与缓冲长度一致（先校验再触碰 WinRT）
pub async fn recognize_bgra(
    bgra: &[u8],
    w: i32,
    h: i32,
) -> Result<Vec<String>, String> {
    if w <= 0 || h <= 0 {
        return Err("invalid bitmap size".into());
    }
    let expected = (w as usize) * (h as usize) * 4;
    if bgra.len() != expected {
        return Err(format!("pixel buffer size mismatch: {} != {}", bgra.len(), expected));
    }

    init_apartment_once();

    let writer =
        DataWriter::new().map_err(|e| format!("DataWriter::new: {e}"))?;
    writer.WriteBytes(bgra).map_err(|e| format!("WriteBytes: {e}"))?;
    let buffer = writer.DetachBuffer().map_err(|e| format!("DetachBuffer: {e}"))?;
    drop(writer); // 显式关闭写入器；buffer 已独立持有数据

    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        w,
        h,
    )
    .map_err(|e| format!("CreateCopyFromBuffer: {e}"))?;

    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|e| format!("OCR 引擎不可用（请在系统设置安装中文语言包后重试）: {e}"))?;

    let operation = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| format!("RecognizeAsync: {e}"))?;
    let result = operation.await.map_err(|e| format!("recognize await: {e}"))?;

    let mut lines = Vec::new();
    for line in result.Lines()?.into_iter() {
        let text = line.Text()?.to_string();
        if !text.trim().is_empty() {
            lines.push(text);
        }
    }
    Ok(lines)
}
