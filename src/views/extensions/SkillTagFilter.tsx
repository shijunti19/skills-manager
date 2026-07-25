import { useMemo, useState } from "react";
import { Eraser, Filter, Sparkles, Upload, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "../../utils";
import type { ManagedSkill, SmartTag, ToolInfo } from "../../lib/tauri";
import * as api from "../../lib/tauri";
import { PromptPreviewDialog } from "../../components/PromptPreviewDialog";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { assemblePrompt, DEFAULT_PROMPT_SPEC } from "./promptAssembly";

interface SkillTagFilterProps {
  smartTags: SmartTag[];
  /** skill_id -> smart_tag_id[] map, for resolving tag membership. */
  smartTagsMap: Record<string, string[]>;
  managedSkills: ManagedSkill[];
  agent: ToolInfo | null;
  /** Refresh callback after sync operations (the standard 3-way refresh). */
  onRefresh: () => Promise<void>;
  /** Currently selected smart tag ids (empty = no filter). */
  selectedTagIds: string[];
  onToggleTag: (id: string) => void;
  onClearTags: () => void;
}

/**
 * Smart-tag filter bar: toggleable tag chips (multi-select — skills from all
 * selected tags are unioned), a trailing "clear" chip, and a left-aligned
 * action row with a "Generate" button (opens the PromptPreviewDialog) and a
 * "Sync all" button that organizes the agent's skills directory to contain
 * exactly the union of the selected tags' skills.
 */
export function SkillTagFilter({
  smartTags,
  smartTagsMap,
  managedSkills,
  agent,
  onRefresh,
  selectedTagIds,
  onToggleTag,
  onClearTags,
}: SkillTagFilterProps) {
  const { t } = useTranslation();
  const [promptOpen, setPromptOpen] = useState(false);
  const [generatedText, setGeneratedText] = useState("");
  const [syncingAll, setSyncingAll] = useState(false);
  const [stripping, setStripping] = useState(false);
  // Confirmation gates for the two destructive actions.
  const [syncAllConfirmOpen, setSyncAllConfirmOpen] = useState(false);
  const [stripConfirmOpen, setStripConfirmOpen] = useState(false);

  const selectedTags = useMemo(
    () => smartTags.filter((tag) => selectedTagIds.includes(tag.id)),
    [smartTags, selectedTagIds],
  );

  // Skills targeted by the current state. With no tags selected, "all" means
  // the entire central library (so the action buttons can operate even before
  // the user picks a tag). With tags selected, it's the union of the picked
  // tags' skills.
  const tagSkills = useMemo<ManagedSkill[]>(() => {
    if (selectedTags.length === 0) {
      return [...managedSkills].sort((a, b) => a.name.localeCompare(b.name));
    }
    const selected = new Set(selectedTagIds);
    const skillIds = new Set<string>();
    for (const [skillId, tagIds] of Object.entries(smartTagsMap)) {
      if (tagIds.some((tagId) => selected.has(tagId))) skillIds.add(skillId);
    }
    return managedSkills
      .filter((s) => skillIds.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedTags, selectedTagIds, smartTagsMap, managedSkills]);

  const hasSelection = selectedTags.length > 0;

  const agentKey = agent?.key ?? null;

  const promptSpec = agent?.skills_prompt_spec?.trim() || DEFAULT_PROMPT_SPEC;

  const handleGenerate = () => {
    if (tagSkills.length === 0) {
      toast.error(t("promptPreview.noMatchingSkills"));
      return;
    }
    // When no tags are picked, fall back to an implicit "all" group so the
    // generated prompt still carries tag descriptors + skill links.
    const tagsForPrompt = hasSelection
      ? selectedTags
      : [{
          id: "__all__",
          name: t("promptPreview.allSkillsGroup"),
          agents: [],
          description: null,
          prompt: null,
          sort_order: 0,
          created_at: 0,
          updated_at: 0,
        } as SmartTag];
    const text = assemblePrompt(tagsForPrompt, tagSkills, promptSpec);
    setGeneratedText(text);
    setPromptOpen(true);
  };

  const handleSyncAll = async () => {
    if (!agentKey || tagSkills.length === 0) return;
    setSyncingAll(true);
    try {
      const keepSkillIds = tagSkills.map((s) => s.id);
      const result = await api.organizeAgentSkills(agentKey, keepSkillIds);
      await onRefresh();
      toast.success(
        t("promptPreview.syncAllDone", {
          agent: agent?.display_name ?? agentKey,
          kept: result.kept,
          removed: result.removed,
        }),
      );
    } catch {
      toast.error(t("promptPreview.syncAllFailed"));
    } finally {
      setSyncingAll(false);
    }
  };

  const handleStripDescriptions = async () => {
    if (!agentKey) return;
    setStripping(true);
    try {
      const result = await api.stripAgentSkillDescriptions(agentKey);
      await onRefresh();
      // When some skills failed to process, warn the user instead of claiming
      // full success — the failed count was previously dropped silently.
      if (result.failed > 0) {
        toast.warning(
          t("promptPreview.stripPartial", {
            agent: agent?.display_name ?? agentKey,
            stripped: result.stripped,
            skipped: result.skipped,
            failed: result.failed,
          }),
        );
      } else {
        toast.success(
          t("promptPreview.stripDone", {
            agent: agent?.display_name ?? agentKey,
            stripped: result.stripped,
            skipped: result.skipped,
          }),
        );
      }
    } catch (err) {
      // Backend returns a concrete reason (e.g. "must be copy mode",
      // "found N symlinks: ..."); surface it directly when available.
      toast.error(typeof err === "string" ? err : t("promptPreview.stripFailed"));
    } finally {
      setStripping(false);
    }
  };

  if (smartTags.length === 0) return null;

  return (
    <>
      <div className="flex flex-col gap-2">
        {/* Tag chips (multi-select) + trailing clear chip */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1.5 pr-1 text-[12px] text-muted">
            <Filter className="h-3.5 w-3.5" />
            {t("promptPreview.filterByTag")}
          </span>

          {smartTags.map((tag) => {
            const active = selectedTagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => onToggleTag(tag.id)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors",
                  active
                    ? "bg-accent text-white"
                    : "bg-surface-hover text-muted hover:text-secondary",
                )}
              >
                {tag.name}
              </button>
            );
          })}

          {selectedTagIds.length > 0 && (
            <button
              type="button"
              onClick={onClearTags}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-[12px] font-medium text-muted transition-colors hover:border-border-subtle hover:text-secondary"
              title={t("promptPreview.clearFilter")}
            >
              <X className="h-3 w-3" />
              {t("promptPreview.clearFilter")}
            </button>
          )}

          {selectedTagIds.length > 0 && (
            <span className="pl-1 text-[12px] text-faint">
              {t("promptPreview.matchedSkills", { count: tagSkills.length })}
            </span>
          )}
        </div>

        {/* Action buttons — own row, left-aligned for easy reach. Always
            visible (per UX requirement): without tag selection they target
            the entire central library; with selection they target the
            union of the chosen tags' skills. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={tagSkills.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-hover px-2.5 py-1 text-[12px] font-medium text-secondary transition hover:bg-surface-active disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t("promptPreview.generate")}
          </button>
          {agentKey && (
            <button
              type="button"
              onClick={() => setSyncAllConfirmOpen(true)}
              disabled={syncingAll || tagSkills.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2.5 py-1 text-[12px] font-medium text-secondary transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              title={t("promptPreview.syncAllToAgent", { agent: agent?.display_name ?? "" })}
            >
              <Upload className="h-3.5 w-3.5" />
              {t("promptPreview.syncAllToAgent", { agent: agent?.display_name ?? "" })}
            </button>
          )}
          {agentKey && (
            <button
              type="button"
              onClick={() => setStripConfirmOpen(true)}
              disabled={stripping}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2.5 py-1 text-[12px] font-medium text-secondary transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              title={t("promptPreview.stripDescriptionsHint")}
            >
              <Eraser className="h-3.5 w-3.5" />
              {t("promptPreview.stripDescriptions")}
            </button>
          )}
        </div>
      </div>

      <PromptPreviewDialog
        open={promptOpen}
        generatedText={generatedText}
        onClose={() => setPromptOpen(false)}
        onRegenerate={handleGenerate}
      />
      <ConfirmDialog
        open={syncAllConfirmOpen}
        tone="warning"
        title={t("promptPreview.syncAllConfirmTitle")}
        message={t("promptPreview.syncAllConfirmMessage", {
          agent: agent?.display_name ?? agentKey ?? "",
          count: tagSkills.length,
        })}
        confirmLabel={t("promptPreview.syncAllConfirmAction")}
        onClose={() => setSyncAllConfirmOpen(false)}
        onConfirm={handleSyncAll}
      />
      <ConfirmDialog
        open={stripConfirmOpen}
        tone="warning"
        title={t("promptPreview.stripConfirmTitle")}
        message={t("promptPreview.stripConfirmMessage", {
          agent: agent?.display_name ?? agentKey ?? "",
        })}
        confirmLabel={t("promptPreview.stripConfirmAction")}
        onClose={() => setStripConfirmOpen(false)}
        onConfirm={handleStripDescriptions}
      />
    </>
  );
}
