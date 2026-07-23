import { useMemo, useState } from "react";
import { Filter, Sparkles, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ManagedSkill, SmartTag, ToolInfo } from "../../lib/tauri";
import * as api from "../../lib/tauri";
import { PromptPreviewDialog } from "../../components/PromptPreviewDialog";
import { assemblePrompt, DEFAULT_PROMPT_SPEC } from "./promptAssembly";

interface SkillTagFilterProps {
  smartTags: SmartTag[];
  /** skill_id -> smart_tag_id[] map, for resolving tag membership. */
  smartTagsMap: Record<string, string[]>;
  managedSkills: ManagedSkill[];
  agent: ToolInfo | null;
  /** Refresh callback after sync operations (the standard 3-way refresh). */
  onRefresh: () => Promise<void>;
  /** Currently selected smart tag id (null = no filter). */
  selectedTagId: string | null;
  onSelectTag: (id: string | null) => void;
}

/**
 * Smart-tag filter bar: a dropdown to pick one smart tag, a "Generate" button
 * that opens the PromptPreviewDialog, and a "Sync all" button that organizes
 * the agent's skills directory to contain exactly the tag's skills.
 */
export function SkillTagFilter({
  smartTags,
  smartTagsMap,
  managedSkills,
  agent,
  onRefresh,
  selectedTagId,
  onSelectTag,
}: SkillTagFilterProps) {
  const { t } = useTranslation();
  const [promptOpen, setPromptOpen] = useState(false);
  const [generatedText, setGeneratedText] = useState("");
  const [syncingAll, setSyncingAll] = useState(false);

  const selectedTag = useMemo(
    () => smartTags.find((tag) => tag.id === selectedTagId) ?? null,
    [smartTags, selectedTagId],
  );

  // Skills that belong to the selected tag.
  const tagSkills = useMemo<ManagedSkill[]>(() => {
    if (!selectedTag) return [];
    const skillIdsForTag = new Set<string>();
    for (const [skillId, tagIds] of Object.entries(smartTagsMap)) {
      if (tagIds.includes(selectedTag.id)) skillIdsForTag.add(skillId);
    }
    return managedSkills.filter((s) => skillIdsForTag.has(s.id));
  }, [selectedTag, smartTagsMap, managedSkills]);

  const agentKey = agent?.key ?? null;

  const promptSpec = agent?.skills_prompt_spec?.trim() || DEFAULT_PROMPT_SPEC;

  const handleGenerate = () => {
    if (!selectedTag || tagSkills.length === 0) {
      toast.error(t("promptPreview.selectTagFirst"));
      return;
    }
    const text = assemblePrompt([selectedTag], tagSkills, promptSpec);
    setGeneratedText(text);
    setPromptOpen(true);
  };

  const handleSyncAll = async () => {
    if (!agentKey || !selectedTag) return;
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

  if (smartTags.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-[12px] text-muted">
          <Filter className="h-3.5 w-3.5" />
          <span>{t("promptPreview.filterByTag")}</span>
        </div>

        {/* Single-select tag dropdown */}
        <select
          value={selectedTagId ?? ""}
          onChange={(e) => onSelectTag(e.target.value || null)}
          className="max-w-[240px] rounded-md border border-border-subtle bg-surface px-2.5 py-1 text-[12px] text-primary focus:border-accent focus:outline-none"
        >
          <option value="">{t("promptPreview.selectTagHint")}</option>
          {smartTags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>

        {selectedTag && (
          <span className="text-[12px] text-faint">
            {t("promptPreview.matchedSkills", { count: tagSkills.length })}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {selectedTag && agentKey && (
            <button
              type="button"
              onClick={() => void handleSyncAll()}
              disabled={syncingAll || tagSkills.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2.5 py-1 text-[12px] font-medium text-secondary transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              title={t("promptPreview.syncAllToAgent", { agent: agent?.display_name ?? "" })}
            >
              <Upload className="h-3.5 w-3.5" />
              {t("promptPreview.syncAllToAgent", { agent: agent?.display_name ?? "" })}
            </button>
          )}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!selectedTag || tagSkills.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-hover px-2.5 py-1 text-[12px] font-medium text-secondary transition hover:bg-surface-active disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t("promptPreview.generate")}
          </button>
        </div>
      </div>

      <PromptPreviewDialog
        open={promptOpen}
        generatedText={generatedText}
        onClose={() => setPromptOpen(false)}
        onRegenerate={handleGenerate}
      />
    </>
  );
}
