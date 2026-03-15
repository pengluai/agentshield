use std::path::{Path, PathBuf};

pub(crate) fn normalize_path_string(raw: &str) -> String {
    raw.replace('\\', "/").to_lowercase()
}

pub(crate) fn normalize_path(path: &Path) -> String {
    normalize_path_string(&path.to_string_lossy())
}

pub(crate) fn path_contains(path: &Path, needle: &str) -> bool {
    normalize_path(path).contains(&normalize_path_string(needle))
}

pub(crate) fn path_ends_with(path: &Path, suffix: &str) -> bool {
    normalize_path(path).ends_with(&normalize_path_string(suffix))
}

pub(crate) fn npm_command() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

pub(crate) fn openclaw_command() -> &'static str {
    if cfg!(windows) {
        "openclaw.cmd"
    } else {
        "openclaw"
    }
}

pub(crate) fn openclaw_config_candidates(home: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![
        home.join(".openclaw"),
        home.join(".config").join("openclaw"),
        home.join("Library")
            .join("Application Support")
            .join("OpenClaw"),
    ];

    if let Some(appdata) = std::env::var_os("APPDATA") {
        candidates.push(PathBuf::from(appdata).join("openclaw"));
    } else {
        candidates.push(home.join("AppData").join("Roaming").join("openclaw"));
    }

    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local_app_data).join("openclaw"));
    } else {
        candidates.push(home.join("AppData").join("Local").join("openclaw"));
    }

    candidates.sort();
    candidates.dedup();
    candidates
}

pub(crate) fn preferred_openclaw_config_dir(home: &Path) -> PathBuf {
    openclaw_config_candidates(home)
        .into_iter()
        .find(|candidate| candidate.exists())
        .unwrap_or_else(|| {
            if cfg!(windows) {
                std::env::var_os("LOCALAPPDATA")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| home.join("AppData").join("Local"))
                    .join("openclaw")
            } else if cfg!(target_os = "linux") {
                home.join(".config").join("openclaw")
            } else {
                home.join(".openclaw")
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_path_handles_windows_separators() {
        assert_eq!(
            normalize_path_string(r"C:\Users\Test\AppData\Roaming\Code\User\settings.json"),
            "c:/users/test/appdata/roaming/code/user/settings.json"
        );
    }
}
