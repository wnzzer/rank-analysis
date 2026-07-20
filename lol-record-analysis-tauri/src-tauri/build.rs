fn main() {
    emit_app_version();
    // `SENTRY_DSN` 经 observability.rs 的 option_env! 在编译期烤进二进制；
    // env 变化时需触发 crate 重编，否则 cargo 会复用旧值。
    println!("cargo:rerun-if-env-changed=SENTRY_DSN");
    tauri_build::build()
}

/// 从 `tauri.conf.json` 读取 `version` 并通过 `APP_VERSION` 暴露给运行时代码。
///
/// Cargo.toml / package.json 都没有维护 version，唯一真相是 `tauri.conf.json`。
/// Sentry 的 `release_name!()` 宏读 `CARGO_PKG_VERSION`，会误标成 `0.0.0`，所以
/// 这里旁路一份给 `env!("APP_VERSION")` 取用。
fn emit_app_version() {
    let conf_path = "tauri.conf.json";
    println!("cargo:rerun-if-changed={conf_path}");

    let conf =
        std::fs::read_to_string(conf_path).unwrap_or_else(|e| panic!("read {conf_path}: {e}"));
    let version = conf
        .lines()
        .find_map(|line| {
            let line = line.trim();
            let rest = line.strip_prefix("\"version\"")?.trim_start();
            let rest = rest.strip_prefix(':')?.trim_start();
            let rest = rest.strip_prefix('"')?;
            let end = rest.find('"')?;
            Some(rest[..end].to_string())
        })
        .unwrap_or_else(|| panic!("no top-level `\"version\"` field in {conf_path}"));

    println!("cargo:rustc-env=APP_VERSION={version}");
}
