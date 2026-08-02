//! # UUID 工具（LCU 领域）
//!
//! UUID 的解析、格式化与混淆还原。用于 LCU 选人期下发的混淆 PUUID 还原，
//! 故放在 `lcu/util/` 下。
//!
//! ## 还原 key 的来源
//!
//! **key 不硬编码进源码**（与 `observability.rs` 的 `SENTRY_DSN` 同一套约定）：
//! 运行时环境变量 `PUUID_KEY`（本地调试）→ `option_env!` 编译期注入（官方 CI 构建）。
//! 两者都没有时 [`KEY_PUUID`] 为 `None`，还原功能静默关闭——fork / 第三方构建
//! 默认即为此状态。
//!
//! 本地调试：
//! ```bash
//! PUUID_KEY=<32 位十六进制> npm run tauri dev
//! ```

use std::sync::LazyLock;

/// 混淆还原 key（16 字节）。来源见模块文档；未配置时为 `None`。
///
/// `build.rs` 中已声明 `cargo:rerun-if-env-changed=PUUID_KEY`，env 变化会触发重编，
/// 不会复用上一次烤进二进制的旧值。
static KEY_PUUID: LazyLock<Option<[u8; 16]>> = LazyLock::new(|| {
    let raw = std::env::var("PUUID_KEY")
        .ok()
        .or_else(|| option_env!("PUUID_KEY").map(str::to_string))?;
    parse_uuid(&raw)
});

/// 将混淆后的 puuid（36 字符 UUID 形式）还原为真实 puuid。
///
/// 返回与原格式一致的 36 字符小写 UUID 字符串。
///
/// # 错误
///
/// - 未配置 `PUUID_KEY`（功能未启用）
/// - 入参不是合法 UUID
/// - 还原结果不是 RFC4122 v5 UUID —— 说明 key 已失效，见 [`deobfuscate_with_key`]
pub fn deobfuscate_puuid(obfuscated: &str) -> Result<String, String> {
    let key = KEY_PUUID
        .as_ref()
        .ok_or("未配置 PUUID_KEY，选人期混淆 puuid 还原未启用")?;
    deobfuscate_with_key(obfuscated, key)
}

/// 用指定 key 还原，并校验结果的 UUID 结构。
///
/// 与 [`deobfuscate_puuid`] 分离是为了让单测不依赖真实 key（CI 上可能未注入）。
///
/// **为什么要校验 v5**：真实 puuid 恒为 RFC 4122 version 5（第 7 字节高 4 位 = `0x5`，
/// 第 9 字节高 2 位 = `0b10`）。XOR 是无校验变换，key 若失效（Riot 轮换 / 换区服）
/// 只会产出一个格式合法但查无此人的 UUID，下游表现为「玩家卡空白」而非报错，极难定位。
/// 这里提前拦下，让失效变成可观测的显式错误。乱码蒙混过关的概率约 1/16 × 1/4 ≈ 1.5%。
fn deobfuscate_with_key(obfuscated: &str, key: &[u8; 16]) -> Result<String, String> {
    let raw = parse_uuid(obfuscated).ok_or_else(|| format!("非法的 PUUID 格式: {obfuscated}"))?;
    let decrypted: [u8; 16] = std::array::from_fn(|i| raw[i] ^ key[i]);
    if decrypted[6] >> 4 != 5 || decrypted[8] >> 6 != 0b10 {
        return Err(format!(
            "还原结果不是 RFC4122 v5 UUID，PUUID_KEY 可能已失效: {obfuscated}"
        ));
    }
    Ok(format_uuid(&decrypted))
}

/// 从 UUID 字符串解析为 16 字节，忽略 `-`、宽松处理大小写。
///
/// 带连字符的 36 字符形式与不带连字符的 32 字符形式都接受（后者用于解析 `PUUID_KEY`）。
pub fn parse_uuid(s: &str) -> Option<[u8; 16]> {
    let hex: String = s.trim().chars().filter(|&c| c != '-').collect();
    if hex.len() != 32 {
        return None;
    }
    let mut out = [0u8; 16];
    for i in 0..16 {
        out[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

/// 将 16 字节格式化为 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`。
pub fn format_uuid(bytes: &[u8; 16]) -> String {
    let mut s = String::with_capacity(36);
    for (i, b) in bytes.iter().enumerate() {
        if matches!(i, 4 | 6 | 8 | 10) {
            s.push('-');
        }
        s.push_str(&format!("{:02x}", b));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 单测专用假 key——真 key 由 `PUUID_KEY` 注入，CI 上可能缺席，
    /// 故还原相关测试一律走 [`deobfuscate_with_key`]，不依赖运行环境。
    const TEST_KEY: [u8; 16] = [
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee,
        0xff,
    ];

    /// 合成的「真实 puuid」：满足 RFC4122 v5（`[6]` 高 4 位 = 5，`[8]` 高 2 位 = 0b10）。
    const V5_LIKE: [u8; 16] = [
        0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0x5d, 0xef, 0xa1, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd,
        0xef,
    ];

    fn obfuscate(raw: &[u8; 16], key: &[u8; 16]) -> String {
        format_uuid(&std::array::from_fn(|i| raw[i] ^ key[i]))
    }

    #[test]
    fn parse_and_format_roundtrip() {
        let raw = [1u8, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
        let formatted = format_uuid(&raw);
        let parsed = parse_uuid(&formatted).unwrap();
        assert_eq!(parsed, raw);
    }

    #[test]
    fn parse_uuid_accepts_undashed_form() {
        // PUUID_KEY 走的是不带连字符的 32 字符形式
        let dashed = "12345678-9abc-5def-a123-456789abcdef";
        let undashed = "123456789abc5defa123456789abcdef";
        assert_eq!(parse_uuid(dashed), parse_uuid(undashed));
        assert_eq!(parse_uuid(undashed), Some(V5_LIKE));
    }

    #[test]
    fn deobfuscate_recovers_original() {
        let obfuscated = obfuscate(&V5_LIKE, &TEST_KEY);
        let restored = deobfuscate_with_key(&obfuscated, &TEST_KEY).unwrap();
        assert_eq!(restored, format_uuid(&V5_LIKE));
    }

    #[test]
    fn deobfuscate_rejects_wrong_key() {
        let obfuscated = obfuscate(&V5_LIKE, &TEST_KEY);
        let wrong_key: [u8; 16] = std::array::from_fn(|i| TEST_KEY[i] ^ 0x5a);
        let err = deobfuscate_with_key(&obfuscated, &wrong_key).unwrap_err();
        assert!(err.contains("v5"), "错误信息应指出 key 失效: {err}");
    }

    #[test]
    fn deobfuscate_rejects_malformed_input() {
        assert!(deobfuscate_with_key("not-a-uuid", &TEST_KEY).is_err());
        assert!(deobfuscate_with_key("", &TEST_KEY).is_err());
    }
}
