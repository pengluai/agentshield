#[cfg(target_os = "macos")]
use std::process::Command as StdCommand;

#[cfg(target_os = "macos")]
fn pane_urls(pane: &str) -> Option<Vec<&'static str>> {
    let urls = match pane {
        "fullDiskAccess" => vec![
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy",
            "x-apple.systempreferences:com.apple.preference.security?Privacy",
            "x-apple.systempreferences:com.apple.preference.security",
        ],
        "accessibility" => vec![
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy",
            "x-apple.systempreferences:com.apple.preference.security?Privacy",
            "x-apple.systempreferences:com.apple.preference.security",
        ],
        "automation" => vec![
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Automation",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy",
            "x-apple.systempreferences:com.apple.preference.security?Privacy",
            "x-apple.systempreferences:com.apple.preference.security",
        ],
        "notifications" => vec![
            "x-apple.systempreferences:com.apple.settings.Notifications",
            "x-apple.systempreferences:com.apple.preference.notifications",
            "x-apple.systempreferences:com.apple.settings.Notifications",
        ],
        _ => return None,
    };

    Some(urls)
}

#[cfg(target_os = "macos")]
fn open_command_candidates() -> [&'static str; 2] {
    ["/usr/bin/open", "open"]
}

#[cfg(target_os = "macos")]
fn osascript_command_candidates() -> [&'static str; 2] {
    ["/usr/bin/osascript", "osascript"]
}

#[cfg(target_os = "macos")]
fn run_macos_command(command_candidates: &[&str], args: &[&str], context: &str) -> bool {
    for command in command_candidates {
        match StdCommand::new(command).args(args).output() {
            Ok(output) => {
                let success = output.status.success();
                let stderr = String::from_utf8_lossy(&output.stderr);
                eprintln!(
                    "[AgentShield] open_macos_permission_settings: {} command={} args={:?} success={} stderr={}",
                    context,
                    command,
                    args,
                    success,
                    stderr.trim()
                );
                if success {
                    return true;
                }
            }
            Err(error) => {
                eprintln!(
                    "[AgentShield] open_macos_permission_settings: {} command={} args={:?} error={}",
                    context, command, args, error
                );
            }
        }
    }

    false
}

#[cfg(target_os = "macos")]
fn open_url(url: &str) -> bool {
    run_macos_command(&open_command_candidates(), &[url], "open_url")
}

#[cfg(target_os = "macos")]
fn activate_settings_window() {
    for script in [
        r#"tell application "System Settings" to activate"#,
        r#"tell application "System Preferences" to activate"#,
    ] {
        let activated = run_macos_command(
            &osascript_command_candidates(),
            &["-e", script],
            "activate_settings_window",
        );
        if activated {
            break;
        }
    }
}

#[cfg(target_os = "macos")]
fn open_settings_app() -> bool {
    let attempts: &[&[&str]] = &[
        &["-a", "System Settings"],
        &["-a", "System Preferences"],
        &["-b", "com.apple.systempreferences"],
    ];

    for args in attempts {
        if run_macos_command(&open_command_candidates(), args, "open_settings_app") {
            return true;
        }
    }

    false
}

#[cfg(target_os = "macos")]
fn open_settings_with_osascript() -> bool {
    let scripts = [
        r#"tell application "System Settings" to activate"#,
        r#"tell application "System Preferences" to activate"#,
    ];

    for script in scripts {
        if run_macos_command(
            &osascript_command_candidates(),
            &["-e", script],
            "open_settings_with_osascript",
        ) {
            return true;
        }
    }

    false
}

#[tauri::command]
pub async fn open_macos_permission_settings(pane: String) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let pane = pane.trim();
        let Some(urls) = pane_urls(pane) else {
            return Err(format!("Unsupported macOS permission pane: {pane}"));
        };
        eprintln!(
            "[AgentShield] open_macos_permission_settings: pane={} urls={}",
            pane,
            urls.len()
        );

        for url in urls {
            if open_url(url) {
                activate_settings_window();
                return Ok(true);
            }
        }

        if open_settings_app() {
            activate_settings_window();
            return Ok(true);
        }
        if open_settings_with_osascript() {
            return Ok(true);
        }

        eprintln!(
            "[AgentShield] open_macos_permission_settings: all fallbacks failed for pane={}",
            pane
        );
        Ok(false)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = pane;
        Ok(false)
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{open_command_candidates, osascript_command_candidates, pane_urls};

    #[test]
    fn known_permission_panes_have_fallback_urls() {
        for pane in [
            "fullDiskAccess",
            "accessibility",
            "automation",
            "notifications",
        ] {
            let urls = pane_urls(pane).expect("known pane");
            assert!(!urls.is_empty());
        }
    }

    #[test]
    fn unknown_permission_pane_is_rejected() {
        assert!(pane_urls("unknown").is_none());
    }

    #[test]
    fn macos_command_candidates_prefer_absolute_paths() {
        assert_eq!(open_command_candidates()[0], "/usr/bin/open");
        assert_eq!(osascript_command_candidates()[0], "/usr/bin/osascript");
    }
}
