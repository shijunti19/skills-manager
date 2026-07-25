import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  LayoutGrid,
  List,
  CheckCircle2,
  GitFork,
  HardDrive,
  Globe,
  Layers,
  RefreshCw,
  RotateCcw,
  GitBranch,
  ArrowUpCircle,
  Wrench,
  Loader2,
  X,
  Plus,
  SquareCheck,
  Square,
  GripVertical,
  CircleSlash,
  Pencil,
  Trash2,
  Copy,
  Check,
  AlignLeft,
  Sparkles,
} from "lucide-react";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { writeText as clipboardWriteText } from "@tauri-apps/plugin-clipboard-manager";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "../utils";
import { useApp } from "../context/AppContext";
import { useMultiSelect } from "../hooks/useMultiSelect";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TagRenameDialog } from "../components/TagRenameDialog";
import { DeleteSkillButton } from "../components/DeleteSkillButton";
import { SkillDetailPanel } from "../components/SkillDetailPanel";
import { MultiSelectToolbar } from "../components/MultiSelectToolbar";
import { BatchTagDialog } from "../components/BatchTagDialog";
import { SkillTagPickerDialog } from "../components/SkillTagPickerDialog";
import { SyncDots } from "../components/SyncDots";
import * as api from "../lib/tauri";
import { getTagActiveColor, getTagColor, UNTAGGED_FILTER } from "../lib/skillTags";
import type {
  ManagedSkill,
  ToolInfo,
  GitBackupStatus,
  SkillToolToggle,
} from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface SortableSkillItemProps {
  id: string;
  disabled: boolean;
  className?: string;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
}

function SortableSkillItem({ id, disabled, className, children }: SortableSkillItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const handle = !disabled ? (
    <div
      ref={setActivatorNodeRef}
      {...listeners}
      onClick={(e) => e.stopPropagation()}
      className="flex cursor-grab items-center justify-center rounded p-1 text-faint transition-colors hover:bg-surface-hover hover:text-muted active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" />
    </div>
  ) : null;

  return (
    <div ref={setNodeRef} style={style} {...attributes} className={cn("h-full", className)}>
      {children(handle)}
    </div>
  );
}

function getToolDisplayName(toolKey: string, tools: ToolInfo[]) {
  return tools.find((tool) => tool.key === toolKey)?.display_name || toolKey;
}

/** Pick the best available "link" for a skill: github ref if present, else directory. */
function skillLink(skill: ManagedSkill): string {
  const gh = skill.source_ref_resolved || skill.source_ref;
  if (gh && /^https?:\/\//.test(gh)) return gh;
  return skill.central_path.replace(/\\/g, "/");
}

/** Build the skill description, falling back to github/dir when empty. */
function skillDescription(skill: ManagedSkill): string {
  const desc = skill.description?.trim();
  if (desc) return desc;
  const link = skillLink(skill);
  return link || "-";
}

type SkillsListView = "grouped" | "plain";

/**
 * Modal that lists every skill. Two views:
 *  - "grouped": smart-tag sections with all-tags header line + per-tag skill
 *    blocks (name: desc | github | dir). Matches the import-text format.
 *  - "plain":   legacy one-line "name: description" list.
 * Offers "copy all" so the list can be pasted into an AI context.
 */
function SkillsListDialog({
  open,
  skills,
  smartTags,
  onClose,
}: {
  open: boolean;
  skills: ManagedSkill[];
  smartTags: api.SmartTag[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<SkillsListView>("grouped");

  if (!open) return null;

  // Format one skill line: "name: desc  path  github" — description first
  // (falling back to path/github when empty), then directory path, then the
  // github link if any. All separated by two spaces so it stays on one line
  // and is easy for an AI to parse.
  const skillLine = (s: ManagedSkill): string => {
    const desc = skillDescription(s);
    const path = s.central_path.replace(/\\/g, "/");
    const gh =
      (s.source_ref_resolved || s.source_ref) && /^https?:\/\//.test(s.source_ref_resolved || s.source_ref || "")
        ? (s.source_ref_resolved || s.source_ref)!
        : "";
    const tail = [path, gh].filter(Boolean).join("  ");
    return tail ? `${s.name}: ${desc}  ${tail}` : `${s.name}: ${desc}`;
  };

  // Grouped text: all-tags header line + the full skill inventory (every
  // skill, regardless of current tags) so an AI can (re)classify them.
  const buildGroupedText = (): string => {
    const parts: string[] = [];

    // Top: all tag names joined by ';'.
    const allTagNames = smartTags.map((tag) => tag.name).join(";");
    parts.push(`${t("mySkills.skillsListTagsHeader")}: ${allTagNames}`);
    parts.push("");

    // Skills data block — every skill, sorted by name.
    parts.push(`${t("mySkills.skillsListSkillsHeader")}:`);
    const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));
    for (const s of sorted) {
      parts.push(skillLine(s));
    }
    return parts.join("\n").trimEnd();
  };

  // The data text (skills inventory). Both views now list every skill.
  const dataText = view === "grouped" ? buildGroupedText() : skills.map(skillLine).join("\n");

  // The trailing instruction: tells the AI to reclassify these skills under
  // tags using the `## 标签 / - 技能` output format. This is the part the
  // user pastes into an AI to get a reclassification back.
  const instructionText = t("mySkills.skillsListInstruction", {
    tags: smartTags.map((tag) => tag.name).join(" / "),
  });

  // Full prompt = data + instruction, separated so it reads as one block.
  const text = `${dataText}\n\n${instructionText}`;

  const handleCopy = async () => {
    try {
      await clipboardWriteText(text);
      setCopied(true);
      toast.success(t("mySkills.copiedToClipboard"));
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
    }
  };

  const canGroup = smartTags.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="dialog-fade absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="dialog-pop relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-primary">
            <AlignLeft className="h-4 w-4 text-accent-light" />
            {t("mySkills.skillsListTitle")}
            <span className="text-[12px] font-normal text-muted">
              {t("mySkills.skillsListSummary", { count: skills.length })}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            {canGroup && (
              <div className="mr-1 flex items-center rounded-md border border-border-subtle bg-surface-hover/60 p-0.5">
                {(["grouped", "plain"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={cn(
                      "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                      view === v
                        ? "bg-accent text-white"
                        : "text-muted hover:text-secondary"
                    )}
                  >
                    {t(`mySkills.skillsListView_${v}`)}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={onClose}
              className="rounded p-1 text-faint transition-colors hover:text-secondary"
              title={t("common.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {skills.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-faint">
              {t("mySkills.skillsListEmpty")}
            </p>
          ) : (
            <>
              {/* Skills inventory data */}
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">
                  {t("mySkills.skillsListDataLabel")}
                </p>
                <pre className="whitespace-pre-wrap break-words rounded-md bg-surface-hover/60 p-3 font-mono text-[12px] leading-[20px] text-secondary">
                  {dataText}
                </pre>
              </div>
              {/* Trailing instruction: tells the AI how to output */}
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-accent">
                  {t("mySkills.skillsListInstructionLabel")}
                </p>
                <pre className="whitespace-pre-wrap break-words rounded-md border border-accent/20 bg-accent/5 p-3 font-mono text-[12px] leading-[20px] text-secondary">
                  {instructionText}
                </pre>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-border-subtle bg-surface px-3 py-1.5 text-[13px] font-medium text-secondary transition-colors hover:bg-surface-hover"
          >
            {t("common.close")}
          </button>
          <button
            onClick={() => void handleCopy()}
            disabled={skills.length === 0}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50",
              copied
                ? "bg-emerald-500 text-white"
                : "bg-accent text-white hover:bg-accent-hover"
            )}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? t("mySkills.copiedToClipboard") : t("mySkills.copyAll")}
          </button>
        </div>
      </div>
    </div>
  );
}

function centralDirName(skill: ManagedSkill) {
  return skill.central_path.split(/[\\/]/).filter(Boolean).pop() || skill.name;
}

export function MySkills() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    viewedPreset,
    tools,
    managedSkills: skills,
    refreshPresets,
    refreshManagedSkills,
    patchManagedSkill,
    detailSkillId,
    openSkillDetailById,
    closeSkillDetail,
    projects,
    refreshProjects,
  } = useApp();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [filterMode, setFilterMode] = useState<"all" | "enabled" | "available">("all");
  const [sourceFilters, setSourceFilters] = useState<Set<string>>(new Set());
  const [tagFilters, setTagFilters] = useState<Set<string>>(new Set());
  // Smart-tag (smart_tags) filter — orthogonal to the simple tagFilters above.
  const [smartTagFilters, setSmartTagFilters] = useState<Set<string>>(new Set());
  const [allTags, setAllTags] = useState<string[]>([]);
  // Tag management from the filter bar (#233): right-click a tag pill to
  // rename (dialog) or delete (confirm). Left-click stays "filter only".
  const [tagMenu, setTagMenu] = useState<{ tag: string; x: number; y: number } | null>(null);
  const [tagToRename, setTagToRename] = useState<string | null>(null);
  const [tagToDelete, setTagToDelete] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const refreshAfterDeleteRef = useRef<number | null>(null);
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  const [batchTagDialogOpen, setBatchTagDialogOpen] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkingSkillId, setCheckingSkillId] = useState<string | null>(null);
  const [updatingSkillId, setUpdatingSkillId] = useState<string | null>(null);
  const [batchUpdating, setBatchUpdating] = useState(false);
  const [toolToggles, setToolToggles] = useState<SkillToolToggle[] | null>(null);
  const [togglingToolKey, setTogglingToolKey] = useState<string | null>(null);
  const [togglingTarget, setTogglingTarget] = useState<{ skillId: string; tool: string } | null>(null);
  const [gitStatus, setGitStatus] = useState<GitBackupStatus | null>(null);
  const [gitRemoteConfig, setGitRemoteConfig] = useState("");
  // Tag picker popover (replaces the inline tag-input): the "+" button on a
  // card opens a full-screen modal to search/check/create tags for that
  // single skill.
  const [tagDialogSkillId, setTagDialogSkillId] = useState<string | null>(null);
  // Skills-list dialog: dumps every visible skill as "name: description" per
  // line, copyable to paste into an AI context.
  const [skillsListOpen, setSkillsListOpen] = useState(false);

  // Smart tags (for the skills-list "grouped" view + the tag picker modal).
  // Loaded once and refreshed when the dialog opens, so tag edits elsewhere
  // are reflected.
  const [smartTags, setSmartTags] = useState<api.SmartTag[]>([]);
  const [smartTagsMap, setSmartTagsMap] = useState<Record<string, string[]>>({});
  const refreshSmartTags = useCallback(async () => {
    try {
      const [tags, map] = await Promise.all([
        api.getSmartTagsExt(),
        api.getSmartTagsMap(),
      ]);
      setSmartTags(tags);
      setSmartTagsMap(map);
    } catch {
      // not critical for the list dialog
    }
  }, []);
  useEffect(() => {
    void refreshSmartTags();
  }, [refreshSmartTags]);

  // ─── 标签写操作串行队列 + 乐观更新 ─────────────────────────────────
  // 原因：三个标签 handler 都是 async + await refresh。每次点击都要等后端写完
  // + 重拉整张技能表，MySkills（2000 行）在等待期间卡死，连点全丢。
  //
  // 设计（关键铁律）：
  //   1) 点击瞬间：patchManagedSkill / setSmartTagsMap 立即更新 UI（按钮秒回弹）
  //   2) 后端写入丢进串行队列排队（避免并发写冲突，前一个失败不阻塞后一个）
  //   3) 写成功 → 标记需要 refresh，等队列 drain 后做一次合并刷新（连点期间
  //      不重复触发 refresh，避免把还在队列里没写完的中间态拉回来）
  //   4) 写失败 → 立刻 refresh 回滚 + onRollback，让真实状态覆盖乐观层
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const needsRefreshRef = useRef(false);
  const refreshTimerRef = useRef<number | null>(null);
  const flushAfterQueue = useCallback(() => {
    if (!needsRefreshRef.current) return;
    needsRefreshRef.current = false;
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    // 50ms debounce：队列刚空时可能还有下一个 click 进来，把它们合到同一刷
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      Promise.all([refreshManagedSkills(), refreshSmartTags()]).catch(() => {});
    }, 50);
  }, [refreshManagedSkills, refreshSmartTags]);
  const enqueueWrite = useCallback(
    (task: () => Promise<void>, onRollback: () => void) => {
      console.log("[enqueueWrite] 排队写入任务");
      writeQueueRef.current = writeQueueRef.current
        .catch(() => {}) // 前一个失败不阻塞后一个
        .then(async () => {
          console.log("[enqueueWrite] 开始执行 task");
          try {
            await task();
            console.log("[enqueueWrite] task 成功完成");
            // 成功：标记需要 refresh，队列 drain 后合并刷一次，把后端真
            // 实态（包括其他字段）拉回来覆盖乐观层，避免「乐观更新了某
            // 个字段但实际后端写错了/被别的逻辑改了」造成 UI 与 DB 不一致
            needsRefreshRef.current = true;
            flushAfterQueue();
          } catch (error) {
            console.error("[enqueueWrite] task 失败:", error);
            toast.error(getErrorMessage(error, t("common.error")));
            // 失败：refresh 全量拉真实状态覆盖乐观层
            try {
              await Promise.all([refreshManagedSkills(), refreshSmartTags()]);
            } catch {
              // refresh 也失败就没办法了，toast 已经报过错
            }
            onRollback();
          }
        });
    },
    [t, refreshManagedSkills, refreshSmartTags, flushAfterQueue],
  );

  const [presetSkillOrder, setPresetSkillOrder] = useState<string[]>([]);

  const viewedPresetName = viewedPreset?.name || t("mySkills.currentPresetFallback");

  // Fetch sort order whenever active preset changes
  useEffect(() => {
    if (!viewedPreset) {
      setPresetSkillOrder([]);
      return;
    }
    api.getPresetSkillOrder(viewedPreset.id).then(setPresetSkillOrder).catch(() => {});
  }, [viewedPreset, skills]);

  // Skills with an unresolved sync conflict get a "needs attention" badge
  // that jumps to the Backup page (merge-engine design §4 UI).
  const [conflictIds, setConflictIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    api.gitBackupPendingConflicts()
      .then((rows) => setConflictIds(new Set(rows.map((row) => row.skill_id))))
      .catch(() => setConflictIds(new Set()));
  }, [skills]);

  const refreshAllTags = async () => {
    try {
      const tags = await api.getAllTags();
      setAllTags(tags);
    } catch {
      // not critical
    }
  };

  useEffect(() => {
    refreshAllTags();
  }, [skills]);

  // Close the tag context menu on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (tagMenu) setTagMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tagMenu]);

  const toggleFilter = (set: Set<string>, value: string): Set<string> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const skillDisplayNames = useMemo(() => {
    const nameCounts = new Map<string, number>();
    for (const skill of skills) {
      nameCounts.set(skill.name, (nameCounts.get(skill.name) || 0) + 1);
    }

    const displayNames = new Map<string, string>();
    for (const skill of skills) {
      const dirName = centralDirName(skill);
      displayNames.set(
        skill.id,
        (nameCounts.get(skill.name) || 0) > 1 && dirName !== skill.name
          ? dirName
          : skill.name
      );
    }
    return displayNames;
  }, [skills]);

  const filtered = useMemo(() => {
    const result = skills.filter((skill) => {
      const displayName = skillDisplayNames.get(skill.id) || skill.name;
      const matchesSearch =
        skill.name.toLowerCase().includes(search.toLowerCase()) ||
        displayName.toLowerCase().includes(search.toLowerCase()) ||
        (skill.description || "").toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;

      if (sourceFilters.size > 0 && !sourceFilters.has(skill.source_type)) return false;

      if (tagFilters.size > 0) {
        const wantUntagged = tagFilters.has(UNTAGGED_FILTER);
        const matchUntagged = wantUntagged && skill.tags.length === 0;
        const matchTag = skill.tags.some((t) => tagFilters.has(t));
        if (!matchUntagged && !matchTag) return false;
      }

      // Smart-tag filter: a skill passes if it is bound to ANY of the selected
      // smart tags (union semantics, same as the simple tag filter).
      if (smartTagFilters.size > 0) {
        const boundIds = smartTagsMap[skill.id] ?? [];
        const match = boundIds.some((id) => smartTagFilters.has(id));
        if (!match) return false;
      }

      if (!viewedPreset) return true;

      const enabledInPreset = skill.preset_ids.includes(viewedPreset.id);
      if (filterMode === "enabled") return enabledInPreset;
      if (filterMode === "available") return !enabledInPreset;
      return true;
    });

    // Always sort enabled skills first; within enabled group, use custom sort order
    if (viewedPreset) {
      result.sort((a, b) => {
        const aEnabled = a.preset_ids.includes(viewedPreset.id) ? 0 : 1;
        const bEnabled = b.preset_ids.includes(viewedPreset.id) ? 0 : 1;
        if (aEnabled !== bEnabled) return aEnabled - bEnabled;
        // Within same group, use preset sort order
        const aOrder = presetSkillOrder.indexOf(a.id);
        const bOrder = presetSkillOrder.indexOf(b.id);
        if (aOrder !== -1 && bOrder !== -1) return aOrder - bOrder;
        if (aOrder !== -1) return -1;
        if (bOrder !== -1) return 1;
        return a.name.localeCompare(b.name);
      });
    }

    return result;
  }, [skills, skillDisplayNames, search, sourceFilters, tagFilters, smartTagFilters, smartTagsMap, filterMode, viewedPreset, presetSkillOrder]);

  const {
    isMultiSelect, setIsMultiSelect,
    selectedIds,
    toggleSelect,
    isAllSelected,
    anyDisabled,
    handleSelectAll,
    exitMultiSelect,
  } = useMultiSelect({
    items: skills,
    filtered,
    getKey: (s) => s.id,
    isItemActive: (s) => viewedPreset ? s.preset_ids.includes(viewedPreset.id) : true,
  });

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === detailSkillId) || null,
    [detailSkillId, skills]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !viewedPreset) return;

      // Only reorder enabled skills (they are always at the front)
      const enabledSkills = filtered.filter((s) => s.preset_ids.includes(viewedPreset.id));
      const oldIndex = enabledSkills.findIndex((s) => s.id === active.id);
      const newIndex = enabledSkills.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...enabledSkills];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      // Optimistic update
      setPresetSkillOrder(reordered.map((s) => s.id));

      try {
        await api.reorderPresetSkills(viewedPreset.id, reordered.map((s) => s.id));
      } catch {
        // Revert on failure
        await api.getPresetSkillOrder(viewedPreset.id).then(setPresetSkillOrder).catch(() => {});
      }
    },
    [filtered, viewedPreset]
  );

  const canDrag = !!viewedPreset;

  const refreshGitStatus = useCallback(async () => {
    try {
      await api.gitBackupFetch().catch(() => {});
      const status = await api.gitBackupStatus();
      setGitStatus(status);
    } catch {
      // not critical
    }
  }, []);

  // Local-only status refresh: no `git fetch`, so it can fire from
  // dependency-driven effects without driving the file-watcher → refresh
  // → fetch feedback loop.
  const refreshGitStatusLocal = useCallback(async () => {
    try {
      const status = await api.gitBackupStatus();
      setGitStatus(status);
    } catch {
      // not critical
    }
  }, []);

  useEffect(() => {
    (async () => {
      const savedRemote = (await api.getSettings("git_backup_remote_url").catch(() => null))?.trim() || "";
      const status = await api.gitBackupStatus().catch(() => null);
      setGitStatus(status);
      // The saved setting is the single source of truth. Do not backfill from
      // `.git/config` — that made a cleared URL reappear after disconnect (#260).
      setGitRemoteConfig(savedRemote);
    })();
  }, []);

  useEffect(() => {
    const handleWindowFocus = () => {
      refreshGitStatus();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshGitStatus();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshGitStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshGitStatusLocal();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [skills, refreshGitStatusLocal]);

  useEffect(() => {
    let cancelled = false;
    const loadToggles = async () => {
      if (!selectedSkill || !viewedPreset) {
        setToolToggles(null);
        return;
      }
      if (!selectedSkill.preset_ids.includes(viewedPreset.id)) {
        setToolToggles(null);
        return;
      }
      try {
        const toggles = await api.getSkillToolToggles(selectedSkill.id, viewedPreset.id);
        if (!cancelled) setToolToggles(toggles);
      } catch {
        if (!cancelled) setToolToggles(null);
      }
    };
    loadToggles();
    return () => {
      cancelled = true;
    };
  }, [selectedSkill, viewedPreset]);

  const handleToggleSkillTool = async (toolKey: string, enabled: boolean) => {
    if (!selectedSkill || !viewedPreset) return;
    setTogglingToolKey(toolKey);
    try {
      await api.setSkillToolToggle(selectedSkill.id, viewedPreset.id, toolKey, enabled);
      const displayName = getToolDisplayName(toolKey, tools);
      toast.success(
        enabled
          ? t("mySkills.agentToggleEnabled", { agent: displayName })
          : t("mySkills.agentToggleDisabled", { agent: displayName })
      );
      const [, toggles] = await Promise.all([
        refreshManagedSkills(),
        api.getSkillToolToggles(selectedSkill.id, viewedPreset.id),
      ]);
      setToolToggles(toggles);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      await refreshManagedSkills();
    } finally {
      setTogglingToolKey(null);
    }
  };

  const handleToggleSkillTarget = useCallback(
    async (skill: ManagedSkill, toolKey: string, enabled: boolean) => {
      if (togglingTarget) return;
      setTogglingTarget({ skillId: skill.id, tool: toolKey });
      const displayName = getToolDisplayName(toolKey, tools);
      try {
        if (enabled) {
          await api.syncSkillToTool(skill.id, toolKey);
          toast.success(t("mySkills.targetInstalled", { name: skill.name, agent: displayName }));
        } else {
          await api.unsyncSkillFromTool(skill.id, toolKey);
          toast.success(t("mySkills.targetUninstalled", { name: skill.name, agent: displayName }));
        }
        await refreshManagedSkills();
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, t("common.error")));
        await refreshManagedSkills();
      } finally {
        setTogglingTarget(null);
      }
    },
    [togglingTarget, tools, t, refreshManagedSkills]
  );

  const scheduleRefreshAfterDelete = useCallback(() => {
    if (refreshAfterDeleteRef.current !== null) {
      window.clearTimeout(refreshAfterDeleteRef.current);
    }
    refreshAfterDeleteRef.current = window.setTimeout(() => {
      refreshAfterDeleteRef.current = null;
      void Promise.all([refreshManagedSkills(), refreshPresets()]);
    }, 300);
  }, [refreshManagedSkills, refreshPresets]);

  useEffect(() => {
    return () => {
      if (refreshAfterDeleteRef.current !== null) {
        window.clearTimeout(refreshAfterDeleteRef.current);
      }
    };
  }, []);

  const handleDeleteSkill = useCallback(
    (skill: ManagedSkill) => {
      setDeletingIds((prev) => {
        if (prev.has(skill.id)) return prev;
        const next = new Set(prev);
        next.add(skill.id);
        return next;
      });
      void (async () => {
        try {
          await api.deleteManagedSkill(skill.id);
          if (selectedSkill?.id === skill.id) closeSkillDetail();
          toast.success(`${skill.name} ${t("mySkills.deleted")}`);
        } catch (error: unknown) {
          toast.error(getErrorMessage(error, t("common.error")));
        } finally {
          setDeletingIds((prev) => {
            if (!prev.has(skill.id)) return prev;
            const next = new Set(prev);
            next.delete(skill.id);
            return next;
          });
          scheduleRefreshAfterDelete();
        }
      })();
    },
    [selectedSkill, closeSkillDetail, t, scheduleRefreshAfterDelete]
  );

  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    try {
      const result = await api.deleteManagedSkills(ids);
      if (selectedSkill && ids.includes(selectedSkill.id) && !result.failed.includes(selectedSkill.id)) {
        closeSkillDetail();
      }
      if (result.deleted > 0) {
        toast.success(t("mySkills.batchDeleted", { count: result.deleted }));
      }
      if (result.failed.length > 0) {
        toast.error(t("mySkills.batchDeleteFailed", { count: result.failed.length }));
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
    } finally {
      exitMultiSelect();
      setBatchDeleteConfirm(false);
      await Promise.all([refreshManagedSkills(), refreshPresets()]);
    }
  };

  const handleBatchEditTags = async (adds: string[], removes: string[]) => {
    const selectedSkillsList = skills.filter((s) => selectedIds.has(s.id));
    let updated = 0;
    let failed = 0;
    for (const skill of selectedSkillsList) {
      const removeSet = new Set(removes);
      const remaining = skill.tags.filter((tag) => !removeSet.has(tag));
      const merged = [...remaining];
      for (const tag of adds) {
        if (!merged.includes(tag)) merged.push(tag);
      }
      const changed =
        merged.length !== skill.tags.length ||
        merged.some((tag, i) => tag !== skill.tags[i]);
      if (!changed) continue;
      try {
        await api.setSkillTags(skill.id, merged);
        updated++;
      } catch {
        failed++;
      }
    }
    if (updated > 0) {
      toast.success(t("mySkills.batchTagsUpdated", { count: updated }));
    }
    if (failed > 0) {
      toast.error(t("mySkills.batchTagsFailed", { count: failed }));
    }
    await refreshManagedSkills();
    await refreshAllTags();
  };

  const handleBatchTogglePreset = async () => {
    if (!viewedPreset) return;
    const selectedSkillsList = skills.filter((s) => selectedIds.has(s.id));
    const enabling = anyDisabled;
    let count = 0;
    let failed = 0;
    for (const skill of selectedSkillsList) {
      try {
        const enabledInPreset = skill.preset_ids.includes(viewedPreset.id);
        if (enabling && !enabledInPreset) {
          await api.addSkillToPreset(skill.id, viewedPreset.id);
          count++;
        } else if (!enabling && enabledInPreset) {
          await api.removeSkillFromPreset(skill.id, viewedPreset.id);
          count++;
        }
      } catch {
        failed++;
        // continue with remaining
      }
    }
    if (count > 0) {
      toast.success(enabling
        ? t("mySkills.batchEnabled", { count })
        : t("mySkills.batchDisabled", { count }));
    }
    if (failed > 0) {
      toast.error(t("mySkills.batchToggleFailed", { count: failed }));
    }
    await Promise.all([refreshManagedSkills(), refreshPresets()]);
  };

  const handleBatchRefresh = async () => {
    const refreshableSkills = skills.filter((skill) => selectedIds.has(skill.id) && canRefresh(skill));
    if (refreshableSkills.length === 0) return;

    setBatchUpdating(true);
    try {
      const result = await api.batchUpdateSkills(refreshableSkills.map((skill) => skill.id));
      if (result.refreshed > 0) {
        toast.success(t("mySkills.batchUpdated", { count: result.refreshed }));
      }
      if (result.unchanged > 0) {
        toast.info(t("mySkills.batchAlreadyUpToDate", { count: result.unchanged }));
      }
      if (result.failed.length > 0) {
        toast.error(t("mySkills.batchUpdateFailed", { count: result.failed.length }));
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
    } finally {
      await refreshManagedSkills();
      setBatchUpdating(false);
    }
  };

  const handleUpdateAvailableSkills = async () => {
    const updatableSkills = skills.filter(
      (skill) => skill.update_status === "update_available" && canRefresh(skill)
    );
    if (updatableSkills.length === 0) return;

    setBatchUpdating(true);
    try {
      const result = await api.batchUpdateSkills(updatableSkills.map((skill) => skill.id));
      if (result.refreshed > 0) {
        toast.success(t("mySkills.batchUpdated", { count: result.refreshed }));
      }
      if (result.unchanged > 0) {
        toast.info(t("mySkills.batchAlreadyUpToDate", { count: result.unchanged }));
      }
      if (result.failed.length > 0) {
        toast.error(t("mySkills.batchUpdateFailed", { count: result.failed.length }));
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
    } finally {
      await refreshManagedSkills();
      setBatchUpdating(false);
    }
  };

  const handleTogglePreset = async (skill: ManagedSkill) => {
    if (!viewedPreset) return;
    const enabledInPreset = skill.preset_ids.includes(viewedPreset.id);
    if (enabledInPreset) {
      await api.removeSkillFromPreset(skill.id, viewedPreset.id);
      toast.success(`${skill.name} ${t("mySkills.disabledInPreset")}`);
    } else {
      await api.addSkillToPreset(skill.id, viewedPreset.id);
      toast.success(`${skill.name} ${t("mySkills.enabledInPreset")}`);
    }
    await Promise.all([refreshManagedSkills(), refreshPresets()]);
  };

  const handleCheckAllUpdates = async () => {
    setCheckingAll(true);
    try {
      await api.checkAllSkillUpdates(true);
      toast.success(t("mySkills.updateActions.checkedAll"));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
    } finally {
      await refreshManagedSkills();
      setCheckingAll(false);
    }
  };

  const handleCheckUpdate = async (skill: ManagedSkill) => {
    setCheckingSkillId(skill.id);
    try {
      await api.checkSkillUpdate(skill.id, true);
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      await refreshManagedSkills();
    } finally {
      setCheckingSkillId(null);
    }
  };

  const handleRefreshSkill = async (skill: ManagedSkill) => {
    setUpdatingSkillId(skill.id);
    try {
      if (skill.source_type === "local" || skill.source_type === "import") {
        await api.reimportLocalSkill(skill.id);
        toast.success(t("mySkills.updateActions.reimported"));
      } else {
        const result = await api.updateSkill(skill.id);
        if (result.content_changed) {
          toast.success(t("mySkills.updateActions.updated"));
        } else {
          toast.info(t("mySkills.updateActions.alreadyUpToDate"));
        }
      }
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      await refreshManagedSkills();
    } finally {
      setUpdatingSkillId(null);
    }
  };

  const handleRelinkSource = async (skill: ManagedSkill) => {
    const selected = await dialogOpen({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;

    setUpdatingSkillId(skill.id);
    try {
      await api.relinkLocalSkillSource(skill.id, selected);
      toast.success(t("mySkills.updateActions.relinked"));
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      await refreshManagedSkills();
    } finally {
      setUpdatingSkillId(null);
    }
  };

  const handleDetachSource = async (skill: ManagedSkill) => {
    setUpdatingSkillId(skill.id);
    try {
      await api.detachLocalSkillSource(skill.id);
      toast.success(t("mySkills.updateActions.detachedSource"));
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      await refreshManagedSkills();
    } finally {
      setUpdatingSkillId(null);
    }
  };

  // Add a simple tag to a skill (no-op if already present).
  // 乐观更新：立刻把新标签 patch 进本地 skills，按钮秒回弹；
  // 后端写入排队执行，连续点击只在最后一次 refresh 一次。
  const handleAddSimpleTag = (skill: ManagedSkill, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || skill.tags.includes(trimmed)) return;
    const prevTags = skill.tags;
    const nextTags = [...skill.tags, trimmed];
    console.log("[handleAddSimpleTag]", skill.id, "prev=", prevTags, "next=", nextTags);
    patchManagedSkill(skill.id, { tags: nextTags });
    enqueueWrite(
      () => api.setSkillTags(skill.id, nextTags),
      () => patchManagedSkill(skill.id, { tags: prevTags }),
    );
  };

  // Toggle a simple tag: remove if present, add if absent.
  const handleToggleSimpleTag = (skill: ManagedSkill, tag: string) => {
    const prevTags = skill.tags;
    const willAdd = !skill.tags.includes(tag);
    const nextTags = willAdd
      ? [...skill.tags, tag]
      : skill.tags.filter((x) => x !== tag);
    console.log("[handleToggleSimpleTag]", skill.id, "tag=", tag, "willAdd=", willAdd, "prev=", prevTags, "next=", nextTags);
    patchManagedSkill(skill.id, { tags: nextTags });
    enqueueWrite(
      () => api.setSkillTags(skill.id, nextTags),
      () => patchManagedSkill(skill.id, { tags: prevTags }),
    );
  };

  const handleRemoveTag = (skill: ManagedSkill, tagToRemove: string) => {
    const prevTags = skill.tags;
    const nextTags = skill.tags.filter((t) => t !== tagToRemove);
    console.log("[handleRemoveTag]", skill.id, "remove=", tagToRemove, "next=", nextTags);
    patchManagedSkill(skill.id, { tags: nextTags });
    enqueueWrite(
      async () => {
        await api.setSkillTags(skill.id, nextTags);
        toast.success(t("mySkills.tags.tagsUpdated"));
      },
      () => patchManagedSkill(skill.id, { tags: prevTags }),
    );
  };

  // Toggle a smart tag binding: unbind if bound, bind if not.
  const handleToggleSmartTag = (skill: ManagedSkill, smartTagId: string) => {
    const existing = smartTagsMap[skill.id] ?? [];
    const willBind = !existing.includes(smartTagId);
    const prevIds = existing;
    const nextIds = willBind
      ? [...existing, smartTagId]
      : existing.filter((x) => x !== smartTagId);
    console.log("[handleToggleSmartTag]", skill.id, "smartTagId=", smartTagId, "willBind=", willBind, "prev=", prevIds, "next=", nextIds);
    // 乐观更新 smartTagsMap（局部 state，本组件内）
    setSmartTagsMap((prev) => ({ ...prev, [skill.id]: nextIds }));
    enqueueWrite(
      () => api.bindSmartTagsToSkill(skill.id, nextIds),
      () => setSmartTagsMap((prev) => ({ ...prev, [skill.id]: prevIds })),
    );
  };

  // Replace `oldTag` with `newTag` in the active filter set so the current
  // filtering survives a rename/delete.
  const replaceTagInFilters = (oldTag: string, newTag?: string) =>
    setTagFilters((prev) => {
      if (!prev.has(oldTag)) return prev;
      const next = new Set(prev);
      next.delete(oldTag);
      if (newTag) next.add(newTag);
      return next;
    });

  // Throws on failure so the rename dialog stays open (it only closes after a
  // resolved onRename), matching how RenamePresetDialog behaves.
  const handleRenameTag = async (newName: string) => {
    const oldName = tagToRename;
    if (oldName === null) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    try {
      await api.renameTag(oldName, trimmed);
      replaceTagInFilters(oldName, trimmed);
      toast.success(t("mySkills.tags.tagRenamed"));
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
      throw error;
    }
  };

  const handleDeleteTag = async () => {
    const tag = tagToDelete;
    if (tag === null) return;
    try {
      await api.deleteTag(tag);
      replaceTagInFilters(tag);
      toast.success(t("mySkills.tags.tagDeleted"));
      await refreshManagedSkills();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("common.error")));
    }
  };

  // Resolve a skill's bound smart tags (as objects) for display on the card.
  const getSkillSmartTags = useCallback(
    (skill: ManagedSkill): api.SmartTag[] => {
      const ids = smartTagsMap[skill.id] ?? [];
      const idSet = new Set(ids);
      return smartTags.filter((tag) => idSet.has(tag.id));
    },
    [smartTags, smartTagsMap],
  );

  type GitToolbarMode =
    | "loading"
    | "uninitialized"
    | "needs_remote"
    | "needs_fix"
    | "up_to_date"
    | "pending_changes";

  const getGitToolbarMode = (): GitToolbarMode => {
    if (!gitStatus) return "loading";
    if (!gitStatus.is_repo) return "uninitialized";
    if (!gitStatus.remote_url && !gitRemoteConfig) return "needs_remote";
    if (
      gitStatus.upstream_health === "unrelated_histories"
      || gitStatus.upstream_health === "detached"
    ) {
      return "needs_fix";
    }
    // First-push case: remote is set but upstream tracking is not yet established.
    // Treat as a normal pending sync — the push path will set upstream automatically.
    if (gitStatus.upstream_health === "no_upstream") {
      return "pending_changes";
    }
    if (gitStatus.has_changes || gitStatus.ahead > 0 || gitStatus.behind > 0) {
      return "pending_changes";
    }
    return "up_to_date";
  };

  const getGitStatusMeta = (mode: GitToolbarMode) => {
    if (mode === "loading") {
      return {
        icon: Loader2,
        label: t("backup.status.loading"),
        className: "text-muted",
        iconClassName: "animate-spin",
      };
    }
    if (mode === "uninitialized" || mode === "needs_remote") {
      return {
        icon: GitBranch,
        label: t("backup.status.notConnected"),
        className: "text-muted",
        iconClassName: "",
      };
    }
    if (mode === "needs_fix") {
      return {
        icon: Wrench,
        label: t("backup.status.needsFix"),
        className: "text-red-500",
        iconClassName: "",
      };
    }
    if (mode === "pending_changes") {
      return {
        icon: ArrowUpCircle,
        label: t("backup.status.pending"),
        className: "text-amber-600 dark:text-amber-400",
        iconClassName: "",
      };
    }
    return {
      icon: CheckCircle2,
      label: t("backup.status.synced"),
      className: "text-muted",
      iconClassName: "",
    };
  };

  const sourceIcon = (type: string) => {
    switch (type) {
      case "git":
      case "skillssh":
        return <GitFork className="h-3 w-3" />;
      case "local":
      case "import":
        return <HardDrive className="h-3 w-3" />;
      default:
        return <Globe className="h-3 w-3" />;
    }
  };

  const canRefresh = (skill: ManagedSkill) =>
    skill.source_type === "git" ||
    skill.source_type === "skillssh" ||
    ((skill.source_type === "local" || skill.source_type === "import") && !!skill.source_ref);

  const anyRefreshableSelected = useMemo(
    () => skills.some((skill) => selectedIds.has(skill.id) && canRefresh(skill)),
    [skills, selectedIds]
  );
  const availableUpdateCount = useMemo(
    () => skills.filter((skill) => skill.update_status === "update_available" && canRefresh(skill)).length,
    [skills]
  );
  const refreshableSelectedCount = useMemo(
    () => skills.filter((skill) => selectedIds.has(skill.id) && canRefresh(skill)).length,
    [skills, selectedIds]
  );

  const sourceTypeLabel = (skill: ManagedSkill) =>
    skill.source_type === "skillssh" ? "skills.sh" : skill.source_type;

  const refreshLabel = (skill: ManagedSkill) =>
    skill.source_type === "local" || skill.source_type === "import"
      ? t("mySkills.updateActions.reimport")
      : t("mySkills.updateActions.update");

  const statusBadge = (skill: ManagedSkill) => {
    if (skill.update_status === "update_available") {
      return {
        label: "Update",
        className: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
      };
    }
    if (skill.update_status === "source_missing") {
      return {
        label: t("mySkills.updateStatus.sourceMissing"),
        className: "bg-red-500/10 text-red-600 dark:text-red-300",
      };
    }
    if (skill.update_status === "error") {
      return {
        label: t("mySkills.updateStatus.error"),
        className: "bg-red-500/10 text-red-600 dark:text-red-300",
      };
    }
    return null;
  };

  // Floating tag-picker was replaced by a full-screen modal
  // (SkillTagPickerDialog). The card's "+" button just opens that modal.

  return (
    <div className="app-page">
      <div className="app-page-header pr-2 pb-1 flex items-center justify-between gap-3">
        <h1 className="app-page-title flex items-center gap-2">
          {t("mySkills.title")}
          <span className="app-badge">
            {skills.length}
          </span>
        </h1>

        <button
          onClick={() => setSkillsListOpen(true)}
          className="group inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-3 py-1.5 text-[13px] font-medium text-secondary transition-all duration-150 hover:-translate-y-px hover:border-accent/40 hover:bg-surface-hover hover:text-primary active:translate-y-0"
          title={t("mySkills.skillsList")}
        >
          <AlignLeft className="h-3.5 w-3.5 transition-transform duration-150 group-hover:rotate-3" />
          {t("mySkills.skillsList")}
        </button>
      </div>

      <div className="app-toolbar">
        <div className="flex flex-1 gap-3">
          <div className="relative w-full max-w-[280px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("mySkills.searchPlaceholder")}
              className="app-input w-full pl-9 font-medium"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          <div className="app-segmented">
            {(["all", "enabled", "available"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={cn(
                  "app-segmented-button",
                  filterMode === mode && "app-segmented-button-active"
                )}
              >
                {t(`mySkills.filters.${mode}`)}
              </button>
            ))}
          </div>

        </div>

        <div className="app-segmented">
          {(() => {
            const mode = getGitToolbarMode();
            const meta = getGitStatusMeta(mode);
            const Icon = meta.icon;
            return (
              <button
                type="button"
                onClick={() => navigate("/backup")}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-3 py-2 text-[13px] font-medium transition-colors hover:bg-surface-hover hover:text-secondary",
                  meta.className
                )}
                title={t("sidebar.backup")}
              >
                <Icon className={cn("h-3.5 w-3.5", meta.iconClassName)} />
                {meta.label}
              </button>
            );
          })()}
          <button
            onClick={handleCheckAllUpdates}
            disabled={checkingAll}
            className="ml-2 mr-2 inline-flex items-center gap-1 rounded-md border-l border-border-subtle pl-4 pr-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", checkingAll && "animate-spin")} />
            {t("mySkills.updateActions.checkAll")}
          </button>
          <button
            onClick={handleUpdateAvailableSkills}
            disabled={batchUpdating || availableUpdateCount === 0}
            className="mr-2 inline-flex items-center gap-1 rounded-md px-3 py-2 text-[13px] font-medium text-accent-light transition-colors hover:bg-accent-bg disabled:opacity-50"
          >
            <RotateCcw className={cn("h-3.5 w-3.5", batchUpdating && "animate-spin")} />
            {t("mySkills.updateActions.updateAvailable", { count: availableUpdateCount })}
          </button>
          <button
            onClick={() => setViewMode("grid")}
            className={cn(
              "rounded-md p-2 transition-colors outline-none",
              viewMode === "grid" ? "bg-surface-active text-secondary" : "text-muted hover:text-tertiary"
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={cn(
              "rounded-md p-2 transition-colors outline-none",
              viewMode === "list" ? "bg-surface-active text-secondary" : "text-muted hover:text-tertiary"
            )}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={() => isMultiSelect ? exitMultiSelect() : setIsMultiSelect(true)}
            className={cn(
              "rounded-md p-2 transition-colors outline-none",
              isMultiSelect ? "bg-surface-active text-secondary" : "text-muted hover:text-tertiary"
            )}
            title={isMultiSelect ? t("mySkills.cancelSelect") : t("mySkills.selectMode")}
          >
            <SquareCheck className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 px-1 -mt-2 -mb-3">
        {(["local", "import", "git", "skillssh"] as const).map((src) => (
          <button
            key={src}
            onClick={() => setSourceFilters(toggleFilter(sourceFilters, src))}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors",
              sourceFilters.has(src)
                ? "bg-accent text-white dark:bg-accent dark:text-white"
                : "bg-surface-hover text-muted hover:text-secondary"
            )}
          >
            {t(`mySkills.sourceFilter.${src}`)}
          </button>
        ))}
        {allTags.length > 0 && (
          <>
            <span className="mx-0.5 h-3 w-px bg-border-subtle" />
            {skills.some((s) => s.tags.length === 0) && (() => {
              const isActive = tagFilters.has(UNTAGGED_FILTER);
              return (
                <button
                  onClick={() => setTagFilters(toggleFilter(tagFilters, UNTAGGED_FILTER))}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors",
                    isActive
                      ? "bg-surface-active text-primary"
                      : "border border-dashed border-border text-muted hover:text-secondary"
                  )}
                  title={t("mySkills.tags.untagged")}
                >
                  <CircleSlash className="h-3 w-3" />
                  {t("mySkills.tags.untagged")}
                </button>
              );
            })()}
            {allTags.map((tag) => {
              const isActive = tagFilters.has(tag);
              return (
                <button
                  key={tag}
                  onClick={() => setTagFilters(toggleFilter(tagFilters, tag))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setTagMenu({
                      tag,
                      x: Math.min(e.clientX, window.innerWidth - 160),
                      y: Math.min(e.clientY, window.innerHeight - 90),
                    });
                  }}
                  title={t("mySkills.tags.manageHint")}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors",
                    isActive ? getTagActiveColor(tag, allTags) : getTagColor(tag, allTags)
                  )}
                >
                  {tag}
                </button>
              );
            })}
          </>
        )}
      </div>

      {/* Smart-tag filter row — only shows when smart tags exist. Clicking a
          chip filters the grid to skills bound to that smart tag (union of
          all selected). Uses a distinct accent style to tell it apart from
          the simple-tag row above. */}
      {smartTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-1 pb-1">
          <span className="flex items-center gap-1 pr-1 text-[12px] text-muted">
            <Sparkles className="h-3.5 w-3.5" />
            {t("mySkills.smartTagFilter")}
          </span>
          {smartTags.map((tag) => {
            const isActive = smartTagFilters.has(tag.id);
            return (
              <button
                key={tag.id}
                onClick={() =>
                  setSmartTagFilters((prev) => {
                    const next = new Set(prev);
                    if (next.has(tag.id)) next.delete(tag.id);
                    else next.add(tag.id);
                    return next;
                  })
                }
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors",
                  isActive
                    ? "bg-accent text-white"
                    : "border border-border-subtle bg-surface text-muted hover:border-accent/40 hover:text-secondary",
                )}
                title={tag.description ?? tag.name}
              >
                {tag.name}
              </button>
            );
          })}
          {smartTagFilters.size > 0 && (
            <button
              onClick={() => setSmartTagFilters(new Set())}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-[12px] font-medium text-muted transition-colors hover:border-border-subtle hover:text-secondary"
            >
              <X className="h-3 w-3" />
              {t("mySkills.clearSmartTagFilter")}
            </button>
          )}
        </div>
      )}

      {isMultiSelect && (
        <MultiSelectToolbar
          selectedCount={selectedIds.size}
          isAllSelected={isAllSelected}
          anyDisabled={viewedPreset ? anyDisabled : false}
          anyUpdatable={anyRefreshableSelected}
          showToggle={!!viewedPreset}
          updating={batchUpdating}
          labels={{
            hint: t("mySkills.selectHint"),
            selected: t("mySkills.selectedCount", { count: selectedIds.size }),
            update: t("mySkills.batchUpdate", { count: refreshableSelectedCount }),
            delete: t("mySkills.deleteSelected", { count: selectedIds.size }),
            enable: t("mySkills.batchEnable", { count: selectedIds.size }),
            disable: t("mySkills.batchDisable", { count: selectedIds.size }),
            selectAll: t("mySkills.selectAll"),
            deselectAll: t("mySkills.deselectAll"),
            cancel: t("common.cancel"),
            editTags: t("mySkills.batchEditTags", { count: selectedIds.size }),
          }}
          onUpdate={handleBatchRefresh}
          onDelete={() => setBatchDeleteConfirm(true)}
          onToggle={handleBatchTogglePreset}
          onSelectAll={handleSelectAll}
          onCancel={exitMultiSelect}
          onEditTags={() => setBatchTagDialogOpen(true)}
        />
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center pb-20 text-center">
          <Layers className="mb-4 h-12 w-12 text-faint" />
          <h3 className="mb-1.5 text-[14px] font-semibold text-tertiary">{t("mySkills.noSkills")}</h3>
          <p className="text-[13px] text-muted">
            {skills.length === 0 ? t("mySkills.addFirst") : t("mySkills.noMatch")}
          </p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={filtered.map((s) => s.id)}
            strategy={viewMode === "grid" ? rectSortingStrategy : verticalListSortingStrategy}
          >
          <div
            className={cn(
              "pb-8",
              viewMode === "grid"
                ? "grid grid-cols-2 gap-3 lg:grid-cols-3"
                : "flex flex-col gap-0.5"
            )}
          >
          {filtered.map((skill) => {
            const enabledInPreset = viewedPreset
              ? skill.preset_ids.includes(viewedPreset.id)
              : false;
            const badge = statusBadge(skill);
            const isMissingLocalSource =
              skill.update_status === "source_missing"
              && (skill.source_type === "local" || skill.source_type === "import");
            const displayName = skillDisplayNames.get(skill.id) || skill.name;

            if (viewMode === "grid") {
              return (
                <SortableSkillItem
                  key={skill.id}
                  id={skill.id}
                  disabled={!canDrag}
                >
                {(dragHandle) => (
                <div
                  className={cn(
                    "app-panel group relative flex h-full cursor-pointer flex-col transition-all hover:border-border hover:bg-surface-hover",
                    enabledInPreset && "border-l-2 border-l-accent",
                    isMultiSelect && selectedIds.has(skill.id) && "ring-1 ring-accent border-accent/40"
                  )}
                  onClick={() =>
                    isMultiSelect ? toggleSelect(skill.id) : openSkillDetailById(skill.id)
                  }
                >
                  <div className={cn("absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-lg border border-border-subtle bg-surface px-1 py-0.5 opacity-0 shadow-sm transition-all", !isMultiSelect && "group-hover:opacity-100")}>
                    {dragHandle}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCheckUpdate(skill); }}
                      disabled={checkingSkillId === skill.id}
                      className="rounded p-1 text-muted transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
                      title={t("mySkills.updateActions.check")}
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", checkingSkillId === skill.id && "animate-spin")} />
                    </button>
                    {canRefresh(skill) ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRefreshSkill(skill); }}
                        disabled={updatingSkillId === skill.id}
                        className="rounded p-1 text-accent-light transition-colors hover:bg-accent-bg disabled:opacity-50"
                        title={refreshLabel(skill)}
                      >
                        <RotateCcw className={cn("h-3.5 w-3.5", updatingSkillId === skill.id && "animate-spin")} />
                      </button>
                    ) : null}
                    <DeleteSkillButton
                      skill={skill}
                      onConfirm={handleDeleteSkill}
                      buttonClassName="p-1"
                    />
                  </div>
                  {deletingIds.has(skill.id) && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-surface/70 backdrop-blur-[1px]">
                      <Loader2 className="h-5 w-5 animate-spin text-muted" />
                    </div>
                  )}

                  <div className="flex items-center gap-2.5 px-3.5 pr-20 pt-3 pb-1.5">
                    {isMultiSelect && (
                      selectedIds.has(skill.id)
                        ? <SquareCheck className="h-3.5 w-3.5 shrink-0 text-accent" />
                        : <Square className="h-3.5 w-3.5 shrink-0 text-faint" />
                    )}
                    <h3
                      className="flex-1 truncate text-[14px] font-semibold text-primary group-hover:text-accent-light"
                      title={displayName}
                    >
                      {displayName}
                    </h3>
                  </div>

                  <div className="px-3.5 pb-3">
                    <p className="text-[13px] leading-[18px] text-muted truncate">
                      {skill.description || "—"}
                    </p>
                    {(badge || conflictIds.has(skill.id)) && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {conflictIds.has(skill.id) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate("/backup"); }}
                            className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[13px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
                            title={t("mySkills.needsAttentionHint")}
                          >
                            {t("mySkills.needsAttention")}
                          </button>
                        )}
                        {badge && (
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[13px] font-medium",
                              badge.className
                            )}
                          >
                            {badge.label}
                          </span>
                        )}
                        {isMissingLocalSource && (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRelinkSource(skill); }}
                              disabled={updatingSkillId === skill.id}
                              className="rounded-full border border-border-subtle px-2 py-0.5 text-[12px] font-medium text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
                            >
                              {t("mySkills.updateActions.relink")}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDetachSource(skill); }}
                              disabled={updatingSkillId === skill.id}
                              className="rounded-full border border-border-subtle px-2 py-0.5 text-[12px] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
                            >
                              {t("mySkills.updateActions.detachSource")}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    <div className="relative mt-2 flex flex-wrap items-center gap-1">
                      {getSkillSmartTags(skill).map((tag) => (
                        <span
                          key={tag.id}
                          className="group/tag inline-flex items-center gap-0.5 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent"
                        >
                          {tag.name}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleToggleSmartTag(skill, tag.id); }}
                            aria-label={`${t("mySkills.tags.removeTag")}: ${tag.name}`}
                            title={`${t("mySkills.tags.removeTag")}: ${tag.name}`}
                            className="hidden rounded-full p-0 opacity-60 hover:bg-red-500/10 hover:text-red-500 hover:opacity-100 group-hover/tag:inline-flex group-focus-within/tag:inline-flex focus:inline-flex"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      ))}
                      {skill.tags.map((tag) => (
                        <span
                          key={tag}
                          className={cn(
                            "group/tag inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            getTagColor(tag, allTags)
                          )}
                        >
                          {tag}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemoveTag(skill, tag); }}
                            aria-label={`${t("mySkills.tags.removeTag")}: ${tag}`}
                            title={`${t("mySkills.tags.removeTag")}: ${tag}`}
                            className="hidden rounded-full p-0 opacity-60 hover:opacity-100 group-hover/tag:inline-flex group-focus-within/tag:inline-flex focus:inline-flex"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      ))}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setTagDialogSkillId(skill.id);
                        }}
                        className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent transition-all duration-150 hover:scale-[1.05] hover:border-accent hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        title={t("mySkills.tags.addTag")}
                        aria-label={t("mySkills.tags.addTag")}
                      >
                        <Plus className="h-3 w-3" />
                        {t("mySkills.tags.addTagShort")}
                      </button>
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-border-subtle px-3.5 py-2.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="inline-flex shrink-0 items-center gap-1 text-[13px] text-muted">
                        {sourceIcon(skill.source_type)}
                        {sourceTypeLabel(skill)}
                      </span>
                      {enabledInPreset && (
                        <>
                          <span className="text-faint">·</span>
                          <span className="truncate text-[13px] font-medium text-amber-600 dark:text-amber-400/80">
                            {viewedPresetName}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <SyncDots
                        skill={skill}
                        tools={tools}
                        limit={6}
                        onToggle={
                          isMultiSelect
                            ? undefined
                            : (tool, enabled) => handleToggleSkillTarget(skill, tool, enabled)
                        }
                        pendingKey={togglingTarget?.skillId === skill.id ? togglingTarget.tool : null}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); handleTogglePreset(skill); }}
                        disabled={!viewedPreset}
                        className={cn(
                          "rounded px-2 py-1 text-[13px] font-medium transition-colors outline-none",
                          enabledInPreset
                            ? "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                            : "text-muted hover:bg-surface-hover hover:text-secondary"
                        )}
                      >
                        {enabledInPreset ? t("mySkills.enabledButton") : t("mySkills.enable")}
                      </button>
                    </div>
                  </div>
                </div>
                )}
                </SortableSkillItem>
              );
            }

            return (
              <SortableSkillItem key={skill.id} id={skill.id} disabled={!canDrag}>
              {(dragHandle) => (
              <div
                className={cn(
                  "app-panel group relative flex cursor-pointer items-center gap-3.5 rounded-xl border-transparent px-3.5 py-3 transition-all hover:border-border hover:bg-surface-hover",
                  enabledInPreset && "border-l-2 border-l-accent",
                  isMultiSelect && selectedIds.has(skill.id) && "ring-1 ring-accent border-accent/40"
                )}
                onClick={() =>
                  isMultiSelect ? toggleSelect(skill.id) : openSkillDetailById(skill.id)
                }
              >
                {deletingIds.has(skill.id) && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-surface/70 backdrop-blur-[1px]">
                    <Loader2 className="h-5 w-5 animate-spin text-muted" />
                  </div>
                )}
                {dragHandle}
                {isMultiSelect && (
                  selectedIds.has(skill.id)
                    ? <SquareCheck className="h-3.5 w-3.5 shrink-0 text-accent" />
                    : <Square className="h-3.5 w-3.5 shrink-0 text-faint" />
                )}

                <h3
                  className="w-[180px] shrink-0 truncate text-[14px] font-semibold text-secondary group-hover:text-primary"
                  title={displayName}
                >
                  {displayName}
                </h3>

                <p className="min-w-0 flex-1 truncate text-[13px] text-muted">
                  {skill.description || "—"}
                </p>

                <div className="relative flex shrink-0 items-center gap-1.5">
                  {getSkillSmartTags(skill).map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent"
                    >
                      {tag.name}
                    </span>
                  ))}
                  {skill.tags.map((tag) => (
                    <span
                      key={tag}
                      className={cn(
                        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium",
                        getTagColor(tag, allTags)
                      )}
                    >
                      {tag}
                    </span>
                  ))}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setTagDialogSkillId(skill.id);
                    }}
                    className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent transition-all duration-150 hover:scale-[1.05] hover:border-accent hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    title={t("mySkills.tags.addTag")}
                    aria-label={t("mySkills.tags.addTag")}
                  >
                    <Plus className="h-3 w-3" />
                    {t("mySkills.tags.addTagShort")}
                  </button>
                </div>

                <div className="flex shrink-0 items-center gap-2.5">
                  {conflictIds.has(skill.id) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate("/backup"); }}
                      className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[12px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
                      title={t("mySkills.needsAttentionHint")}
                    >
                      {t("mySkills.needsAttention")}
                    </button>
                  )}
                  {badge && (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[12px] font-medium",
                        badge.className
                      )}
                    >
                      {badge.label}
                    </span>
                  )}
                  <SyncDots
                    skill={skill}
                    tools={tools}
                    limit={6}
                    size="sm"
                    onToggle={
                      isMultiSelect
                        ? undefined
                        : (tool, enabled) => handleToggleSkillTarget(skill, tool, enabled)
                    }
                    pendingKey={togglingTarget?.skillId === skill.id ? togglingTarget.tool : null}
                  />
                  <span className="inline-flex items-center gap-1 text-[13px] text-muted">
                    {sourceIcon(skill.source_type)}
                    {sourceTypeLabel(skill)}
                  </span>
                  {enabledInPreset && (
                    <span className="text-[13px] font-medium text-amber-600 dark:text-amber-400/80">
                      {viewedPresetName}
                    </span>
                  )}
                </div>

                <div className={cn("flex shrink-0 items-center gap-1 opacity-0 transition-opacity", !isMultiSelect && "group-hover:opacity-100")}>
                  {isMissingLocalSource && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRelinkSource(skill); }}
                        disabled={updatingSkillId === skill.id}
                        className="rounded px-2 py-0.5 text-[13px] font-medium text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
                      >
                        {t("mySkills.updateActions.relink")}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDetachSource(skill); }}
                        disabled={updatingSkillId === skill.id}
                        className="rounded px-2 py-0.5 text-[13px] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
                      >
                        {t("mySkills.updateActions.detachSource")}
                      </button>
                    </>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleTogglePreset(skill); }}
                    disabled={!viewedPreset}
                    className={cn(
                      "rounded px-2 py-0.5 text-[13px] font-medium transition-colors outline-none",
                      enabledInPreset
                        ? "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                        : "text-muted hover:bg-surface-hover hover:text-secondary"
                    )}
                  >
                    {enabledInPreset ? t("mySkills.enabledButton") : t("mySkills.enable")}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCheckUpdate(skill); }}
                    disabled={checkingSkillId === skill.id}
                    className="rounded p-0.5 text-muted transition-colors hover:bg-surface-hover hover:text-secondary disabled:opacity-50"
                    title={t("mySkills.updateActions.check")}
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", checkingSkillId === skill.id && "animate-spin")} />
                  </button>
                  {canRefresh(skill) ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRefreshSkill(skill); }}
                      disabled={updatingSkillId === skill.id}
                      className="rounded p-0.5 text-accent-light transition-colors hover:bg-accent-bg disabled:opacity-50"
                      title={refreshLabel(skill)}
                    >
                      <RotateCcw className={cn("h-3.5 w-3.5", updatingSkillId === skill.id && "animate-spin")} />
                    </button>
                  ) : null}
                  <DeleteSkillButton
                    skill={skill}
                    onConfirm={handleDeleteSkill}
                    buttonClassName="p-0.5"
                  />
                </div>
              </div>
              )}
              </SortableSkillItem>
            );
          })}
        </div>
          </SortableContext>
        </DndContext>
      )}

      <SkillDetailPanel
        key={selectedSkill?.id ?? "skill-detail-empty"}
        skill={selectedSkill}
        onClose={closeSkillDetail}
        tools={tools}
        toolToggles={toolToggles}
        togglingTool={togglingToolKey}
        onToggleTool={handleToggleSkillTool}
        projects={projects}
        onProjectsChanged={refreshProjects}
      />

      <ConfirmDialog
        open={batchDeleteConfirm}
        message={t("mySkills.batchDeleteConfirm", { count: selectedIds.size })}
        onClose={() => setBatchDeleteConfirm(false)}
        onConfirm={handleBatchDelete}
      />
      <ConfirmDialog
        open={tagToDelete !== null}
        title={t("mySkills.tags.deleteTag")}
        message={t("mySkills.tags.deleteConfirm", { tag: tagToDelete || "" })}
        onClose={() => setTagToDelete(null)}
        onConfirm={handleDeleteTag}
      />
      <TagRenameDialog
        open={tagToRename !== null}
        currentName={tagToRename || ""}
        onClose={() => setTagToRename(null)}
        onRename={handleRenameTag}
      />
      {tagMenu && (
        <>
          {/* Backdrop closes on left- or right-click outside the menu. Explicit
              z-index (z-40/z-50) to avoid the macOS WKWebView stacking bug. */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setTagMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setTagMenu(null);
            }}
          />
          <div
            className="fixed z-50 min-w-[140px] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-2xl"
            style={{ top: tagMenu.y, left: tagMenu.x }}
          >
            <button
              onClick={() => {
                setTagToRename(tagMenu.tag);
                setTagMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-secondary hover:bg-surface-hover"
            >
              <Pencil className="h-3.5 w-3.5" />
              {t("mySkills.tags.renameTag")}
            </button>
            <button
              onClick={() => {
                setTagToDelete(tagMenu.tag);
                setTagMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-red-400 hover:bg-surface-hover"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("mySkills.tags.deleteTag")}
            </button>
          </div>
        </>
      )}
      <BatchTagDialog
        open={batchTagDialogOpen}
        skills={skills.filter((s) => selectedIds.has(s.id))}
        allTags={allTags}
        onClose={() => setBatchTagDialogOpen(false)}
        onApply={handleBatchEditTags}
      />
      <SkillsListDialog
        open={skillsListOpen}
        skills={skills}
        smartTags={smartTags}
        onClose={() => setSkillsListOpen(false)}
      />
      <SkillTagPickerDialog
        open={tagDialogSkillId !== null}
        skill={tagDialogSkillId ? (skills.find((s) => s.id === tagDialogSkillId) ?? null) : null}
        smartTags={smartTags}
        smartTagsMap={smartTagsMap}
        getTagColor={getTagColor}
        allSimpleTags={allTags}
        onClose={() => setTagDialogSkillId(null)}
        onToggleSmartTag={handleToggleSmartTag}
        onToggleSimpleTag={handleToggleSimpleTag}
        onCreateSimpleTag={handleAddSimpleTag}
      />
    </div>
  );
}
