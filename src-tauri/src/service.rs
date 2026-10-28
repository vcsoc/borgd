use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    thread,
    time::Duration,
};

const NAME: &str = "borgd-worker.service";
const MARKER: &str = "Managed by borgd";
fn text(path: &Path) -> Result<&str, String> {
    let value = path.to_str().ok_or("Service paths must be valid Unicode")?;
    if value.contains(['\n', '\r', '\0']) {
        return Err("Service paths cannot contain control characters".into());
    }
    Ok(value)
}
fn command(program: &str, args: &[&str]) -> Result<Output, String> {
    let mut command = Command::new(program);
    crate::host::configure(&mut command);
    command.args(args).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .output()
        .map_err(|e| format!("Cannot run {program}: {e}"))
}
fn checked(program: &str, args: &[&str]) -> Result<(), String> {
    let output = command(program, args)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "{program} failed: {}",
            String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(4000)
                .collect::<String>()
        ))
    }
}
pub fn executable() -> Result<PathBuf, String> {
    std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(|| std::env::current_exe().map_err(|e| e.to_string()))
}
#[cfg(unix)]
fn home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("Cannot locate home directory".into())
}
#[cfg(target_os = "linux")]
fn config_home() -> Result<PathBuf, String> {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(|| home().map(|h| h.join(".config")))
}
fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
fn desktop_quote(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\\\\\")
            .replace('"', "\\\\\\\"")
            .replace('$', "\\\\$")
            .replace('`', "\\\\`")
            .replace('%', "%%")
    )
}
fn windows_quote(value: &str) -> String {
    let mut result = String::from("\"");
    let mut slashes = 0;
    for ch in value.chars() {
        if ch == '\\' {
            slashes += 1;
            continue;
        }
        result.extend(std::iter::repeat_n(
            '\\',
            if ch == '"' { slashes * 2 + 1 } else { slashes },
        ));
        result.push(ch);
        slashes = 0;
    }
    result.extend(std::iter::repeat_n('\\', slashes * 2));
    result.push('"');
    result
}
#[derive(Clone, Copy, PartialEq)]
#[allow(dead_code)] // All platform definitions are exercised by host-side tests.
enum Manager {
    Systemd,
    Desktop,
    Launchd,
    Windows,
}
struct Plan {
    manager: Manager,
    path: PathBuf,
    target: String,
    description: &'static str,
}
#[cfg(windows)]
fn sid() -> Result<String, String> {
    let output = command("whoami.exe", &["/user", "/fo", "csv", "/nh"])?;
    let value = String::from_utf8_lossy(&output.stdout)
        .split(',')
        .next_back()
        .unwrap_or("")
        .trim()
        .trim_matches('"')
        .to_string();
    if !output.status.success()
        || !value.starts_with("S-1-")
        || !value
            .chars()
            .all(|c| c == 'S' || c == '-' || c.is_ascii_digit())
    {
        return Err("Cannot determine the current Windows user SID".into());
    }
    Ok(value)
}
#[cfg(any(target_os = "linux", test))]
fn manager_matches_home(environment: &[u8], expected: &Path) -> bool {
    let environment = String::from_utf8_lossy(environment);
    let variable = |name: &str| {
        environment
            .lines()
            .find_map(|line| line.strip_prefix(&format!("{name}=")))
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    };
    let manager_home =
        variable("XDG_CONFIG_HOME").or_else(|| variable("HOME").map(|home| home.join(".config")));
    manager_home.is_some_and(|home| home == expected)
}
fn plan() -> Result<Plan, String> {
    #[cfg(target_os = "linux")]
    {
        let unit = config_home()?.join("systemd/user").join(NAME);
        // A sandbox/custom XDG home must never control a different user-manager namespace.
        let systemd = command("systemctl", &["--user", "show-environment"]).is_ok_and(|o| {
            o.status.success()
                && manager_matches_home(&o.stdout, &config_home().unwrap_or_default())
        });
        if systemd {
            return Ok(Plan {
                manager: Manager::Systemd,
                path: unit,
                target: NAME.into(),
                description:
                    "systemd user service (any Linux distribution with a working user manager)",
            });
        }
        return Ok(Plan {
            manager: Manager::Desktop,
            path: config_home()?.join("autostart/borgd-worker.desktop"),
            target: "borgd-worker.desktop".into(),
            description:
                "XDG desktop autostart (non-systemd Linux; starts at desktop login, not at boot)",
        });
    }
    #[cfg(target_os = "macos")]
    {
        return Ok(Plan {
            manager: Manager::Launchd,
            path: home()?.join("Library/LaunchAgents/com.borgd.worker.plist"),
            target: format!("gui/{}/com.borgd.worker", unsafe { libc::geteuid() }),
            description: "macOS per-user launchd LaunchAgent (starts at login)",
        });
    }
    #[cfg(windows)]
    {
        let user = sid()?;
        return Ok(Plan { manager: Manager::Windows, path: PathBuf::new(), target: format!("borgd-worker-{user}"), description: "Windows Task Scheduler, current user only (starts at login; Borg still requires WSL)" });
    }
    #[allow(unreachable_code)]
    Err("Background service management is not supported on this platform".into())
}
fn definition(
    manager: Manager,
    exe: &Path,
    directory: &Path,
    user: &str,
) -> Result<String, String> {
    let exe = text(exe)?;
    let directory = text(directory)?;
    Ok(match manager {
        Manager::Systemd => format!("# {MARKER}\n[Unit]\nDescription=borgd scheduled backup worker\n\n[Service]\nType=simple\nExecStart={} --worker --config-dir {}\nEnvironment=BORGD_MANAGED_SERVICE=1\nRestart=on-failure\nRestartSec=5\nKillMode=process\nTimeoutStopSec=infinity\nUMask=0077\n\n[Install]\nWantedBy=default.target\n", crate::worker::service_quote(exe)?, crate::worker::service_quote(directory)?),
        Manager::Desktop => format!("# {MARKER}\n[Desktop Entry]\nType=Application\nName=borgd background backups\nExec={} --worker --config-dir {}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n", desktop_quote(exe), desktop_quote(directory)),
        Manager::Launchd => format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict><key>Label</key><string>com.borgd.worker</string><key>ProgramArguments</key><array><string>{}</string><string>--worker</string><string>--config-dir</string><string>{}</string></array><key>EnvironmentVariables</key><dict><key>BORGD_MANAGED_SERVICE</key><string>1</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><false/><key>AbandonProcessGroup</key><true/><key>ExitTimeOut</key><integer>2147483647</integer><key>ProcessType</key><string>Background</string></dict></plist>\n<!-- {MARKER} -->\n", xml(exe), xml(directory)),
        Manager::Windows => format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\"><RegistrationInfo><Description>{MARKER}; config: {}</Description></RegistrationInfo><Triggers><LogonTrigger><Enabled>true</Enabled><UserId>{}</UserId></LogonTrigger></Triggers><Principals><Principal id=\"User\"><UserId>{}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>false</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Enabled>true</Enabled></Settings><Actions Context=\"User\"><Exec><Command>{}</Command><Arguments>--worker --config-dir {}</Arguments></Exec></Actions></Task>", xml(directory), xml(user), xml(user), xml(exe), xml(&windows_quote(directory))),
    })
}
fn decode(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) || (bytes.len() > 1 && bytes[1] == 0) {
        String::from_utf16_lossy(
            &bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .filter(|c| *c != 0xfeff)
                .collect::<Vec<_>>(),
        )
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}
fn existing(plan: &Plan) -> Result<Option<String>, String> {
    if plan.manager == Manager::Windows {
        let output = command("schtasks.exe", &["/Query", "/TN", &plan.target, "/XML"])?;
        return Ok(output.status.success().then(|| decode(&output.stdout)));
    }
    match fs::symlink_metadata(&plan.path) {
        Ok(meta) if !meta.is_file() || meta.file_type().is_symlink() => {
            Err("Refusing to manage a service definition that is not a regular file".into())
        }
        Ok(_) => fs::read_to_string(&plan.path)
            .map(Some)
            .map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
fn owned(plan: &Plan, contents: &str, directory: &Path) -> Result<bool, String> {
    let expected = definition(plan.manager, &executable()?, directory, "")?;
    if contents == expected {
        return Ok(true);
    }
    let directory = text(directory)?;
    Ok(match plan.manager {
        Manager::Systemd => {
            contents.contains("Description=borgd scheduled backup worker")
                && contents.lines().any(|line| {
                    Some(line)
                        == expected
                            .lines()
                            .find(|expected| expected.starts_with("ExecStart="))
                })
                && contents.contains(&format!(
                    "--worker --config-dir {}",
                    crate::worker::service_quote(directory)?
                ))
                && contents.lines().any(|l| l == "KillMode=process")
                && contents.lines().any(|l| l == "TimeoutStopSec=infinity")
        }
        Manager::Desktop => {
            contents.contains(MARKER)
                && contents.contains(&format!(
                    "--worker --config-dir {}",
                    desktop_quote(directory)
                ))
        }
        Manager::Launchd => {
            contents.contains(MARKER)
                && contents.contains(&format!("<string>{}</string>", xml(directory)))
                && contents.contains("<key>Label</key><string>com.borgd.worker</string>")
        }
        Manager::Windows => contents.contains(&format!("{MARKER}; config: {}", xml(directory))),
    })
}
pub fn private_runtime(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink() || !m.is_dir()) {
        return Err("Worker runtime must be a real private directory".into());
    }
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if fs::symlink_metadata(path)
            .map_err(|e| e.to_string())?
            .file_attributes()
            & 0x400
            != 0
        {
            return Err("Worker runtime cannot be a Windows reparse point".into());
        }
        use std::{ffi::c_void, os::windows::ffi::OsStrExt};
        #[link(name = "advapi32")]
        unsafe extern "system" {
            fn ConvertStringSecurityDescriptorToSecurityDescriptorW(
                value: *const u16,
                revision: u32,
                descriptor: *mut *mut c_void,
                size: *mut u32,
            ) -> i32;
            fn SetFileSecurityW(path: *const u16, information: u32, descriptor: *mut c_void)
                -> i32;
        }
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn LocalFree(memory: *mut c_void) -> *mut c_void;
        }
        let sddl: Vec<u16> = format!("D:P(A;OICI;FA;;;{})(A;OICI;FA;;;SY)", sid()?)
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut descriptor = std::ptr::null_mut();
        // Replace the entire DACL atomically; retaining inherited/explicit public grants would expose RPC credentials.
        unsafe {
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut descriptor,
                std::ptr::null_mut(),
            ) == 0
            {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let result = SetFileSecurityW(name.as_ptr(), 0x80000004, descriptor);
            let error = std::io::Error::last_os_error();
            LocalFree(descriptor);
            if result == 0 {
                return Err(error.to_string());
            }
        }
    }
    Ok(())
}
pub fn paused(directory: &Path) -> bool {
    directory.join("worker/paused").exists()
}
pub fn locked(directory: &Path) -> Result<bool, String> {
    let path = directory.join("worker/runtime.lock");
    if !path.exists() {
        return Ok(false);
    }
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    match file.try_lock() {
        Ok(()) => Ok(false),
        Err(std::fs::TryLockError::WouldBlock) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}
pub fn info(directory: &Path) -> Result<Value, String> {
    let plan = plan()?;
    let definition = existing(&plan)?;
    let registered = definition
        .as_ref()
        .map(|s| owned(&plan, s, directory))
        .transpose()?
        .unwrap_or(false);
    let worker = crate::worker::background_call(directory, "worker_info", Value::Null).ok();
    Ok(
        json!({"manager": plan.description, "registered": registered, "conflict": definition.is_some() && !registered, "running": worker.is_some(), "stopping": paused(directory) && locked(directory)?, "paused": paused(directory), "definition": if plan.manager == Manager::Windows { plan.target } else { plan.path.display().to_string() }}),
    )
}
pub fn has_registration(directory: &Path) -> bool {
    plan()
        .ok()
        .and_then(|p| {
            existing(&p)
                .ok()
                .flatten()
                .and_then(|s| owned(&p, &s, directory).ok())
        })
        .unwrap_or(false)
}
fn spawn(directory: &Path) -> Result<(), String> {
    let mut child = Command::new(executable()?);
    crate::host::configure(&mut child);
    child
        .arg("--worker")
        .arg("--config-dir")
        .arg(directory)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        child.creation_flags(0x08000000);
    }
    let mut child = child.spawn().map_err(|e| e.to_string())?;
    thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}
pub fn ensure(directory: &Path) -> Result<(), String> {
    if crate::worker::background_call(directory, "worker_info", Value::Null).is_ok()
        || paused(directory)
        || has_registration(directory)
    {
        return Ok(());
    }
    spawn(directory)?;
    ready(directory)
}
fn ready(directory: &Path) -> Result<(), String> {
    for _ in 0..100 {
        if crate::worker::background_call(directory, "worker_info", Value::Null).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("The background worker did not become ready. Check the service manager and start it again explicitly.".into())
}
pub fn change(directory: &Path, action: &str) -> Result<Value, String> {
    if !matches!(action, "register" | "start" | "stop" | "uninstall") {
        return Err("Unknown worker service action".into());
    }
    let runtime = directory.join("worker");
    private_runtime(&runtime)?;
    let lifecycle = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(runtime.join("service-management.lock"))
        .map_err(|e| e.to_string())?;
    lifecycle
        .try_lock()
        .map_err(|_| "Another worker service change is in progress")?;
    let plan = plan()?;
    let existing = existing(&plan)?;
    if let Some(contents) = &existing {
        if !owned(&plan, contents, directory)? {
            return Err("An existing startup definition belongs to another configuration or application. It was not changed.".into());
        }
    }
    let paused_path = runtime.join("paused");
    if action == "register" && existing.is_none() {
        #[cfg(windows)]
        let user = sid()?;
        #[cfg(not(windows))]
        let user = String::new();
        let contents = definition(plan.manager, &executable()?, directory, &user)?;
        if plan.manager == Manager::Windows {
            let temporary = runtime.join(format!("task-{}.xml", uuid::Uuid::new_v4()));
            fs::write(&temporary, contents).map_err(|e| e.to_string())?;
            let result = checked(
                "schtasks.exe",
                &["/Create", "/TN", &plan.target, "/XML", text(&temporary)?],
            );
            let _ = fs::remove_file(temporary);
            result?;
        } else {
            fs::create_dir_all(plan.path.parent().ok_or("Missing service directory")?)
                .map_err(|e| e.to_string())?;
            use std::io::Write;
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            options
                .open(&plan.path)
                .and_then(|mut f| f.write_all(contents.as_bytes()))
                .map_err(|e| e.to_string())?;
        }
    }
    if action == "register" && plan.manager == Manager::Systemd {
        checked("systemctl", &["--user", "daemon-reload"])?;
        checked("systemctl", &["--user", "enable", NAME])?;
    }
    if action == "start" {
        if paused(directory) && locked(directory)? {
            return Err(
                "The worker is still stopping. Wait for its active operation to finish.".into(),
            );
        }
        if paused_path.exists() {
            fs::remove_file(&paused_path).map_err(|e| e.to_string())?;
        }
        if crate::worker::background_call(directory, "worker_info", Value::Null).is_err() {
            match plan.manager {
                Manager::Systemd if existing.is_some() => {
                    checked("systemctl", &["--user", "start", NAME])?
                }
                Manager::Launchd if existing.is_some() => {
                    if command("launchctl", &["print", &plan.target])?
                        .status
                        .success()
                    {
                        checked("launchctl", &["kickstart", &plan.target])?;
                    } else {
                        let domain = plan
                            .target
                            .rsplit_once('/')
                            .ok_or("Invalid launchd domain")?
                            .0;
                        checked("launchctl", &["bootstrap", domain, text(&plan.path)?])?;
                    }
                }
                Manager::Windows if existing.is_some() => {
                    checked("schtasks.exe", &["/Run", "/TN", &plan.target])?
                }
                _ => spawn(directory)?,
            }
            ready(directory)?;
        }
    }
    if matches!(action, "stop" | "uninstall") {
        let previously_paused = paused_path.exists();
        fs::write(
            &paused_path,
            b"Background backups explicitly stopped by the user.\n",
        )
        .map_err(|e| e.to_string())?;
        let worker = crate::worker::background_call(directory, "worker_info", Value::Null);
        if worker.is_err() && locked(directory)? {
            return Err("The worker owns its runtime but is not reachable. No process was force-killed; inspect Activity and the service manager before retrying.".into());
        }
        if let Ok(worker) = worker {
            if plan.manager == Manager::Systemd && existing.is_some() && worker["managed"] == true {
                checked("systemctl", &["--user", "stop", NAME])?;
            } else if let Err(error) =
                crate::worker::background_call(directory, "stop_worker", Value::Null)
            {
                if !previously_paused && error.contains("Unknown worker request") {
                    let _ = fs::remove_file(&paused_path);
                }
                return Err(format!("Could not request a graceful stop; no process was force-killed. An older unmanaged worker may need one manual graceful restart. {error}"));
            }
        }
        // No timeout or force termination: accepted Borg operations must finish first.
        while locked(directory)? {
            thread::sleep(Duration::from_millis(200));
        }
        if action == "uninstall" && existing.is_some() {
            match plan.manager {
                Manager::Systemd => {
                    checked("systemctl", &["--user", "disable", NAME])?;
                    fs::remove_file(&plan.path).map_err(|e| e.to_string())?;
                    checked("systemctl", &["--user", "daemon-reload"])?;
                }
                Manager::Launchd => {
                    if command("launchctl", &["print", &plan.target])?
                        .status
                        .success()
                    {
                        checked("launchctl", &["bootout", &plan.target])?;
                    }
                    fs::remove_file(&plan.path).map_err(|e| e.to_string())?;
                }
                Manager::Windows => {
                    checked("schtasks.exe", &["/Delete", "/TN", &plan.target, "/F"])?
                }
                Manager::Desktop => fs::remove_file(&plan.path).map_err(|e| e.to_string())?,
            }
        }
    }
    info(directory)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn platform_definitions_are_scoped_and_graceful() {
        let exe = Path::new("/opt/borgd & tools/app");
        let config = Path::new("/home/user/a & b");
        let unit = definition(Manager::Systemd, exe, config, "").unwrap();
        assert!(unit.contains("KillMode=process\nTimeoutStopSec=infinity"));
        let desktop = definition(Manager::Desktop, exe, config, "").unwrap();
        assert!(desktop.contains("Terminal=false"));
        assert!(!desktop.contains("sh -c"));
        let mac = definition(Manager::Launchd, exe, config, "").unwrap();
        assert!(mac.contains("a &amp; b"));
        assert!(mac.contains("<key>AbandonProcessGroup</key><true/>"));
        assert!(mac.contains("<key>KeepAlive</key><false/>"));
        let win = definition(Manager::Windows, exe, config, "S-1-5-21-123").unwrap();
        assert!(win.contains("<AllowHardTerminate>false"));
        assert!(win.contains("<ExecutionTimeLimit>PT0S"));
        assert!(win.contains("<RunLevel>LeastPrivilege"));
        assert!(definition(Manager::Desktop, Path::new("/bad\npath"), config, "").is_err());
    }
    #[test]
    fn quoting_and_utf16_are_lossless() {
        assert_eq!(windows_quote("C:\\some path\\"), "\"C:\\some path\\\\\"");
        assert!(desktop_quote("/a% b").contains("%%"));
        let bytes: Vec<u8> = "<Task>hello</Task>"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        assert_eq!(decode(&bytes), "<Task>hello</Task>");
    }
    #[test]
    fn isolated_xdg_home_never_controls_another_systemd_manager() {
        assert!(manager_matches_home(
            b"HOME=/home/alice\n",
            Path::new("/home/alice/.config")
        ));
        assert!(!manager_matches_home(
            b"HOME=/home/alice\n",
            Path::new("/tmp/isolated/config")
        ));
        assert!(manager_matches_home(
            b"HOME=/home/alice\nXDG_CONFIG_HOME=/custom/config\n",
            Path::new("/custom/config")
        ));
        assert!(!manager_matches_home(b"", Path::new("/home/alice/.config")));
    }
    #[test]
    fn runtime_ownership_is_exclusive() {
        let path =
            std::env::temp_dir().join(format!("borgd-service-test-{}", uuid::Uuid::new_v4()));
        private_runtime(&path.join("worker")).unwrap();
        let file = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path.join("worker/runtime.lock"))
            .unwrap();
        file.try_lock().unwrap();
        assert!(locked(&path).unwrap());
        drop(file);
        assert!(!locked(&path).unwrap());
        fs::remove_dir_all(path).unwrap();
    }
}
