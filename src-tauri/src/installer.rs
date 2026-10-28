use serde::Serialize;
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::path::Path;
use std::{
    io::Read,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub available: bool,
    pub installed_version: Option<String>,
    pub title: String,
    pub message: String,
    pub commands: Vec<String>,
}
#[derive(Clone)]
struct Step {
    program: String,
    args: Vec<String>,
}
struct Pending {
    plan: Plan,
    steps: Vec<Step>,
    issued: Instant,
}
#[derive(Default)]
pub struct Installer {
    pub busy: AtomicBool,
    pending: Mutex<Option<Pending>>,
}
fn step(program: &str, args: &[&str]) -> Step {
    Step {
        program: program.into(),
        args: args.iter().map(|s| s.to_string()).collect(),
    }
}
#[cfg(any(target_os = "linux", test))]
fn linux_steps(manager: &str, pkexec: &str) -> Vec<Step> {
    let args: Vec<Vec<&str>> = match manager {
        "/usr/bin/apt-get" => vec![
            vec![manager, "update"],
            vec![manager, "install", "--yes", "borgbackup"],
        ],
        "/usr/bin/pacman" => vec![vec![manager, "-S", "--needed", "--noconfirm", "borg"]],
        "/usr/bin/dnf" => vec![vec![manager, "install", "--assumeyes", "borgbackup"]],
        "/usr/bin/zypper" => vec![vec![manager, "--non-interactive", "install", "borgbackup"]],
        _ => vec![],
    };
    args.iter().map(|args| step(pkexec, args)).collect()
}
#[cfg(any(target_os = "linux", test))]
fn linux_manager<'a>(release: &str, available: &[&'a str]) -> Option<&'a str> {
    let ids = release
        .lines()
        .filter_map(|line| line.split_once('='))
        .filter(|(key, _)| *key == "ID" || *key == "ID_LIKE")
        .map(|(_, value)| value.replace(['\"', '\''], "").to_lowercase())
        .collect::<Vec<_>>()
        .join(" ");
    let tokens: Vec<_> = ids.split_whitespace().collect();
    let expected = if tokens.iter().any(|t| matches!(*t, "arch" | "manjaro")) {
        "/usr/bin/pacman"
    } else if tokens.iter().any(|t| matches!(*t, "debian" | "ubuntu")) {
        "/usr/bin/apt-get"
    } else if tokens
        .iter()
        .any(|t| matches!(*t, "fedora" | "rhel" | "centos"))
    {
        "/usr/bin/dnf"
    } else if tokens
        .iter()
        .any(|t| t.starts_with("opensuse") || *t == "suse")
    {
        "/usr/bin/zypper"
    } else {
        return None;
    };
    available.iter().copied().find(|path| *path == expected)
}
fn detect() -> (String, String, Vec<Step>) {
    #[cfg(target_os = "linux")]
    {
        let candidates: Vec<_> = [
            "/usr/bin/apt-get",
            "/usr/bin/pacman",
            "/usr/bin/dnf",
            "/usr/bin/zypper",
        ]
        .into_iter()
        .filter(|p| Path::new(p).is_file())
        .collect();
        let manager = linux_manager(
            &std::fs::read_to_string("/etc/os-release").unwrap_or_default(),
            &candidates,
        );
        if let Some(manager) = manager {
            if Path::new("/usr/bin/pkexec").is_file() {
                return ("Install Borg using the system package manager".into(), "Packages and dependencies are downloaded from your configured system repositories. Your OS authorization agent may request administrator approval. No repository data or mount settings are changed. Keep borgd open until installation finishes.".into(), linux_steps(manager, "/usr/bin/pkexec"));
            }
            return ("Administrator authorization is required".into(), format!("Automatic installation requires pkexec and a running desktop authorization agent. Install Borg 1.2+ (1.x) using {manager}, or ask your administrator to enable graphical package installation."), vec![]);
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(brew) = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]
            .into_iter()
            .find(|p| Path::new(p).is_file())
        {
            return ("Install Borg using Homebrew".into(), "Homebrew will download Borg and its dependencies using your configured taps. Keep borgd open until installation finishes. The result must be compatible Borg 1.2+ (1.x).".into(), vec![step(brew, &["install", "borgbackup"])]);
        }
        ("Homebrew is required".into(), "Install Homebrew from https://brew.sh and complete its prerequisites, then reopen this installer. borgd does not run a downloaded bootstrap script or ask for your administrator password.".into(), vec![])
    }
    #[cfg(target_os = "windows")]
    {
        let found = Command::new("wsl.exe")
            .args(["--exec", "test", "-x", "/usr/bin/apt-get"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
        if found {
            return ("Install Borg inside the default WSL distribution".into(), "This updates the default WSL distribution's package index and installs Borg and its dependencies as WSL root. Windows host packages, mount settings, and repository data are not changed.".into(), vec![step("wsl.exe", &["--user", "root", "--exec", "/usr/bin/apt-get", "update"]), step("wsl.exe", &["--user", "root", "--exec", "/usr/bin/apt-get", "install", "--yes", "borgbackup"])]);
        }
        ("Set up WSL first".into(), "Install WSL using Microsoft's wsl --install, restart Windows if requested, and finish the Linux user setup. Automatic Borg installation then supports an apt-based default WSL distribution such as Ubuntu or Debian. For other distributions, install Borg 1.2+ (1.x) using their package manager.".into(), vec![])
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        ("Manual Borg setup is required".into(), "No supported system package manager was detected. Install Borg Backup 1.2+ (1.x) through your operating system's trusted package manager, then choose Check again.".into(), vec![])
    }
}
fn drain_output(mut input: impl Read) -> String {
    let mut text = String::new();
    let mut buffer = [0; 4096];
    loop {
        match input.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                text.push_str(&String::from_utf8_lossy(&buffer[..n]));
                if text.len() > 16000 {
                    text = crate::activity::bounded_text(&text, 12000).0;
                }
            }
            Err(error) => {
                text.push_str(&format!("\nCould not read installer output: {error}"));
                break;
            }
        }
    }
    text
}
impl Installer {
    pub fn plan(&self) -> Result<Plan, String> {
        if self.busy.load(Ordering::SeqCst) {
            return Err("Borg installation is already running.".into());
        }
        let installed_version = crate::engine::probe().ok();
        let (title, message, steps) = match &installed_version {
            Some(version) => (
                "Borg is already installed".into(),
                format!("{version} is compatible and ready. No software installation is needed."),
                vec![],
            ),
            None => detect(),
        };
        let plan = Plan {
            id: uuid::Uuid::new_v4().to_string(),
            available: !steps.is_empty(),
            installed_version,
            title,
            message,
            commands: steps
                .iter()
                .map(|s| format!("{} {}", s.program, s.args.join(" ")))
                .collect(),
        };
        let mut pending = self.pending.lock().unwrap();
        if self.busy.load(Ordering::SeqCst) {
            return Err("Borg installation is already running.".into());
        }
        *pending = Some(Pending {
            plan: plan.clone(),
            steps,
            issued: Instant::now(),
        });
        Ok(plan)
    }
    pub fn dismiss(&self, id: &str) {
        let mut pending = self.pending.lock().unwrap();
        if pending.as_ref().is_some_and(|plan| plan.plan.id == id) {
            *pending = None;
        }
    }
    pub fn install(&self, id: &str) -> Result<String, String> {
        self.install_with_probe(id, crate::engine::probe)
    }
    fn install_with_probe(
        &self,
        id: &str,
        probe: impl Fn() -> Result<String, String>,
    ) -> Result<String, String> {
        let steps = {
            let mut pending = self.pending.lock().unwrap();
            let plan = pending
                .as_ref()
                .ok_or("Open the installer and approve a fresh installation plan.")?;
            if plan.plan.id != id
                || plan.issued.elapsed() > Duration::from_secs(600)
                || !plan.plan.available
            {
                return Err("Installation approval is invalid, unavailable, or expired. Reopen the installer.".into());
            }
            if self.busy.swap(true, Ordering::SeqCst) {
                return Err("Borg installation is already running.".into());
            }
            pending.take().unwrap().steps
        };
        let result = (|| {
            // Another application may have installed Borg after the preview was approved.
            if let Ok(version) = probe() {
                return Ok(version);
            }
            for step in steps {
                let mut command = Command::new(&step.program);
                crate::host::configure(&mut command);
                let mut child = command
                    .args(&step.args)
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn()
                    .map_err(|e| format!("Cannot start the system package installer: {e}"))?;
                let stdout = child.stdout.take().unwrap();
                let stderr = child.stderr.take().unwrap();
                // Drain both pipes completely without retaining unbounded package/build logs.
                let out = std::thread::spawn(move || drain_output(stdout));
                let err = std::thread::spawn(move || drain_output(stderr));
                let status = child.wait().map_err(|e| e.to_string())?;
                let text = format!(
                    "{}\n{}",
                    out.join().unwrap_or_default(),
                    err.join().unwrap_or_default()
                );
                if !status.success() {
                    return Err(format!("Package installation did not complete ({}). Administrator authorization may have been cancelled, or the package manager may need attention.\n{}", status, crate::activity::bounded_text(&text, 8000).0));
                }
            }
            probe().map_err(|error| format!("The package manager finished, but compatible Borg could not be verified. No backup operation was started. {error}"))
        })();
        self.busy.store(false, Ordering::SeqCst);
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn package_plans_use_fixed_trusted_commands_without_shells_or_system_upgrades() {
        let steps = linux_steps("/usr/bin/pacman", "/usr/bin/pkexec");
        assert_eq!(steps[0].program, "/usr/bin/pkexec");
        assert_eq!(
            steps[0].args,
            ["/usr/bin/pacman", "-S", "--needed", "--noconfirm", "borg"]
        );
        assert!(linux_steps("untrusted-manager", "/usr/bin/pkexec").is_empty());
        assert_eq!(linux_steps("/usr/bin/apt-get", "/usr/bin/pkexec").len(), 2);
    }
    #[test]
    fn installer_output_is_bounded_while_retaining_the_final_cause() {
        let text = format!("initial message\n{}\nfinal diagnostic", "x".repeat(100000));
        let output = drain_output(std::io::Cursor::new(text));
        assert!(output.len() <= 16000);
        assert!(output.contains("initial message"));
        assert!(output.contains("final diagnostic"));
    }
    #[test]
    fn selects_the_native_manager_not_an_unrelated_installed_tool() {
        let available = [
            "/usr/bin/apt-get",
            "/usr/bin/pacman",
            "/usr/bin/dnf",
            "/usr/bin/zypper",
        ];
        assert_eq!(
            linux_manager("ID=arch\n", &available),
            Some("/usr/bin/pacman")
        );
        assert_eq!(
            linux_manager("ID=mint\nID_LIKE=\"ubuntu debian\"", &available),
            Some("/usr/bin/apt-get")
        );
        assert_eq!(linux_manager("ID=unknown", &available), None);
    }
    #[test]
    #[cfg(unix)]
    fn a_failed_installer_releases_busy_state_and_consumes_approval_without_privileges() {
        let installer = Installer::default();
        *installer.pending.lock().unwrap() = Some(Pending {
            plan: Plan {
                id: "test-token".into(),
                available: true,
                installed_version: None,
                title: "Test".into(),
                message: String::new(),
                commands: vec![],
            },
            steps: vec![step(
                "/bin/sh",
                &["-c", "printf simulated-failure >&2; exit 23"],
            )],
            issued: Instant::now(),
        });
        assert!(installer
            .install_with_probe("test-token", || Err("simulated missing Borg".into()))
            .err()
            .unwrap()
            .contains("simulated-failure"));
        assert!(!installer.busy.load(Ordering::SeqCst));
        assert!(installer.install("test-token").is_err());
    }
    #[test]
    #[cfg(unix)]
    fn compatible_borg_skips_installation_and_new_installations_are_reprobed() {
        for already_present in [true, false] {
            let installer = Installer::default();
            let program = if already_present {
                "/nonexistent-must-never-execute"
            } else {
                "/bin/true"
            };
            *installer.pending.lock().unwrap() = Some(Pending {
                plan: Plan {
                    id: "test-token".into(),
                    available: true,
                    installed_version: None,
                    title: "Test".into(),
                    message: String::new(),
                    commands: vec![],
                },
                steps: vec![step(program, &[])],
                issued: Instant::now(),
            });
            let probes = std::sync::atomic::AtomicUsize::new(0);
            let result = installer.install_with_probe("test-token", || {
                let count = probes.fetch_add(1, Ordering::SeqCst);
                if already_present || count > 0 {
                    Ok("borg 1.4.5".into())
                } else {
                    Err("not installed".into())
                }
            });
            assert_eq!(result.unwrap(), "borg 1.4.5");
            assert_eq!(
                probes.load(Ordering::SeqCst),
                if already_present { 1 } else { 2 }
            );
            assert!(!installer.busy.load(Ordering::SeqCst));
            assert!(installer.install("test-token").is_err());
        }
    }
    #[test]
    fn invalid_approval_never_executes_a_package_manager() {
        let installer = Installer::default();
        assert!(installer.install("not-approved").is_err());
        let plan = installer.plan().unwrap();
        assert!(installer.install("forged-token").is_err());
        assert!(!installer.busy.load(Ordering::SeqCst));
        assert_ne!(plan.id, "forged-token");
        {
            let mut pending = installer.pending.lock().unwrap();
            let approval = pending.as_mut().unwrap();
            approval.plan.available = true;
            approval.issued = Instant::now() - Duration::from_secs(601);
        }
        assert!(installer.install(&plan.id).is_err());
        let fresh = installer.plan().unwrap();
        installer.dismiss(&fresh.id);
        assert!(installer.install(&fresh.id).is_err());
    }
}
