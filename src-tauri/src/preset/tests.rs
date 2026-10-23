use super::*;
use std::{
    io::{Read, Write},
    sync::mpsc,
    time::{Duration, Instant},
};

use portable_pty::{native_pty_system, PtySize};

use crate::shells::resolve_shell;

fn steps(commands: &[&str]) -> Vec<PresetCommand> {
    commands
        .iter()
        .map(|command| PresetCommand {
            command: (*command).into(),
            delay_ms: 0,
        })
        .collect()
}

// Exercise the same CommandBuilder and ConPTY path as real sessions. File
// assertions distinguish command output from the echoed command text.
fn run(
    shell: ShellKind,
    commands: &[PresetCommand],
    startup_delay_ms: u64,
    cwd: &Path,
    input: Option<&str>,
) -> (u32, String) {
    let script = PresetScript::prepare(shell, commands, startup_delay_ms)
        .unwrap()
        .unwrap();
    // Cover quoting of temporary paths with spaces, Unicode and metacharacters.
    let directory = tempfile::Builder::new()
        .prefix("presets 测试 & ' ")
        .tempdir()
        .unwrap();
    for entry in fs::read_dir(script.directory.path()).unwrap() {
        let entry = entry.unwrap();
        fs::copy(entry.path(), directory.path().join(entry.file_name())).unwrap();
    }
    let script = PresetScript { directory, shell };
    let path = script.directory.path().to_owned();
    let (program, _) = resolve_shell(&shell).unwrap();
    let mut command = CommandBuilder::new(program);
    // Test fixtures must not execute a developer's personal profile.
    match shell {
        ShellKind::PowerShell | ShellKind::Pwsh => command.args(["-NoLogo", "-NoProfile"]),
        ShellKind::Bash => command.args(["--noprofile", "--norc", "-i"]),
        ShellKind::Cmd => command.arg("/D"),
        _ => {}
    }
    command.cwd(cwd);
    script.configure(&mut command);
    let pair = native_pty_system().openpty(PtySize::default()).unwrap();
    let mut reader = pair.master.try_clone_reader().unwrap();
    let mut writer = Some(pair.master.take_writer().unwrap());
    let mut child = pair.slave.spawn_command(command).unwrap();
    drop(pair.slave);
    let mut master = Some(pair.master);
    let (sender, receiver) = mpsc::channel();
    let reader_thread = std::thread::spawn(move || {
        let mut buffer = [0; 8192];
        while let Ok(count) = reader.read(&mut buffer) {
            if count == 0 || sender.send(buffer[..count].to_vec()).is_err() {
                break;
            }
        }
    });
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut output = Vec::new();
    let mut input_sent = false;
    let mut exit = None;
    loop {
        match receiver.recv_timeout(Duration::from_millis(20)) {
            Ok(bytes) => {
                output.extend_from_slice(&bytes);
                // Console hosts may query cursor position before reading input.
                if output.ends_with(b"\x1b[6n") {
                    if let Some(writer) = &mut writer {
                        writer.write_all(b"\x1b[1;1R").unwrap();
                    }
                }
                if let Some(input) = input.filter(|_| !input_sent) {
                    if String::from_utf8_lossy(&output).contains("AEMETH_INPUT_READY:") {
                        let writer = writer.as_mut().unwrap();
                        writer.write_all(input.as_bytes()).unwrap();
                        writer.flush().unwrap();
                        input_sent = true;
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if exit.is_none() {
            exit = child.try_wait().unwrap();
            if exit.is_some() {
                // Like the session reaper, release ConPTY once the child exits
                // so the reader can receive EOF and drain its final output.
                drop(writer.take());
                drop(master.take());
            }
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            panic!("{shell:?} timed out: {}", String::from_utf8_lossy(&output));
        }
    }
    let exit = exit.unwrap_or_else(|| child.wait().unwrap()).exit_code();
    drop(writer);
    drop(master);
    reader_thread.join().unwrap();
    drop(script);
    assert!(
        !path.exists(),
        "temporary commands should be removed after exit"
    );
    (exit, String::from_utf8_lossy(&output).into_owned())
}

fn assert_success(result: (u32, String)) {
    assert_eq!(result.0, 0, "{}", result.1);
}

#[test]
fn blank_presets_leave_the_shell_interactive() {
    for shell in [
        ShellKind::PowerShell,
        ShellKind::Pwsh,
        ShellKind::Cmd,
        ShellKind::Bash,
        ShellKind::Sh,
        ShellKind::Zsh,
    ] {
        assert!(PresetScript::prepare(shell, &steps(&["", " \r\n "]), 0)
            .unwrap()
            .is_none());
    }
}

fn verify_powershell(shell: ShellKind) {
    if resolve_shell(&shell).is_err() {
        return;
    }
    let cwd = tempfile::tempdir().unwrap();
    fs::create_dir(cwd.path().join("child space")).unwrap();
    let commands = steps(&[
        "$env:AEMETH_SEQUENCE_TEST = '值 & ''quoted'''; $value = 42; Set-Location 'child space'",
        "Start-Sleep -Milliseconds 200; Set-Content -Encoding UTF8 trace.txt 'fetch'; # trailing comment",
        "Add-Content -Encoding UTF8 trace.txt 'pull'",
        "Add-Content -Encoding UTF8 trace.txt 'yarn'; Add-Content -Encoding UTF8 trace.txt $env:AEMETH_SEQUENCE_TEST; Add-Content -Encoding UTF8 trace.txt $value",
        "Add-Content -Encoding UTF8 trace.txt 'release'",
    ]);
    assert_success(run(shell, &commands, 0, cwd.path(), None));
    let trace = fs::read_to_string(cwd.path().join("child space/trace.txt")).unwrap();
    assert_eq!(
        trace.trim_start_matches('\u{feff}').replace('\r', ""),
        "fetch\npull\nyarn\n值 & 'quoted'\n42\nrelease\n"
    );

    let failure = if cfg!(windows) {
        "cmd /d /c exit 7"
    } else {
        "sh -c 'exit 7'"
    };
    let result = run(
        shell,
        &steps(&[failure, "Set-Content should-not-run.txt bad"]),
        0,
        cwd.path(),
        None,
    );
    assert_eq!(result.0, 7, "{}", result.1);
    assert!(!cwd.path().join("should-not-run.txt").exists());
    let result = run(shell, &steps(&[failure]), 0, cwd.path(), None);
    assert_eq!(
        result.0, 7,
        "the final command's exit code was lost: {}",
        result.1
    );
    let result = run(
        shell,
        &steps(&[
            "Write-Error 'expected failure'",
            "Set-Content should-not-run.txt bad",
        ]),
        0,
        cwd.path(),
        None,
    );
    assert_eq!(result.0, 1, "{}", result.1);
    assert!(!cwd.path().join("should-not-run.txt").exists());
}

#[test]
#[cfg(windows)]
fn powershell_waits_preserves_state_and_stops_on_failure() {
    verify_powershell(ShellKind::PowerShell);
}

#[test]
fn pwsh_waits_preserves_state_and_stops_on_failure() {
    verify_powershell(ShellKind::Pwsh);
}

#[test]
#[cfg(windows)]
fn powershell_keeps_stdin_for_the_running_command() {
    let cwd = tempfile::tempdir().unwrap();
    let commands = steps(&[
        "$answer = Read-Host ('AEMETH_' + 'INPUT_READY'); Set-Content -Encoding UTF8 answer.txt $answer",
        "Add-Content -Encoding UTF8 answer.txt 'next command'",
    ]);
    assert_success(run(
        ShellKind::PowerShell,
        &commands,
        0,
        cwd.path(),
        Some("actual user input\r"),
    ));
    let answer = fs::read_to_string(cwd.path().join("answer.txt")).unwrap();
    assert_eq!(
        answer.trim_start_matches('\u{feff}').replace('\r', ""),
        "actual user input\nnext command\n"
    );
}

#[test]
#[cfg(windows)]
fn powershell_delays_follow_completion_and_ignore_last_pause() {
    let cwd = tempfile::tempdir().unwrap();
    let commands = vec![
        PresetCommand { command: "Start-Sleep -Milliseconds 180; [IO.File]::WriteAllText((Join-Path $pwd 'first.txt'), [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())".into(), delay_ms: 150 },
        PresetCommand { command: "[IO.File]::WriteAllText((Join-Path $pwd 'second.txt'), [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())".into(), delay_ms: 60_000 },
    ];
    let before = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    assert_success(run(ShellKind::PowerShell, &commands, 120, cwd.path(), None));
    let timestamp = |name| {
        fs::read_to_string(cwd.path().join(name))
            .unwrap()
            .parse::<u128>()
            .unwrap()
    };
    assert!(timestamp("first.txt") - before >= 300);
    assert!(timestamp("second.txt") - timestamp("first.txt") >= 150);
}

#[test]
#[cfg(windows)]
fn cmd_returns_from_batch_shims_and_preserves_state_and_exit_codes() {
    let cwd = tempfile::tempdir().unwrap();
    fs::create_dir(cwd.path().join("child space")).unwrap();
    fs::write(
        cwd.path().join("child space/yarn.cmd"),
        "@echo off\r\necho yarn>>trace.txt\r\nexit /b 0\r\n",
    )
    .unwrap();
    let commands = steps(&[
        "set AEMETH_SEQUENCE_TEST=hello & cd /d \"child space\"",
        "yarn.cmd && echo after-shim>>trace.txt",
        "echo %AEMETH_SEQUENCE_TEST%>>trace.txt",
        "echo 中文>>trace.txt",
        "echo release>>trace.txt",
    ]);
    assert_success(run(ShellKind::Cmd, &commands, 0, cwd.path(), None));
    let trace = fs::read_to_string(cwd.path().join("child space/trace.txt")).unwrap();
    assert_eq!(trace, "yarn\r\nafter-shim\r\nhello \r\n中文\r\nrelease\r\n");
    fs::write(cwd.path().join("fail.cmd"), "@exit /b 7\r\n").unwrap();
    let result = run(
        ShellKind::Cmd,
        &steps(&["fail.cmd", "echo bad>should-not-run.txt"]),
        0,
        cwd.path(),
        None,
    );
    assert_eq!(result.0, 7, "{}", result.1);
    assert!(!cwd.path().join("should-not-run.txt").exists());
}

#[test]
fn posix_shells_wait_preserve_state_and_exit_codes() {
    for shell in [ShellKind::Bash, ShellKind::Zsh, ShellKind::Sh] {
        if resolve_shell(&shell).is_err() {
            continue;
        }
        let cwd = tempfile::tempdir().unwrap();
        fs::create_dir(cwd.path().join("child space")).unwrap();
        let commands = steps(&[
            "export AEMETH_SEQUENCE_TEST='值 & quotes'; cd 'child space'",
            "sleep 0.2; printf '%s\\n' fetch >trace.txt # trailing comment",
            "printf '%s\\n' pull yarn \"$AEMETH_SEQUENCE_TEST\" release >>trace.txt",
        ]);
        assert_success(run(shell, &commands, 0, cwd.path(), None));
        assert_eq!(
            fs::read_to_string(cwd.path().join("child space/trace.txt")).unwrap(),
            "fetch\npull\nyarn\n值 & quotes\nrelease\n"
        );
        let result = run(
            shell,
            &steps(&["sh -c 'exit 7'", "echo bad >should-not-run.txt"]),
            0,
            cwd.path(),
            None,
        );
        assert_eq!(result.0, 7, "{}", result.1);
        assert!(!cwd.path().join("should-not-run.txt").exists());
    }
}
