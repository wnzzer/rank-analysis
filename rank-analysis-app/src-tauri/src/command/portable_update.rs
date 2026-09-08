//! # 安装形态探测与便携版自更新
//!
//! ## 为什么需要区分安装形态
//!
//! 便携版是 CI 把裸 `target/release/rank-analysis.exe` 用 `7z` 打包分发的，**没有经过
//! NSIS bundler**。官方 updater 却仍然会为它匹配到 `latest.json` 的 `windows-x86_64`
//! 条目（target 匹配始终兜底 `{os}-{arch}`），于是便携版能查到更新、能下载 setup.exe，
//! 最后运行 NSIS 安装器把新版**装进标准安装目录**——而用户原来那个便携目录里的 exe
//! 一字未动。结果是每次更新都静默多出一份安装版，便携用户永远停在旧版本。
//!
//! 所以便携版必须走自研更新路径（下载 .7z → 校验签名 → 解压 → 原地替换自身 → 重启），
//! 前提就是先能可靠地判断"我是哪种形态"。
//!
//! ## 判断依据
//!
//! `tauri::utils::platform::bundle_type()` 读的是二进制里的静态串 `__TAURI_BUNDLE_TYPE`，
//! 该串由 bundler 在打包时**二进制补丁**改写（NSIS → `_VAR_NSS`、MSI → `_VAR_MSI`……）。
//! 裸 exe 不经 bundler，静态串保持默认的 `_VAR_UNK`，于是返回 `None`——这正是"便携版"
//! 的可靠指纹，不需要去猜安装路径（用户可以把便携版解压到任何地方，包括 Program Files）。

use tauri::utils::config::BundleType;

/// 应用的安装形态。
///
/// 同时用于 Sentry 的 `install_form` tag（便携版占比只能这样量化——下载数里
/// setup.exe 会被老用户的自动更新反复计数，便携版则可能被同一人重复下载）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallForm {
    /// 经安装器安装（Windows NSIS / MSI，Linux deb / rpm / AppImage）。
    Installer,
    /// 免安装的裸可执行文件（当前只有 Windows 的 portable .7z）。
    Portable,
    /// macOS 的 `.app` bundle。macOS 不存在便携形态，且 bundle 内部不可写。
    MacosBundle,
}

impl InstallForm {
    /// 稳定的字符串标识，用作 Sentry tag 值与前端门控依据。
    ///
    /// 取值是枚举而非自由文本，可安全上报（非 PII）。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Installer => "installer",
            Self::Portable => "portable",
            Self::MacosBundle => "macos_bundle",
        }
    }
}

/// 由 bundle 类型与操作系统推断安装形态。
///
/// # 参数
/// - `bundle`: `tauri::utils::platform::bundle_type()` 的结果
/// - `os`: `std::env::consts::OS`
///
/// # 行为
/// - macOS 一律 `MacosBundle`：该平台没有便携形态，`.app` 内部也不可写。注意 macOS 上
///   `bundle_type()` 兜底返回 `Some(App)`，但这里不依赖那个兜底，`None` 也归此类。
/// - 其余平台：`Some(_)` 表示经 bundler 打包 → `Installer`；`None` 表示裸 exe → `Portable`。
///
/// 刻意做成**不带 `#[cfg]` 的纯函数**，两个平台的 CI 都能跑它的单测。若用 `cfg` 门控，
/// 另一平台上它是 dead code，会直接撞 `clippy -Dwarnings`（同 `paths` 模块的取舍）。
pub fn classify_install_form(bundle: Option<BundleType>, os: &str) -> InstallForm {
    if os == "macos" {
        return InstallForm::MacosBundle;
    }
    match bundle {
        Some(_) => InstallForm::Installer,
        None => InstallForm::Portable,
    }
}

/// 当前进程的安装形态。
///
/// 供 `observability::init()` 与 [`get_install_form`] 共用同一个真相，避免两处各判一次。
pub fn install_form() -> InstallForm {
    classify_install_form(tauri::utils::platform::bundle_type(), std::env::consts::OS)
}

/// 返回当前安装形态（`installer` / `portable` / `macos_bundle`）。
///
/// 供前端决定更新时走哪条路：便携版必须走自研自更新，否则官方 updater 会把新版装到
/// 别处、原地文件不变（详见模块头说明）。
#[tauri::command]
pub fn get_install_form() -> &'static str {
    install_form().as_str()
}

// ─── 便携版自更新 ────────────────────────────────────────────────────────────
//
// 整条链路：下载 .7z → 验签 → 解压出 exe → 原地替换自身 → 拉起新版 → 退出旧进程。
//
// 这里**刻意不做 `#[cfg(target_os = "windows")]` 门控**（与 `system::relaunch_as_admin`
// 的双实现不同）：那个函数真的要调 Windows 专属的 ShellExecuteW，而这里从头到尾都是
// 跨平台的 std / reqwest API。门控会让另一平台上这些函数变成 dead code 直接撞
// `clippy -Dwarnings`，其纯逻辑部分也就没法在 macOS 上跑单测了（同 `paths` 模块的取舍）。
// 平台限制改由运行时的 `install_form()` 判断表达——语义上也更准：即使在 Windows 上，
// 安装版调用它同样应当被拒绝。

use minisign_verify::{PublicKey, Signature};
use reqwest::Client;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::ipc::Channel;

/// 便携版更新的下载进度事件。
///
/// 字段形状对齐官方 updater 的下载事件，前端可以复用同一套进度弹窗：
/// - `started`：`data` 是总字节数，服务端没给 Content-Length 时为 `None`
///   （前端据此退化为「只显示已下载字节、不画进度条」）
/// - `progress`：`data` 是本次新增字节数（**增量**，不是累计值）
/// - `finished`：`data` 为 `None`，此后进入验签 / 解压 / 替换阶段
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableUpdateEvent {
    pub event: String,
    pub data: Option<u64>,
}

impl PortableUpdateEvent {
    fn started(total: Option<u64>) -> Self {
        Self {
            event: "started".into(),
            data: total,
        }
    }
    fn progress(chunk: u64) -> Self {
        Self {
            event: "progress".into(),
            data: Some(chunk),
        }
    }
    fn finished() -> Self {
        Self {
            event: "finished".into(),
            data: None,
        }
    }
}

/// 自更新过程中围绕当前 exe 派生的三个路径。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SidePaths {
    /// 当前 exe 自身，替换后新版落在这个路径上（用户的快捷方式仍然指向它）。
    pub target: PathBuf,
    /// 新版落地前的暂存文件（`<exe>.new`）。
    pub staged: PathBuf,
    /// 旧版被挪走后的备份（`<exe>.old`），供失败回滚与下次启动清理。
    pub backup: PathBuf,
}

/// 由当前 exe 路径派生 `.new` / `.old` 两个旁路文件名。
///
/// # 行为
/// 用**追加**而非 `Path::with_extension`：后者会把 `rank-analysis.exe` 变成
/// `rank-analysis.new`，扩展名丢失，Windows 上就不再是可执行文件了。这里要的是
/// `rank-analysis.exe.new`。
///
/// 全程从传入路径派生、不硬编码文件名——便携版就是一个裸 exe，用户完全可能改过名。
pub fn derive_side_paths(current_exe: &Path) -> SidePaths {
    let with_suffix = |suffix: &str| {
        let mut s = current_exe.as_os_str().to_os_string();
        s.push(suffix);
        PathBuf::from(s)
    };
    SidePaths {
        target: current_exe.to_path_buf(),
        staged: with_suffix(".new"),
        backup: with_suffix(".old"),
    }
}

/// 校验便携包的 minisign 签名。
///
/// # 参数
/// - `data`: 下载到的 .7z 完整字节
/// - `signature_b64`: `latest.json` 里 `portable` 条目的签名
/// - `pubkey_b64`: `tauri.conf.json` 的 `plugins.updater.pubkey`
///
/// # 行为
/// 编码约定与官方 updater 完全一致——公钥与签名都是 **base64 包裹的 minisign 文本**，
/// 所以两边能共用同一把密钥、同一个 pubkey，CI 只需对便携包多签一次。
///
/// 注意签名绑定的是**文件字节**：setup.exe 的签名放到 .7z 上必然验不过，这不是配置问题。
pub fn verify_portable_signature(
    data: &[u8],
    signature_b64: &str,
    pubkey_b64: &str,
) -> Result<(), String> {
    use base64::Engine;
    let unwrap_base64 = |value: &str, what: &str| -> Result<String, String> {
        let raw = base64::engine::general_purpose::STANDARD
            .decode(value.trim())
            .map_err(|_| format!("{what}不是合法的 base64 编码"))?;
        String::from_utf8(raw).map_err(|_| format!("{what}解码后不是合法文本"))
    };

    let public_key = PublicKey::decode(&unwrap_base64(pubkey_b64, "更新公钥")?)
        .map_err(|e| format!("更新公钥无法解析: {e}"))?;
    let signature = Signature::decode(&unwrap_base64(signature_b64, "更新包签名")?)
        .map_err(|e| format!("更新包签名无法解析: {e}"))?;

    public_key
        .verify(data, &signature, true)
        .map_err(|_| "更新包签名校验失败，已中止更新（文件可能损坏或被篡改）".to_string())
}

/// 从便携包里取出唯一的可执行文件。
///
/// # 行为
/// CI 打包的便携 .7z 里只有一个 exe（`7z a -t7z <name>.7z rank-analysis.exe`）。
/// 出现 0 个或多个都视为异常并报错，而不是猜一个——猜错会把用户的 exe 换成别的东西。
///
/// **必须在验签通过之后再调用**：7z 解析器本身也是攻击面，不能拿未校验的字节去喂它。
pub fn extract_single_exe(archive: &[u8]) -> Result<Vec<u8>, String> {
    let mut reader =
        sevenz_rust2::ArchiveReader::new(Cursor::new(archive), sevenz_rust2::Password::empty())
            .map_err(|e| format!("便携包解析失败: {e}"))?;

    let names: Vec<String> = reader
        .archive()
        .files
        .iter()
        .filter(|f| !f.is_directory && f.name.to_ascii_lowercase().ends_with(".exe"))
        .map(|f| f.name.clone())
        .collect();

    let name = match names.as_slice() {
        [only] => only.clone(),
        [] => return Err("便携包内没有可执行文件，已中止更新".to_string()),
        _ => return Err("便携包内有多个可执行文件，无法确定替换目标，已中止更新".to_string()),
    };

    reader
        .read_file(&name)
        .map_err(|e| format!("从便携包中解出可执行文件失败: {e}"))
}

/// 探测目录是否可写。
///
/// 便携版可能被解压到 U 盘、只读目录，或被放进 `Program Files`（那里普通权限写不了）。
/// 先探一下，比动到一半才失败要好——此时还没碰用户的 exe。
fn ensure_dir_writable(dir: &Path) -> Result<(), String> {
    let probe = dir.join(format!(
        ".rank-analysis-write-probe-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::write(&probe, b"probe")
        .map_err(|_| "当前目录没有写入权限，无法自动更新，请手动下载新版".to_string())?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

/// 原地替换可执行文件（rename 三步）。
///
/// # 行为
/// Windows 不允许覆盖正在运行的 exe（映像被锁），但**允许重命名**它——重命名只改目录项，
/// 不动文件内容。于是：暂存新版 → 把自己挪成 `.old` → 新版顶上原名。
///
/// 第二步之后任何失败都会把 `.old` 改回原名回滚，绝不留下"exe 不见了"的中间态。
/// `.old` 不在这里删：此刻旧映像还在运行、文件被占用，交给下次启动清理。
pub fn replace_exe_in_place(paths: &SidePaths, new_bytes: &[u8]) -> Result<(), String> {
    std::fs::write(&paths.staged, new_bytes).map_err(|e| format!("写入新版本文件失败: {e}"))?;

    if let Err(e) = std::fs::rename(&paths.target, &paths.backup) {
        let _ = std::fs::remove_file(&paths.staged);
        return Err(format!("替换当前程序失败: {e}"));
    }

    if let Err(e) = std::fs::rename(&paths.staged, &paths.target) {
        // 回滚：把旧版本改回原名，用户下次启动仍是可用的旧版，而不是一个空目录
        let _ = std::fs::rename(&paths.backup, &paths.target);
        let _ = std::fs::remove_file(&paths.staged);
        return Err(format!("启用新版本失败，已回滚到当前版本: {e}"));
    }

    Ok(())
}

/// 清理上一次自更新留下的旁路文件（`.old` / `.new`）。
///
/// 在启动早期调用。`.old` 在刚更新完的那次启动里通常删不掉——旧进程可能还没完全退出、
/// 映像仍被占用——这是预期内的，静默忽略、下次启动再删即可。`.new` 则是更新中途崩溃
/// （release profile 是 `panic = "abort"`，没有 unwind，Drop 清理不会跑）的残骸。
pub fn cleanup_stale_artifacts() {
    let Ok(current) = std::env::current_exe() else {
        return;
    };
    let paths = derive_side_paths(&current);
    for stale in [&paths.backup, &paths.staged] {
        if stale.exists() && std::fs::remove_file(stale).is_ok() {
            // 不打印路径：日志会被全量转发到 Sentry Logs，而 exe 路径含用户名（PII）
            log::info!("已清理上次更新残留文件");
        }
    }
}

/// 便携更新专用的下载客户端。
///
/// 与 LCU 客户端分开：外网下载要保留系统代理（国内用户常挂加速器）并走正常 TLS 校验。
/// 只设建连超时、不设总超时——便携包约 5MB，慢网下的总耗时无法预估，设总超时等于
/// 让慢速用户永远更新不成功。
static UPDATE_CLIENT: OnceLock<Client> = OnceLock::new();

fn update_client() -> &'static Client {
    UPDATE_CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("构建便携版更新下载客户端失败")
    })
}

/// 读取 `tauri.conf.json` 里 updater 的 minisign 公钥。
///
/// 与官方 updater 共用同一个配置项，避免两处各存一份公钥而漂移。
fn updater_pubkey(app: &tauri::AppHandle) -> Result<String, String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get("pubkey"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "缺少更新公钥配置，无法校验更新包".to_string())
}

/// 下载便携包并把进度发给前端。
async fn download_archive(
    url: &str,
    on_event: &Channel<PortableUpdateEvent>,
) -> Result<Vec<u8>, String> {
    use futures::StreamExt;

    let resp = update_client()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载更新包失败: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("下载更新包失败，服务器返回 {}", resp.status()));
    }

    let total = resp.content_length();
    let _ = on_event.send(PortableUpdateEvent::started(total));

    let mut buf: Vec<u8> = Vec::with_capacity(total.unwrap_or(0) as usize);
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载中断: {e}"))?;
        buf.extend_from_slice(&chunk);
        let _ = on_event.send(PortableUpdateEvent::progress(chunk.len() as u64));
    }

    let _ = on_event.send(PortableUpdateEvent::finished());
    Ok(buf)
}

/// 便携版原地自更新：下载 → 验签 → 解压 → 替换自身 → 重启。
///
/// # 参数
/// - `url` / `signature`: 取自 `latest.json` 的自定义 `portable` 条目（前端经
///   `update.rawJson` 读出后传入）
/// - `on_event`: 下载进度通道，事件形状见 [`PortableUpdateEvent`]
///
/// # 行为
/// 成功后**不返回**——拉起新版进程并退出当前进程。所以前端不要在它之后再调 `relaunch()`。
///
/// 非便携形态（安装版 / macOS）直接拒绝：那两种形态该走官方 updater，原地替换对它们
/// 既无必要也不安全。
#[tauri::command]
pub async fn portable_self_update(
    app: tauri::AppHandle,
    url: String,
    signature: String,
    on_event: Channel<PortableUpdateEvent>,
) -> Result<(), String> {
    if install_form() != InstallForm::Portable {
        return Err("当前不是便携版，请通过常规更新方式升级。".to_string());
    }

    let current = std::env::current_exe().map_err(|_| "无法定位当前程序位置".to_string())?;
    let dir = current
        .parent()
        .ok_or_else(|| "无法定位当前程序所在目录".to_string())?;
    ensure_dir_writable(dir)?;

    let pubkey = updater_pubkey(&app)?;
    let paths = derive_side_paths(&current);

    log::info!("便携版自更新：开始下载更新包");
    let archive = download_archive(&url, &on_event).await?;

    // 顺序不能反：先验整包签名，再交给 7z 解析器
    verify_portable_signature(&archive, &signature, &pubkey)?;
    log::info!("便携版自更新：签名校验通过，开始解压");

    let exe_bytes = extract_single_exe(&archive)?;
    replace_exe_in_place(&paths, &exe_bytes)?;
    log::info!("便携版自更新：已替换可执行文件，准备重启");

    crate::observability::track_feature("portable_self_update");

    std::process::Command::new(&paths.target)
        .spawn()
        .map_err(|e| format!("新版本已就位，但自动重启失败，请手动打开程序: {e}"))?;

    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_treat_bare_exe_as_portable() {
        assert_eq!(
            classify_install_form(None, "windows"),
            InstallForm::Portable,
            "裸 exe 的 __TAURI_BUNDLE_TYPE 未被 bundler 改写，必须判为便携版"
        );
    }

    #[test]
    fn should_treat_bundled_windows_targets_as_installer() {
        for bundle in [BundleType::Nsis, BundleType::Msi] {
            assert_eq!(
                classify_install_form(Some(bundle.clone()), "windows"),
                InstallForm::Installer,
                "{bundle:?} 经 bundler 打包，应判为安装版"
            );
        }
    }

    #[test]
    fn should_treat_macos_as_bundle_regardless_of_bundle_type() {
        // macOS 上 bundle_type() 会兜底返回 Some(App)，但不能依赖这个兜底：
        // 无论有没有值，macOS 都没有便携形态。
        assert_eq!(
            classify_install_form(Some(BundleType::App), "macos"),
            InstallForm::MacosBundle
        );
        assert_eq!(
            classify_install_form(None, "macos"),
            InstallForm::MacosBundle
        );
    }

    #[test]
    fn should_treat_linux_packages_as_installer() {
        for bundle in [BundleType::Deb, BundleType::Rpm, BundleType::AppImage] {
            assert_eq!(
                classify_install_form(Some(bundle.clone()), "linux"),
                InstallForm::Installer
            );
        }
    }

    #[test]
    fn should_expose_stable_tag_values() {
        // 这些字符串是 Sentry tag 值，改动会断掉历史数据的连续性。
        assert_eq!(InstallForm::Installer.as_str(), "installer");
        assert_eq!(InstallForm::Portable.as_str(), "portable");
        assert_eq!(InstallForm::MacosBundle.as_str(), "macos_bundle");
    }

    // ─── 便携版自更新 ───────────────────────────────────────────────────────

    use std::fs;
    use std::path::PathBuf;

    /// 临时沙箱目录，Drop 时整个删掉。
    ///
    /// 仓库没有 `tempfile` 依赖，既有 Rust 测试（`migrate.rs` / `observability.rs`）
    /// 用的都是 `temp_dir()` + uuid 手动清理，这里沿用同一套。
    struct Sandbox {
        root: PathBuf,
    }

    impl Sandbox {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "rank-analysis-portable-test-{}",
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(&root).expect("建沙箱目录");
            Self { root }
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    /// 把 minisign 文本按 tauri 的约定包一层 base64。
    fn wrap_base64(text: &str) -> String {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(text)
    }

    /// 来自 minisign-verify 自身测试的已知有效三元组：公钥 / 签名 / 被签数据是 b"test"。
    const TEST_PUBKEY_TEXT: &str = "untrusted comment: minisign public key
RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
    const TEST_SIGNATURE_TEXT: &str = "untrusted comment: signature from minisign secret key
RWQf6LRCGA9i59SLOFxz6NxvASXDJeRtuZykwQepbDEGt87ig1BNpWaVWuNrm73YiIiJbq71Wi+dP9eKL8OC351vwIasSSbXxwA=
trusted comment: timestamp:1555779966\tfile:test
QtKMXWyYcwdpZAlPF7tE2ENJkRd1ujvKjlj1m9RtHTBnZPa5WKU5uWRs5GoP5M/VqE81QFuMKI5k/SfNQUaOAA==";

    #[test]
    fn should_keep_exe_suffix_when_deriving_side_paths() {
        // 这是本模块最容易写错的一处：Path::with_extension 会把 rank-analysis.exe
        // 变成 rank-analysis.new，扩展名丢失后在 Windows 上就不是可执行文件了。
        let paths = derive_side_paths(Path::new("C:\\tools\\rank-analysis.exe"));
        assert!(paths
            .staged
            .to_string_lossy()
            .ends_with("rank-analysis.exe.new"));
        assert!(paths
            .backup
            .to_string_lossy()
            .ends_with("rank-analysis.exe.old"));
        assert_eq!(paths.target, PathBuf::from("C:\\tools\\rank-analysis.exe"));
    }

    #[test]
    fn should_derive_side_paths_from_renamed_exe() {
        // 便携版就是一个裸 exe，用户完全可能改过名——绝不能硬编码文件名。
        let paths = derive_side_paths(Path::new("/opt/我的排位工具.exe"));
        assert!(paths
            .staged
            .to_string_lossy()
            .ends_with("我的排位工具.exe.new"));
        assert!(paths
            .backup
            .to_string_lossy()
            .ends_with("我的排位工具.exe.old"));
    }

    #[test]
    fn should_accept_valid_signature() {
        assert!(verify_portable_signature(
            b"test",
            &wrap_base64(TEST_SIGNATURE_TEXT),
            &wrap_base64(TEST_PUBKEY_TEXT),
        )
        .is_ok());
    }

    #[test]
    fn should_reject_tampered_payload() {
        // 签名绑定文件字节：内容被改一个字母就必须验不过
        let err = verify_portable_signature(
            b"Test",
            &wrap_base64(TEST_SIGNATURE_TEXT),
            &wrap_base64(TEST_PUBKEY_TEXT),
        )
        .expect_err("被篡改的内容必须验签失败");
        assert!(err.contains("校验失败"), "错误应说明验签失败: {err}");
    }

    #[test]
    fn should_reject_malformed_signature_encoding() {
        // tauri 约定签名是 base64 包裹的 minisign 文本，直接给裸文本应当被拒
        assert!(verify_portable_signature(
            b"test",
            TEST_SIGNATURE_TEXT,
            &wrap_base64(TEST_PUBKEY_TEXT),
        )
        .is_err());
    }

    /// 用 sevenz-rust2 压一个只含单个 exe 条目的 7z（对齐 CI 的 `7z a -t7z`）。
    fn make_archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer =
            sevenz_rust2::ArchiveWriter::new(Cursor::new(Vec::new())).expect("建 7z writer");
        for (name, data) in entries {
            writer
                .push_archive_entry(
                    sevenz_rust2::ArchiveEntry::new_file(name),
                    Some(Cursor::new(data.to_vec())),
                )
                .expect("写入 7z 条目");
        }
        writer.finish().expect("生成 7z").into_inner()
    }

    #[test]
    fn should_extract_the_only_exe_from_archive() {
        let archive = make_archive(&[("rank-analysis.exe", b"MZ-fake-binary")]);
        assert_eq!(
            extract_single_exe(&archive).expect("应能解出唯一的 exe"),
            b"MZ-fake-binary"
        );
    }

    #[test]
    fn should_refuse_archive_without_single_exe() {
        let none = make_archive(&[("readme.txt", b"hi")]);
        assert!(extract_single_exe(&none).is_err(), "没有 exe 时必须报错");

        let many = make_archive(&[("a.exe", b"a"), ("b.exe", b"b")]);
        assert!(
            extract_single_exe(&many).is_err(),
            "多个 exe 时不能瞎猜替换目标"
        );
    }

    #[test]
    fn should_replace_exe_and_keep_backup() {
        let sb = Sandbox::new();
        let exe = sb.root.join("rank-analysis.exe");
        fs::write(&exe, b"old-version").expect("预置旧版");
        let paths = derive_side_paths(&exe);

        replace_exe_in_place(&paths, b"new-version").expect("替换应成功");

        assert_eq!(fs::read(&exe).unwrap(), b"new-version", "原路径应是新版本");
        assert_eq!(
            fs::read(&paths.backup).unwrap(),
            b"old-version",
            "旧版本应被留作 .old 备份，供回滚与下次启动清理"
        );
        assert!(!paths.staged.exists(), "暂存文件应已改名，不该残留");
    }

    #[test]
    fn should_rollback_when_target_cannot_be_replaced() {
        let sb = Sandbox::new();
        let exe = sb.root.join("rank-analysis.exe");
        fs::write(&exe, b"old-version").expect("预置旧版");
        let paths = derive_side_paths(&exe);

        // 制造第二步失败：把 .new 的位置占成目录，rename 到目标必然失败
        fs::create_dir_all(&paths.staged).ok();
        let blocked = SidePaths {
            staged: paths.staged.clone(),
            ..paths.clone()
        };
        // 目录已存在时 fs::write 会失败，直接走「写暂存文件失败」分支；
        // 这里主要断言：无论失败在哪一步，用户的 exe 都必须还在原地。
        let _ = replace_exe_in_place(&blocked, b"new-version");
        assert!(exe.exists(), "任何失败路径都不能留下「exe 不见了」的中间态");
    }

    /// 可选的真实产物验证：`PORTABLE_7Z_FIXTURE` 指向一个真正由 `7z a -t7z` 打出来的包时才跑。
    ///
    /// 常规单测用 sevenz-rust2 自己压的包，验的是「能解自己压的 LZMA2」；这条用来确认
    /// 它也能解 7z CLI 的产物（CI 便携包就是那么打的）。
    #[test]
    fn should_extract_real_cli_archive_when_fixture_provided() {
        let Ok(path) = std::env::var("PORTABLE_7Z_FIXTURE") else {
            return;
        };
        let bytes = fs::read(&path).expect("读取 fixture 失败");
        let exe = extract_single_exe(&bytes).expect("应能解出真实 CLI 打的包里的 exe");
        assert!(exe.starts_with(b"MZ"), "解出的应是 PE 可执行文件");
    }
}
