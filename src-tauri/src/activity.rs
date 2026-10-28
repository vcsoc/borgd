use crate::engine::{History, Profile, Repository, Request};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    pub entry: History,
    pub request: Request,
    pub repository: Option<Repository>,
    pub profile: Option<Profile>,
    pub log: String,
    pub output: String,
    pub truncated: bool,
    #[serde(default)]
    pub process_exit_code: Option<i32>,
    #[serde(default)]
    pub relocation_confirmation: Option<crate::relocation::Paths>,
}

// Keep both the initial cause and the final summary, with an explicit marker.
pub fn bounded_text(text: &str, limit: usize) -> (String, bool) {
    if text.len() <= limit {
        return (text.into(), false);
    }
    let marker = "\n\n[... diagnostic output truncated ...]\n\n";
    let budget = limit.saturating_sub(marker.len());
    let mut head = budget * 3 / 4;
    while !text.is_char_boundary(head) {
        head -= 1;
    }
    let mut tail = text.len() - budget / 4;
    while !text.is_char_boundary(tail) {
        tail += 1;
    }
    (
        format!("{}{}{}", &text[..head], marker, &text[tail..]),
        true,
    )
}

pub fn error_summary(code: i32, logs: &VecDeque<String>) -> String {
    if let Some(paths) = crate::relocation::aborted_notice(logs) {
        return format!("Repository relocation requires confirmation. Previous location: {}. Current location: {}. Borg aborted without approval (exit code {code}).", paths.old_path, paths.new_path);
    }
    let is_context = |line: &str| {
        line.split_once(": ").is_some_and(|(action, _)| {
            matches!(
                action,
                "init" | "info" | "check" | "backup" | "prune" | "restore" | "archives" | "files"
            )
        })
    };
    let contains = |needle: &str| {
        logs.iter()
            .any(|line| !is_context(line) && line.to_lowercase().contains(needle))
    };
    let message = if contains("incorrect passphrase")
        || (contains("passphrase supplied") && contains("is incorrect"))
    {
        "Repository passphrase is missing or incorrect. Set the correct session passphrase using Unlock, then retry. Passphrases are not saved across app restarts; a correct repository path does not unlock encrypted archives."
    } else if contains("read-only file system") || contains("errno 30") {
        "Repository storage is read-only. Borg needs a writable lock file even for inspection. Check the drive/filesystem before safely mounting it read-write; do not force-remount or delete locks to bypass this error."
    } else if contains("no space left on device") || contains("disk quota exceeded") {
        "Repository or cache storage is full. Check free space and quotas before retrying; do not manually delete repository files."
    } else if contains("permission denied") {
        "Access was denied. Check filesystem permissions or SSH credentials for the repository; unlocking its passphrase does not grant filesystem write access."
    } else {
        let cause = logs
            .iter()
            .find(|line| {
                let lower = line.to_lowercase();
                !is_context(line)
                    && (lower.contains("failed")
                        || lower.contains("error")
                        || lower.contains("does not exist")
                        || lower.contains("incorrect passphrase"))
                    && !lower.starts_with("ssh_original_command:")
                    && !lower.starts_with("  file ")
            })
            .or_else(|| {
                logs.iter().find(|line| {
                    let line = line.trim();
                    !line.is_empty()
                        && !is_context(line)
                        && ![
                            "Platform:",
                            "Linux:",
                            "Borg:",
                            "PID:",
                            "sys.argv:",
                            "SSH_ORIGINAL_COMMAND:",
                            "Traceback",
                            "File ",
                        ]
                        .iter()
                        .any(|prefix| line.starts_with(prefix))
                })
            });
        let cause = cause
            .map(|line| bounded_text(line, 500).0)
            .unwrap_or_else(|| {
                "No diagnostic message was returned. Review the operation log.".into()
            });
        return format!("Borg exited with code {code}. {cause}");
    };
    format!("{message} (Borg exit code {code}.)")
}

#[cfg(test)]
mod tests {
    #[test]
    fn reports_borgs_actual_passphrase_rejection_instead_of_the_operation_preamble() {
        let logs = ["check: documents", "Checking segments 75.0%", "Passphrase supplied in BORG_PASSPHRASE, by BORG_PASSCOMMAND, or via BORG_PASSPHRASE_FD is incorrect."].map(str::to_string).into();
        let message = super::error_summary(2, &logs);
        assert!(message.contains("Repository passphrase is missing or incorrect"));
        assert!(message.contains("Unlock"));
        assert!(!message.contains("check: documents"));
        assert!(!message.contains("read-only"));
        let other = [
            "info: error documents".into(),
            "Repository access aborted".into(),
        ]
        .into();
        assert!(super::error_summary(2, &other).contains("Repository access aborted"));
    }
    use super::*;
    #[test]
    fn readonly_error_is_not_hidden_by_traceback_footer() {
        let logs = ["info: documents", "Failed to create/acquire the lock /media/backup/lock.exclusive ([Errno 30] Read-only file system)", "Traceback (most recent call last):", "Platform: Linux", "SSH_ORIGINAL_COMMAND: None"].map(str::to_string).into();
        let message = error_summary(2, &logs);
        assert!(message.contains("read-only"));
        assert!(message.contains("lock file"));
        assert!(!message.contains("SSH_ORIGINAL_COMMAND"));
        assert!(!message.contains("break-lock"));
    }
    #[test]
    fn preserves_generic_root_cause_and_distinguishes_permissions() {
        let logs = [
            "Repository /missing does not exist.",
            "SSH_ORIGINAL_COMMAND: None",
        ]
        .map(str::to_string)
        .into();
        assert!(error_summary(2, &logs).contains("/missing does not exist"));
        let logs = ["Permission denied", "SSH_ORIGINAL_COMMAND: None"]
            .map(str::to_string)
            .into();
        assert!(error_summary(2, &logs).contains("Access was denied"));
        assert!(!error_summary(2, &logs).contains("read-only"));
    }
    #[test]
    fn bounds_diagnostics_without_splitting_unicode() {
        let text = format!("root cause {} final result", "\u{00e9}".repeat(1000));
        let (bounded, truncated) = bounded_text(&text, 256);
        assert!(truncated);
        assert!(bounded.len() <= 256);
        assert!(bounded.starts_with("root cause"));
        assert!(bounded.ends_with("final result"));
        assert_eq!(bounded_text("complete", 256), ("complete".into(), false));
    }
}
