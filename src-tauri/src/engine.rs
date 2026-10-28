use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::{BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub id: String,
    pub name: String,
    pub location: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub repository_id: String,
    pub sources: Vec<String>,
    pub excludes: Vec<String>,
    pub keep_daily: u16,
    pub keep_weekly: u16,
    pub keep_monthly: u16,
    pub interval_hours: u16,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default)]
    pub onboarding_complete: bool,
    pub repositories: Vec<Repository>,
    pub profiles: Vec<Profile>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub details_available: bool,
    #[serde(default)]
    pub repository_name: Option<String>,
    #[serde(default)]
    pub repository_location: Option<String>,
    #[serde(default)]
    pub profile_name: Option<String>,
    pub time: String,
    pub action: String,
    pub repository_id: String,
    pub profile_id: Option<String>,
    pub exit_code: i32,
    pub message: String,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    #[serde(skip)]
    exit_code: Option<i32>,
    #[serde(skip)]
    log_dropped: bool,
    pub busy: bool,
    pub action: String,
    pub logs: VecDeque<String>,
    pub history: Vec<History>,
    pub unlocked: Vec<String>,
    pub relocation: Option<crate::relocation::Pending>,
}
#[derive(Clone)]
pub struct Backend {
    pub directory: PathBuf,
    pub status: Arc<Mutex<Status>>,
    secrets: Arc<Mutex<HashMap<String, String>>>,
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub action: String,
    pub repository_id: String,
    pub profile_id: Option<String>,
    pub archive: Option<String>,
    pub destination: Option<String>,
    pub encrypted: Option<bool>,
    pub dry_run: Option<bool>,
    pub selected_paths: Option<Vec<String>>,
    pub compare_archive: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub exit_code: i32,
    pub data: Value,
    pub text: String,
}

pub fn validate(config: &Config) -> Result<(), String> {
    let safe_id = |id: &str| {
        !id.is_empty()
            && id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    };
    let mut ids = std::collections::HashSet::new();
    for repo in &config.repositories {
        if !safe_id(&repo.id) || !ids.insert(&repo.id) || repo.name.trim().is_empty() {
            return Err("Repository names and unique IDs are required.".into());
        }
        if repo.location.trim().is_empty()
            || repo.location.starts_with('-')
            || repo.location.contains("::")
            || repo.location.contains('\0')
            || !(repo.location.starts_with('/') || repo.location.starts_with("ssh://"))
        {
            return Err("Use an absolute repository path or ssh://user@host/path URL. Windows paths must use WSL syntax (/mnt/c/...).".into());
        }
    }
    let mut profile_ids = std::collections::HashSet::new();
    for profile in &config.profiles {
        if !safe_id(&profile.id)
            || !profile_ids.insert(&profile.id)
            || profile.name.trim().is_empty()
        {
            return Err("Profile names and unique IDs are required.".into());
        }
        if !ids.contains(&profile.repository_id) {
            return Err("Profile repository does not exist.".into());
        }
        if profile.sources.is_empty()
            || profile
                .sources
                .iter()
                .any(|p| !p.starts_with('/') || p.contains('\0'))
        {
            return Err("Choose at least one absolute source path (WSL paths on Windows).".into());
        }
        if profile.keep_daily == 0 && profile.keep_weekly == 0 && profile.keep_monthly == 0 {
            return Err("Keep at least one daily, weekly, or monthly archive.".into());
        }
    }
    Ok(())
}

impl Backend {
    pub fn new(directory: PathBuf) -> Self {
        let history = fs::read(directory.join("history.json"))
            .ok()
            .and_then(|v| serde_json::from_slice(&v).ok())
            .unwrap_or_default();
        Self {
            directory,
            status: Arc::new(Mutex::new(Status {
                history,
                ..Status::default()
            })),
            secrets: Default::default(),
        }
    }
    pub fn schedule_attempts(&self) -> Result<HashMap<String, String>, String> {
        match fs::read(self.directory.join("schedule-attempts.json")) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).map_err(|e| format!("Invalid schedule state: {e}"))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
            Err(error) => Err(error.to_string()),
        }
    }
    pub fn config(&self) -> Result<Config, String> {
        let path = self.directory.join("config.json");
        if !path.exists() {
            return Ok(Config::default());
        }
        let mut config: Config =
            serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        config.onboarding_complete |=
            !config.repositories.is_empty() || !config.profiles.is_empty();
        Ok(config)
    }
    pub fn save(&self, mut config: Config) -> Result<(), String> {
        let mut status = self.status.lock().unwrap();
        if status.busy {
            return Err("Wait for the active operation before changing settings.".into());
        }
        validate(&config)?;
        config.onboarding_complete |= self.config()?.onboarding_complete
            || !config.repositories.is_empty()
            || !config.profiles.is_empty()
            || !status.history.is_empty();
        atomic_json(&self.directory, "config.json", &config)?;
        let exists = |id: &String| config.repositories.iter().any(|r| &r.id == id);
        self.secrets.lock().unwrap().retain(|id, _| exists(id));
        status.unlocked.retain(exists);
        status.relocation = None;
        Ok(())
    }
    pub fn unlock(&self, id: String, passphrase: String) -> Result<(), String> {
        if !self.config()?.repositories.iter().any(|r| r.id == id) {
            return Err("Repository not found.".into());
        }
        self.secrets.lock().unwrap().insert(id.clone(), passphrase);
        let mut status = self.status.lock().unwrap();
        if !status.unlocked.contains(&id) {
            status.unlocked.push(id);
        }
        Ok(())
    }
    pub fn lock_repository(&self, id: &str) -> Result<(), String> {
        let mut status = self.status.lock().unwrap();
        if status.busy {
            return Err("Wait for the active operation before locking a repository.".into());
        }
        self.secrets.lock().unwrap().remove(id);
        status.unlocked.retain(|r| r != id);
        Ok(())
    }
    fn log(&self, line: String) {
        let mut status = self.status.lock().unwrap();
        status.logs.push_back(line);
        while status.logs.len() > 800 {
            status.logs.pop_front();
            status.log_dropped = true;
        }
    }
    pub fn execute(&self, request: Request) -> Result<Output, String> {
        self.execute_authorized(request, None)
    }
    pub fn confirm_relocation(&self, token: String) -> Result<Output, String> {
        let request = self
            .status
            .lock()
            .unwrap()
            .relocation
            .as_ref()
            .ok_or("Relocation confirmation is no longer available. Run the operation again.")?
            .request
            .clone();
        self.execute_authorized(request, Some(token))
    }
    pub fn dismiss_relocation(&self, token: &str) {
        let mut status = self.status.lock().unwrap();
        if status
            .relocation
            .as_ref()
            .is_some_and(|p| p.challenge.token == token)
        {
            status.relocation = None;
        }
    }
    fn execute_authorized(
        &self,
        request: Request,
        token: Option<String>,
    ) -> Result<Output, String> {
        let approval = {
            let mut status = self.status.lock().unwrap();
            if status.busy {
                return Err("Another Borg operation is running.".into());
            }
            let approval = if let Some(token) = token {
                let pending = status.relocation.as_ref().ok_or(
                    "Relocation confirmation is no longer available. Run the operation again.",
                )?;
                if pending.issued_at.elapsed().as_secs() >= 300 {
                    status.relocation = None;
                    return Err("Relocation confirmation expired. Run the operation again.".into());
                }
                if pending.challenge.token != token || pending.request != request {
                    return Err(
                        "Relocation confirmation is invalid or expired. Run the operation again."
                            .into(),
                    );
                }
                Some((pending.challenge.paths.clone(), pending.location.clone()))
            } else {
                None
            };
            // Consume the grant under the same lock that reserves the single running operation.
            status.relocation = None;
            status.busy = true;
            status.action = request.action.clone();
            status.logs.clear();
            status.exit_code = None;
            status.log_dropped = false;
            approval
        };
        let context = self.config().ok();
        let repository = context
            .as_ref()
            .and_then(|c| {
                c.repositories
                    .iter()
                    .find(|r| r.id == request.repository_id)
            })
            .cloned();
        let profile = context
            .as_ref()
            .and_then(|c| {
                c.profiles
                    .iter()
                    .find(|p| Some(&p.id) == request.profile_id.as_ref())
            })
            .cloned();
        let result = self.execute_inner(
            &request,
            approval.as_ref().map(|(_, location)| location.as_str()),
        );
        let (exit_code, message) = match &result {
            Ok(out) => (
                out.exit_code,
                if out.exit_code == 0 {
                    "Completed".into()
                } else {
                    "Completed with warnings. Review the activity log.".into()
                },
            ),
            Err(error) => (
                self.status
                    .lock()
                    .unwrap()
                    .exit_code
                    .filter(|code| *code > 1)
                    .unwrap_or(2),
                error.clone(),
            ),
        };
        self.log(message.clone());
        let mut status = self.status.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let mut entry = History {
            id: Some(id.clone()),
            details_available: true,
            repository_name: repository.as_ref().map(|r| r.name.clone()),
            repository_location: repository.as_ref().map(|r| r.location.clone()),
            profile_name: profile.as_ref().map(|p| p.name.clone()),
            time: Utc::now().to_rfc3339(),
            action: request.action.clone(),
            repository_id: request.repository_id.clone(),
            profile_id: request.profile_id.clone(),
            exit_code,
            message,
        };
        if request.action == "backup" {
            if let Some(id) = request.profile_id.as_ref() {
                let recorded = self.schedule_attempts().and_then(|mut attempts| {
                    attempts.insert(
                        format!("{}:{id}", request.repository_id),
                        entry.time.clone(),
                    );
                    let config = self.config()?;
                    attempts.retain(|key, _| {
                        config
                            .profiles
                            .iter()
                            .any(|p| *key == format!("{}:{}", p.repository_id, p.id))
                    });
                    atomic_json(&self.directory, "schedule-attempts.json", &attempts)
                });
                if let Err(error) = recorded {
                    status
                        .logs
                        .push_back(format!("Could not persist schedule timestamp: {error}"));
                }
            }
        }
        let (log, log_truncated) = crate::activity::bounded_text(
            &status.logs.iter().cloned().collect::<Vec<_>>().join("\n"),
            128 * 1024,
        );
        let (output, output_truncated) = crate::activity::bounded_text(
            result
                .as_ref()
                .map(|out| out.text.as_str())
                .unwrap_or_default(),
            128 * 1024,
        );
        let details = crate::activity::Details {
            entry: entry.clone(),
            request,
            repository,
            profile,
            log,
            output,
            truncated: log_truncated || output_truncated || status.log_dropped,
            process_exit_code: status.exit_code,
            relocation_confirmation: approval.map(|(paths, _)| paths),
        };
        if let Err(error) = atomic_json(
            &self.directory.join("activity"),
            &format!("{id}.json"),
            &details,
        ) {
            entry.details_available = false;
            status
                .logs
                .push_back(format!("Could not persist operation details: {error}"));
        }
        status.history.insert(0, entry);
        let expired: Vec<_> = status
            .history
            .iter()
            .skip(200)
            .filter_map(|h| h.id.clone())
            .collect();
        status.history.truncate(200);
        match atomic_json(&self.directory, "history.json", &status.history) {
            Ok(()) => {
                for id in expired {
                    if uuid::Uuid::parse_str(&id).is_ok() {
                        let _ = fs::remove_file(
                            self.directory.join("activity").join(format!("{id}.json")),
                        );
                    }
                }
            }
            Err(error) => status
                .logs
                .push_back(format!("Could not persist history: {error}")),
        }
        status.busy = false;
        result
    }
    pub fn history_details(&self, id: &str) -> Result<crate::activity::Details, String> {
        if uuid::Uuid::parse_str(id).is_err() {
            return Err("Invalid operation ID.".into());
        }
        if !self
            .status
            .lock()
            .unwrap()
            .history
            .iter()
            .any(|h| h.id.as_deref() == Some(id) && h.details_available)
        {
            return Err("Detailed log is not available for this operation.".into());
        }
        let path = self.directory.join("activity").join(format!("{id}.json"));
        serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    }
    fn archive_code(&self, profile_id: &str) -> Result<String, String> {
        let path = self.directory.join("archive-codes.json");
        let mut codes: HashMap<String, String> = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| format!("Invalid archive ownership codes: {e}"))?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(error) => return Err(error.to_string()),
        };
        let mut unique = std::collections::HashSet::new();
        for code in codes.values() {
            if code.len() != 6
                || !code
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
                || !unique.insert(code.clone())
            {
                return Err("Archive ownership codes are invalid or duplicated; no backup or prune was run.".into());
            }
        }
        if let Some(code) = codes.get(profile_id) {
            return Ok(code.clone());
        }
        let profile_ids = self
            .config()?
            .profiles
            .into_iter()
            .map(|p| p.id)
            .collect::<std::collections::HashSet<_>>();
        let leading: String = profile_id
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .take(6)
            .collect();
        let mut selected = None;
        for attempt in 0usize..4096 {
            let prefix_len = leading.len().saturating_sub(attempt.div_ceil(36));
            let random = uuid::Uuid::new_v4();
            let mut code = leading[..prefix_len].to_owned();
            code.extend(
                random.as_bytes()[..6 - prefix_len]
                    .iter()
                    .map(|b| b"0123456789abcdefghijklmnopqrstuvwxyz"[usize::from(*b) % 36] as char),
            );
            if !unique.contains(&code) && !profile_ids.contains(&code) {
                selected = Some(code);
                break;
            }
        }
        let code = selected.ok_or("Could not allocate a unique archive code")?;
        codes.insert(profile_id.to_owned(), code.clone());
        atomic_json(&self.directory, "archive-codes.json", &codes)?;
        Ok(code)
    }
    fn execute_inner(&self, request: &Request, approval: Option<&str>) -> Result<Output, String> {
        self.execute_namespace(request, approval, None)
    }
    fn execute_namespace(
        &self,
        request: &Request,
        approval: Option<&str>,
        namespace: Option<&str>,
    ) -> Result<Output, String> {
        probe()?;
        let config = self.config()?;
        validate(&config)?;
        let repo = config
            .repositories
            .iter()
            .find(|r| r.id == request.repository_id)
            .ok_or("Repository not found.")?;
        if approval.is_some_and(|location| location != repo.location) {
            return Err("Repository location changed. Run the operation again before confirming relocation.".into());
        }
        let profile = || {
            config
                .profiles
                .iter()
                .find(|p| Some(&p.id) == request.profile_id.as_ref() && p.repository_id == repo.id)
                .ok_or("Backup profile not found.")
        };
        if request.action == "prune" && namespace.is_none() {
            let p = profile()?;
            let code = self.archive_code(&p.id)?;
            let common: String =
                p.id.chars()
                    .zip(code.chars())
                    .take_while(|(a, b)| a == b)
                    .map(|(a, _)| a)
                    .collect();
            let prefix = format!("borgd-{common}");
            let legacy = format!("borgd-{}-", p.id);
            let current = format!("borgd-{code}-");
            let mut listing_request = request.clone();
            listing_request.action = "archives".into();
            let listing = self.execute_namespace(&listing_request, approval, None)?;
            if listing.exit_code != 0 {
                return Err("Could not verify a complete archive ownership listing; no pruning was performed.".into());
            }
            // Borg 1.x cannot union archive-name globs. Verify the entire shared prefix
            // before pruning a single combined pool, preserving exact retention policy.
            for archive in listing.data["archives"]
                .as_array()
                .ok_or("Missing archive ownership listing")?
            {
                let name = archive["name"]
                    .as_str()
                    .ok_or("Invalid archive ownership listing")?;
                if name.starts_with(&prefix)
                    && !name.starts_with(&legacy)
                    && !name.starts_with(&current)
                {
                    return Err("Retention prefix overlaps an unrelated archive. No pruning was performed; rename that unrelated archive or use Borg manually with an explicit selection.".into());
                }
            }
            return self.execute_namespace(request, approval, Some(&format!("{prefix}*")));
        }
        let archive = || -> Result<String, String> {
            let name = request.archive.as_ref().ok_or("Choose an archive.")?;
            if name.is_empty()
                || name.starts_with('-')
                || name.contains(['/', '\\', '\0'])
                || name.contains("::")
            {
                return Err("Invalid archive name.".into());
            }
            Ok(format!("{}::{}", repo.location, name))
        };
        let mut args: Vec<String> = vec![];
        let mut cwd = None;
        match request.action.as_str() {
            "init" => {
                let encryption = if request.encrypted.unwrap_or(true) {
                    "repokey-blake2"
                } else {
                    "none"
                };
                if encryption != "none"
                    && self
                        .secrets
                        .lock()
                        .unwrap()
                        .get(&repo.id)
                        .is_none_or(|s| s.is_empty())
                {
                    return Err(
                        "Enter a non-empty passphrase before creating an encrypted repository."
                            .into(),
                    );
                }
                args.extend([
                    "init".into(),
                    format!("--encryption={encryption}"),
                    repo.location.clone(),
                ]);
            }
            "info" => args.extend(["info".into(), "--json".into(), repo.location.clone()]),
            "archives" => args.extend([
                "info".into(),
                "--json".into(),
                "--glob-archives".into(),
                "*".into(),
                repo.location.clone(),
            ]),
            "files" => args.extend(["list".into(), "--json-lines".into(), archive()?]),
            "diff" => {
                let second = request
                    .compare_archive
                    .as_deref()
                    .ok_or("Choose a comparison archive")?;
                if second.is_empty()
                    || second.starts_with('-')
                    || second.contains(['/', '\\', '\0'])
                    || second.contains("::")
                {
                    return Err("Invalid comparison archive name".into());
                }
                if request.archive.as_deref() == Some(second) {
                    return Err("Choose two different archives".into());
                }
                args.extend([
                    "diff".into(),
                    "--json-lines".into(),
                    "--sort".into(),
                    archive()?,
                    second.into(),
                ]);
            }
            "backup" => {
                let p = profile()?;
                let name = format!(
                    "borgd-{}-{}",
                    self.archive_code(&p.id)?,
                    Utc::now().format("%Y-%m-%dT%H-%M-%S%.3f")
                );
                args.extend([
                    "create".into(),
                    "--json".into(),
                    "--stats".into(),
                    "--progress".into(),
                    "--compression=lz4".into(),
                ]);
                for pattern in &p.excludes {
                    args.extend(["--exclude".into(), pattern.clone()]);
                }
                args.push(format!("{}::{}", repo.location, name));
                args.extend(p.sources.clone());
            }
            "check" => args.extend(["check".into(), "--progress".into(), repo.location.clone()]),
            "prune" => {
                let p = profile()?;
                // Scope retention to this profile; never prune unrelated archives.
                args.extend([
                    "prune".into(),
                    "--list".into(),
                    "--glob-archives".into(),
                    namespace
                        .map(str::to_owned)
                        .unwrap_or_else(|| format!("borgd-{}-*", p.id)),
                    format!("--keep-daily={}", p.keep_daily),
                    format!("--keep-weekly={}", p.keep_weekly),
                    format!("--keep-monthly={}", p.keep_monthly),
                ]);
                if request.dry_run.unwrap_or(true) {
                    args.push("--dry-run".into());
                }
                args.push(repo.location.clone());
            }
            "restore" => {
                let destination = request
                    .destination
                    .as_ref()
                    .ok_or("Choose a restore destination.")?;
                let path = Path::new(destination);
                #[cfg(not(target_os = "windows"))]
                {
                    if !path.is_absolute() || !path.is_dir() {
                        return Err(
                            "Restore destination must be an existing absolute directory.".into(),
                        );
                    }
                    if fs::read_dir(path)
                        .map_err(|e| e.to_string())?
                        .next()
                        .is_some()
                    {
                        return Err(
                            "Choose an empty restore directory to avoid overwriting files.".into(),
                        );
                    }
                }
                #[cfg(target_os = "windows")]
                {
                    let _ = path;
                    // Validate inside WSL: Windows cannot inspect a Linux filesystem path.
                    let checked = Command::new("wsl.exe").args(["--exec", "python3", "-c",
                        "import os,sys; p=sys.argv[1]; sys.exit(0 if os.path.isabs(p) and os.path.isdir(p) and not os.listdir(p) else 1)", destination])
                        .stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
                    if !checked.status.success() {
                        return Err("Choose an existing empty WSL directory for restore.".into());
                    }
                }
                cwd = Some(PathBuf::from(destination));
                args.extend(["extract".into(), "--progress".into()]);
                if let Some(paths) = &request.selected_paths {
                    if paths.is_empty() || paths.len() > 1000 {
                        return Err("Select between 1 and 1000 archive paths.".into());
                    }
                    for selected in paths {
                        if selected.is_empty()
                            || selected.starts_with('/')
                            || selected.contains(['\\', '\0'])
                            || selected
                                .split('/')
                                .any(|part| part.is_empty() || part == "." || part == "..")
                        {
                            return Err(
                                "Selected restore paths must be safe relative archive paths."
                                    .into(),
                            );
                        }
                        // Literal prefix patterns include a folder's descendants, never similarly named siblings or glob matches.
                        args.push(format!("--pattern=+pp:{selected}"));
                    }
                    args.push("--pattern=-re:.*".into());
                }
                args.push(archive()?);
            }
            _ => return Err("Unsupported operation.".into()),
        }
        self.log(format!("{}: {}", request.action, repo.name));
        let mut command = borg_command_at(cwd.as_deref());
        command
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // Never inherit ambient passphrase commands, repository overrides, or unsafe confirmations.
        for key in [
            "BORG_PASSPHRASE",
            "BORG_PASSCOMMAND",
            "BORG_PASSPHRASE_FD",
            "BORG_NEW_PASSPHRASE",
            "BORG_REPO",
            "BORG_RSH",
            "BORG_REMOTE_PATH",
            "BORG_UNKNOWN_UNENCRYPTED_REPO_ACCESS_IS_OK",
            "BORG_RELOCATED_REPO_ACCESS_IS_OK",
        ] {
            command.env_remove(key);
        }
        command.env("BORG_EXIT_CODES", "legacy");
        command.env("TZ", "UTC");
        command.env(
            "BORG_RELOCATED_REPO_ACCESS_IS_OK",
            if approval.is_some() { "yes" } else { "no" },
        );
        command.env("BORG_RSH", "ssh -oBatchMode=yes -oConnectTimeout=20");
        command.env(
            "BORG_PASSPHRASE",
            self.secrets
                .lock()
                .unwrap()
                .get(&repo.id)
                .cloned()
                .unwrap_or_default(),
        );
        let mut child = command.spawn().map_err(|e| format!("Cannot start Borg 1.x. Install Borg (or Borg inside the default WSL distribution on Windows). {e}"))?;
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let backend = self.clone();
        let log_reader = std::thread::spawn(move || {
            let mut line = Vec::with_capacity(3000);
            // Split both progress carriage returns and normal log newlines as they arrive.
            for byte in BufReader::new(stderr).bytes().map_while(Result::ok) {
                if byte == b'\n' || byte == b'\r' {
                    if !line.is_empty() {
                        backend.log(String::from_utf8_lossy(&line).into());
                        line.clear();
                    }
                } else {
                    line.push(byte);
                    if line.len() >= 3000 {
                        backend.log(String::from_utf8_lossy(&line).into());
                        line.clear();
                    }
                }
            }
            if !line.is_empty() {
                backend.log(String::from_utf8_lossy(&line).into());
            }
        });
        let output_reader = std::thread::spawn(move || {
            let mut data = Vec::new();
            let result = stdout.take(32 * 1024 * 1024 + 1).read_to_end(&mut data);
            (result, data)
        });
        let exit = child.wait().map_err(|e| e.to_string())?;
        let code = exit.code().unwrap_or(2);
        self.status.lock().unwrap().exit_code = exit.code();
        let _ = log_reader.join();
        let (read_result, bytes) = output_reader
            .join()
            .map_err(|_| "Could not read Borg output.")?;
        read_result.map_err(|e| e.to_string())?;
        if bytes.len() > 32 * 1024 * 1024 {
            return Err(
                "Borg output exceeded 32 MiB; use Borg CLI to browse this large archive.".into(),
            );
        }
        let text = String::from_utf8_lossy(&bytes).to_string();
        if code > 1 {
            let mut status = self.status.lock().unwrap();
            if let Some(paths) = crate::relocation::aborted_notice(&status.logs) {
                status.relocation = Some(crate::relocation::Pending {
                    challenge: crate::relocation::Challenge {
                        token: uuid::Uuid::new_v4().to_string(),
                        repository_id: repo.id.clone(),
                        action: request.action.clone(),
                        paths,
                    },
                    request: request.clone(),
                    location: repo.location.clone(),
                    issued_at: std::time::Instant::now(),
                });
            }
            return Err(crate::activity::error_summary(code, &status.logs));
        }
        let mut data: Value = if matches!(request.action.as_str(), "files" | "diff") {
            let lines: Result<Vec<Value>, _> = text
                .lines()
                .filter(|l| !l.is_empty())
                .map(serde_json::from_str)
                .collect();
            Value::Array(lines.map_err(|e| format!("Invalid Borg file listing: {e}"))?)
        } else if matches!(request.action.as_str(), "archives" | "info" | "backup") {
            serde_json::from_str(&text)
                .map_err(|e| format!("Expected Borg 1.x JSON output: {e}"))?
        } else {
            Value::Null
        };
        let text = if request.action == "archives" {
            let archives = data["archives"].as_array().ok_or("Expected an archive array from Borg info.")?.iter().map(|archive| serde_json::json!({
                "name": archive["name"], "id": archive["id"], "time": utc_archive_time(&archive["start"]),
                "stats": { "nfiles": archive["stats"]["nfiles"], "original_size": archive["stats"]["original_size"] }
            })).collect::<Vec<_>>();
            // Keep only listing metadata, not stored command lines/host information, in diagnostics.
            data = serde_json::json!({"archives": archives});
            serde_json::to_string(&data).map_err(|error| error.to_string())?
        } else {
            text
        };
        Ok(Output {
            exit_code: code,
            data,
            text,
        })
    }
}
fn utc_archive_time(value: &Value) -> Value {
    let Some(time) = value.as_str() else {
        return value.clone();
    };
    // Borg 1.x omits the offset from JSON timestamps. Its process is explicitly run in UTC.
    if let Ok(time) = chrono::NaiveDateTime::parse_from_str(time, "%Y-%m-%dT%H:%M:%S%.f") {
        return Value::String(
            time.and_utc()
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        );
    }
    value.clone()
}
fn atomic_json(directory: &Path, name: &str, value: &impl Serialize) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let temporary = directory.join(format!("{name}.tmp"));
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    fs::rename(temporary, directory.join(name)).map_err(|e| e.to_string())
}
pub fn borg_command() -> Command {
    borg_command_at(None)
}
fn borg_command_at(directory: Option<&Path>) -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("wsl.exe");
        crate::host::configure(&mut command);
        if let Some(path) = directory {
            command.arg("--cd").arg(path);
        }
        command.args(["--exec", "borg"]);
        // WSLENV forwards the passphrase without placing it in process arguments.
        let existing = std::env::var("WSLENV").unwrap_or_default();
        command.env(
            "WSLENV",
            format!("{existing}:BORG_PASSPHRASE:BORG_EXIT_CODES:BORG_RSH:BORG_RELOCATED_REPO_ACCESS_IS_OK:TZ"),
        );
        command
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut command = Command::new("borg");
        crate::host::configure(&mut command);
        if let Some(path) = directory {
            command.current_dir(path);
        }
        command
    }
}
pub fn probe() -> Result<String, String> {
    let output = borg_command()
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Borg is not installed: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let version = stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .find(|line| line.starts_with("borg "))
        .unwrap_or("")
        .to_string();
    let supported = version
        .strip_prefix("borg 1.")
        .and_then(|v| v.split('.').next())
        .and_then(|v| v.parse::<u32>().ok())
        .is_some_and(|minor| minor >= 2);
    if !output.status.success() || !supported {
        return Err(format!(
            "Borg 1.2+ (1.x only) is required; {}",
            if version.is_empty() {
                format!("Borg exited with {}: {}", output.status, stderr.trim())
            } else {
                format!("detected: {version}")
            }
        ));
    }
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn real_borg_archive_diff_is_read_only_and_scoped() {
        if probe().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("changed.txt"), "before").unwrap();
        let backend = Backend::new(dir.path().join("config"));
        backend
            .save(config(
                dir.path().join("repo").display().to_string(),
                source.display().to_string(),
            ))
            .unwrap();
        let mut init = request("init");
        init.encrypted = Some(false);
        backend.execute(init).unwrap();
        let first = backend.execute(request("backup")).unwrap().data["archive"]["name"]
            .as_str()
            .unwrap()
            .to_owned();
        fs::write(source.join("changed.txt"), "after with a different size").unwrap();
        fs::write(source.join("added.txt"), "new file").unwrap();
        let second = backend.execute(request("backup")).unwrap().data["archive"]["name"]
            .as_str()
            .unwrap()
            .to_owned();
        let mut diff = request("diff");
        diff.archive = Some(first.clone());
        diff.compare_archive = Some(second.clone());
        let output = backend.execute(diff.clone()).unwrap();
        assert!(output.data.as_array().unwrap().iter().any(|row| row["path"]
            .as_str()
            .is_some_and(|p| p.ends_with("changed.txt"))));
        assert!(output.data.as_array().unwrap().iter().any(|row| row["path"]
            .as_str()
            .is_some_and(|p| p.ends_with("added.txt"))));
        assert_eq!(
            backend.execute(request("archives")).unwrap().data["archives"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        diff.compare_archive = Some("other-repo::archive".into());
        assert!(backend.execute(diff.clone()).is_err());
        diff.compare_archive = Some(first);
        assert!(backend.execute(diff).is_err());
    }
    #[test]
    fn short_archive_codes_are_unique_stable_and_persisted() {
        let directory = tempfile::tempdir().unwrap();
        let backend = Backend::new(directory.path().to_path_buf());
        let first = backend.archive_code("first-profile").unwrap();
        assert_eq!(first.len(), 6);
        assert!(first
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()));
        assert_ne!(first, backend.archive_code("second-profile").unwrap());
        assert_eq!(
            first,
            Backend::new(directory.path().to_path_buf())
                .archive_code("first-profile")
                .unwrap()
        );
        assert_eq!(
            utc_archive_time(&serde_json::json!("2026-10-28T02:38:43.732000")),
            serde_json::json!("2026-10-28T02:38:43.732Z")
        );
        assert_eq!(
            utc_archive_time(&serde_json::json!("2026-10-28T04:38:43+02:00")),
            serde_json::json!("2026-10-28T04:38:43+02:00")
        );
    }
    fn config(location: String, source: String) -> Config {
        Config {
            onboarding_complete: false,
            repositories: vec![Repository {
                id: "r1".into(),
                name: "Test".into(),
                location,
            }],
            profiles: vec![Profile {
                id: "p1".into(),
                name: "Home".into(),
                repository_id: "r1".into(),
                sources: vec![source],
                excludes: vec![],
                keep_daily: 7,
                keep_weekly: 4,
                keep_monthly: 6,
                interval_hours: 0,
            }],
        }
    }
    #[cfg(unix)]
    fn request(action: &str) -> Request {
        Request {
            action: action.into(),
            repository_id: "r1".into(),
            profile_id: Some("p1".into()),
            archive: None,
            destination: None,
            encrypted: Some(false),
            dry_run: Some(true),
            selected_paths: None,
            compare_archive: None,
        }
    }
    #[test]
    fn validates_paths_and_retention() {
        assert!(validate(&config("/backups".into(), "/home".into())).is_ok());
        assert!(validate(&config("--help".into(), "/home".into())).is_err());
        assert!(validate(&config("/backups".into(), "relative".into())).is_err());
        let mut c = config("/backups".into(), "/home".into());
        c.profiles[0].keep_daily = 0;
        c.profiles[0].keep_weekly = 0;
        c.profiles[0].keep_monthly = 0;
        assert!(validate(&c).is_err());
        let mut c = config("/backups".into(), "/home".into());
        c.profiles[0].id = "*".into();
        assert!(validate(&c).is_err());
        c.profiles[0].id = "p1".into();
        c.repositories.push(c.repositories[0].clone());
        assert!(validate(&c).is_err());
    }
    #[test]
    fn session_locking_and_busy_configuration_guard() {
        let temp = tempfile::tempdir().unwrap();
        let backend = Backend::new(temp.path().into());
        let c = config("/backup".into(), "/source".into());
        backend.save(c.clone()).unwrap();
        backend.unlock("r1".into(), "memory-only".into()).unwrap();
        backend.status.lock().unwrap().busy = true;
        assert!(backend.save(c.clone()).is_err());
        assert!(backend.lock_repository("r1").is_err());
        backend.status.lock().unwrap().busy = false;
        backend.lock_repository("r1").unwrap();
        assert!(backend.secrets.lock().unwrap().is_empty());
        backend.unlock("r1".into(), "memory-only".into()).unwrap();
        backend.save(Config::default()).unwrap();
        assert!(backend.config().unwrap().onboarding_complete);
        assert!(backend.status.lock().unwrap().unlocked.is_empty());
        assert!(backend.secrets.lock().unwrap().is_empty());
        assert!(!fs::read_to_string(temp.path().join("config.json"))
            .unwrap()
            .contains("memory-only"));
    }
    #[test]
    fn operation_details_persist_separately_with_original_context() {
        let temp = tempfile::tempdir().unwrap();
        let backend = Backend::new(temp.path().into());
        let mut c = config("/missing-repository".into(), "/source".into());
        backend.save(c.clone()).unwrap();
        assert!(backend.execute(request_for_details_test()).is_err());
        let entry = backend.status.lock().unwrap().history[0].clone();
        assert!(entry.details_available);
        let id = entry.id.as_deref().unwrap();
        let details = backend.history_details(id).unwrap();
        assert_eq!(details.request.action, "unsupported");
        assert_eq!(details.repository.as_ref().unwrap().name, "Test");
        assert!(details.log.contains(&entry.message));
        c.repositories[0].name = "Renamed".into();
        backend.save(c).unwrap();
        let reopened = Backend::new(temp.path().into());
        assert_eq!(
            reopened
                .history_details(id)
                .unwrap()
                .repository
                .unwrap()
                .name,
            "Test"
        );
        assert!(reopened.history_details("../config.json").is_err());
        assert!(reopened
            .history_details(&uuid::Uuid::new_v4().to_string())
            .is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(temp.path().join("activity").join(format!("{id}.json")))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }
    fn request_for_details_test() -> Request {
        Request {
            action: "unsupported".into(),
            repository_id: "r1".into(),
            profile_id: None,
            archive: None,
            destination: None,
            encrypted: None,
            dry_run: None,
            selected_paths: None,
            compare_archive: None,
        }
    }
    #[test]
    fn old_history_without_detailed_logs_remains_readable() {
        let temp = tempfile::tempdir().unwrap();
        let old = serde_json::json!([{"time": "2026-01-01T00:00:00Z", "action": "info", "repositoryId": "r1", "profileId": null, "exitCode": 2, "message": "Previous summary"}]);
        fs::write(
            temp.path().join("history.json"),
            serde_json::to_vec(&old).unwrap(),
        )
        .unwrap();
        let backend = Backend::new(temp.path().into());
        let status = backend.status.lock().unwrap();
        assert_eq!(status.history.len(), 1);
        assert!(status.history[0].id.is_none());
        assert!(!status.history[0].details_available);
        assert_eq!(status.history[0].message, "Previous summary");
    }
    #[test]
    fn legacy_config_keeps_onboarding_complete_after_forgetting_connections() {
        let temp = tempfile::tempdir().unwrap();
        let old = serde_json::json!({"repositories": [{"id": "r1", "name": "Existing", "location": "/backup"}], "profiles": []});
        fs::write(
            temp.path().join("config.json"),
            serde_json::to_vec(&old).unwrap(),
        )
        .unwrap();
        let backend = Backend::new(temp.path().into());
        assert!(backend.config().unwrap().onboarding_complete);
        backend.save(Config::default()).unwrap();
        assert!(
            Backend::new(temp.path().into())
                .config()
                .unwrap()
                .onboarding_complete
        );
    }
    #[test]
    #[cfg(unix)]
    fn relocation_approval_is_explicit_scoped_and_one_shot() {
        if probe().is_err() {
            eprintln!("SKIP: Borg 1.x not available");
            return;
        }
        let temp = tempfile::tempdir().unwrap();
        let old = temp.path().join("old repo");
        let new = temp.path().join("new repo");
        let source = temp.path().join("source");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("hello"), "test").unwrap();
        let backend = Backend::new(temp.path().join("settings"));
        let mut c = config(
            old.to_string_lossy().into(),
            source.to_string_lossy().into(),
        );
        backend.save(c.clone()).unwrap();
        backend
            .unlock("r1".into(), "relocation-test-only".into())
            .unwrap();
        let mut init = request("init");
        init.encrypted = Some(true);
        backend.execute(init).unwrap();
        backend.execute(request("backup")).unwrap();
        backend.execute(request("info")).unwrap();
        fs::rename(&old, &new).unwrap();
        c.repositories[0].location = format!("{}/", new.to_string_lossy());
        backend.save(c.clone()).unwrap();
        assert!(backend
            .execute(request("info"))
            .err()
            .unwrap()
            .contains("relocation requires confirmation"));
        let pending = backend.status.lock().unwrap().relocation.clone().unwrap();
        assert_eq!(pending.challenge.paths.old_path, old.to_string_lossy());
        assert_eq!(pending.challenge.paths.new_path, new.to_string_lossy());
        assert!(backend.confirm_relocation("forged-token".into()).is_err());
        assert!(backend
            .execute_authorized(request("backup"), Some(pending.challenge.token.clone()))
            .is_err());
        backend.dismiss_relocation(&pending.challenge.token);
        assert!(backend
            .confirm_relocation(pending.challenge.token.clone())
            .is_err());
        assert!(backend.execute(request("info")).is_err());
        let token = backend
            .status
            .lock()
            .unwrap()
            .relocation
            .as_ref()
            .unwrap()
            .challenge
            .token
            .clone();
        assert_ne!(pending.challenge.token, token);
        assert_eq!(
            backend.confirm_relocation(token.clone()).unwrap().exit_code,
            0
        );
        assert!(backend.confirm_relocation(token).is_err());
        let entry = backend.status.lock().unwrap().history[0].clone();
        let details = backend
            .history_details(entry.id.as_deref().unwrap())
            .unwrap();
        assert_eq!(
            details.relocation_confirmation.unwrap(),
            pending.challenge.paths
        );
        assert_eq!(details.request.action, "info");
        assert!(backend.status.lock().unwrap().relocation.is_none());
        assert_eq!(backend.execute(request("info")).unwrap().exit_code, 0);
        let third = temp.path().join("third repo");
        fs::rename(&new, &third).unwrap();
        c.repositories[0].location = third.to_string_lossy().into();
        backend.save(c.clone()).unwrap();
        assert!(backend.execute(request("info")).is_err());
        let token = {
            let mut status = backend.status.lock().unwrap();
            let pending = status.relocation.as_mut().unwrap();
            pending.issued_at = std::time::Instant::now() - std::time::Duration::from_secs(301);
            pending.challenge.token.clone()
        };
        assert!(backend
            .confirm_relocation(token.clone())
            .err()
            .unwrap()
            .contains("expired"));
        backend.save(c).unwrap();
        assert!(backend.confirm_relocation(token).is_err());
        assert!(Backend::new(backend.directory.clone())
            .status
            .lock()
            .unwrap()
            .relocation
            .is_none());
    }
    #[test]
    #[cfg(unix)]
    fn real_borg_round_trip() {
        if probe().is_err() {
            eprintln!("SKIP: Borg 1.x not available");
            return;
        }
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("hello.txt"), "borgd round trip\n").unwrap();
        fs::write(source.join("literal[1].txt"), "literal selection").unwrap();
        fs::write(source.join("literal1.txt"), "must not restore").unwrap();
        fs::create_dir(source.join("folder")).unwrap();
        fs::write(source.join("folder/child.txt"), "selected folder").unwrap();
        fs::create_dir(source.join("folder-other")).unwrap();
        fs::write(source.join("folder-other/child.txt"), "must not restore").unwrap();
        let backend = Backend::new(temp.path().join("settings"));
        backend
            .save(config(
                temp.path().join("repo").to_string_lossy().into(),
                source.to_string_lossy().into(),
            ))
            .unwrap();
        backend.execute(request("init")).unwrap();
        backend.execute(request("backup")).unwrap();
        let list = backend.execute(request("archives")).unwrap();
        assert_eq!(list.data["archives"][0]["stats"]["nfiles"], 5);
        assert!(
            list.data["archives"][0]["stats"]["original_size"]
                .as_u64()
                .unwrap()
                > 0
        );
        assert!(list.data["archives"][0]["time"].as_str().is_some());
        assert!(!list.text.contains("command_line"));
        let listed = &list.data["archives"][0];
        let generated = listed["name"].as_str().unwrap();
        let suffix = generated.strip_prefix("borgd-").unwrap();
        assert_eq!(suffix.chars().nth(6), Some('-'));
        assert!(suffix[..6].bytes().all(|c| c.is_ascii_alphanumeric()));
        assert!(
            chrono::NaiveDateTime::parse_from_str(&suffix[7..], "%Y-%m-%dT%H-%M-%S%.f").is_ok()
        );
        assert!(listed["time"].as_str().unwrap().ends_with('Z'));
        let name = list.data["archives"][0]["name"]
            .as_str()
            .unwrap()
            .to_string();
        let mut files = request("files");
        files.archive = Some(name.clone());
        assert!(backend.execute(files).unwrap().text.contains("hello.txt"));
        backend.execute(request("info")).unwrap();
        backend.execute(request("check")).unwrap();
        backend.execute(request("prune")).unwrap();
        let destination = temp.path().join("restored");
        fs::create_dir(&destination).unwrap();
        let mut restore = request("restore");
        restore.archive = Some(name);
        restore.destination = Some(destination.to_string_lossy().into());
        backend.execute(restore.clone()).unwrap();
        let restored = destination
            .join(source.strip_prefix("/").unwrap())
            .join("hello.txt");
        assert_eq!(fs::read_to_string(restored).unwrap(), "borgd round trip\n");
        let partial = temp.path().join("partial");
        fs::create_dir(&partial).unwrap();
        let mut selected = restore.clone();
        selected.destination = Some(partial.to_string_lossy().into());
        let prefix = source.strip_prefix("/").unwrap().to_string_lossy();
        selected.selected_paths = Some(vec![
            format!("{prefix}/literal[1].txt"),
            format!("{prefix}/folder"),
        ]);
        assert_eq!(backend.execute(selected.clone()).unwrap().exit_code, 0);
        let base = partial.join(source.strip_prefix("/").unwrap());
        assert!(base.join("literal[1].txt").exists());
        assert!(base.join("folder/child.txt").exists());
        assert!(!base.join("literal1.txt").exists());
        assert!(!base.join("folder-other").exists());
        assert!(!base.join("hello.txt").exists());
        let empty = temp.path().join("invalid-selection");
        fs::create_dir(&empty).unwrap();
        selected.destination = Some(empty.to_string_lossy().into());
        for paths in [vec![], vec!["../escape".into()], vec!["/absolute".into()]] {
            selected.selected_paths = Some(paths);
            assert!(backend.execute(selected.clone()).is_err());
            assert!(fs::read_dir(&empty).unwrap().next().is_none());
        }
        assert!(backend.execute(restore).is_err());
        assert!(!backend.status.lock().unwrap().busy);
        assert!(backend.directory.join("history.json").exists());
        let persisted = Backend::new(backend.directory.clone());
        assert!(!persisted.status.lock().unwrap().history.is_empty());
    }
    #[test]
    #[cfg(unix)]
    fn encrypted_repository_and_prune_isolation() {
        if probe().is_err() {
            eprintln!("SKIP: Borg 1.x not available");
            return;
        }
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("secret.txt"), "encrypted test data").unwrap();
        let location = temp.path().join("repo").to_string_lossy().to_string();
        let backend = Backend::new(temp.path().join("settings"));
        let mut c = config(location.clone(), source.to_string_lossy().into());
        c.profiles[0].keep_daily = 1;
        c.profiles[0].keep_weekly = 0;
        c.profiles[0].keep_monthly = 0;
        backend.save(c).unwrap();
        let mut init = request("init");
        init.encrypted = Some(true);
        assert!(backend.execute(init.clone()).is_err());
        backend
            .unlock("r1".into(), "test-only-passphrase".into())
            .unwrap();
        backend.execute(init).unwrap();
        for name in ["borgd-p1-old", "borgd-other-old", "manual-old"] {
            let result = borg_command()
                .args([
                    "create",
                    "--timestamp=2000-01-01T00:00:00",
                    &format!("{location}::{name}"),
                    source.to_str().unwrap(),
                ])
                .env("BORG_PASSPHRASE", "test-only-passphrase")
                .stdin(Stdio::null())
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
        }
        backend.execute(request("backup")).unwrap();
        backend.execute(request("prune")).unwrap();
        let before = backend.execute(request("archives")).unwrap();
        assert_eq!(before.data["archives"].as_array().unwrap().len(), 4);
        let mut prune = request("prune");
        prune.dry_run = Some(false);
        backend.execute(prune).unwrap();
        let after = backend.execute(request("archives")).unwrap();
        let names: Vec<_> = after.data["archives"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a["name"].as_str().unwrap())
            .collect();
        assert!(!names.contains(&"borgd-p1-old"));
        assert!(names.contains(&"borgd-other-old"));
        assert!(names.contains(&"manual-old"));
        let overlap = borg_command()
            .args([
                "create",
                &format!("{location}::borgd-p11-unrelated"),
                source.to_str().unwrap(),
            ])
            .env("BORG_PASSPHRASE", "test-only-passphrase")
            .output()
            .unwrap();
        assert!(overlap.status.success());
        let mut prune = request("prune");
        prune.dry_run = Some(false);
        assert!(backend
            .execute(prune)
            .err()
            .unwrap()
            .contains("overlaps an unrelated archive"));
        assert!(!fs::read_to_string(backend.directory.join("config.json"))
            .unwrap()
            .contains("test-only-passphrase"));
        assert!(!backend
            .status
            .lock()
            .unwrap()
            .logs
            .iter()
            .any(|l| l.contains("test-only-passphrase")));
        for item in fs::read_dir(backend.directory.join("activity")).unwrap() {
            assert!(!fs::read_to_string(item.unwrap().path())
                .unwrap()
                .contains("test-only-passphrase"));
        }
        assert!(backend.secrets.lock().unwrap().contains_key("r1"));
        let reopened = Backend::new(backend.directory.clone());
        assert!(reopened.secrets.lock().unwrap().is_empty());
        assert!(reopened
            .execute(request("info"))
            .err()
            .unwrap()
            .contains("Repository passphrase is missing or incorrect"));
        reopened
            .unlock("r1".into(), "wrong-test-passphrase".into())
            .unwrap();
        assert!(reopened
            .execute(request("check"))
            .err()
            .unwrap()
            .contains("Repository passphrase is missing or incorrect"));
        reopened
            .unlock("r1".into(), "test-only-passphrase".into())
            .unwrap();
        assert_eq!(reopened.execute(request("info")).unwrap().exit_code, 0);
    }
}
