// Annotated fixture for manifests/semgrep-classes/shell-command-assembled.yaml.
use std::process::Command;

fn assembled(path: &str) {
    // ruleid: cw-shell-command-assembled-rust
    Command::new("sh").arg("-c").arg(format!("tar -xf {path}")).status().unwrap();
}

fn assembled_args(cmd: String) {
    // ruleid: cw-shell-command-assembled-rust
    Command::new("bash").args(["-c", &cmd]).output().unwrap();
}

fn literal_script() {
    // ok: cw-shell-command-assembled-rust
    Command::new("sh").arg("-c").arg("make -j4").status().unwrap();
}

fn direct(path: &str) {
    // ok: cw-shell-command-assembled-rust
    Command::new("tar").arg("-xf").arg(path).status().unwrap();
}
