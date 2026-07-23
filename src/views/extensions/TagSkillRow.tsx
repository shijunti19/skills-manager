import { useState } from "react";
import { Check, Loader2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ManagedSkill } from "../../lib/tauri";
import * as api from "../../lib/tauri";
import { getErrorMessage } from "../../lib/error";

interface TagSkillRowProps {
  skill: ManagedSkill;
  agentKey: string;
  agentDisplayName: string;
  /** Refresh callback after a sync (the standard 3-way refresh). */
  onSynced: () => Promise<void>;
}

/**
 * One row in the tag-filtered skill list. Shows the skill name + description
 * and a status badge: "Synced" (emerald) if the skill has a target for this
 * agent, otherwise "Not installed" with a "Sync" button that calls
 * `syncSkillToTool` (which honors the global sync_mode: symlink or copy).
 */
export function TagSkillRow({
  skill,
  agentKey,
  agentDisplayName,
  onSynced,
}: TagSkillRowProps) {
  const { t } = useTranslation();
  const [syncing, setSyncing] = useState(false);
  const isSynced = skill.targets.some((tgt) => tgt.tool === agentKey);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.syncSkillToTool(skill.id, agentKey);
      await onSynced();
      toast.success(t("promptPreview.syncedToast", { agent: agentDisplayName }));
    } catch (e) {
      toast.error(getErrorMessage(e, t("common.error")));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface px-4 py-2.5 transition hover:border-border">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-primary">{skill.name}</p>
        {skill.description && (
          <p className="truncate text-[12px] text-muted">{skill.description}</p>
        )}
      </div>

      {isSynced ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          <Check className="h-3 w-3" />
          {t("promptPreview.synced")}
        </span>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-surface-hover px-2.5 py-1 text-[11px] font-medium text-muted">
            {t("promptPreview.notInstalled")}
          </span>
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Upload className="h-3 w-3" />
            )}
            {t("promptPreview.sync")}
          </button>
        </div>
      )}
    </div>
  );
}
