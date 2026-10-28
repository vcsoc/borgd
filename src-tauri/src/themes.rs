use std::io::Write;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn export_theme(app: tauri::AppHandle, document: String) -> Result<bool, String> {
    validate_document(&document)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Theme JSON", &["json"])
            .set_file_name("borgd-theme.json")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        write_theme(&path, &document)?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn validate_document(document: &str) -> Result<(), String> {
    if document.len() > 131_072 {
        return Err("Theme JSON exceeds 128 KiB".into());
    }
    let value: serde_json::Value = serde_json::from_str(document).map_err(|e| e.to_string())?;
    if value["format"] != "borgd-theme" || value["version"] != 1 {
        return Err("Unsupported theme document".into());
    }
    Ok(())
}

fn write_theme(path: &std::path::Path, document: &str) -> Result<(), String> {
    validate_document(document)?;
    if !path
        .extension()
        .is_some_and(|s| s.eq_ignore_ascii_case("json"))
    {
        return Err("Choose a filename ending in .json".into());
    }
    if let Ok(meta) = std::fs::symlink_metadata(path) {
        if !meta.is_file() || meta.is_symlink() {
            return Err("Choose a regular JSON file, not a link or directory".into());
        }
    }
    let temporary = path.with_file_name(format!(".borgd-theme-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(document.as_bytes())?;
        file.sync_all()?;
        std::fs::rename(&temporary, path)
    })();
    let _ = std::fs::remove_file(&temporary);
    result.map_err(|e: std::io::Error| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exports_only_bounded_theme_json_to_explicit_regular_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("theme.json");
        let document = r#"{"format":"borgd-theme","version":1}"#;
        write_theme(&path, document).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), document);
        write_theme(&path, document).unwrap();
        assert!(write_theme(&dir.path().join("config.txt"), document).is_err());
        assert!(write_theme(&path, "{}").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), document);
        assert!(validate_document(&"x".repeat(131_073)).is_err());
        #[cfg(unix)]
        {
            let link = dir.path().join("link.json");
            std::os::unix::fs::symlink(&path, &link).unwrap();
            assert!(write_theme(&link, document).is_err());
        }
    }
}
