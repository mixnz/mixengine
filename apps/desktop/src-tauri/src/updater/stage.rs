//! Download, check, unpack and try the payload before anything installed is touched — spec D4
//! steps 2 to 4.

use std::collections::BTreeMap;
use std::io::Read as _;
use std::path::{Component, Path};

use sha2::{Digest as _, Sha256};

/// Download `url` to `dest`, reporting `(received, total)`, and check it against `sha256`.
///
/// A partial file from an earlier try is resumed with a `Range` request when the server honours
/// it, and started again when it does not. A file whose checksum is wrong is removed.
pub async fn download(
    http: &reqwest::Client,
    url: &str,
    sha256: &str,
    dest: &Path,
    progress: impl Fn(u64, u64),
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt as _;

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let mut partial = dest.as_os_str().to_owned();
    partial.push(".partial");
    let partial = std::path::PathBuf::from(partial);
    let have = tokio::fs::metadata(&partial)
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    let mut request = http.get(url);
    if have > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let mut response = request
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| e.to_string())?;
    let resumed = response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let start = if resumed { have } else { 0 };
    let total = start + response.content_length().unwrap_or(0);

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(resumed)
        .truncate(!resumed)
        .open(&partial)
        .await
        .map_err(|e| e.to_string())?;
    let mut received = start;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        progress(received, total);
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    let (checked, expected) = (partial.clone(), sha256.to_owned());
    tokio::task::spawn_blocking(move || check_sha256(&checked, &expected))
        .await
        .map_err(|e| e.to_string())??;
    tokio::fs::rename(&partial, dest)
        .await
        .map_err(|e| e.to_string())
}

/// Whether the file at `path` hashes to `expected`. A file that does not is removed, so the next
/// try starts clean rather than resuming a wrong one.
pub fn check_sha256(path: &Path, expected: &str) -> Result<(), String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; 1 << 16];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    drop(file);
    let actual = format!("{:x}", hasher.finalize());
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        let _ = std::fs::remove_file(path);
        Err(format!(
            "the download's SHA-256 is {actual}, and the feed says {expected}"
        ))
    }
}

/// Unpack exactly the entries `provides` names into `into`. A path that would land outside `into`
/// is refused, and so is a name the archive does not carry.
pub fn unpack(
    archive: &Path,
    provides: &BTreeMap<String, String>,
    into: &Path,
) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    for (name, relative) in provides {
        let inside = Path::new(relative);
        if inside
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err(format!(
                "{name}: {relative} is not a path inside the archive"
            ));
        }
        let mut entry = zip
            .by_name(relative)
            .map_err(|_| format!("the archive has no {relative} for {name}"))?;
        let target = into.join(inside);
        std::fs::create_dir_all(target.parent().unwrap_or(into)).map_err(|e| e.to_string())?;
        let mut out = std::fs::File::create(&target).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Run the staged `mixengined --version` and check it names `version`: the check that catches a
/// payload for another machine, or one Smart App Control refuses.
pub fn smoke_test(
    staged: &Path,
    provides: &BTreeMap<String, String>,
    version: &str,
) -> Result<(), String> {
    let Some(relative) = provides.get("mixengined") else {
        // A payload with no daemon has nothing to try; the window is tried by its own relaunch.
        return Ok(());
    };
    let mut command = std::process::Command::new(staged.join(relative));
    command.arg("--version");
    let output = crate::platform::hide_console(&mut command)
        .output()
        .map_err(|e| format!("the new mixengined did not run here: {e}"))?;
    let printed = String::from_utf8_lossy(&output.stdout);
    if output.status.success() && printed.contains(version) {
        Ok(())
    } else {
        Err(format!(
            "the new mixengined did not run here: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::io::Write as _;

    fn zip_with(entries: &[(&str, &[u8])]) -> tempfile::NamedTempFile {
        let file = tempfile::NamedTempFile::new().unwrap();
        let mut writer = zip::ZipWriter::new(file.reopen().unwrap());
        for (name, bytes) in entries {
            writer
                .start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
        file
    }

    #[test]
    fn only_the_named_entries_are_unpacked() {
        let archive = zip_with(&[("mixengine/mix.exe", b"mix"), ("mixengine/extra.txt", b"x")]);
        let into = tempfile::tempdir().unwrap();
        let provides = BTreeMap::from([("mix".to_owned(), "mixengine/mix.exe".to_owned())]);
        unpack(archive.path(), &provides, into.path()).unwrap();
        assert!(into.path().join("mixengine/mix.exe").exists());
        assert!(!into.path().join("mixengine/extra.txt").exists());
    }

    #[test]
    fn a_path_that_escapes_the_staging_directory_is_refused() {
        let archive = zip_with(&[("../escape.exe", b"x")]);
        let into = tempfile::tempdir().unwrap();
        let provides = BTreeMap::from([("escape".to_owned(), "../escape.exe".to_owned())]);
        assert!(unpack(archive.path(), &provides, into.path()).is_err());
        assert!(!into.path().parent().unwrap().join("escape.exe").exists());
    }

    #[test]
    fn a_name_the_archive_lacks_is_refused() {
        let archive = zip_with(&[("mixengine/mix.exe", b"mix")]);
        let into = tempfile::tempdir().unwrap();
        let provides = BTreeMap::from([(
            "mixengined".to_owned(),
            "mixengine/mixengined.exe".to_owned(),
        )]);
        assert!(unpack(archive.path(), &provides, into.path()).is_err());
    }

    #[test]
    fn a_checksum_that_does_not_match_is_refused_and_the_file_removed() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("payload.zip");
        std::fs::write(&path, b"payload").unwrap();
        let right = "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5";
        assert!(check_sha256(&path, right).is_ok());
        assert!(check_sha256(&path, &"0".repeat(64)).is_err());
        assert!(!path.exists(), "a wrong file is not kept for a resume");
    }
}
