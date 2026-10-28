use crate::engine::{Backend, Config, Request};
#[cfg(any(any(unix, windows), test))]
use crate::engine::{History, Profile};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub fn service_quote(value: &str) -> Result<String, String> {
    if value.contains(['\n', '\r', '\0']) {
        return Err("Service paths cannot contain control characters".into());
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
pub fn background_call(directory: &Path, method: &str, args: Value) -> Result<Value, String> {
    #[cfg(any(unix, windows))]
    {
        platform::call(directory, method, args)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (directory, method, args);
        Err("Background workers are unsupported on this platform".into())
    }
}

pub struct EngineState {
    local: Backend,
    remote: bool,
}
impl EngineState {
    pub fn new(directory: PathBuf) -> Result<Self, String> {
        let local = Backend::new(directory);
        #[cfg(any(unix, windows))]
        if std::env::var_os("BORGD_STANDALONE").is_none() {
            crate::service::ensure(&local.directory)?;
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
    pub fn directory(&self) -> Result<PathBuf, String> {
        if !self.remote {
            return Err(
                "Worker service controls are disabled in standalone diagnostic mode".into(),
            );
        }
        Ok(self.local.directory.clone())
    }
    pub fn local_busy(&self) -> bool {
        !self.remote && self.local.status.lock().unwrap().busy
    }
    pub fn call(&self, method: &str, args: Value) -> Result<Value, String> {
        #[cfg(any(unix, windows))]
        if self.remote {
            if crate::service::paused(&self.local.directory)
                || platform::call(&self.local.directory, "worker_info", Value::Null).is_err()
            {
                if matches!(method, "get_config" | "get_history_details" | "get_status") {
                    let fresh = Backend::new(self.local.directory.clone());
                    let mut value = dispatch(&fresh, method, args, false)?;
                    if method == "get_status" {
                        value["workerOffline"] = json!(true);
                    }
                    return Ok(value);
                }
                return Err("The background worker is stopped or unavailable. Start it in Settings before changing configuration or running operations.".into());
            }
            return platform::call(&self.local.directory, method, args);
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
#[cfg(any(any(unix, windows), test))]
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

#[cfg(any(any(unix, windows), test))]
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

#[cfg(any(unix, windows))]
mod platform {
    use super::*;
    #[cfg(windows)]
    use crate::worker_tls::Stream;
    use serde::{Deserialize, Serialize};
    #[cfg(windows)]
    use std::net::TcpListener as Listener;
    #[cfg(unix)]
    use std::os::unix::{
        fs::{FileTypeExt, OpenOptionsExt, PermissionsExt},
        net::{UnixListener as Listener, UnixStream as Stream},
    };
    use std::{
        fs::{self, OpenOptions},
        io::{BufRead, BufReader, Read, Write},
        path::Path,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        thread,
        time::Duration,
    };
    static STOP: AtomicBool = AtomicBool::new(false);
    #[cfg(unix)]
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        token: Option<String>,
    }
    #[cfg(unix)]
    fn socket(directory: &Path) -> PathBuf {
        directory.join("worker/runtime.sock")
    }
    pub(super) fn call(directory: &Path, method: &str, args: Value) -> Result<Value, String> {
        #[cfg(unix)]
        let connection = Stream::connect(socket(directory));
        #[cfg(windows)]
        let (connection, token) = {
            let endpoint: Value = serde_json::from_slice(
                &fs::read(directory.join("worker/runtime.json")).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            let port = endpoint["port"]
                .as_u64()
                .filter(|p| *p > 0 && *p <= u16::MAX as u64)
                .ok_or("Invalid worker endpoint")? as u16;
            (
                Stream::connect(
                    port,
                    serde_json::from_value::<Vec<u8>>(endpoint["certificate"].clone())
                        .map_err(|e| e.to_string())?,
                ),
                endpoint["token"].as_str().map(str::to_string),
            )
        };
        let mut stream = connection.map_err(|e| {
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
            #[cfg(unix)]
            token: None,
            #[cfg(windows)]
            token,
        })
        .map_err(|e| e.to_string())?;
        payload.push(b'\n');
        stream.write_all(&payload).map_err(|e| e.to_string())?;
        stream.flush().map_err(|e| e.to_string())?;
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
    #[cfg(all(test, unix))]
    pub(super) fn quote(value: &str) -> Result<String, String> {
        service_quote(value)
    }
    #[cfg(all(test, unix))]
    pub(super) fn unit(executable: &Path, directory: &Path) -> Result<String, String> {
        Ok(format!("[Unit]\nDescription=borgd scheduled backup worker\n\n[Service]\nType=simple\nExecStart={} --worker --config-dir {}\nEnvironment=BORGD_MANAGED_SERVICE=1\nRestart=on-failure\nRestartSec=5\nKillMode=process\nTimeoutStopSec=infinity\nUMask=0077\n\n[Install]\nWantedBy=default.target\n", quote(&executable.to_string_lossy())?, quote(&directory.to_string_lossy())?))
    }
    fn connection(
        mut stream: Stream,
        backend: Backend,
        shutdown: Arc<AtomicBool>,
        token: Arc<String>,
    ) {
        let result = (|| -> Result<Value, String> {
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .map_err(|e| e.to_string())?;
            let mut bytes = Vec::new();
            BufReader::new(&mut stream)
                .take(1024 * 1024 + 1)
                .read_until(b'\n', &mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > 1024 * 1024 {
                return Err("Worker request exceeds safety limit".into());
            }
            let rpc: Rpc = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            #[cfg(windows)]
            {
                let provided = rpc.token.as_deref().unwrap_or("");
                if provided.len() != token.len()
                    || provided
                        .bytes()
                        .zip(token.bytes())
                        .fold(0u8, |difference, (a, b)| {
                            difference | std::hint::black_box(a ^ b)
                        })
                        != 0
                {
                    return Err("Worker authentication failed".into());
                }
            }
            #[cfg(unix)]
            let _ = &token;
            if rpc.method == "stop_worker" {
                shutdown.store(true, Ordering::SeqCst);
                return Ok(json!({"stopping": true}));
            }
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
            let _ = stream.flush();
        }
    }
    pub(super) fn serve(backend: Backend, shutdown: Arc<AtomicBool>) -> Result<(), String> {
        let runtime = backend.directory.join("worker");
        crate::service::private_runtime(&runtime)?;
        let mut options = OpenOptions::new();
        options.create(true).truncate(false).read(true).write(true);
        #[cfg(unix)]
        options.mode(0o600);
        let lock = options
            .open(runtime.join("runtime.lock"))
            .map_err(|e| e.to_string())?;
        lock.try_lock()
            .map_err(|_| "A worker already owns this configuration directory.".to_string())?;
        #[cfg(unix)]
        let path = socket(&backend.directory);
        #[cfg(windows)]
        let path = runtime.join("runtime.json");
        #[cfg(unix)]
        if let Ok(metadata) = fs::symlink_metadata(&path) {
            if !metadata.file_type().is_socket() {
                return Err("Refusing to replace a non-socket worker path.".into());
            }
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        #[cfg(unix)]
        let listener = Listener::bind(&path).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        let token = Arc::new(String::new());
        #[cfg(windows)]
        let (listener, token, tls) = {
            let listener =
                Listener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).map_err(|e| e.to_string())?;
            let token = Arc::new(format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ));
            if fs::symlink_metadata(&path).is_ok_and(|m| !m.is_file() || m.file_type().is_symlink())
            {
                return Err("Invalid worker endpoint file".into());
            }
            let (tls, certificate) = crate::worker_tls::server_config()?;
            if path.exists() {
                fs::remove_file(&path).map_err(|e| e.to_string())?;
            }
            fs::write(&path, serde_json::to_vec(&json!({"port": listener.local_addr().map_err(|e| e.to_string())?.port(), "token": &*token, "certificate": certificate})).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            (listener, token, tls)
        };
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
                        #[cfg(windows)]
                        let stream =
                            Stream::server(stream, tls.clone()).map_err(|e| e.to_string())?;
                        let backend = backend.clone();
                        let stop = shutdown.clone();
                        let token = token.clone();
                        connections.push(thread::spawn(move || {
                            connection(stream, backend, stop, token)
                        }));
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
        #[cfg(unix)]
        unsafe {
            libc::signal(libc::SIGTERM, stop as *const () as libc::sighandler_t);
            libc::signal(libc::SIGINT, stop as *const () as libc::sighandler_t);
        }
        if crate::service::paused(&directory) {
            return Ok(());
        }
        serve(Backend::new(directory), Arc::new(AtomicBool::new(false)))
    }
    #[cfg(all(test, unix))]
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
    #[cfg(any(unix, windows))]
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
        Some(platform::run(directory))
    }
    #[cfg(not(any(unix, windows)))]
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
