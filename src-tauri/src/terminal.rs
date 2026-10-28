use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    sync::{
        atomic::{AtomicU32, Ordering},
        mpsc::{sync_channel, SyncSender},
        Arc, Mutex,
    },
};

const OUTPUT_LIMIT: usize = 1024 * 1024;
const SESSION_LIMIT: usize = 12;
#[derive(Default)]
struct Buffer {
    bytes: VecDeque<u8>,
    exited: bool,
    exit_code: Option<u32>,
    dropped: bool,
    exited_at: Option<std::time::Instant>,
}
struct Session {
    master: Box<dyn MasterPty + Send>,
    input: SyncSender<Vec<u8>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    output: Arc<Mutex<Buffer>>,
}
#[derive(Default)]
pub struct Terminals {
    sessions: Mutex<HashMap<u32, Session>>,
    next: AtomicU32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    id: u32,
    shell: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    data: Vec<u8>,
    exited: bool,
    exit_code: Option<u32>,
    dropped: bool,
}
fn size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if !(2..=500).contains(&cols) || !(1..=250).contains(&rows) {
        return Err("Invalid terminal dimensions.".into());
    }
    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}
impl Terminals {
    pub fn create(&self, cols: u16, rows: u16) -> Result<Started, String> {
        let mut sessions = self.sessions.lock().unwrap();
        if sessions.len() >= SESSION_LIMIT {
            return Err("Close a terminal tab before opening another (maximum 12).".into());
        }
        #[cfg(windows)]
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
        #[cfg(not(windows))]
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|s| std::path::Path::new(s).is_file())
            .unwrap_or_else(|| "/bin/bash".into());
        let pair = native_pty_system()
            .openpty(size(cols, rows)?)
            .map_err(|e| e.to_string())?;
        let mut command = CommandBuilder::new(&shell);
        #[cfg(not(windows))]
        command.arg("-l");
        for (key, value) in crate::host::environment() {
            if let Some(value) = value {
                command.env(key, value);
            } else {
                command.env_remove(key);
            }
        }
        // Never expose Borg's session passphrases to the shell environment.
        for key in [
            "BORG_PASSPHRASE",
            "BORG_PASSCOMMAND",
            "BORG_PASSPHRASE_FD",
            "BORG_NEW_PASSPHRASE",
        ] {
            command.env_remove(key);
        }
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
            command.cwd(home);
        }
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let child = Arc::new(Mutex::new(
            pair.slave
                .spawn_command(command)
                .map_err(|e| e.to_string())?,
        ));
        drop(pair.slave);
        // A stopped shell must not block IPC or input/output in other tabs.
        let (input, pending) = sync_channel::<Vec<u8>>(64);
        std::thread::spawn(move || {
            while let Ok(bytes) = pending.recv() {
                if writer
                    .write_all(&bytes)
                    .and_then(|_| writer.flush())
                    .is_err()
                {
                    break;
                }
            }
        });
        let output = Arc::new(Mutex::new(Buffer::default()));
        let received = output.clone();
        std::thread::spawn(move || {
            let mut bytes = [0u8; 8192];
            loop {
                match reader.read(&mut bytes) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        let mut buffer = received.lock().unwrap();
                        buffer.bytes.extend(&bytes[..count]);
                        if buffer.bytes.len() > OUTPUT_LIMIT {
                            let extra = buffer.bytes.len() - OUTPUT_LIMIT;
                            buffer.bytes.drain(..extra);
                            buffer.dropped = true;
                        }
                    }
                }
            }
            received.lock().unwrap().exited = true;
        });
        let waited = output.clone();
        let reaped = child.clone();
        std::thread::spawn(move || loop {
            // Share ownership with close(): never signal a reaped/reused process ID.
            let result = reaped.lock().unwrap().try_wait();
            match result {
                Ok(Some(status)) => {
                    let mut buffer = waited.lock().unwrap();
                    buffer.exit_code = Some(status.exit_code());
                    buffer.exited_at = Some(std::time::Instant::now());
                    break;
                }
                Err(_) => {
                    waited.lock().unwrap().exited = true;
                    break;
                }
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(25)),
            }
        });
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        sessions.insert(
            id,
            Session {
                master: pair.master,
                input,
                child,
                output,
            },
        );
        Ok(Started { id, shell })
    }
    pub fn write(&self, id: u32, data: String) -> Result<(), String> {
        if data.len() > 64 * 1024 {
            return Err("Paste is too large (maximum 64 KiB per input).".into());
        }
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(&id).ok_or("Terminal session not found.")?;
        session
            .input
            .try_send(data.into_bytes())
            .map_err(|e| format!("Terminal input unavailable: {e}"))
    }
    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        sessions
            .get(&id)
            .ok_or("Terminal session not found.")?
            .master
            .resize(size(cols, rows)?)
            .map_err(|e| e.to_string())
    }
    pub fn read(&self, id: u32) -> Result<Output, String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(&id).ok_or("Terminal session not found.")?;
        let mut output = session.output.lock().unwrap();
        let count = output.bytes.len().min(64 * 1024);
        // ConPTY may keep its output pipe open after the child exits. Allow its
        // final output to arrive before reporting exit without requiring pipe EOF.
        let child_exited = output
            .exited_at
            .is_some_and(|at| at.elapsed() >= std::time::Duration::from_millis(150));
        let exited = (output.exited || child_exited) && count == output.bytes.len();
        Ok(Output {
            data: output.bytes.drain(..count).collect(),
            exited,
            exit_code: output.exit_code,
            dropped: std::mem::take(&mut output.dropped),
        })
    }
    pub fn close(&self, id: u32) -> Result<(), String> {
        let session = self
            .sessions
            .lock()
            .unwrap()
            .remove(&id)
            .ok_or("Terminal session not found.")?;
        {
            let mut child = session.child.lock().unwrap();
            if matches!(child.try_wait(), Ok(None)) {
                let _ = child.kill();
            }
        }
        // Dropping the PTY hangs up the shell/foreground process; waiter reaps it.
        drop(session);
        Ok(())
    }
    pub fn close_all(&self) {
        let sessions = std::mem::take(&mut *self.sessions.lock().unwrap());
        for (_, session) in sessions {
            let mut child = session.child.lock().unwrap();
            if matches!(child.try_wait(), Ok(None)) {
                let _ = child.kill();
            }
        }
    }
}
impl Drop for Terminals {
    fn drop(&mut self) {
        self.close_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_shell_tabs_input_resize_exit_and_cleanup() {
        let terminals = Terminals::default();
        let first = terminals.create(80, 24).unwrap();
        let second = terminals.create(100, 30).unwrap();
        assert_ne!(first.id, second.id);
        terminals.resize(first.id, 110, 40).unwrap();
        assert_eq!(
            terminals.sessions.lock().unwrap()[&first.id]
                .master
                .get_size()
                .unwrap()
                .cols,
            110
        );
        #[cfg(windows)]
        for id in [first.id, second.id] {
            // ConPTY waits for the terminal's cursor-position reply before starting the shell.
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            let mut startup = String::new();
            while std::time::Instant::now() < deadline {
                startup.push_str(&String::from_utf8_lossy(&terminals.read(id).unwrap().data));
                if startup.contains("\u001b[6n") {
                    terminals.write(id, "\u001b[1;1R".into()).unwrap();
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
        }
        #[cfg(unix)]
        terminals
            .write(
                first.id,
                "printf '\\137\\137BORG_TERMINAL_OK\\137\\137\\n'\r".into(),
            )
            .unwrap();
        #[cfg(windows)]
        terminals
            .write(first.id, "echo __BORG_TERMINAL_OK__\r".into())
            .unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let mut text = String::new();
        while !text.contains("__BORG_TERMINAL_OK__") && std::time::Instant::now() < deadline {
            text.push_str(&String::from_utf8_lossy(
                &terminals.read(first.id).unwrap().data,
            ));
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert!(
            text.contains("__BORG_TERMINAL_OK__"),
            "Shell output: {text}"
        );
        terminals.close(first.id).unwrap();
        assert!(terminals.read(first.id).is_err());
        assert!(terminals.read(second.id).is_ok());
        #[cfg(unix)]
        {
            terminals.write(second.id, "sleep 30\r".into()).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(200));
            terminals.write(second.id, "\x03".into()).unwrap();
            terminals
                .write(
                    second.id,
                    "printf '\\137\\137INTERRUPTED_OK\\137\\137\\n'\r".into(),
                )
                .unwrap();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            let mut text = String::new();
            while !text.contains("__INTERRUPTED_OK__") && std::time::Instant::now() < deadline {
                text.push_str(&String::from_utf8_lossy(
                    &terminals.read(second.id).unwrap().data,
                ));
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            assert!(
                text.contains("__INTERRUPTED_OK__"),
                "Ctrl-C did not return control to the shell: {text}"
            );
        }
        terminals.write(second.id, "exit\r".into()).unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !terminals.read(second.id).unwrap().exited && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert!(terminals.read(second.id).unwrap().exited);
        terminals.close_all();
        assert!(terminals.sessions.lock().unwrap().is_empty());
        assert!(size(0, 0).is_err());
    }
}
