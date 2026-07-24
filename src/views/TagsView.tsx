import { useCallback, useEffect, useMemo, useState } from "react";
import { Tags, Plus, Pencil, Trash2, X, Loader2, Search, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "../utils";
import { useApp } from "../context/AppContext";
import * as api from "../lib/tauri";
import type { ManagedSkill, SmartTag } from "../lib/tauri";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { getErrorMessage } from "../lib/error";

interface TagEditorState {
  id: string | null; // null = creating new
  name: string;
  description: string;
  prompt: string;
  /** agent keys this tag applies to. */
  agents: Set<string>;
  /** working copy of skill ids bound to this tag. */
  boundSkillIds: Set<string>;
  /** raw text the user pastes into the skills textarea. */
  skillsText: string;
}

/**
 * Smart Tag management page: list all smart tags, create / edit (name,
 * description, prompt, bound agents) / delete, and bind skills to a tag by
 * pasting skill names (whitespace/newline separated — unmatched names are
 * filtered out and reported).
 */
export function TagsView() {
  const { t } = useTranslation();
  const { tools } = useApp();
  const [tags, setTags] = useState<SmartTag[]>([]);
  const [smartTagsMap, setSmartTagsMap] = useState<Record<string, string[]>>({});
  const [managedSkills, setManagedSkills] = useState<ManagedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<TagEditorState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SmartTag | null>(null);
  const [saving, setSaving] = useState(false);
  const [skillSearch, setSkillSearch] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [t2, map, skills] = await Promise.all([
        api.getSmartTagsExt(),
        api.getSmartTagsMap(),
        api.getManagedSkills(),
      ]);
      setTags(t2);
      setSmartTagsMap(map);
      setManagedSkills(skills);
    } catch (e) {
      toast.error(getErrorMessage(e, t("common.error")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Installed agents available for binding.
  const installedAgents = useMemo(
    () => tools.filter((tool) => tool.installed && tool.enabled),
    [tools],
  );

  // tag_id -> count of skills bound to it.
  const skillCountByTag = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tagIds of Object.values(smartTagsMap)) {
      for (const tid of tagIds) {
        counts[tid] = (counts[tid] ?? 0) + 1;
      }
    }
    return counts;
  }, [smartTagsMap]);

  const skillsById = useMemo(() => {
    const m: Record<string, ManagedSkill> = {};
    for (const s of managedSkills) m[s.id] = s;
    return m;
  }, [managedSkills]);

  // Resolve the skill names a user pasted into the textarea into matched /
  // unmatched lists against the managed skills library. Names are split on any
  // whitespace/newline/comma; each token matches by exact name, then by trimmed
  // name, then by case-insensitive containment. A token that matches nothing
  // goes to unmatched (and is filtered out of the binding on save).
  const parseSkillsText = useCallback(
    (text: string): { matched: string[]; unmatched: string[] } => {
      const tokens = text
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const matchedIds: string[] = [];
      const unmatched: string[] = [];
      // Build a lowercase name -> skill index for containment fallback.
      const lowerByName: Record<string, string> = {};
      for (const s of managedSkills) {
        const ln = s.name.trim().toLowerCase();
        if (ln) lowerByName[ln] = s.id;
      }
      for (const tok of tokens) {
        // exact name match (case-sensitive first)
        const exact = managedSkills.find((s) => s.name === tok);
        if (exact) {
          matchedIds.push(exact.id);
          continue;
        }
        // exact case-insensitive
        const ln = tok.toLowerCase();
        if (lowerByName[ln]) {
          matchedIds.push(lowerByName[ln]);
          continue;
        }
        // containment: token appears in a skill name (or vice-versa)
        const contain = managedSkills.find(
          (s) =>
            s.name.toLowerCase().includes(ln) || ln.includes(s.name.toLowerCase()),
        );
        if (contain) {
          matchedIds.push(contain.id);
          continue;
        }
        unmatched.push(tok);
      }
      // dedupe matched ids preserving order
      const seen = new Set<string>();
      const dedup = matchedIds.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
      return { matched: dedup, unmatched };
    },
    [managedSkills],
  );

  // Live preview of what the current skillsText resolves to.
  const skillsPreview = useMemo(() => {
    if (!editor) return null;
    return parseSkillsText(editor.skillsText);
  }, [editor, parseSkillsText]);

  const openCreate = () => {
    setSkillSearch("");
    setEditor({
      id: null,
      name: "",
      description: "",
      prompt: "",
      agents: new Set(),
      boundSkillIds: new Set(),
      skillsText: "",
    });
  };

  const openEdit = (tag: SmartTag) => {
    setSkillSearch("");
    const bound = new Set<string>();
    for (const [skillId, tagIds] of Object.entries(smartTagsMap)) {
      if (tagIds.includes(tag.id)) bound.add(skillId);
    }
    // Pre-fill the textarea with the currently-bound skill names so the user
    // sees what's already there and can edit from that.
    const boundNames = [...bound]
      .map((id) => skillsById[id]?.name ?? "")
      .filter((n) => n.length > 0)
      .join("\n");
    setEditor({
      id: tag.id,
      name: tag.name,
      description: tag.description ?? "",
      prompt: tag.prompt ?? "",
      agents: new Set(tag.agents ?? []),
      boundSkillIds: bound,
      skillsText: boundNames,
    });
  };

  const toggleAgentInEditor = (agentKey: string) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.agents);
      if (next.has(agentKey)) next.delete(agentKey);
      else next.add(agentKey);
      return { ...prev, agents: next };
    });
  };

  // Merge the textarea-matched skills into the bound set. Called when the user
  // clicks "apply" next to the skills textarea (so they can keep pasting batches
  // and accumulating). unmatched tokens are reported via the preview.
  const applySkillsText = () => {
    if (!editor || !skillsPreview) return;
    setEditor((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.boundSkillIds);
      for (const id of skillsPreview.matched) next.add(id);
      return { ...prev, boundSkillIds: next, skillsText: "" };
    });
    if (skillsPreview.unmatched.length > 0) {
      toast.warning(
        t("tags.filteredOut", { names: skillsPreview.unmatched.join(", ") }),
      );
    }
  };

  const removeBoundSkill = (skillId: string) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.boundSkillIds);
      next.delete(skillId);
      // keep the textarea in sync if it still holds that name
      return { ...prev, boundSkillIds: next };
    });
  };

  const filteredBoundSkills = useMemo(() => {
    if (!editor) return [];
    const q = skillSearch.trim().toLowerCase();
    return [...editor.boundSkillIds]
      .map((id) => skillsById[id])
      .filter((s): s is ManagedSkill => !!s)
      .filter((s) => !q || s.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [editor, skillsById, skillSearch]);

  const handleSave = async () => {
    if (!editor) return;
    const name = editor.name.trim();
    if (!name) {
      toast.error(t("tags.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      const input: api.SmartTagInput = {
        name,
        agents: [...editor.agents],
        description: editor.description.trim() || null,
        prompt: editor.prompt.trim() || null,
      };
      let saved: SmartTag;
      if (editor.id) {
        saved = await api.updateSmartTagExt(editor.id, input);
      } else {
        saved = await api.createSmartTagExt(input);
      }
      // Reconcile skill bindings against current state.
      const currentBound = new Set<string>();
      for (const [skillId, tagIds] of Object.entries(smartTagsMap)) {
        if (tagIds.includes(saved.id)) currentBound.add(skillId);
      }
      const toAdd: string[] = [];
      const toRemove: string[] = [];
      for (const sid of editor.boundSkillIds) {
        if (!currentBound.has(sid)) toAdd.push(sid);
      }
      for (const sid of currentBound) {
        if (!editor.boundSkillIds.has(sid)) toRemove.push(sid);
      }
      for (const sid of toAdd) {
        const existing = smartTagsMap[sid] ?? [];
        if (!existing.includes(saved.id)) {
          await api.bindSmartTagsToSkill(sid, [...existing, saved.id]);
        }
      }
      for (const sid of toRemove) {
        const existing = smartTagsMap[sid] ?? [];
        await api.bindSmartTagsToSkill(sid, existing.filter((x) => x !== saved.id));
      }
      toast.success(editor.id ? t("tags.updated") : t("tags.created"));
      setEditor(null);
      await loadAll();
    } catch (e) {
      toast.error(getErrorMessage(e, t("common.error")));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await api.deleteSmartTagExt(deleteTarget.id);
      toast.success(t("tags.deleted"));
      setDeleteTarget(null);
      await loadAll();
    } catch (e) {
      toast.error(getErrorMessage(e, t("common.error")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-page app-page-narrow">
      <div className="app-page-header">
        <h1 className="app-page-title">{t("tags.title")}</h1>
        <p className="app-page-subtitle text-tertiary">{t("tags.subtitle")}</p>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] text-muted">
          {t("tags.countSummary", { count: tags.length })}
        </span>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("tags.newTag")}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-[13px] text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : tags.length === 0 ? (
        <div className="app-panel flex min-h-[200px] flex-col items-center justify-center gap-3 text-center">
          <Tags className="h-10 w-10 text-faint" />
          <p className="text-[13px] text-muted">{t("tags.empty")}</p>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("tags.newTag")}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="app-panel group flex flex-col gap-2 p-4 transition-colors hover:border-border"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[14px] font-semibold text-primary">{tag.name}</h3>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-faint">
                    <span>
                      {t("tags.skillCount", { count: skillCountByTag[tag.id] ?? 0 })}
                    </span>
                    <span>
                      {tag.agents && tag.agents.length > 0
                        ? t("tags.agentCount", { count: tag.agents.length })
                        : t("tags.globalTag")}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => openEdit(tag)}
                    className="rounded p-1 text-faint transition hover:text-secondary"
                    title={t("common.edit")}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(tag)}
                    className="rounded p-1 text-faint transition hover:text-red-400"
                    title={t("common.delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {tag.description && (
                <p className="line-clamp-2 text-[12px] leading-relaxed text-muted">
                  {tag.description}
                </p>
              )}
              {tag.prompt && (
                <p className="line-clamp-3 rounded bg-surface-hover px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-tertiary">
                  {tag.prompt}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Editor modal */}
      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-bg-secondary shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
              <h2 className="text-[15px] font-semibold text-primary">
                {editor.id ? t("tags.editTag") : t("tags.newTag")}
              </h2>
              <button
                onClick={() => setEditor(null)}
                className="rounded p-1 text-faint transition hover:text-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div>
                <label className="app-section-title mb-1.5 block">{t("tags.fieldName")}</label>
                <input
                  value={editor.name}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  placeholder={t("tags.fieldNamePlaceholder")}
                  className="w-full rounded-md border border-border-subtle bg-surface px-3 py-2 text-[13px] text-primary focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="app-section-title mb-1.5 block">{t("tags.fieldDescription")}</label>
                <textarea
                  value={editor.description}
                  onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                  placeholder={t("tags.fieldDescriptionPlaceholder")}
                  rows={2}
                  className="w-full resize-y rounded-md border border-border-subtle bg-surface px-3 py-2 text-[13px] text-primary focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="app-section-title mb-1.5 block">{t("tags.fieldPrompt")}</label>
                <textarea
                  value={editor.prompt}
                  onChange={(e) => setEditor({ ...editor, prompt: e.target.value })}
                  placeholder={t("tags.fieldPromptPlaceholder")}
                  rows={4}
                  className="w-full resize-y rounded-md border border-border-subtle bg-surface px-3 py-2 font-mono text-[12px] leading-relaxed text-primary focus:border-accent focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-faint">{t("tags.fieldPromptHint")}</p>
              </div>

              {/* Bound agents */}
              <div>
                <label className="app-section-title mb-1.5 block">
                  {t("tags.fieldAgents", { count: editor.agents.size })}
                </label>
                <p className="mb-1.5 text-[11px] text-faint">{t("tags.fieldAgentsHint")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {installedAgents.length === 0 ? (
                    <span className="text-[12px] text-faint">{t("tags.noAgents")}</span>
                  ) : (
                    installedAgents.map((agent) => {
                      const checked = editor.agents.has(agent.key);
                      return (
                        <button
                          key={agent.key}
                          type="button"
                          onClick={() => toggleAgentInEditor(agent.key)}
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition-colors",
                            checked
                              ? "border-accent/30 bg-accent/10 text-accent"
                              : "border-border-subtle bg-surface text-muted hover:text-secondary",
                          )}
                        >
                          {agent.display_name}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Bound skills via paste */}
              <div>
                <label className="app-section-title mb-1.5 block">
                  {t("tags.fieldSkills", { count: editor.boundSkillIds.size })}
                </label>
                <p className="mb-1.5 text-[11px] text-faint">{t("tags.fieldSkillsHint")}</p>
                <textarea
                  value={editor.skillsText}
                  onChange={(e) => setEditor({ ...editor, skillsText: e.target.value })}
                  placeholder={t("tags.fieldSkillsPlaceholder")}
                  rows={3}
                  className="w-full resize-y rounded-md border border-border-subtle bg-surface px-3 py-2 font-mono text-[12px] leading-relaxed text-primary focus:border-accent focus:outline-none"
                />
                {/* live preview: what the current text resolves to */}
                {editor.skillsText.trim().length > 0 && skillsPreview && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="text-emerald-500">
                      {t("tags.matchedCount", { count: skillsPreview.matched.length })}
                    </span>
                    {skillsPreview.unmatched.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-amber-500">
                        <AlertCircle className="h-3 w-3" />
                        {t("tags.unmatchedCount", { count: skillsPreview.unmatched.length })}
                        <span className="text-faint" title={skillsPreview.unmatched.join(", ")}>
                          ({skillsPreview.unmatched.slice(0, 4).join(", ")}
                          {skillsPreview.unmatched.length > 4 ? "…" : ""})
                        </span>
                      </span>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={applySkillsText}
                  disabled={!editor.skillsText.trim()}
                  className="mt-2 rounded-md border border-border-subtle bg-surface px-2.5 py-1 text-[12px] font-medium text-secondary transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("tags.applySkills")}
                </button>

                {/* already-bound skills (removable) */}
                {editor.boundSkillIds.size > 0 && (
                  <div className="mt-3">
                    <div className="relative mb-2">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                      <input
                        value={skillSearch}
                        onChange={(e) => setSkillSearch(e.target.value)}
                        placeholder={t("tags.searchSkills")}
                        className="w-full rounded-md border border-border-subtle bg-surface py-1.5 pl-8 pr-3 text-[12px] text-primary focus:border-accent focus:outline-none"
                      />
                    </div>
                    <div className="max-h-[160px] space-y-0.5 overflow-y-auto rounded-md border border-border-subtle p-1.5">
                      {filteredBoundSkills.map((skill) => (
                        <div
                          key={skill.id}
                          className="group flex items-center justify-between rounded px-2 py-1 text-[12px] hover:bg-surface-hover"
                        >
                          <span className="truncate text-secondary">{skill.name}</span>
                          <button
                            type="button"
                            onClick={() => removeBoundSkill(skill.id)}
                            className="shrink-0 rounded p-0.5 text-faint opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
              <button
                onClick={() => setEditor(null)}
                className="rounded-md border border-border-subtle bg-surface px-3 py-1.5 text-[13px] font-medium text-secondary transition hover:bg-surface-hover"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        message={t("tags.deleteConfirm", { name: deleteTarget?.name ?? "" })}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
