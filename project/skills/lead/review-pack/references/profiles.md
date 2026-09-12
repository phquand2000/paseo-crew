# Review Pack Profiles

Use these profile names with `python3 SKILL_DIR/scripts/review_pack.py create --profile NAME`.

- `rust`: Rust crates and workspaces. Includes `Cargo.toml`, lock/toolchain/config files, `.rs`, `.toml`, and Markdown. With `--exclude-tests`, excludes common test paths and strips `#[cfg(test)]` blocks from included Rust source.
- `go`: Go modules/workspaces. Includes module files and `.go`; with `--exclude-tests`, excludes `*_test.go`.
- `vue`: Vue/Vite/TypeScript frontends. Includes package/lock/config files, Vue, TS/JS, CSS/SCSS, JSON, and Markdown; with `--exclude-tests`, excludes common spec/test files and snapshots.
- `swift-ios`: Swift iOS app source. Includes Swift, Objective-C bridge files, Xcode project/workspace metadata, plists, storyboards, xibs, xcconfig, and Markdown; with `--exclude-tests`, excludes `*Tests`, `*UITests`, and common Swift test files.
- `changed-files`: Uses `git status --porcelain` as the file source and includes all changed files that survive excludes.
- `generic`: General repository pack.

Default heavy-output excludes include git metadata, build outputs, dependency folders, reports, common image/binary/archive formats, `target`, `node_modules`, `DerivedData`, `.build`, `Pods`, and `Carthage`.
