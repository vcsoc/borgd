#[cfg(any(target_os = "linux", all(test, unix)))]
use std::{ffi::OsStr, path::Path};
use std::{ffi::OsString, process::Command};

// linuxdeploy's AppRun sets Python and loader paths for its bundle. Host tools
// (including system Borg's Python interpreter) must not inherit that environment.
pub fn environment() -> Vec<(OsString, Option<OsString>)> {
    #[allow(unused_mut)]
    let mut overrides = Vec::new();
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPIMAGE").is_some() || std::env::var_os("APPDIR").is_some() {
        let appdir = std::env::var_os("APPDIR");
        overrides = appimage_environment(appdir.as_deref(), std::env::var_os("PATH").as_deref());
        if let Some(dir) = appdir {
            for key in [
                "XDG_DATA_DIRS",
                "GI_TYPELIB_PATH",
                "QT_PLUGIN_PATH",
                "QML2_IMPORT_PATH",
                "QT_QPA_PLATFORM_PLUGIN_PATH",
                "GST_PLUGIN_PATH",
                "GST_PLUGIN_SYSTEM_PATH",
            ] {
                if let Some(value) = std::env::var_os(key) {
                    let paths: Vec<_> = std::env::split_paths(&value)
                        .filter(|entry| !entry.starts_with(Path::new(&dir)))
                        .collect();
                    let cleaned = if paths.is_empty() {
                        None
                    } else {
                        std::env::join_paths(paths).ok()
                    };
                    overrides.push((key.into(), cleaned));
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let mut paths = vec![
            std::path::PathBuf::from("/opt/homebrew/bin"),
            std::path::PathBuf::from("/usr/local/bin"),
        ];
        paths.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        overrides.push(("PATH".into(), std::env::join_paths(paths).ok()));
    }
    overrides
}

#[cfg(any(target_os = "linux", all(test, unix)))]
fn appimage_environment(
    appdir: Option<&OsStr>,
    path: Option<&OsStr>,
) -> Vec<(OsString, Option<OsString>)> {
    let mut result: Vec<_> = [
        "LD_LIBRARY_PATH",
        "LD_PRELOAD",
        "PYTHONHOME",
        "PYTHONPATH",
        "PYTHONDONTWRITEBYTECODE",
        "GIO_MODULE_DIR",
        "GIO_EXTRA_MODULES",
        "GSETTINGS_SCHEMA_DIR",
        "GTK_PATH",
        "GTK_EXE_PREFIX",
        "GTK_DATA_PREFIX",
        "GTK_IM_MODULE_FILE",
        "GTK_THEME",
        "APPDIR",
        "APPIMAGE",
    ]
    .into_iter()
    .map(|key| (OsString::from(key), None))
    .collect();
    if let Some(dir) = appdir {
        let paths = std::env::split_paths(path.unwrap_or_default())
            .filter(|entry| !entry.starts_with(Path::new(dir)));
        if let Ok(cleaned) = std::env::join_paths(paths) {
            result.push(("PATH".into(), Some(cleaned)));
        }
    }
    result
}

pub fn configure(command: &mut Command) {
    for (key, value) in environment() {
        if let Some(value) = value {
            command.env(key, value);
        } else {
            command.env_remove(key);
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    #[cfg(unix)]
    fn appimage_environment_removes_python_and_bundle_paths() {
        let env = appimage_environment(
            Some(OsStr::new("/tmp/appdir")),
            Some(OsStr::new("/tmp/appdir/usr/bin:/usr/local/bin:/usr/bin")),
        );
        assert!(env.contains(&("PYTHONHOME".into(), None)));
        assert!(env.contains(&("PYTHONPATH".into(), None)));
        assert!(env.contains(&("LD_LIBRARY_PATH".into(), None)));
        assert!(env.contains(&("PATH".into(), Some("/usr/local/bin:/usr/bin".into()))));
    }
    #[test]
    #[cfg(target_os = "linux")]
    fn system_borg_runs_with_cleaned_appimage_environment() {
        let mut command = Command::new("/usr/bin/borg");
        if !Path::new("/usr/bin/borg").exists() {
            return;
        }
        command
            .arg("--version")
            .env("PYTHONHOME", "/tmp/not-a-python-runtime")
            .env("PYTHONPATH", "/tmp/not-python");
        for (key, value) in appimage_environment(None, None) {
            if let Some(value) = value {
                command.env(key, value);
            } else {
                command.env_remove(key);
            }
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).starts_with("borg 1."));
    }
}
