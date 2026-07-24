use std::path::Path;

pub struct SkillMeta {
    pub name: Option<String>,
    pub description: Option<String>,
}

fn read_named_file_exact(dir: &Path, target_name: &str) -> Option<String> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        if !entry.file_type().ok()?.is_file() {
            continue;
        }
        if entry.file_name().to_string_lossy() == target_name {
            return std::fs::read_to_string(entry.path()).ok();
        }
    }
    None
}

fn has_named_file_exact(dir: &Path, target_name: &str) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        entry.file_type().map(|ft| ft.is_file()).unwrap_or(false)
            && entry.file_name().to_string_lossy() == target_name
    })
}

pub fn parse_skill_md(dir: &Path) -> SkillMeta {
    parse_skill_md_with_candidates(dir, &["SKILL.md", "skill.md"])
}

fn parse_skill_md_with_candidates(dir: &Path, candidates: &[&str]) -> SkillMeta {
    for candidate in candidates {
        if let Some(content) = read_named_file_exact(dir, candidate) {
            return parse_frontmatter(&content);
        }
    }
    SkillMeta {
        name: None,
        description: None,
    }
}

fn parse_frontmatter(content: &str) -> SkillMeta {
    let trimmed = content.trim();
    if !trimmed.starts_with("---") {
        return SkillMeta {
            name: None,
            description: None,
        };
    }

    let rest = &trimmed[3..];
    if let Some(end) = rest.find("---") {
        let yaml_str = &rest[..end];
        if let Ok(yaml) = serde_yaml::from_str::<serde_yaml::Value>(yaml_str) {
            let name = yaml
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let description = yaml
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            return SkillMeta { name, description };
        }
    }

    SkillMeta {
        name: None,
        description: None,
    }
}

/// Skill directory marker files used across the application.
const SKILL_DIR_MARKERS: &[&str] = &["SKILL.md", "skill.md"];

/// Check whether a directory looks like a valid skill directory
/// (contains at least one recognised marker file).
pub fn is_valid_skill_dir(dir: &Path) -> bool {
    dir.is_dir()
        && SKILL_DIR_MARKERS
            .iter()
            .any(|name| has_named_file_exact(dir, name))
}

/// Characters that are invalid in Windows file/directory names.
const WINDOWS_RESERVED: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Reserved Windows device names that cannot be used as file/directory names.
const WINDOWS_RESERVED_BASENAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Sanitize a skill name so it is safe to use as a single directory component
/// on all major platforms (macOS, Linux, Windows).
///
/// Security-focused with cross-platform safety:
/// - Strips path traversal (`../`) via `Path::file_name()`
/// - Rejects bare `.` and `..`
/// - Replaces control characters with `_` (preserves position for near-injectivity)
/// - Replaces Windows-reserved characters (`<>:"/\|?*`) with `_`
/// - Trims leading/trailing whitespace and dots (Windows rejects trailing dots)
///
/// Returns `None` if the result would be empty or unsafe.
pub fn sanitize_skill_name(name: &str) -> Option<String> {
    // Take only the last path component — strips any leading `../` sequences.
    let last = std::path::Path::new(name)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())?;

    // Reject bare `.` and `..` (file_name() returns None for `..` on most
    // platforms, but be explicit for cross-platform safety).
    if last == ".." || last == "." {
        return None;
    }

    // Replace control characters and Windows-reserved characters with `_`.
    // Using replacement instead of removal preserves character positions,
    // making the mapping nearly injective (distinct inputs → distinct outputs).
    let clean: String = last
        .chars()
        .map(|c| {
            if c.is_control() || WINDOWS_RESERVED.contains(&c) {
                '_'
            } else {
                c
            }
        })
        .collect();

    // Trim whitespace and trailing dots (Windows ignores trailing dots/spaces
    // in directory names, which would cause silent mismatches).
    let trimmed = clean.trim().trim_end_matches('.');
    if trimmed.is_empty() {
        None
    } else {
        let reserved = trimmed
            .split('.')
            .next()
            .map(|base| base.to_ascii_uppercase())
            .map(|upper| WINDOWS_RESERVED_BASENAMES.contains(&upper.as_str()))
            .unwrap_or(false);

        if reserved {
            Some(format!("_{}", trimmed))
        } else {
            Some(trimmed.to_string())
        }
    }
}

pub fn infer_skill_name(dir: &Path) -> String {
    let meta = parse_skill_md(dir);
    if let Some(name) = meta.name {
        if let Some(sanitized) = sanitize_skill_name(&name) {
            return sanitized;
        }
    }
    dir.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown-skill".to_string())
}

// ── description stripping (in-place frontmatter editor) ──

/// Outcome of [`strip_description_from_skill_dir`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StripOutcome {
    /// A `description` field was found and its value was cleared (key kept).
    Stripped,
    /// The SKILL.md had a frontmatter but no `description` field.
    NoDescription,
    /// No SKILL.md / skill.md file in this directory.
    NotASkill,
}

/// Clear the `description` field value in a SKILL.md document, keeping the
/// key (`description:`) present but with an empty value.
/// Everything else is preserved byte-for-byte.
///
/// Handles all common YAML representations of the value:
/// - Plain / single-quoted / double-quoted scalars on one line
///   (`description: foo`, `description: "foo"`, `description: 'foo'`)
/// - Block scalars (`description: |` / `description: >`), whose multi-line
///   body is also removed.
///
/// If the document has no frontmatter, or the frontmatter has no
/// `description` key, the content is returned unchanged.
pub fn strip_description_line(content: &str) -> String {
    // Split into the frontmatter block (between the first two `---` fences)
    // and the rest of the document. Only the frontmatter is edited.
    let lines: Vec<&str> = content.split_inclusive('\n').collect();
    if lines.is_empty() {
        return content.to_string();
    }
    let first_line_trimmed = lines[0].trim_end_matches(['\r', '\n']);
    if first_line_trimmed != "---" {
        // No frontmatter at all.
        return content.to_string();
    }

    // Find the closing `---` fence (the first line equal to `---` after line 0).
    let mut close_idx = None;
    for (i, line) in lines.iter().enumerate().skip(1) {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            close_idx = Some(i);
            break;
        }
    }
    let close_idx = match close_idx {
        Some(i) => i,
        None => return content.to_string(), // unterminated frontmatter — leave untouched
    };

    // Locate the `description:` key inside the frontmatter.
    let mut key_idx = None;
    for i in 1..close_idx {
        let line = lines[i].trim_end_matches(['\r', '\n']);
        // Match `description:` at column 0 (top-level key only — nested keys
        // under other mappings are indented and must be left alone).
        let stripped = line.strip_prefix(' ').unwrap_or(line);
        if !stripped.is_empty() && stripped.starts_with(' ') {
            continue; // indented, not a top-level key
        }
        if let Some(rest) = line.strip_prefix("description:") {
            // The remainder, trimmed, must be empty, a YAML value, or start
            // a block scalar. Distinguish from keys like `description_url:`.
            // `strip_prefix("description:")` already rejects `description_url:`.
            let _ = rest; // value handled below
            key_idx = Some(i);
            break;
        }
    }
    let key_idx = match key_idx {
        Some(i) => i,
        None => return content.to_string(), // no description field — nothing to do
    };

    // Determine the span of lines to remove.
    let key_value_trimmed = lines[key_idx]
        .trim_end_matches(['\r', '\n'])
        .strip_prefix("description:")
        .unwrap_or("")
        .trim_start();
    let last_to_remove = if key_value_trimmed == "|" || key_value_trimmed == ">"
        || key_value_trimmed.starts_with("|")
        || key_value_trimmed.starts_with(">")
    {
        // Block scalar: consume the key line plus every following line that is
        // either blank or more-indented than column 0, until the closing
        // fence or the next top-level key.
        let mut j = key_idx + 1;
        while j < close_idx {
            let raw = lines[j];
            let line = raw.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                j += 1;
                continue;
            }
            // A non-indented, non-blank line means the block scalar body ended.
            if !line.starts_with(' ') && !line.starts_with('\t') {
                break;
            }
            j += 1;
        }
        // Trim trailing blank lines that belonged to the block, so we don't
        // leave a gap in the frontmatter.
        while j > key_idx + 1 && lines[j - 1].trim().is_empty() {
            j -= 1;
        }
        j - 1
    } else {
        // Single-line scalar (plain/quoted/folded-on-one-line).
        key_idx
    };

    // Rebuild the document: keep `description:` key but clear its value.
    let mut out = String::with_capacity(content.len());
    for (i, line) in lines.iter().enumerate() {
        if i == key_idx {
            // Preserve the `description:` key with an empty value.
            // Preserve the original line ending style (\n or \r\n).
            let ending = if line.ends_with("\r\n") { "\r\n" } else { "\n" };
            out.push_str("description:");
            out.push_str(ending);
        } else if i > key_idx && i <= last_to_remove {
            continue; // skip block scalar body lines (if any)
        } else {
            out.push_str(line);
        }
    }
    out
}

/// Strip the `description` field from the SKILL.md (or skill.md) inside `dir`,
/// writing the file back only when it actually changed.
pub fn strip_description_from_skill_dir(dir: &Path) -> std::io::Result<StripOutcome> {
    for candidate in &["SKILL.md", "skill.md"] {
        let path = dir.join(candidate);
        if !path.is_file() {
            continue;
        }
        let original = std::fs::read_to_string(&path)?;
        let stripped = strip_description_line(&original);
        if stripped == original {
            return Ok(StripOutcome::NoDescription);
        }
        std::fs::write(&path, stripped)?;
        return Ok(StripOutcome::Stripped);
    }
    Ok(StripOutcome::NotASkill)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    // ── parse_frontmatter ──

    #[test]
    fn parse_frontmatter_full() {
        let content = "---\nname: my-skill\ndescription: A great skill\n---\n# Content";
        let meta = parse_frontmatter(content);
        assert_eq!(meta.name.as_deref(), Some("my-skill"));
        assert_eq!(meta.description.as_deref(), Some("A great skill"));
    }

    #[test]
    fn parse_frontmatter_name_only() {
        let content = "---\nname: test-skill\n---\n";
        let meta = parse_frontmatter(content);
        assert_eq!(meta.name.as_deref(), Some("test-skill"));
        assert_eq!(meta.description, None);
    }

    #[test]
    fn parse_frontmatter_no_frontmatter() {
        let content = "# Just markdown\nNo frontmatter here.";
        let meta = parse_frontmatter(content);
        assert_eq!(meta.name, None);
        assert_eq!(meta.description, None);
    }

    #[test]
    fn parse_frontmatter_empty_string() {
        let meta = parse_frontmatter("");
        assert_eq!(meta.name, None);
    }

    #[test]
    fn parse_frontmatter_invalid_yaml() {
        let content = "---\n: : broken yaml\n---\n";
        let meta = parse_frontmatter(content);
        // Should not panic, just return None
        assert_eq!(meta.name, None);
    }

    #[test]
    fn parse_frontmatter_extra_fields_ignored() {
        let content = "---\nname: foo\nauthor: bar\nversion: 1.0\n---\n";
        let meta = parse_frontmatter(content);
        assert_eq!(meta.name.as_deref(), Some("foo"));
    }

    // ── parse_skill_md (filesystem) ──

    #[test]
    fn parse_skill_md_reads_skill_md() {
        let tmp = tempdir().unwrap();
        fs::write(
            tmp.path().join("SKILL.md"),
            "---\nname: from-skill\ndescription: desc\n---\n",
        )
        .unwrap();

        let meta = parse_skill_md(tmp.path());
        assert_eq!(meta.name.as_deref(), Some("from-skill"));
        assert_eq!(meta.description.as_deref(), Some("desc"));
    }

    #[test]
    fn parse_skill_md_reads_lowercase_skill_md() {
        let tmp = tempdir().unwrap();
        fs::write(
            tmp.path().join("skill.md"),
            "---\nname: from-lowercase\ndescription: desc\n---\n",
        )
        .unwrap();

        let meta = parse_skill_md(tmp.path());
        assert_eq!(meta.name.as_deref(), Some("from-lowercase"));
        assert_eq!(meta.description.as_deref(), Some("desc"));
    }

    #[test]
    fn parse_skill_md_ignores_claude_md() {
        let tmp = tempdir().unwrap();
        fs::write(
            tmp.path().join("CLAUDE.md"),
            "---\nname: from-claude\n---\n",
        )
        .unwrap();

        let meta = parse_skill_md(tmp.path());
        assert_eq!(meta.name, None);
    }

    #[test]
    fn parse_skill_md_prefers_skill_md_when_claude_md_is_present() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("SKILL.md"), "---\nname: from-skill\n---\n").unwrap();
        fs::write(
            tmp.path().join("CLAUDE.md"),
            "---\nname: from-claude\n---\n",
        )
        .unwrap();

        let meta = parse_skill_md(tmp.path());
        assert_eq!(meta.name.as_deref(), Some("from-skill"));
    }

    #[test]
    fn parse_skill_md_empty_dir() {
        let tmp = tempdir().unwrap();
        let meta = parse_skill_md(tmp.path());
        assert_eq!(meta.name, None);
        assert_eq!(meta.description, None);
    }

    // ── is_valid_skill_dir ──

    #[test]
    fn is_valid_skill_dir_with_skill_md() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("SKILL.md"), "content").unwrap();
        assert!(is_valid_skill_dir(tmp.path()));
    }

    #[test]
    fn is_valid_skill_dir_accepts_lowercase_skill_md() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("skill.md"), "content").unwrap();
        assert!(is_valid_skill_dir(tmp.path()));
    }

    #[test]
    fn is_valid_skill_dir_ignores_readme_only_dirs() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("README.md"), "content").unwrap();
        assert!(!is_valid_skill_dir(tmp.path()));
    }

    #[test]
    fn is_valid_skill_dir_ignores_claude_only_dirs() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("CLAUDE.md"), "content").unwrap();
        assert!(!is_valid_skill_dir(tmp.path()));
    }

    #[test]
    fn is_valid_skill_dir_empty() {
        let tmp = tempdir().unwrap();
        assert!(!is_valid_skill_dir(tmp.path()));
    }

    #[test]
    fn is_valid_skill_dir_file_not_dir() {
        let tmp = tempdir().unwrap();
        let file = tmp.path().join("not-a-dir");
        fs::write(&file, "content").unwrap();
        assert!(!is_valid_skill_dir(&file));
    }

    // ── sanitize_skill_name ──

    #[test]
    fn sanitize_normal_name() {
        assert_eq!(sanitize_skill_name("my-skill"), Some("my-skill".into()));
    }

    #[test]
    fn sanitize_strips_path_traversal() {
        assert_eq!(
            sanitize_skill_name("../../../../.bashrc"),
            Some(".bashrc".into())
        );
    }

    #[test]
    fn sanitize_rejects_dotdot() {
        assert_eq!(sanitize_skill_name(".."), None);
        assert_eq!(sanitize_skill_name("."), None);
    }

    #[test]
    fn sanitize_preserves_spaces_and_unicode() {
        assert_eq!(
            sanitize_skill_name("my skill (v2)"),
            Some("my skill (v2)".into())
        );
        assert_eq!(sanitize_skill_name("技能-测试"), Some("技能-测试".into()));
    }

    #[test]
    fn sanitize_distinct_inputs_produce_distinct_outputs() {
        // "a b" and "a-b" must NOT collapse to the same name.
        let a = sanitize_skill_name("a b");
        let b = sanitize_skill_name("a-b");
        assert_ne!(a, b);
    }

    #[test]
    fn sanitize_replaces_control_chars_with_underscore() {
        // Replace rather than remove, so "a\x00b" → "a_b" not "ab"
        assert_eq!(sanitize_skill_name("a\x00b\x07c"), Some("a_b_c".into()));
    }

    #[test]
    fn sanitize_replaces_windows_reserved_chars() {
        assert_eq!(
            sanitize_skill_name("foo:bar*baz"),
            Some("foo_bar_baz".into())
        );
        assert_eq!(sanitize_skill_name("a<b>c"), Some("a_b_c".into()));
    }

    #[test]
    fn sanitize_trims_whitespace_and_trailing_dots() {
        assert_eq!(sanitize_skill_name("  foo  "), Some("foo".into()));
        assert_eq!(sanitize_skill_name("bar..."), Some("bar".into()));
    }

    #[test]
    fn sanitize_rejects_empty_after_cleaning() {
        assert_eq!(sanitize_skill_name("   "), None);
        assert_eq!(sanitize_skill_name("..."), None);
    }

    #[test]
    fn sanitize_control_only_input_produces_underscores() {
        // Control chars become `_`, not removed — so result is non-empty.
        assert_eq!(sanitize_skill_name("\x00\x01"), Some("__".into()));
    }

    #[test]
    fn sanitize_avoids_windows_reserved_device_names() {
        assert_eq!(sanitize_skill_name("CON"), Some("_CON".into()));
        assert_eq!(sanitize_skill_name("nul.txt"), Some("_nul.txt".into()));
        assert_eq!(sanitize_skill_name("Com1"), Some("_Com1".into()));
    }

    // ── infer_skill_name ──

    #[test]
    fn infer_skill_name_from_metadata() {
        let tmp = tempdir().unwrap();
        let skill_dir = tmp.path().join("directory-name");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: metadata-name\n---\n",
        )
        .unwrap();

        assert_eq!(infer_skill_name(&skill_dir), "metadata-name");
    }

    #[test]
    fn infer_skill_name_falls_back_to_dirname() {
        let tmp = tempdir().unwrap();
        let skill_dir = tmp.path().join("my-cool-skill");
        fs::create_dir_all(&skill_dir).unwrap();

        assert_eq!(infer_skill_name(&skill_dir), "my-cool-skill");
    }

    // ── strip_description_line ──

    #[test]
    fn strip_description_single_line() {
        let content = "---\nname: foo\ndescription: hello world\n---\nbody\n";
        let out = strip_description_line(content);
        // `description:` key stays, value is cleared
        assert!(out.contains("description:"));
        assert!(out.contains("name: foo"));
        assert!(out.contains("body"));
        // Check exact output
        assert_eq!(out, "---\nname: foo\ndescription:\n---\nbody\n");
    }

    #[test]
    fn strip_description_quoted_value() {
        let content = "---\nname: foo\ndescription: \"a 'b' c\"\n---\n";
        let out = strip_description_line(content);
        assert!(out.contains("description:"));
        assert!(out.contains("name: foo"));
    }

    #[test]
    fn strip_description_block_scalar_literal() {
        let content = "---\nname: foo\ndescription: |\n  line one\n  line two\n---\nbody\n";
        let out = strip_description_line(content);
        // `description:` key stays empty, block body removed
        assert!(out.contains("description:"));
        assert!(!out.contains("line one"));
        assert!(!out.contains("line two"));
        assert!(out.contains("name: foo"));
        assert!(out.contains("body"));
    }

    #[test]
    fn strip_description_block_scalar_folded() {
        let content = "---\nname: foo\ndescription: >\n  folded\n  text\n---\n";
        let out = strip_description_line(content);
        assert!(out.contains("description:"));
        assert!(!out.contains("folded"));
        assert!(out.contains("name: foo"));
    }

    #[test]
    fn strip_description_no_frontmatter_unchanged() {
        let content = "# Just markdown\ndescription: not frontmatter\n";
        let out = strip_description_line(content);
        assert_eq!(out, content);
    }

    #[test]
    fn strip_description_no_description_field_unchanged() {
        let content = "---\nname: foo\nversion: 1.0\n---\n";
        let out = strip_description_line(content);
        assert_eq!(out, content);
    }

    #[test]
    fn strip_description_preserves_other_fields() {
        let content = "---\nname: foo\nauthor: me\ndescription: bar\nversion: 1.0\n---\n";
        let out = strip_description_line(content);
        // `description:` key stays with empty value, other keys in original order.
        assert_eq!(
            out,
            "---\nname: foo\nauthor: me\ndescription:\nversion: 1.0\n---\n".to_string()
        );
    }

    #[test]
    fn strip_description_preserves_body_content() {
        let content = "---\nname: foo\ndescription: bar\n---\n\n# Title\n\nSome **body** text.\n";
        let out = strip_description_line(content);
        assert!(out.ends_with("# Title\n\nSome **body** text.\n"));
    }

    #[test]
    fn strip_description_does_not_touch_nested_keys() {
        // An indented `description:` under another mapping is NOT a top-level
        // key and must be left alone.
        let content = "---\nname: foo\nmetadata:\n  description: nested\n---\n";
        let out = strip_description_line(content);
        assert_eq!(out, content);
    }

    #[test]
    fn strip_description_handles_crlf() {
        let content = "---\r\nname: foo\r\ndescription: bar\r\n---\r\n";
        let out = strip_description_line(content);
        // `description:` key stays with empty value, CRLF preserved
        assert!(out.contains("description:"));
        assert!(out.contains("name: foo"));
    }

    #[test]
    fn strip_description_empty_value() {
        let content = "---\nname: foo\ndescription:\n---\n";
        let out = strip_description_line(content);
        // Already empty or absent → keep as-is (NoDescription path in dir-level)
        assert_eq!(out, content);
    }

    // ── strip_description_from_skill_dir ──

    #[test]
    fn strip_from_skill_dir_strips_and_writes() {
        let tmp = tempdir().unwrap();
        let skill_dir = tmp.path().join("foo");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: foo\ndescription: hello\n---\nbody\n",
        )
        .unwrap();

        assert_eq!(
            strip_description_from_skill_dir(&skill_dir).unwrap(),
            StripOutcome::Stripped
        );
        let after = fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
        // `description:` key stays, value cleared
        assert!(after.contains("description:"));
        assert!(after.contains("body"));
    }

    #[test]
    fn strip_from_skill_dir_returns_no_description_when_absent() {
        let tmp = tempdir().unwrap();
        let skill_dir = tmp.path().join("foo");
        fs::create_dir_all(&skill_dir).unwrap();
        let original = "---\nname: foo\n---\nbody\n";
        fs::write(skill_dir.join("SKILL.md"), original).unwrap();

        assert_eq!(
            strip_description_from_skill_dir(&skill_dir).unwrap(),
            StripOutcome::NoDescription
        );
        assert_eq!(
            fs::read_to_string(skill_dir.join("SKILL.md")).unwrap(),
            original
        );
    }

    #[test]
    fn strip_from_skill_dir_returns_not_a_skill_when_empty() {
        let tmp = tempdir().unwrap();
        let empty_dir = tmp.path().join("empty");
        fs::create_dir_all(&empty_dir).unwrap();

        assert_eq!(
            strip_description_from_skill_dir(&empty_dir).unwrap(),
            StripOutcome::NotASkill
        );
    }

    #[test]
    fn strip_from_skill_dir_prefers_skill_md() {
        let tmp = tempdir().unwrap();
        let skill_dir = tmp.path().join("foo");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: up\ndescription: up\n---\n",
        )
        .unwrap();

        assert_eq!(
            strip_description_from_skill_dir(&skill_dir).unwrap(),
            StripOutcome::Stripped
        );
        let after = fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
        // `description:` key stays, value cleared
        assert!(after.contains("description:"));
        assert!(after.contains("name: up"));
    }

    #[test]
    fn strip_from_skill_dir_uses_lowercase_skill_md() {
        let tmp = tempdir().unwrap();
        let skill_dir = tmp.path().join("foo");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("skill.md"),
            "---\nname: low\ndescription: low\n---\n",
        )
        .unwrap();

        assert_eq!(
            strip_description_from_skill_dir(&skill_dir).unwrap(),
            StripOutcome::Stripped
        );
        let after = fs::read_to_string(skill_dir.join("skill.md")).unwrap();
        // `description:` key stays, value cleared
        assert!(after.contains("description:"));
        assert!(after.contains("name: low"));
    }
}
