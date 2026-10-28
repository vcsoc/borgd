use crate::engine::{Backend, Config, Request};
#[cfg(any(target_os = "linux", test))]
use crate::engine::{History, Profile};
use serde_json::{json, Value};
use std::path::PathBuf;

pub struct EngineState {
    local: Backend,
    remote: bool,
}
impl EngineState {
    pub fn new(directory: PathBuf) -> Result<Self, String> {
        let local = Backend::new(directory);
        #[cfg(target_os = "linux")]
        if std::env::var_os("BORGD_STANDALONE").is_none() {
            linux::ensure(&local.directory)?;
            return Ok(Self {
                local,
                remote: true,
            });
        }
        Ok(Self {
            local,
            remote: false,
        })
    }
    pub fn local_busy(&self) -> bool {
        !self.remote && self.local.status.lock().unwrap().busy
    }
    pub fn call(&self, method: &str, args: Value) -> Result<Value, String> {
        #[cfg(target_os = "linux")]
        if self.remote {
            return linux::call(&self.local.directory, method, args);
        }
        dispatch(&self.local, method, args, false)
    }
}
fn dispatch(
    backend: &Backend,
    method: &str,
    args: Value,
    background: bool,
) -> Result<Value, String> {
    let string = |key: &str| {
        args.get(key)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| format!("Missing {key}"))
    };
    let value = match method {
        "get_config" => serde_json::to_value(backend.config()?).map_err(|e| e.to_string())?,
        "save_config" => {
            let config: Config =
                serde_json::from_value(args["config"].clone()).map_err(|e| e.to_string())?;
            backend.save(config)?;
            Value::Null
        }
        "unlock" => {
            backend.unlock(string("id")?, string("passphrase")?)?;
            Value::Null
        }
        "lock_repository" => {
            backend.lock_repository(&string("id")?)?;
            Value::Null
        }
        "get_status" => {
            let mut value = serde_json::to_value(&*backend.status.lock().unwrap())
                .map_err(|e| e.to_string())?;
            value["workerRunning"] = json!(background);
            value
        }
        "get_history_details" => serde_json::to_value(backend.history_details(&string("id")?)?)
            .map_err(|e| e.to_string())?,
        "run_operation" => {
            let request: Request =
                serde_json::from_value(args["request"].clone()).map_err(|e| e.to_string())?;
            serde_json::to_value(backend.execute(request)?).map_err(|e| e.to_string())?
        }
        "confirm_relocation" => serde_json::to_value(backend.confirm_relocation(string("token")?)?)
            .map_err(|e| e.to_string())?,
        "dismiss_relocation" => {
            backend.dismiss_relocation(&string("token")?);
            Value::Null
        }
        "worker_info" => {
            json!({"running": background, "pid": std::process::id(), "protocol": 1, "managed": std::env::var_os("BORGD_MANAGED_SERVICE").is_some()})
        }
        _ => return Err("Unknown worker request".into()),
    };
    Ok(value)
}
#[cfg(any(target_os = "linux", test))]
fn due(profile: &Profile, history: &[History], now: chrono::DateTime<chrono::Utc>) -> bool {
    if profile.interval_hours == 0 {
        return false;
    }
    let last = history
        .iter()
        .filter(|h| {
            h.action == "backup"
                && h.repository_id == profile.repository_id
                && h.profile_id.as_deref() == Some(&profile.id)
        })
        .filter_map(|h| chrono::DateTime::parse_from_rfc3339(&h.time).ok())
        .max();
    last.is_none_or(|time| {
        now.signed_duration_since(time).num_seconds() >= i64::from(profile.interval_hours) * 3600
    })
}

#[cfg(any(target_os = "linux", test))]
fn scheduled_due(
    profile: &Profile,
    history: &[History],
    persisted: Option<&str>,
    now: chrono::DateTime<chrono::Utc>,
) -> bool {
    due(profile, history, now)
        && persisted.is_none_or(|last| {
            chrono::DateTime::parse_from_rfc3339(last).is_ok_and(|time| {
                now.signed_duration_since(time).num_seconds()
                    >= i64::from(profile.interval_hours) * 3600
            })
        })
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use serde::{Deserialize, Serialize};
    use std::{
        fs::{self, OpenOptions},
        io::{BufRead, BufReader, Read, Write},
        os::unix::{
            fs::{FileTypeExt, OpenOptionsExt, PermissionsExt},
            net::{UnixListener, UnixStream},
        },
        path::Path,
        process::{Command, Stdio},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        thread,
        time::Duration,
    };
    static STOP: AtomicBool = AtomicBool::new(false);
    extern "C" fn stop(_: libc::c_int) {
        STOP.store(true, Ordering::SeqCst);
    }
    fn stopping(flag: &AtomicBool) -> bool {
        STOP.load(Ordering::SeqCst) || flag.load(Ordering::SeqCst)
    }
    #[derive(Serialize, Deserialize)]
    struct Rpc {
        method: String,
        args: Value,
    }
    fn socket(directory: &Path) -> PathBuf {
        directory.join("worker/runtime.sock")
    }
    pub(super) fn call(directory: &Path, method: &str, args: Value) -> Result<Value, String> {
        let mut stream = UnixStream::connect(socket(directory)).map_err(|e| {
            format!(
                "Background worker unavailable: {e}. Reopen borgd or check borgd-worker.service."
            )
        })?;
        stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .map_err(|e| e.to_string())?;
        if !matches!(method, "run_operation" | "confirm_relocation") {
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .map_err(|e| e.to_string())?;
        }
        let mut payload = serde_json::to_vec(&Rpc {
            method: method.into(),
            args,
        })
        .map_err(|e| e.to_string())?;
        payload.push(b'\n');
        stream.write_all(&payload).map_err(|e| e.to_string())?;
        let mut response = Vec::new();
        BufReader::new(stream)
            .take(128 * 1024 * 1024 + 1)
            .read_until(b'\n', &mut response)
            .map_err(|e| e.to_string())?;
        if response.len() > 128 * 1024 * 1024 {
            return Err("Worker response exceeds the safety limit.".into());
        }
        let response: Value = serde_json::from_slice(&response).map_err(|e| {
            format!("Worker response was interrupted; check Activity before retrying. {e}")
        })?;
        if let Some(error) = response.get("error").and_then(Value::as_str) {
            return Err(error.into());
        }
        Ok(response["result"].clone())
    }
    pub(super) fn quote(value: &str) -> Result<String, String> {
        if value.contains(['\n', '\r', '\0']) {
            return Err("Service paths cannot contain control characters.".into());
        }
        Ok(format!(
            "\"{}\"",
            value
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('%', "%%")
                .replace('$', "$$")
        ))
    }
    pub(super) fn unit(executable: &Path, directory: &Path) -> Result<String, String> {
        Ok(format!("[Unit]\nDescription=borgd scheduled backup worker\n\n[Service]\nType=simple\nExecStart={} --worker --config-dir {}\nEnvironment=BORGD_MANAGED_SERVICE=1\nRestart=on-failure\nRestartSec=5\nKillMode=process\nTimeoutStopSec=infinity\nUMask=0077\n\n[Install]\nWantedBy=default.target\n", quote(&executable.to_string_lossy())?, quote(&directory.to_string_lossy())?))
    }
    fn executable() -> Result<PathBuf, String> {
        std::env::var_os("APPIMAGE")
            .map(PathBuf::from)
            .map(Ok)
            .unwrap_or_else(|| std::env::current_exe().map_err(|e| e.to_string()))
    }
    pub(super) fn ensure(directory: &Path) -> Result<(), String> {
        if call(directory, "worker_info", Value::Null).is_ok() {
            return Ok(());
        }
        let executable = executable()?;
        let mut check = Command::new("/usr/bin/systemctl");
        crate::host::configure(&mut check);
        let systemd = check
            .args(["--user", "show-environment"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
        if systemd {
            let config_home = std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
                .ok_or("Cannot locate user service directory")?;
            let units = config_home.join("systemd/user");
            fs::create_dir_all(&units).map_err(|e| e.to_string())?;
            let path = units.join("borgd-worker.service");
            if !path.exists() {
                fs::write(&path, unit(&executable, directory)?).map_err(|e| e.to_string())?;
            }
            for args in [
                vec!["--user", "daemon-reload"],
                vec!["--user", "enable", "--now", "borgd-worker.service"],
            ] {
                let mut command = Command::new("/usr/bin/systemctl");
                crate::host::configure(&mut command);
                if !command
                    .args(args)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .map_err(|e| e.to_string())?
                    .success()
                {
                    return Err("Could not start borgd-worker.service. Check systemctl --user status borgd-worker.service.".into());
                }
            }
        } else {
            let mut command = Command::new(&executable);
            crate::host::configure(&mut command);
            command
                .arg("--worker")
                .arg("--config-dir")
                .arg(directory)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        for _ in 0..100 {
            if call(directory, "worker_info", Value::Null).is_ok() {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(100));
        }
        Err("The background worker did not become ready. Check the user service journal.".into())
    }
    fn connection(mut stream: UnixStream, backend: Backend, shutdown: Arc<AtomicBool>) {
        let result = (|| -> Result<Value, String> {
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .map_err(|e| e.to_string())?;
            let mut bytes = Vec::new();
            BufReader::new(&stream)
                .take(1024 * 1024 + 1)
                .read_until(b'\n', &mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > 1024 * 1024 {
                return Err("Worker request exceeds safety limit".into());
            }
            let rpc: Rpc = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            if stopping(&shutdown) {
                return Err("Worker is stopping; the current backup will finish first.".into());
            }
            dispatch(&backend, &rpc.method, rpc.args, true)
        })();
        let response = match result {
            Ok(value) => json!({"result": value}),
            Err(error) => json!({"error": error}),
        };
        if let Ok(mut bytes) = serde_json::to_vec(&response) {
            bytes.push(b'\n');
            let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
            let _ = stream.write_all(&bytes);
        }
    }
    pub(super) fn serve(backend: Backend, shutdown: Arc<AtomicBool>) -> Result<(), String> {
        let runtime = backend.directory.join("worker");
        fs::create_dir_all(&runtime).map_err(|e| e.to_string())?;
        fs::set_permissions(&runtime, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(runtime.join("runtime.lock"))
            .map_err(|e| e.to_string())?;
        lock.try_lock()
            .map_err(|_| "A worker already owns this configuration directory.".to_string())?;
        let path = socket(&backend.directory);
        if let Ok(metadata) = fs::symlink_metadata(&path) {
            if !metadata.file_type().is_socket() {
                return Err("Refusing to replace a non-socket worker path.".into());
            }
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        let listener = UnixListener::bind(&path).map_err(|e| e.to_string())?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let schedule_backend = backend.clone();
        let schedule_stop = shutdown.clone();
        let scheduler = thread::spawn(move || {
            while !stopping(&schedule_stop) {
                let config = schedule_backend.config();
                let attempts = schedule_backend.schedule_attempts();
                if let Err(error) = &attempts {
                    eprintln!("borgd scheduling paused: {error}");
                }
                if let (Ok(config), Ok(attempts)) = (config, attempts) {
                    let selected = {
                        let mut status = schedule_backend.status.lock().unwrap();
                        if status
                            .relocation
                            .as_ref()
                            .is_some_and(|pending| pending.issued_at.elapsed().as_secs() >= 300)
                        {
                            status.relocation = None;
                        }
                        if status.busy || status.relocation.is_some() {
                            None
                        } else {
                            config
                                .profiles
                                .iter()
                                .find(|p| {
                                    scheduled_due(
                                        p,
                                        &status.history,
                                        attempts
                                            .get(&format!("{}:{}", p.repository_id, p.id))
                                            .map(String::as_str),
                                        chrono::Utc::now(),
                                    )
                                })
                                .cloned()
                        }
                    };
                    if let Some(profile) = selected {
                        if !stopping(&schedule_stop) {
                            let _ = schedule_backend.execute(Request {
                                action: "backup".into(),
                                repository_id: profile.repository_id,
                                profile_id: Some(profile.id),
                                archive: None,
                                destination: None,
                                encrypted: None,
                                dry_run: None,
                                selected_paths: None,
                            });
                        }
                    }
                }
                for _ in 0..60 {
                    if stopping(&schedule_stop) {
                        break;
                    }
                    thread::sleep(Duration::from_secs(1));
                }
            }
        });
        let mut connections: Vec<thread::JoinHandle<()>> = Vec::new();
        let mut failure = None;
        while !stopping(&shutdown) {
            if scheduler.is_finished() {
                failure = Some("The backup scheduler stopped unexpectedly.".to_string());
                break;
            }
            connections.retain(|handle| !handle.is_finished());
            match listener.accept() {
                Ok((stream, _)) => {
                    if connections.len() < 32 {
                        let backend = backend.clone();
                        let stop = shutdown.clone();
                        connections.push(thread::spawn(move || connection(stream, backend, stop)));
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50))
                }
                Err(error) => {
                    failure = Some(format!("Worker socket failed: {error}"));
                    break;
                }
            }
        }
        shutdown.store(true, Ordering::SeqCst);
        drop(listener);
        let _ = scheduler.join();
        for handle in connections {
            let _ = handle.join();
        }
        let _ = fs::remove_file(path);
        drop(lock);
        failure.map_or(Ok(()), Err)
    }
    pub(super) fn run(directory: PathBuf) -> Result<(), String> {
        // Only atomics are touched by signal handlers; package/Borg children are never killed mid-operation.
        unsafe {
            libc::signal(libc::SIGTERM, stop as *const () as libc::sighandler_t);
            libc::signal(libc::SIGINT, stop as *const () as libc::sighandler_t);
        }
        serve(Backend::new(directory), Arc::new(AtomicBool::new(false)))
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn service_paths_are_quoted_and_shutdown_never_kills_borg_children() {
            let text = unit(
                Path::new("/tmp/has spaces/100%.AppImage"),
                Path::new("/tmp/config"),
            )
            .unwrap();
            assert!(text.contains("\"/tmp/has spaces/100%%.AppImage\" --worker"));
            assert!(text.contains("KillMode=process"));
            assert!(text.contains("TimeoutStopSec=infinity"));
            assert!(quote("bad\npath").is_err());
        }
        #[test]
        fn real_worker_rpc_serializes_state_and_holds_an_exclusive_lock() {
            let dir = tempfile::tempdir().unwrap();
            let backend = Backend::new(dir.path().into());
            let flag = Arc::new(AtomicBool::new(false));
            let stop = flag.clone();
            let copy = backend.clone();
            let server = thread::spawn(move || serve(copy, stop));
            for _ in 0..100 {
                if socket(dir.path()).exists() {
                    break;
                }
                thread::sleep(Duration::from_millis(20));
            }
            assert_eq!(
                call(dir.path(), "worker_info", Value::Null).unwrap()["running"],
                true
            );
            assert!(serve(backend, Arc::new(AtomicBool::new(false))).is_err());
            assert_eq!(
                call(dir.path(), "get_status", Value::Null).unwrap()["workerRunning"],
                true
            );
            call(dir.path(), "save_config", json!({"config": {"repositories": [{"id":"r", "name":"Test", "location":"/tmp/worker-test-repository"}], "profiles":[]}})).unwrap();
            call(
                dir.path(),
                "unlock",
                json!({"id":"r", "passphrase":"test-only-worker-secret"}),
            )
            .unwrap();
            assert_eq!(
                call(dir.path(), "get_status", Value::Null).unwrap()["unlocked"],
                json!(["r"])
            );
            assert!(!fs::read_to_string(dir.path().join("config.json"))
                .unwrap()
                .contains("test-only-worker-secret"));
            call(dir.path(), "lock_repository", json!({"id":"r"})).unwrap();
            assert_eq!(
                call(dir.path(), "get_status", Value::Null).unwrap()["unlocked"],
                json!([])
            );
            assert!(call(dir.path(), "not_a_command", Value::Null).is_err());
            assert_eq!(
                fs::metadata(socket(dir.path()))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
            flag.store(true, Ordering::SeqCst);
            server.join().unwrap().unwrap();
            assert!(!socket(dir.path()).exists());
        }
    }
}

pub fn run_if_requested() -> Option<Result<(), String>> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_none_or(|arg| arg != "--worker") {
        return None;
    }
    #[cfg(target_os = "linux")]
    {
        let directory = if args.len() == 4 && args[2] == "--config-dir" {
            PathBuf::from(&args[3])
        } else if args.len() == 2 {
            match std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
            {
                Some(root) => root.join("com.borgd.desktop"),
                None => return Some(Err("Cannot find the configuration directory".into())),
            }
        } else {
            return Some(Err(
                "Usage: borgd --worker [--config-dir ABSOLUTE_PATH]".into()
            ));
        };
        if !directory.is_absolute() {
            return Some(Err("Worker configuration path must be absolute".into()));
        }
        Some(linux::run(directory))
    }
    #[cfg(not(target_os = "linux"))]
    Some(Err("The persistent service currently supports Linux. Scheduling on this platform requires the desktop app to remain open.".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn schedule_is_opt_in_and_counts_failed_attempts_to_avoid_retry_storms() {
        let now = chrono::Utc::now();
        let mut profile = Profile {
            id: "p".into(),
            name: "Test".into(),
            repository_id: "r".into(),
            sources: vec!["/tmp/source".into()],
            excludes: vec![],
            keep_daily: 1,
            keep_weekly: 0,
            keep_monthly: 0,
            interval_hours: 0,
        };
        assert!(!due(&profile, &[], now));
        profile.interval_hours = 1;
        assert!(due(&profile, &[], now));
        assert!(!scheduled_due(&profile, &[], Some(&now.to_rfc3339()), now));
        assert!(!scheduled_due(&profile, &[], Some("invalid"), now));
        assert!(scheduled_due(
            &profile,
            &[],
            Some(&(now - chrono::Duration::hours(2)).to_rfc3339()),
            now
        ));
        let mut history = History {
            id: None,
            details_available: false,
            repository_name: None,
            repository_location: None,
            profile_name: None,
            time: now.to_rfc3339(),
            action: "backup".into(),
            repository_id: "r".into(),
            profile_id: Some("p".into()),
            exit_code: 2,
            message: "failed".into(),
        };
        assert!(!due(&profile, &[history.clone()], now));
        history.time = (now - chrono::Duration::hours(2)).to_rfc3339();
        assert!(due(&profile, &[history], now));
    }
}
