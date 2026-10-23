//! Run presets as a shell program, never as timed terminal keystrokes.
//!
//! The shell owns sequencing and stdin stays available to the running command.
//! Keep the temporary program alive until the shell exits (including stops).

use std::{fmt::Write as _, fs, path::Path};

use portable_pty::CommandBuilder;
use serde::{Deserialize, Serialize};
use tempfile::TempDir;

use crate::shells::ShellKind;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetCommand {
    pub command: String,
    /// Extra pause after this command succeeds, before the next command.
    #[serde(default)]
    pub delay_ms: u64,
}

pub struct PresetScript {
    directory: TempDir,
    shell: ShellKind,
}

impl PresetScript {
    pub fn prepare(
        shell: ShellKind,
        commands: &[PresetCommand],
        startup_delay_ms: u64,
    ) -> anyhow::Result<Option<Self>> {
        let commands: Vec<_> = commands
            .iter()
            .filter(|command| !command.command.trim().is_empty())
            .collect();
        if commands.is_empty() {
            return Ok(None);
        }

        let script = Self {
            directory: tempfile::Builder::new()
                .prefix("aemeth-presets-")
                .tempdir()?,
            shell,
        };
        let source = match shell {
            ShellKind::PowerShell | ShellKind::Pwsh => powershell(&commands, startup_delay_ms),
            ShellKind::Cmd => cmd(&commands, startup_delay_ms, script.directory.path())?,
            ShellKind::Bash | ShellKind::Zsh | ShellKind::Sh => posix(&commands, startup_delay_ms),
        };
        fs::write(script.path(), source)?;
        Ok(Some(script))
    }

    fn path(&self) -> std::path::PathBuf {
        self.directory.path().join(match self.shell {
            ShellKind::PowerShell | ShellKind::Pwsh => "run.ps1",
            ShellKind::Cmd => "run.cmd",
            _ => "run.sh",
        })
    }

    pub fn configure(&self, command: &mut CommandBuilder) {
        match self.shell {
            ShellKind::PowerShell | ShellKind::Pwsh => {
                command.args(["-ExecutionPolicy", "Bypass", "-File"]);
                command.arg(self.path());
            }
            ShellKind::Cmd => {
                // A leading CALL keeps cmd /C from stripping the executable's
                // quotes when the temporary path contains spaces or &.
                command.args(["/Q", "/V:OFF", "/C", "call"]);
                command.arg(self.path());
            }
            ShellKind::Bash | ShellKind::Zsh | ShellKind::Sh => {
                // Supplying a script would otherwise disable the interactive
                // startup files that provide tools such as nvm and aliases.
                if !command.get_argv().iter().any(|arg| arg == "-i") {
                    command.arg("-i");
                }
                // Git Bash accepts drive paths with forward slashes.
                let path = self.path();
                if cfg!(windows) {
                    command.arg(path.to_string_lossy().replace('\\', "/"));
                } else {
                    command.arg(path);
                }
            }
        }
    }
}

fn powershell(commands: &[&PresetCommand], startup_delay_ms: u64) -> String {
    // Windows PowerShell 5.1 needs a BOM to read non-ASCII script text as UTF-8.
    let mut source = String::from("\u{feff}$ErrorActionPreference = 'Stop'\ntry {\n");
    ps_sleep(&mut source, startup_delay_ms);
    for (index, preset) in commands.iter().enumerate() {
        let command = preset.command.trim();
        writeln!(source, "Write-Host {}", ps_quote(&format!("> {command}"))).unwrap();
        source.push_str("$LASTEXITCODE = 0\n");
        source.push_str(command);
        source.push_str(
            r"
$__aemethSucceeded = $?
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not $__aemethSucceeded) { exit 1 }
",
        );
        if index + 1 < commands.len() {
            ps_sleep(&mut source, preset.delay_ms);
        }
    }
    source.push_str(
        r"} catch {
Write-Error -ErrorRecord $_ -ErrorAction Continue
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
exit 1
}
exit 0
",
    );
    source
}

fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn ps_sleep(source: &mut String, ms: u64) {
    if ms > 0 {
        writeln!(source, "Start-Sleep -Milliseconds {ms}").unwrap();
    }
}

fn posix(commands: &[&PresetCommand], startup_delay_ms: u64) -> String {
    let mut source = String::new();
    posix_sleep(&mut source, startup_delay_ms);
    for (index, preset) in commands.iter().enumerate() {
        let command = sh_quote(preset.command.trim());
        writeln!(source, "printf '> %s\\n' {command}\neval {command}").unwrap();
        source.push_str(
            r#"__aemeth_status=$?
if [ "$__aemeth_status" -ne 0 ]; then
    exit "$__aemeth_status"
fi
"#,
        );
        if index + 1 < commands.len() {
            posix_sleep(&mut source, preset.delay_ms);
        }
    }
    source.push_str("exit 0\n");
    source
}

fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn posix_sleep(source: &mut String, ms: u64) {
    if ms > 0 {
        writeln!(source, "sleep {}.{:03}", ms / 1000, ms % 1000).unwrap();
    }
}

fn cmd(
    commands: &[&PresetCommand],
    startup_delay_ms: u64,
    directory: &Path,
) -> anyhow::Result<String> {
    let mut source = String::from("@echo off\r\nchcp 65001 >nul\r\n");
    cmd_sleep(&mut source, startup_delay_ms);
    for (index, preset) in commands.iter().enumerate() {
        let command = preset.command.trim();
        // CALL a separate batch context, so npm/yarn .cmd shims can replace
        // that context without skipping the remaining presets. Do not prefix
        // the user's command with CALL: it reparses quotes and redirections.
        fs::write(
            directory.join(format!("step-{index}.cmd")),
            format!("@echo off\r\n{command}\r\n"),
        )?;
        // TYPE prints the original command without expanding %, !, &, or >.
        fs::write(
            directory.join(format!("step-{index}.txt")),
            format!("> {command}\r\n"),
        )?;
        writeln!(source, "type \"%~dp0step-{index}.txt\"\r").unwrap();
        writeln!(source, "call \"%~dp0step-{index}.cmd\"\r").unwrap();
        source.push_str("if not \"%errorlevel%\"==\"0\" exit /b %errorlevel%\r\n");
        if index + 1 < commands.len() {
            cmd_sleep(&mut source, preset.delay_ms);
        }
    }
    source.push_str("exit /b 0\r\n");
    Ok(source)
}

fn cmd_sleep(source: &mut String, ms: u64) {
    if ms > 0 {
        // TIMEOUT only supports whole seconds and can consume console input.
        writeln!(source, "\"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\" -NoLogo -NoProfile -Command \"Start-Sleep -Milliseconds {ms}\"\r").unwrap();
    }
}

#[cfg(test)]
mod tests;
