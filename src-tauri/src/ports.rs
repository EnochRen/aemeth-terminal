//! OS-level port discovery: which TCP ports a session's process tree listens on.
//!
//! The listening process is usually a grandchild of the spawned shell
//! (shell → yarn → node), so we first expand the shell pid into its full
//! descendant set (via `sysinfo`) and then intersect it with the system's
//! listening TCP sockets (parsed from `netstat` / `lsof` / `ss`).

use std::collections::{HashMap, HashSet};
use std::process::Command;

/// Parent→children adjacency, built once per poll tick.
pub struct ProcessTable {
    children: HashMap<u32, Vec<u32>>,
}

impl ProcessTable {
    pub fn snapshot() -> Self {
        let system = sysinfo::System::new_all();
        let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
        for (pid, process) in system.processes() {
            if let Some(parent) = process.parent() {
                children.entry(parent.as_u32()).or_default().push(pid.as_u32());
            }
        }
        Self { children }
    }

    /// `root` plus all transitive descendants.
    pub fn descendants(&self, root: u32) -> HashSet<u32> {
        let mut set = HashSet::from([root]);
        let mut stack = vec![root];
        while let Some(pid) = stack.pop() {
            if let Some(kids) = self.children.get(&pid) {
                for &kid in kids {
                    if set.insert(kid) {
                        stack.push(kid);
                    }
                }
            }
        }
        set
    }
}

/// pid → listening TCP ports.
pub fn listening_ports() -> HashMap<u32, Vec<u16>> {
    let mut map = if cfg!(windows) {
        netstat_windows()
    } else if cfg!(target_os = "macos") {
        lsof_unix()
    } else {
        ss_linux()
    };
    for ports in map.values_mut() {
        ports.sort_unstable();
        ports.dedup();
    }
    map
}

/// Port suffix of a `host:port` / `[::]:port` address.
fn port_of(addr: &str) -> Option<u16> {
    addr.rsplit(':').next()?.parse().ok()
}

/// Spawn without flashing a console window on Windows.
fn quiet_command(program: &str, args: &[&str]) -> Command {
    let mut cmd = Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn run_lossy(program: &str, args: &[&str]) -> String {
    quiet_command(program, args)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
}

/// Windows: `netstat -ano`
/// `  TCP    0.0.0.0:5173    0.0.0.0:0    LISTENING    1234`
fn netstat_windows() -> HashMap<u32, Vec<u16>> {
    let mut map: HashMap<u32, Vec<u16>> = HashMap::new();
    for line in run_lossy("netstat", &["-ano"]).lines() {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.len() != 5 || tokens[0] != "TCP" || tokens[3] != "LISTENING" {
            continue;
        }
        let Ok(pid) = tokens[4].parse::<u32>() else { continue };
        if let Some(port) = port_of(tokens[1]) {
            map.entry(pid).or_default().push(port);
        }
    }
    map
}

/// macOS: `lsof -i TCP -s TCP:LISTEN -P -n`
/// `node  1234  user  21u  IPv6  0x..  0t0  TCP  *:5173  (LISTEN)`
fn lsof_unix() -> HashMap<u32, Vec<u16>> {
    let mut map: HashMap<u32, Vec<u16>> = HashMap::new();
    for line in run_lossy("lsof", &["-i", "TCP", "-s", "TCP:LISTEN", "-P", "-n"]).lines() {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.len() < 10 || tokens[7] != "TCP" {
            continue;
        }
        let Ok(pid) = tokens[1].parse::<u32>() else { continue };
        if let Some(port) = port_of(tokens[8]) {
            map.entry(pid).or_default().push(port);
        }
    }
    map
}

/// Linux: `ss -tlnp`
/// `LISTEN 0 511 0.0.0.0:5173 0.0.0.0:* users:(("node",pid=1234,fd=21))`
fn ss_linux() -> HashMap<u32, Vec<u16>> {
    let mut map: HashMap<u32, Vec<u16>> = HashMap::new();
    for line in run_lossy("ss", &["-tlnp"]).lines() {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.len() < 4 || tokens[0] != "LISTEN" {
            continue;
        }
        let Some(pid_token) = tokens.iter().find(|t| t.contains("pid=")) else {
            continue;
        };
        let Some(pid_part) = pid_token.split("pid=").nth(1) else { continue };
        let Ok(pid) = pid_part
            .split(|c: char| !c.is_ascii_digit())
            .next()
            .unwrap_or_default()
            .parse::<u32>()
        else {
            continue;
        };
        if let Some(port) = port_of(tokens[3]) {
            map.entry(pid).or_default().push(port);
        }
    }
    map
}
