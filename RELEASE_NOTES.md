# borgd 0.1.2

A repository-centered desktop companion for Borg Backup 1.x.

## Latest changes

- Activity uses a two-column layout: recent activity on the left, operation log on the right.
- Every page uses approximately 6px outer padding, including the archive browser.
- Selected-path restores pass negative exclusion patterns safely to older Borg 1.x argument parsers.
- Unix-only Borg integration tests are correctly gated when building Windows packages.

## Features

- Local and SSH repositories, encrypted backups, source profiles, exclusions, and explicit retention previews/application.
- Background worker management and scheduled backups; repository passphrases remain in worker memory, never saved to settings.
- Archive browsing, scoped selective restoration into empty directories, and read-only snapshot comparisons with Go to navigation.
- Repository dashboards, activity diagnostics, and a real integrated terminal.
- Eight dark/light themes, Custom palette/font/layout editing, seeded color editor, and theme JSON import/export.
- In-app feature guides and a collapsible license panel.
- Backup profile rows now include Preview prune between Edit and Back up. It previews the profile's retention policy without deleting archives.

## Downloads

- Linux: download the `.AppImage`, make it executable, and launch it.
- Windows: download and run the `.exe` installer. Borg runs through WSL; install WSL and Borg Backup 1.x inside the default distribution first.
- `SHA256SUMS` contains checksums for both packages.

Borg is not bundled. Borg 2 repositories are not supported. Windows packages are not code-signed and may show SmartScreen warnings. Build/unit-test verification is not a substitute for native Windows UI testing.

Updating the desktop application does not restart an existing worker. Restart the worker explicitly from Settings when backend changes require it; accepted work finishes first and encrypted repositories must then be unlocked again.

Use is governed by the included borgd license. Third-party components retain their own licenses.
