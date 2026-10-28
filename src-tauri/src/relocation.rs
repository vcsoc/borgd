use crate::engine::Request;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Paths {
    pub old_path: String,
    pub new_path: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Challenge {
    pub token: String,
    pub repository_id: String,
    pub action: String,
    pub paths: Paths,
}
#[derive(Clone, Serialize)]
pub struct Pending {
    #[serde(flatten)]
    pub challenge: Challenge,
    #[serde(skip)]
    pub request: Request,
    #[serde(skip)]
    pub location: String,
    #[serde(skip)]
    pub issued_at: std::time::Instant,
}

pub fn notice(logs: &VecDeque<String>) -> Option<Paths> {
    logs.iter().find_map(|line| {
        let warning = line
            .trim()
            .strip_prefix("Warning: The repository at location ")?;
        let (new, old) = warning.split_once(" was previously located at ")?;
        if old.is_empty() || new.is_empty() {
            return None;
        }
        Some(Paths {
            old_path: old.into(),
            new_path: new.into(),
        })
    })
}
pub fn aborted_notice(logs: &VecDeque<String>) -> Option<Paths> {
    let paths = notice(logs)?;
    if !logs.iter().any(|l| l.contains("Repository access aborted")) {
        return None;
    }
    Some(paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_paths_without_losing_spaces() {
        let logs = ["info: documents", "Warning: The repository at location /mnt/My Drive/docs was previously located at /run/media/old drive/docs", "Do you want to continue? [yN] Aborting.", "Repository access aborted"].map(str::to_string).into();
        let paths = aborted_notice(&logs).unwrap();
        assert_eq!(paths.old_path, "/run/media/old drive/docs");
        assert_eq!(paths.new_path, "/mnt/My Drive/docs");
        assert!(aborted_notice(
            &["Warning: The repository at location /new was previously located at /old".into()]
                .into()
        )
        .is_none());
        assert!(notice(&VecDeque::new()).is_none());
    }
}
