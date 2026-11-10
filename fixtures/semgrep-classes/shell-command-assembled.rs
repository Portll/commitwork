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

// Test code builds a shell line from its own fixtures; it is not attack surface.
#[cfg(test)]
mod tests {
    use std::process::Command;

    fn reads_through_a_shell(reads: String) {
        // ok: cw-shell-command-assembled-rust
        let direct = std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg(&reads)
            .output()
            .unwrap();
    }
}

#[test]
fn unit_test_with_a_shell_line() {
    let line = String::from("echo hi");
    // ok: cw-shell-command-assembled-rust
    Command::new("sh").arg("-c").arg(&line).status().unwrap();
}

fn production_shell_line_after_a_test_module(line: &str) {
    // ruleid: cw-shell-command-assembled-rust
    Command::new("/bin/sh").arg("-c").arg(line).status().unwrap();
}
