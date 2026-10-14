fn main() {
    tauri_build::build();

    let hash = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "nogit".into());
    println!("cargo:rustc-env=SOROKA_GIT_HASH={hash}");
}
