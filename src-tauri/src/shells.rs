//! Shell discovery & resolution.
//!
//! Detects which shells are actually installed on the host machine and maps a
//! logical [`ShellKind`] to a concrete executable + launch arguments.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Logical shell identifiers exposed to the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShellKind {
    PowerShell,
    Pwsh,
    Cmd,
    Bash,
    Zsh,
    Sh,
}

impl ShellKind {
    pub fn label(self) -> &'static str {
        match self {
            ShellKind::PowerShell => "PowerShell",
            ShellKind::Pwsh => "PowerShell 7",
            ShellKind::Cmd => "CMD",
            ShellKind::Bash => "Git Bash",
            ShellKind::Zsh => "Zsh",
            ShellKind::Sh => "sh",
        }
    }
}

/// A shell the frontend can offer in the app editor.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellInfo {
    pub kind: ShellKind,
    pub label: String,
    /// Absolute path to the executable, when it could be resolved.
    pub path: Option<String>,
    pub available: bool,
    /// Default launch arguments used when spawning.
    pub default_args: Vec<String>,
}

fn first_existing(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|p| p.is_file())
        .map(|p| p.to_path_buf())
}

fn which(name: &str) -> Option<PathBuf> {
    which::which(name).ok()
}

fn env_dir(key: &str) -> Option<PathBuf> {
    std::env::var(key).ok().map(PathBuf::from)
}

/// Probe the host system for well-known shells.
pub fn detect_shells() -> Vec<ShellInfo> {
    let mut shells: Vec<ShellInfo> = Vec::new();
    let mut push =
        |kind: ShellKind, path: Option<PathBuf>, default_args: Vec<String>| {
            shells.push(ShellInfo {
                kind,
                label: kind.label().to_string(),
                available: path.is_some(),
                path: path.map(|p| p.to_string_lossy().into_owned()),
                default_args,
            });
        };

    if cfg!(windows) {
        let system_root = env_dir("SystemRoot").unwrap_or_else(|| PathBuf::from(r"C:\Windows"));

        // Windows PowerShell 5.1 — ships with Windows.
        push(
            ShellKind::PowerShell,
            first_existing(&[system_root
                .join(r"System32\WindowsPowerShell\v1.0\powershell.exe")]),
            vec!["-NoLogo".into()],
        );

        // PowerShell 7+ (pwsh), installed side-by-side or on PATH.
        let pwsh = which("pwsh").or_else(|| {
            let pf = env_dir("ProgramFiles").unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
            first_existing(&[pf.join(r"PowerShell\7\pwsh.exe")])
        });
        push(ShellKind::Pwsh, pwsh, vec!["-NoLogo".into()]);

        // cmd.exe — ships with Windows.
        push(
            ShellKind::Cmd,
            first_existing(&[system_root.join(r"System32\cmd.exe")]),
            Vec::new(),
        );

        // Git Bash — search PATH first, then common install locations.
        let mut git_bash_candidates = Vec::new();
        for dir_key in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
            if let Some(dir) = env_dir(dir_key) {
                git_bash_candidates.push(dir.join(r"Git\bin\bash.exe"));
            }
        }
        if let Some(local) = env_dir("LOCALAPPDATA") {
            git_bash_candidates.push(local.join(r"Programs\Git\bin\bash.exe"));
        }
        let bash = which("bash").or_else(|| first_existing(&git_bash_candidates));
        push(ShellKind::Bash, bash, vec!["--login".into(), "-i".into()]);
    } else {
        push(
            ShellKind::Bash,
            which("bash").or_else(|| first_existing(&[PathBuf::from("/bin/bash")])),
            vec!["--login".into()],
        );
        push(
            ShellKind::Zsh,
            which("zsh").or_else(|| first_existing(&[PathBuf::from("/bin/zsh")])),
            vec!["--login".into()],
        );
        push(
            ShellKind::Sh,
            first_existing(&[PathBuf::from("/bin/sh")]),
            Vec::new(),
        );
        push(ShellKind::Pwsh, which("pwsh"), vec!["-NoLogo".into()]);
    }

    shells
}

/// Resolve a shell kind to an executable path and launch arguments.
pub fn resolve_shell(kind: &ShellKind) -> anyhow::Result<(String, Vec<String>)> {
    detect_shells()
        .into_iter()
        .find(|s| s.kind == *kind && s.available)
        .and_then(|s| s.path.map(|p| (p, s.default_args)))
        .ok_or_else(|| anyhow::anyhow!("shell '{}' is not available on this machine", kind.label()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_at_least_one_shell() {
        let shells = detect_shells();
        assert!(!shells.is_empty());
        assert!(shells.iter().any(|s| s.available), "expected at least one usable shell");
    }

    #[test]
    fn available_shells_have_paths() {
        for shell in detect_shells().into_iter().filter(|s| s.available) {
            assert!(shell.path.is_some(), "{:?} marked available without a path", shell.kind);
        }
    }

    #[test]
    fn resolve_matches_detection() {
        for shell in detect_shells().into_iter().filter(|s| s.available) {
            let (program, args) = resolve_shell(&shell.kind).unwrap();
            assert_eq!(program, shell.path.unwrap());
            assert_eq!(args, shell.default_args);
        }
    }
}

