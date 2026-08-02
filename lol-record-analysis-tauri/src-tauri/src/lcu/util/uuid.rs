//! # UUID 工具（LCU 领域）
//!
//! UUID 的解析、格式化与混淆还原。用于 LCU 选人期下发的混淆 PUUID 还原，
//! 故放在 `lcu/util/` 下。

const KEY_PUUID: [u8; 16] = *b"\x81\x70\x76\xa9\xf4\x51\x50\x9b\x95\x98\x68\x13\xce\x91\x17\xe7";

/// 将混淆后的 puuid（36 字符 UUID 形式）还原为真实 puuid。
///
/// 返回与原格式一致的 36 字符小写 UUID 字符串。
pub fn deobfuscate_puuid(obfuscated: &str) -> Result<String, String> {
    let raw = parse_uuid(obfuscated).ok_or_else(|| format!("非法的 PUUID 格式: {obfuscated}"))?;
    let decrypted: [u8; 16] = std::array::from_fn(|i| raw[i] ^ KEY_PUUID[i]);
    Ok(format_uuid(&decrypted))
}

/// 从 36 字符 UUID 字符串解析为 16 字节，宽松处理大小写。
pub fn parse_uuid(s: &str) -> Option<[u8; 16]> {
    let hex: String = s.chars().filter(|&c| c != '-').collect();
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

    #[test]
    fn parse_and_format_roundtrip() {
        let raw = [1u8, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
        let formatted = format_uuid(&raw);
        let parsed = parse_uuid(&formatted).unwrap();
        assert_eq!(parsed, raw);
    }

    #[test]
    fn deobfuscate_roundtrip() {
        let raw = [
            0x01u8, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
            0x0f, 0x10,
        ];
        let obfuscated: [u8; 16] = std::array::from_fn(|i| raw[i] ^ KEY_PUUID[i]);
        let obfuscated_str = format_uuid(&obfuscated);
        let restored = deobfuscate_puuid(&obfuscated_str).unwrap();
        assert_eq!(restored, format_uuid(&raw));
    }
}
