//! 旧安装目录的用户数据迁移。
//!
//! productName 从 `lol-record-analysis-app` 改成 `Rank Analysis` 后安装目录随之改变。
//! Windows 上配置落点由 [`crate::paths`]（`config_file()` / `data_file()`）解析为
//! **exe 所在目录**（NSIS `installMode: currentUser` 下即安装目录，见 `paths` 模块文档），
//! 因此改名会让 `config.yaml` 与 `device_id` 一起“搬家”，老版本留在旧目录里的这两份数据
//! 会变成孤儿。本模块在启动最早期把它们搬过来。
//!
//! macOS 上配置目录是 `~/Library/Application Support/<bundle id>`，只随 `identifier`
//! 变化（这次改名不动 `identifier`），落点纹丝不动、无需迁移——这一条不用显式判断平台：
//! macOS 没有 `LOCALAPPDATA` 环境变量，[`migrate_legacy_data`] 会在读取该变量失败时
//! 直接返回空报告。

use std::path::Path;

/// 需要从旧安装目录搬运的文件。
///
/// 缓存类（`opgg_cache_*.json` / `cn_patch_notes_cache.json`）不在内：
/// 它们会自动重建，搬运只是把陈旧数据带进新版本。
const MIGRATED_FILES: [&str; 2] = ["config.yaml", "device_id"];

/// 旧安装目录名。NSIS `installMode: currentUser` 下安装目录为
/// `%LOCALAPPDATA%\{productName}`，这里是改名前的 productName。
const LEGACY_DIR_NAME: &str = "lol-record-analysis-app";

/// 迁移结果。
///
/// 迁移跑在 logger 安装之前（见 [`migrate_legacy_data`] 的调用约束），
/// 期间的 `log::` 宏会被丢弃，因此结论只能带出来由调用方补打日志。
#[derive(Debug, Default, PartialEq)]
pub struct MigrationReport {
    /// 实际搬运成功的文件名
    pub migrated: Vec<String>,
    /// 逐文件的失败描述，不阻断启动
    pub errors: Vec<String>,
}

/// 从旧安装目录搬运用户数据到当前目录。
///
/// # 行为
///
/// - 幂等：`target` 下已有 `config.yaml`、`legacy` 与 `target` 同路径、
///   或 `legacy` 不存在时，直接返回空报告
/// - 不覆盖：逐文件检查目标是否存在，存在则跳过
/// - 不删源：搬完旧文件仍保留，迁移逻辑万一有 bug 用户还能手工恢复
/// - 不阻断：任何 IO 错误只计入 `errors`，绝不返回 `Err` 或 panic
///
/// # 参数
/// - `legacy`: 旧安装目录
/// - `target`: 当前配置目录（见 [`migrate_legacy_data`] 如何解析）
fn migrate_from(legacy: &Path, target: &Path) -> MigrationReport {
    let mut report = MigrationReport::default();

    // 同路径保护：日后若 productName 改回、或有人把新版手工装进旧目录，
    // 没有这层会出现自己搬自己
    if legacy == target {
        return report;
    }
    if !legacy.is_dir() {
        return report;
    }
    // 目标已有配置 = 已迁移过，或全新安装后已自行产生数据。两种情况都不该动它
    if target.join("config.yaml").exists() {
        return report;
    }

    for name in MIGRATED_FILES {
        let src = legacy.join(name);
        let dst = target.join(name);
        if !src.is_file() || dst.exists() {
            continue;
        }
        match std::fs::copy(&src, &dst) {
            Ok(_) => report.migrated.push(name.to_string()),
            Err(e) => report.errors.push(format!("{} 迁移失败: {}", name, e)),
        }
    }

    report
}

/// 解析真实路径并执行迁移。
///
/// # 调用约束
///
/// **必须是 `main()` 的第一条语句。** 晚于以下任一处都会出问题：
/// - `observability::reporting_enabled()` 经 `config::config_path()` 读取
///   `crate::paths::config_file()` 指向的 `config.yaml`，文件还没搬过来就会读出
///   `false`，老用户开着的错误上报在首启这一次被当成关闭
/// - `observability::init()` 在 `device_id_path()`（同样来自
///   `crate::paths::data_file()`）指向的文件缺失时会生成并写盘，新 ID 抢先落地后
///   本模块的「不覆盖」规则会跳过老 ID，Sentry 就把老用户算成新设备
///
/// `target` 取 [`crate::paths::config_file`] 的父目录，与 `config.yaml` / `device_id`
/// 实际落点保持单一真相来源，不用 CWD——CWD 在部分启动方式下并不等于 exe 所在目录。
///
/// `LOCALAPPDATA` 未设置（非 Windows，包括 macOS——见模块文档）、或无法解析
/// `target` 的父目录时，返回空报告。
///
/// # 已知取舍：中断在两文件之间会让 `device_id` 永久跳过迁移
///
/// [`migrate_from`] 的短路条件是「`target` 下已有 `config.yaml`」。若进程恰好在
/// 拷完 `config.yaml`、还没拷 `device_id` 时被杀（断电/强制关闭/杀软锁文件），
/// 下次启动会因为 `config.yaml` 已存在而整体短路，`device_id` 从此再也不会被
/// 迁移。后果仅限 Sentry 把老用户误算成新设备（不丢配置、不影响功能），概率
/// 极低。**这是有意的取舍，不是 bug**：短路的存在理由是「用户主动删掉
/// `config.yaml` 想重置设置时，不该把老配置搬回来」，若改成逐文件独立判断
/// 是否迁移过，会让「重置配置」这个用户可预期的操作变得难以实现。
pub fn migrate_legacy_data() -> MigrationReport {
    let Ok(local_app_data) = std::env::var("LOCALAPPDATA") else {
        return MigrationReport::default();
    };
    let Some(target) = crate::paths::config_file().parent().map(Path::to_path_buf) else {
        return MigrationReport::default();
    };
    migrate_from(&Path::new(&local_app_data).join(LEGACY_DIR_NAME), &target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    /// 临时沙箱：`legacy` 与 `target` 两个目录，Drop 时整个删掉。
    ///
    /// 仓库没有 `tempfile` 依赖，现有 Rust 测试（见 `observability.rs` 的
    /// `should_generate_and_persist_device_id`）用的就是 `temp_dir()` + uuid 手动清理。
    /// 这里包成 RAII，断言失败时也能清干净。
    struct Sandbox {
        root: PathBuf,
        legacy: PathBuf,
        target: PathBuf,
    }

    impl Sandbox {
        /// 建沙箱，并在 legacy 下按 `files` 预置内容。
        fn new(files: &[(&str, &str)]) -> Self {
            let root = std::env::temp_dir().join(format!(
                "rank-analysis-migrate-test-{}",
                uuid::Uuid::new_v4()
            ));
            let legacy = root.join("legacy");
            let target = root.join("target");
            fs::create_dir_all(&legacy).expect("建 legacy 目录");
            fs::create_dir_all(&target).expect("建 target 目录");
            for (name, content) in files {
                fs::write(legacy.join(name), content).expect("预置文件");
            }
            Self {
                root,
                legacy,
                target,
            }
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn should_migrate_both_files_with_identical_content() {
        let sb = Sandbox::new(&[("config.yaml", "theme: dark"), ("device_id", "abc-123")]);

        let report = migrate_from(&sb.legacy, &sb.target);

        assert_eq!(report.migrated, vec!["config.yaml", "device_id"]);
        assert!(report.errors.is_empty());
        assert_eq!(
            fs::read_to_string(sb.target.join("config.yaml")).unwrap(),
            "theme: dark"
        );
        assert_eq!(
            fs::read_to_string(sb.target.join("device_id")).unwrap(),
            "abc-123"
        );
    }

    #[test]
    fn should_skip_entirely_when_target_config_exists() {
        let sb = Sandbox::new(&[("config.yaml", "旧"), ("device_id", "旧")]);
        fs::write(sb.target.join("config.yaml"), "新").unwrap();

        let report = migrate_from(&sb.legacy, &sb.target);

        assert!(report.migrated.is_empty(), "已有配置时不得迁移");
        assert_eq!(
            fs::read_to_string(sb.target.join("config.yaml")).unwrap(),
            "新"
        );
        assert!(
            !sb.target.join("device_id").exists(),
            "短路后不该搬任何文件"
        );
    }

    #[test]
    fn should_noop_when_legacy_dir_missing() {
        let sb = Sandbox::new(&[]);

        let report = migrate_from(&sb.root.join("nonexistent"), &sb.target);

        assert_eq!(report, MigrationReport::default());
    }

    #[test]
    fn should_migrate_partial_without_reporting_missing_as_error() {
        let sb = Sandbox::new(&[("config.yaml", "only-config")]);

        let report = migrate_from(&sb.legacy, &sb.target);

        assert_eq!(report.migrated, vec!["config.yaml"]);
        assert!(report.errors.is_empty(), "源里本就没有的文件不算失败");
    }

    #[test]
    fn should_noop_when_legacy_equals_target() {
        let sb = Sandbox::new(&[("config.yaml", "same")]);

        let report = migrate_from(&sb.legacy, &sb.legacy);

        assert_eq!(report, MigrationReport::default(), "同路径不得自我复制");
        assert_eq!(
            fs::read_to_string(sb.legacy.join("config.yaml")).unwrap(),
            "same"
        );
    }

    #[test]
    fn should_never_delete_source() {
        let sb = Sandbox::new(&[("config.yaml", "x"), ("device_id", "y")]);

        migrate_from(&sb.legacy, &sb.target);

        assert!(
            sb.legacy.join("config.yaml").exists(),
            "源文件必须保留，迁移出错时用户还能手工恢复"
        );
        assert!(sb.legacy.join("device_id").exists());
    }
}
