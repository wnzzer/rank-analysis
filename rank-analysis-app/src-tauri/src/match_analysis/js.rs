//! # 复刻 JS 数值行为
//!
//! TS 侧取整全部走 `Math.round` / `Number.prototype.toFixed`，与 Rust 默认行为不同：
//!
//! - `Math.round` 平分时向 +∞ 取：`Math.round(-0.5)` 为 `-0`、`Math.round(2.5)` 为 `3`；
//!   Rust `f64::round` 远离零（`-1` / `3`）
//! - `toFixed` 按 double 的**精确十进制值**取舍，恰好平分时取较大的 n：
//!   `(0.125).toFixed(2)` 为 `"0.13"`；Rust `format!("{:.2}", 0.125)` 平分取偶得 `"0.12"`
//!
//! 对拍要求数值与展示文字逐位一致，凡 TS 用到这两个函数之处，Rust 一律调用本模块。

/// 精确展开 f64 所需的小数位上限：最小次正规数 5e-324 的精确十进制展开有 1074 位小数。
const EXACT_FRACTION_DIGITS: usize = 1100;

/// JS `Math.round`：取最接近的整数，平分时向 +∞；结果为 0 且输入为负时返回 `-0`。
///
/// # 示例
/// ```
/// use rank_analysis_lib::match_analysis::js::js_round;
/// assert_eq!(js_round(2.5), 3.0);
/// assert!(js_round(-0.5).is_sign_negative());
/// ```
pub fn js_round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let floor = x.floor();
    // 有限 double 的 x - floor(x) 是精确的：0.49999999999999994 不会被进成 1
    let rounded = if x - floor >= 0.5 { floor + 1.0 } else { floor };
    if rounded == 0.0 && x.is_sign_negative() {
        -0.0
    } else {
        rounded
    }
}

/// JS `Number.prototype.toFixed(digits)`。
///
/// # 参数
/// - `x`: 任意 f64
/// - `digits`: 小数位数，0..=100（与 JS 一致；超出 JS 会抛 RangeError）
///
/// # 行为
/// - 按 double 的精确十进制展开取舍；下一位 ≥ 5 即进位（精确展开下等价于「平分取较大 n」）
/// - 负数先取符号再对绝对值格式化：`(-0.001).toFixed(2)` 为 `"-0.00"`；`-0` 不带符号
/// - `|x| ≥ 1e21`、`NaN`、`±Infinity` 与 JS 一样退回 `String(x)`
///
/// # 示例
/// ```
/// use rank_analysis_lib::match_analysis::js::js_to_fixed;
/// assert_eq!(js_to_fixed(0.125, 2), "0.13");
/// assert_eq!(js_to_fixed(1.005, 2), "1.00");
/// ```
pub fn js_to_fixed(x: f64, digits: usize) -> String {
    debug_assert!(digits <= 100, "JS toFixed 只接受 0..=100 位");
    if x.is_nan() {
        return "NaN".to_string();
    }
    if x.is_infinite() || x.abs() >= 1e21 {
        return js_number_to_string(x);
    }
    let negative = x < 0.0;
    let exact = format!("{:.*}", EXACT_FRACTION_DIGITS, x.abs());
    let (int_part, frac_part) = exact.split_once('.').expect("精确展开必含小数点");
    let mut kept: Vec<u8> = int_part
        .bytes()
        .chain(frac_part.bytes().take(digits))
        .collect();
    if frac_part.as_bytes()[digits] >= b'5' {
        increment_decimal(&mut kept);
    }
    let int_len = kept.len() - digits;
    let mut out = String::with_capacity(kept.len() + 2);
    if negative {
        out.push('-');
    }
    out.push_str(std::str::from_utf8(&kept[..int_len]).expect("ASCII 数字"));
    if digits > 0 {
        out.push('.');
        out.push_str(std::str::from_utf8(&kept[int_len..]).expect("ASCII 数字"));
    }
    out
}

/// 十进制数字串末位加一（逢 9 进位，最高位溢出时前补 `1`）。
fn increment_decimal(digits: &mut Vec<u8>) {
    for d in digits.iter_mut().rev() {
        if *d == b'9' {
            *d = b'0';
        } else {
            *d += 1;
            return;
        }
    }
    digits.insert(0, b'1');
}

/// JS `Number(x.toFixed(digits))`：TS `roundStat` 与 laneFacts `round` 的口径。
///
/// # 示例
/// ```
/// use rank_analysis_lib::match_analysis::js::js_fixed_num;
/// assert_eq!(js_fixed_num(7.5 - 0.88, 2), 6.62);
/// ```
pub fn js_fixed_num(x: f64, digits: usize) -> f64 {
    js_to_fixed(x, digits).parse().unwrap_or(f64::NAN)
}

/// JS `String(x)` 在 `|x| ≥ 1e21` 与 ±Infinity 时的形式（`1e+21`、`-1.5e+21`、`Infinity`）。
fn js_number_to_string(x: f64) -> String {
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    let s = format!("{x:e}");
    let (mantissa, exp) = s.split_once('e').expect("科学计数法必含 e");
    let exp: i32 = exp.parse().expect("指数为整数");
    let sign = if exp >= 0 { '+' } else { '-' };
    format!("{mantissa}e{sign}{}", exp.abs())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_round_half_toward_positive_infinity() {
        assert_eq!(js_round(0.5), 1.0);
        assert_eq!(js_round(1.5), 2.0);
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-1.5), -1.0);
        assert_eq!(js_round(-2.5), -2.0);
    }

    #[test]
    fn should_keep_negative_zero_like_js() {
        for x in [-0.5, -0.4, -0.0, -1e-300] {
            let r = js_round(x);
            assert_eq!(r, 0.0, "x={x}");
            assert!(r.is_sign_negative(), "x={x} 应得 -0");
        }
        assert!(js_round(0.0).is_sign_positive());
        assert!(js_round(0.3).is_sign_positive());
    }

    #[test]
    fn should_not_round_up_largest_double_below_half() {
        assert_eq!(js_round(0.49999999999999994), 0.0);
        assert!(js_round(0.49999999999999994).is_sign_positive());
        assert!(js_round(-0.49999999999999994).is_sign_negative());
        assert_eq!(js_round(1.4999999999999998), 1.0);
    }

    #[test]
    fn should_keep_large_integers_and_non_finite() {
        assert_eq!(js_round(4503599627370497.0), 4503599627370497.0);
        assert!(js_round(f64::NAN).is_nan());
        assert_eq!(js_round(f64::INFINITY), f64::INFINITY);
    }

    #[test]
    fn should_round_exact_ties_up_in_to_fixed() {
        // Rust format! 平分取偶会给 "0.12" / "10.2" / "2"
        assert_eq!(js_to_fixed(0.125, 2), "0.13");
        assert_eq!(js_to_fixed(10.25, 1), "10.3");
        assert_eq!(js_to_fixed(2.5, 0), "3");
        assert_eq!(js_to_fixed(0.5, 0), "1");
        assert_eq!(js_to_fixed(1.5, 0), "2");
        assert_eq!(js_to_fixed(9.5, 0), "10");
        assert_eq!(js_to_fixed(-2.5, 0), "-3");
    }

    #[test]
    fn should_use_exact_binary_value_in_to_fixed() {
        // 期望值均为 node 实测
        assert_eq!(js_to_fixed(1.005, 2), "1.00");
        assert_eq!(js_to_fixed(1.45, 1), "1.4");
        assert_eq!(js_to_fixed(8.345, 2), "8.35");
        assert_eq!(js_to_fixed(9.995, 2), "9.99");
        assert_eq!(js_to_fixed(99.95, 1), "100.0");
        assert_eq!(js_to_fixed(0.045, 2), "0.04");
        assert_eq!(js_to_fixed(0.95, 1), "0.9");
        assert_eq!(js_to_fixed(-1.005, 2), "-1.00");
    }

    #[test]
    fn should_format_common_values() {
        assert_eq!(js_to_fixed(123.456, 1), "123.5");
        assert_eq!(js_to_fixed(1234.5678, 2), "1234.57");
        assert_eq!(js_to_fixed(25000.0 / 30.0, 1), "833.3");
        assert_eq!(js_to_fixed(0.0, 1), "0.0");
        assert_eq!(js_to_fixed(1e-7, 2), "0.00");
        assert_eq!(js_to_fixed(5e-324, 3), "0.000");
    }

    #[test]
    fn should_handle_signs_like_js() {
        assert_eq!(js_to_fixed(-0.001, 2), "-0.00");
        assert_eq!(js_to_fixed(-0.0, 2), "0.00");
    }

    #[test]
    fn should_fall_back_to_number_string_from_1e21() {
        assert_eq!(js_to_fixed(1e21, 2), "1e+21");
        assert_eq!(js_to_fixed(1.5e21, 1), "1.5e+21");
        assert_eq!(js_to_fixed(-1e21, 1), "-1e+21");
        assert_eq!(js_to_fixed(f64::NAN, 2), "NaN");
        assert_eq!(js_to_fixed(f64::INFINITY, 2), "Infinity");
    }

    #[test]
    fn should_parse_fixed_back_to_number() {
        assert_eq!(js_fixed_num(7.5 - 0.88, 2), 6.62);
        assert_eq!(js_fixed_num(32.5 - 20.3, 1), 12.2);
        assert_eq!(js_fixed_num(99.95, 1), 100.0);
        let neg_zero = js_fixed_num(-0.001, 2);
        assert_eq!(neg_zero, 0.0);
        assert!(neg_zero.is_sign_negative());
    }
}
