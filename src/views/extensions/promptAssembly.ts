import type { ManagedSkill, SmartTag } from "../../lib/tauri";

/** Default prompt spec when an agent has none configured. */
export const DEFAULT_PROMPT_SPEC = "[$(name)]((path))";

/**
 * Normalize a central skill path into a forward-slash SKILL.md URL suitable
 * for cross-terminal prompts: `C:\Users\...\caveman` -> `C:/Users/.../caveman/SKILL.md`.
 */
export function skillPathToPromptUrl(centralPath: string): string {
  const normalized = centralPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return `${normalized}/SKILL.md`;
}

/** Apply a prompt-spec template (e.g. `[$(name)]((path))`) to one skill. */
export function formatSkillLine(spec: string, skill: ManagedSkill): string {
  const path = skillPathToPromptUrl(skill.central_path);
  // Support both $(name)/$(path) (this app's convention) and {{name}}/{{path}}.
  return spec
    .replace(/\$\(name\)/g, skill.name)
    .replace(/\$\{name\}/g, skill.name)
    .replace(/\{\{name\}\}/g, skill.name)
    .replace(/\$\(path\)/g, path)
    .replace(/\$\{path\}/g, path)
    .replace(/\{\{path\}\}/g, path)
    // Bare (name)/(path) — the default spec "[$(name)]((path))" uses markdown
    // link syntax where the URL placeholder is a bare (path) without $ prefix.
    // Must run AFTER all prefixed variants so replacement values are not
    // re-matched; name before path so a path containing "(name)" stays safe.
    .replace(/\(name\)/g, skill.name)
    .replace(/\(path\)/g, path);
}

/** Assemble the full generated prompt: tag descriptions + skill links + tag prompts. */
export function assemblePrompt(
  selectedTags: SmartTag[],
  skills: ManagedSkill[],
  promptSpec: string,
): string {
  if (selectedTags.length === 0 || skills.length === 0) return "";

  const parts: string[] = [];

  // Tag descriptions as section headers.
  for (const tag of selectedTags) {
    if (tag.description) {
      parts.push(`# ${tag.name}\n${tag.description}`);
    }
  }

  // Skill links block.
  parts.push(skills.map((s) => formatSkillLine(promptSpec, s)).join("\n"));

  // Tag prompts (coordination instructions) at the end.
  const prompts = selectedTags
    .map((tag) => tag.prompt)
    .filter((p): p is string => !!p && p.trim().length > 0);
  if (prompts.length > 0) {
    parts.push(prompts.join("\n\n"));
  }

  return parts.join("\n\n");
}
