//! Process-manager backend: snapshot every system process (with command line
//! and listening ports) and force-kill whole process trees.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

use crate::ports;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub ppid: Option<u32>,
    pub name: String,
    /// Full command line, arguments joined by spaces.
    pub cmd: String,
    pub exe: Option<String>,
    /// Resident memory in bytes.
    pub memory: u64,
    pub cpu: f32,
    /// Start time, seconds since the epoch.
    pub start_time: u64,
    pub ports: Vec<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessDetail {
    pub pid: u32,
    pub ppid: Option<u32>,
    pub name: String,
    pub cmd: String,
    pub exe: Option<String>,
    pub memory: u64,
    pub cpu: f32,
    pub start_time: u64,
    pub ports: Vec<u16>,
    /// Number of threads (not available via sysinfo on all platforms).
    pub threads: Option<u32>,
    /// Environment variables (KEY=VALUE).
    pub environ: Vec<String>,
    /// Total bytes read (disk I/O).
    pub disk_read_bytes: u64,
    /// Total bytes written (disk I/O).
    pub disk_write_bytes: u64,
}

/// Reused between snapshots so CPU usage is measured over the poll interval.
static SYSTEM: Mutex<Option<System>> = Mutex::new(None);

fn lock_system() -> std::sync::MutexGuard<'static, Option<System>> {
    SYSTEM.lock().unwrap_or_else(|e| e.into_inner())
}

/// Number of logical CPU cores, cached once.
fn cpu_cores() -> f32 {
    use std::sync::OnceLock;
    static CORES: OnceLock<f32> = OnceLock::new();
    *CORES.get_or_init(|| {
        // Use a fresh System to query CPU count so we don't deadlock
        // with the caller that already holds the SYSTEM mutex.
        System::new_all().cpus().len() as f32
    })
}

/// Snapshot of all processes, sorted by pid.
pub fn snapshot() -> Vec<ProcessInfo> {
    let mut slot = lock_system();
    let system = slot.get_or_insert_with(System::new_all);
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new()
            .with_cmd(UpdateKind::Always)
            .with_memory()
            .with_cpu()
            .with_exe(UpdateKind::OnlyIfNotSet),
    );

    let listeners = ports::listening_ports();
    let mut infos: Vec<ProcessInfo> = system
        .processes()
        .iter()
        .map(|(pid, p)| ProcessInfo {
            pid: pid.as_u32(),
            ppid: p.parent().map(|x| x.as_u32()),
            name: p.name().to_string_lossy().into_owned(),
            cmd: p
                .cmd()
                .iter()
                .map(|a| a.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join(" "),
            exe: p.exe().map(|e| e.to_string_lossy().into_owned()),
            memory: p.memory(),
            cpu: p.cpu_usage() / cpu_cores(),
            start_time: p.start_time(),
            ports: listeners.get(&pid.as_u32()).cloned().unwrap_or_default(),
        })
        .collect();
    infos.sort_by_key(|i| i.pid);
    infos
}

/// In‑depth information for a single process (includes environment variables
/// and disk I/O).
pub fn detail(pid: u32) -> Option<ProcessDetail> {
    let mut slot = lock_system();
    let system = slot.get_or_insert_with(System::new_all);
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[Pid::from_u32(pid)]),
        false,
        ProcessRefreshKind::everything(),
    );
    let p = system.processes().get(&Pid::from_u32(pid))?;
    let listeners = ports::listening_ports();
    let disk = p.disk_usage();
    Some(ProcessDetail {
        pid: p.pid().as_u32(),
        ppid: p.parent().map(|x| x.as_u32()),
        name: p.name().to_string_lossy().into_owned(),
        cmd: p
            .cmd()
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join(" "),
        exe: p.exe().map(|e| e.to_string_lossy().into_owned()),
        memory: p.memory(),
        cpu: p.cpu_usage() / cpu_cores(),
        start_time: p.start_time(),
        ports: listeners.get(&pid).cloned().unwrap_or_default(),
        threads: None,
        environ: p
            .environ()
            .iter()
            .map(|e| e.to_string_lossy().into_owned())
            .collect(),
        disk_read_bytes: disk.total_read_bytes,
        disk_write_bytes: disk.total_written_bytes,
    })
}

/// Force-kill the selected process and its verified descendants, children first.
/// Parent PIDs can be reused, so an older process is never treated as a child
/// of a newer parent. Unknown timestamps cannot establish ancestry safely.
pub fn kill_tree(root: u32, expected_start: u64) -> Result<usize, String> {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let root_process = system
        .process(Pid::from_u32(root))
        .ok_or("process already exited")?;
    if expected_start != 0 && root_process.start_time() != expected_start {
        return Err("process changed since the list was displayed; refresh and try again".into());
    }

    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut uncertain_children: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, process) in system.processes() {
        if let Some(parent) = process.parent() {
            if let Some(parent_process) = system.process(parent) {
                let parent_start = parent_process.start_time();
                let child_start = process.start_time();
                if parent_start == 0 || child_start == 0 {
                    uncertain_children
                        .entry(parent.as_u32())
                        .or_default()
                        .push(pid.as_u32());
                } else if child_start >= parent_start {
                    children
                        .entry(parent.as_u32())
                        .or_default()
                        .push(pid.as_u32());
                }
            }
        }
    }
    let mut order = Vec::new();
    let mut seen = HashSet::from([root]);
    let mut stack = vec![root];
    let mut failures = Vec::new();
    while let Some(pid) = stack.pop() {
        if let Some(process) = system.process(Pid::from_u32(pid)) {
            order.push((
                pid,
                if pid == root {
                    expected_start
                } else {
                    process.start_time()
                },
            ));
        }
        if let Some(kids) = uncertain_children.get(&pid) {
            for kid in kids {
                failures.push(format!(
                    "PID {kid}: could not verify parent relationship; skipped"
                ));
            }
        }
        if let Some(kids) = children.get(&pid) {
            for &kid in kids {
                if seen.insert(kid) {
                    stack.push(kid);
                }
            }
        }
    }

    let mut killed = 0;
    for &(pid, start) in order.iter().rev() {
        match force_terminate(&system, pid, start) {
            Ok(true) => killed += 1,
            Ok(false) if pid == root => {
                failures.push(format!("PID {pid}: process already exited or changed"))
            }
            Ok(false) => {} // A descendant already exited or its PID was reused.
            Err(error) => failures.push(format!("PID {pid}: {error}")),
        }
    }
    if !failures.is_empty() {
        return Err(format!(
            "{killed} process(es) stopped; failed to stop {}",
            failures.join("; ")
        ));
    }
    Ok(killed)
}

#[cfg(windows)]
fn force_terminate(_system: &System, pid: u32, expected_start: u64) -> Result<bool, String> {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, TerminateProcess, WaitForSingleObject,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };
    const SYNCHRONIZE: u32 = 0x0010_0000;
    // A handle pins the process object, avoiding a PID reuse race after opening.
    let handle = unsafe {
        OpenProcess(
            PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
            0,
            pid,
        )
    };
    if handle.is_null() {
        let error = std::io::Error::last_os_error();
        return match error.raw_os_error() {
            Some(87) => Ok(false), // PID no longer exists.
            Some(5) => Err("access denied; run Aemeth Terminal as administrator if appropriate (Windows may protect this process)".into()),
            _ => Err(error.to_string()),
        };
    }
    let result = (|| {
        let mut creation = FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        };
        let mut exit = creation;
        let mut kernel = creation;
        let mut user = creation;
        if unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) } == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let ticks = (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime);
        let actual_start = (ticks / 10_000_000).saturating_sub(11_644_473_600);
        if expected_start == 0 {
            return Err("cannot verify the process identity; refresh and try again".into());
        }
        if actual_start != expected_start {
            return Ok(false);
        }
        if unsafe { WaitForSingleObject(handle, 0) } == WAIT_OBJECT_0 {
            return Ok(false);
        }
        if unsafe { TerminateProcess(handle, 1) } == 0 {
            let error = std::io::Error::last_os_error();
            if unsafe { WaitForSingleObject(handle, 0) } == WAIT_OBJECT_0 {
                return Ok(false);
            }
            return Err(error.to_string());
        }
        if unsafe { WaitForSingleObject(handle, 2000) } != WAIT_OBJECT_0 {
            return Err("termination requested, but the process did not exit in time".into());
        }
        Ok(true)
    })();
    unsafe {
        CloseHandle(handle);
    }
    result
}

#[cfg(not(windows))]
fn force_terminate(system: &System, pid: u32, expected_start: u64) -> Result<bool, String> {
    let Some(process) = system.process(Pid::from_u32(pid)) else {
        return Ok(false);
    };
    if expected_start == 0 || process.start_time() != expected_start {
        return Err("cannot verify the process identity; refresh and try again".into());
    }
    if process.kill() {
        Ok(true)
    } else {
        Err(
            "termination failed; the process may have exited or require additional permissions"
                .into(),
        )
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn terminates_only_the_matching_process_identity() {
        use std::os::windows::process::CommandExt;
        let mut child = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", "Start-Sleep -Seconds 30"])
            .creation_flags(0x0800_0000)
            .spawn()
            .expect("spawn test process");
        let pid = child.id();
        let mut system = System::new_all();
        system.refresh_processes(ProcessesToUpdate::All, true);
        let start = system
            .process(Pid::from_u32(pid))
            .expect("test process in snapshot")
            .start_time();
        assert_ne!(start, 0);
        assert!(!force_terminate(&system, pid, start + 1).expect("different identity is safe"));
        assert!(child.try_wait().expect("check child").is_none());
        assert!(force_terminate(&system, pid, start).expect("terminate child"));
        assert!(child.wait().is_ok());
    }
}
