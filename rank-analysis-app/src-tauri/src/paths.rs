//! # 应用数据路径解析
//!
//! 统一决定「配置文件」和「缓存文件」落在哪里。**唯一的硬性要求：不依赖进程的当前
//! 工作目录（CWD）。**
//!
//! ## 为什么不能用 CWD 相对路径
//!
//! 曾经这些文件都写成 `PathBuf::from("config.yaml")` 这样的相对路径，实际落点等于
//! `CWD + 文件名`。而 CWD 是**由启动方决定的，不是应用能保证的**：
//!
//! - Windows 上走开始菜单/桌面快捷方式时，CWD = 快捷方式的「起始位置」= 安装目录，
//!   于是恰好落在 exe 旁边，看起来一切正常；
//! - 但从命令行、Win+R、或被其他进程拉起时，CWD 可能是 `C:\`、`%USERPROFILE%`、
//!   甚至 `System32`，配置就写去了别处，表现为「设置莫名其妙回到默认」；
//! - macOS 上由 LaunchServices 拉起的 `.app`，CWD 恒为 `/`（实测 Chrome / iTerm2
//!   亦然），而 `/` 在 SIP 下只读 —— 配置**读不到也写不进**，每次启动全部重置。
//!
//! ## 现在的规则
//!
//! | 平台 | 配置目录 | 理由 |
//! |------|---------|------|
//! | Windows | **exe 所在目录** | 保持便携版（绿色软件）约定，且与老版本落点一致，升级无需迁移数据 |
//! | macOS | `~/Library/Application Support/<bundle id>` | 不能写进 `.app` bundle：会破坏代码签名，且每次更新整个 bundle 被替换 |
//! | 其他 Unix | `~/.config/<bundle id>` | 未发布平台，仅为编译完整性 |
//!
//! 缓存一律放系统临时目录（带应用前缀避免撞名）—— 它们都能自动重建，丢了只是多拉
//! 一次，不值得占用配置目录，也不必考虑写权限。
//!
//! ## ⚠️ 前提：Windows 安装在用户可写目录
//!
//! Windows 侧把配置放 exe 旁边成立的前提是 `tauri.conf.json` 里
//! `bundle.windows.nsis.installMode = "currentUser"`（装进 `%LOCALAPPDATA%`，可写）。
//! **若哪天改成 `perMachine`（装进 `Program Files`），exe 目录将不可写，届时必须改用
//! `%APPDATA%\<bundle id>` 并为老用户写一次数据迁移。**

use std::path::{Path, PathBuf};

/// 应用 bundle 标识，与 `tauri.conf.json` 的 `identifier` 保持一致。
///
/// 用作 macOS / Linux 配置目录名。改动 `identifier` 时必须同步改这里，否则老用户的
/// 配置会「消失」（其实是去了新目录）。
const BUNDLE_ID: &str = "com.lol-record-analysis-tauri.app";

/// 配置文件名。
const CONFIG_FILE_NAME: &str = "config.yaml";

/// 缓存文件名前缀，避免在多应用共用的临时目录里与别人撞名。
const CACHE_PREFIX: &str = "rank-analysis-";

// 下面三个 `config_dir_*` 是**纯路径运算**，不碰任何平台专有 API，因此一律无条件编译，
// 由 `config_dir()` 用运行时的 `cfg!()` 选择。刻意不用 `#[cfg]` 门控：那样未被选中的
// 分支在本平台就是 dead code（撞 `clippy -Dwarnings`），且它们的测试也只能跟着门控，
// 于是「Windows 的路径逻辑」只有 Windows runner 能验——本地怎么跑都发现不了问题。
// 无条件编译后，任一平台的 `cargo test` 都会把三套逻辑全跑一遍。

/// Windows 配置目录：exe 所在目录（便携版约定）。
///
/// 传入 `current_exe()` 的结果。返回 `None` 表示无法确定（父目录缺失或为空——空父目录
/// 意味着又要退回 CWD，正是本模块要杜绝的），调用方应回退到别处。
fn config_dir_windows(exe: &Path) -> Option<PathBuf> {
    exe.parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(PathBuf::from)
}

/// macOS 配置目录：`<home>/Library/Application Support/<bundle id>`。
fn config_dir_macos(home: &Path) -> PathBuf {
    home.join("Library")
        .join("Application Support")
        .join(BUNDLE_ID)
}

/// 其他 Unix 配置目录：`<home>/.config/<bundle id>`。
///
/// 本项目只发布 Windows / macOS，此分支不会在真实运行时被选中，仅为在 Linux 上也能跑。
fn config_dir_unix(home: &Path) -> PathBuf {
    home.join(".config").join(BUNDLE_ID)
}

/// 缓存文件路径：临时目录 + 应用前缀 + 文件名。
fn cache_file_in(temp_dir: &Path, name: &str) -> PathBuf {
    temp_dir.join(format!("{}{}", CACHE_PREFIX, name))
}

/// 配置文件的绝对路径。
///
/// 落点见模块文档。**保证返回绝对路径**——这是本模块存在的意义，相对路径会退回
/// 依赖 CWD 的老行为。
pub fn config_file() -> PathBuf {
    data_file(CONFIG_FILE_NAME)
}

/// 按平台解析配置目录，解析不出来时回退到临时目录。
///
/// 回退分支现实中几乎不可能走到（`current_exe()` / `$HOME` 皆失效）。选临时目录而不是
/// CWD，是因为它至少保证「绝对且可写」；配置存在那里会随系统清理丢失，所以额外打一条
/// 告警，便于线上发现。
fn config_dir() -> PathBuf {
    let resolved = if cfg!(target_os = "windows") {
        std::env::current_exe()
            .ok()
            .as_deref()
            .and_then(config_dir_windows)
    } else if cfg!(target_os = "macos") {
        home_dir().map(|h| config_dir_macos(&h))
    } else {
        home_dir().map(|h| config_dir_unix(&h))
    };

    resolved.unwrap_or_else(|| {
        let fallback = std::env::temp_dir();
        log::warn!(
            "无法解析配置目录（exe 路径 / $HOME 均不可用），回退到临时目录 {:?}；配置可能随系统清理丢失",
            fallback
        );
        fallback
    })
}

/// 用户主目录（`$HOME`），空值视为不可用。
///
/// Windows 上不会被 [`config_dir`] 走到（那条分支用 exe 目录），无条件编译只是为了让
/// `cfg!()` 的三个分支在所有平台都通过类型检查。
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
}

/// 配置目录下某个数据文件的绝对路径。
///
/// 用于配置以外、但同样需要**跨重启保留**的小文件（如 Sentry 的匿名设备 ID）。与
/// [`cache_file`] 的区别：缓存丢了自动重建，数据文件丢了会造成语义损失（设备 ID 重生成
/// 会让上报侧把同一台机器算成多台）。
pub fn data_file(name: &str) -> PathBuf {
    config_dir().join(name)
}

/// 某个缓存文件的绝对路径（系统临时目录下，带应用前缀）。
///
/// # 参数
/// - `name`: 不含前缀的文件名，如 `"opgg_ranked.json"`
pub fn cache_file(name: &str) -> PathBuf {
    cache_file_in(&std::env::temp_dir(), name)
}

/// 某个缓存目录的绝对路径（系统临时目录下，带应用前缀，可整目录删除重建）。
///
/// 与 [`cache_file`] 同一命名空间：`mayhem` 这样的多文件缓存以目录为边界，
/// 语义上仍是「丢了自动重建」的缓存，因此与单文件缓存共享前缀规则。
pub fn cache_dir(name: &str) -> PathBuf {
    cache_file_in(&std::env::temp_dir(), name)
}

/// 确保某个文件路径的父目录存在（不存在则递归创建）。
///
/// macOS 首次运行时 `~/Library/Application Support/<bundle id>` 尚不存在，写配置前
/// 必须先建目录，否则 `File::create` 会直接失败。
pub fn ensure_parent_dir(path: &Path) -> std::io::Result<()> {
    match path.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => std::fs::create_dir_all(dir),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 路径字面量统一用 `/` 分隔：Windows 的 Path 同样接受 `/`，这样断言在 CI 的
    // windows-latest 与 macos-latest 上语义一致（`\` 在 Unix 上不是分隔符，会被当成
    // 普通字符，令 parent() 结果随平台漂移）。
    #[test]
    fn windows_config_dir_should_be_the_exe_directory() {
        let dir = config_dir_windows(Path::new("/AppData/Local/app/app.exe"));

        assert_eq!(dir, Some(PathBuf::from("/AppData/Local/app")));
    }

    #[test]
    fn windows_config_dir_should_be_none_when_exe_has_no_real_parent() {
        // 父目录为空字符串等价于「相对 CWD」，正是本模块要杜绝的，必须当作失败。
        assert_eq!(config_dir_windows(Path::new("app.exe")), None);
    }

    #[test]
    fn macos_config_dir_should_live_under_application_support() {
        let dir = config_dir_macos(Path::new("/Users/me"));

        assert_eq!(
            dir,
            PathBuf::from(
                "/Users/me/Library/Application Support/com.lol-record-analysis-tauri.app"
            )
        );
    }

    #[test]
    fn unix_config_dir_should_live_under_dot_config() {
        let dir = config_dir_unix(Path::new("/home/me"));

        assert_eq!(
            dir,
            PathBuf::from("/home/me/.config/com.lol-record-analysis-tauri.app")
        );
    }

    #[test]
    fn cache_file_should_be_namespaced_inside_temp_dir() {
        let path = cache_file_in(Path::new("/tmp"), "opgg_ranked.json");

        assert_eq!(path, PathBuf::from("/tmp/rank-analysis-opgg_ranked.json"));
    }

    // 本模块存在的全部理由：路径不能依赖 CWD。相对路径一旦回归，下面两条立刻变红。
    // 这正是当初 macOS 上「配置读不到也写不进」（CWD 为只读的 `/`）漏网的原因。
    #[test]
    fn config_file_must_be_absolute_never_cwd_relative() {
        assert!(
            config_file().is_absolute(),
            "配置路径必须绝对，否则落点会随启动方式漂移：{:?}",
            config_file()
        );
    }

    #[test]
    fn cache_file_must_be_absolute_never_cwd_relative() {
        assert!(cache_file("x.json").is_absolute());
    }

    #[test]
    fn cache_dir_should_share_prefix_and_be_absolute() {
        let dir = cache_dir("mayhem");
        assert!(dir.is_absolute(), "{:?}", dir);
        assert!(dir.ends_with("rank-analysis-mayhem"));
        assert_eq!(dir.parent(), cache_file("x.json").parent());
    }

    #[test]
    fn data_file_should_sit_beside_the_config_file() {
        let device_id = data_file("device_id");

        assert!(device_id.is_absolute(), "{:?}", device_id);
        assert_eq!(device_id.parent(), config_file().parent());
        assert_eq!(
            device_id.file_name().and_then(|n| n.to_str()),
            Some("device_id")
        );
    }

    #[test]
    fn config_file_should_be_named_config_yaml() {
        assert_eq!(
            config_file().file_name().and_then(|n| n.to_str()),
            Some("config.yaml")
        );
    }

    #[test]
    fn ensure_parent_dir_should_create_missing_directories() {
        let target = std::env::temp_dir()
            .join(format!("ra-paths-test-{}", std::process::id()))
            .join("nested")
            .join("config.yaml");
        let created_root = target.parent().unwrap().parent().unwrap().to_path_buf();
        let _ = std::fs::remove_dir_all(&created_root);

        ensure_parent_dir(&target).expect("应能创建父目录");

        assert!(target.parent().unwrap().is_dir());
        let _ = std::fs::remove_dir_all(&created_root);
    }
}
