import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../utils";
import type { ManagedSkill, SmartTag } from "../lib/tauri";

interface Props {
  open: boolean;
  /** The skill being tagged (null when closed). */
  skill: ManagedSkill | null;
  /** All smart tags available for binding. */
  smartTags: SmartTag[];
  /** skill_id -> smart_tag_id[] membership map. */
  smartTagsMap: Record<string, string[]>;
  /** Simple-tag color resolver (same one the cards use). */
  getTagColor: (tag: string, allTags: string[]) => string;
  allSimpleTags: string[];
  onClose: () => void;
  /** Toggle a smart tag binding for the open skill. */
  onToggleSmartTag: (skill: ManagedSkill, smartTagId: string) => void;
  /** Toggle a simple tag for the open skill. */
  onToggleSimpleTag: (skill: ManagedSkill, tag: string) => void;
  /** Create + bind a brand-new simple tag. */
  onCreateSimpleTag: (skill: ManagedSkill, name: string) => void;
}

/**
 * Full-screen modal for editing a single skill's tags. Two sections:
 *  - Smart tags: checkbox list (✓ = bound). One click toggles binding.
 *  - Simple tags: existing simple tags as toggle chips + a quick-add input.
 *
 * Replaces the old inline floating "tag picker" popover which was cramped and
 * hard to hit on touch/dense grids.
 */
export function SkillTagPickerDialog({
  open,
  skill,
  smartTags,
  smartTagsMap,
  getTagColor,
  allSimpleTags,
  onClose,
  onToggleSmartTag,
  onToggleSimpleTag,
  onCreateSimpleTag,
}: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // 保存最新的 onClose 到 ref，避免它作为 effect 依赖时——因为父组件每次渲染
  // 都传入新的内联函数引用——导致焦点 effect 反复重跑、把焦点强制抢回搜索框。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Reset the search + new-tag inputs whenever a different skill opens, so a
  // half-typed search from skill A doesn't bleed into the dialog for skill B.
  // (Component stays mounted while closed, so state would otherwise persist.)
  useEffect(() => {
    if (open) {
      setSearch("");
      setNewTagName("");
    }
  }, [open, skill?.id]);

  // Keep keyboard focus inside the modal and restore it to the trigger when
  // the dialog closes. The search box is the most useful initial target.
  // 依赖只放 [open]：焦点只在「打开/关闭」那一刻各跑一次，不能每次父组件
  // 重渲染都重跑——否则点击列表项触发状态更新 → onClose 新引用 → effect
  // 重跑 → setTimeout 把焦点抢回搜索框，按钮点击/Tab 全部失效。
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
      returnFocusRef.current?.focus();
    };
  }, [open]);

  // Bound smart-tag ids for the open skill, as a Set for O(1) lookup.
  const boundSmartTagIds = useMemo(
    () => new Set(skill ? (smartTagsMap[skill.id] ?? []) : []),
    [skill, smartTagsMap],
  );

  // Filter smart tags by the search box.
  const filteredSmartTags = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return smartTags;
    return smartTags.filter((tag) => tag.name.toLowerCase().includes(needle));
  }, [smartTags, search]);

  // Simple tags of the open skill + the ones not yet on it (candidates).
  const skillSimpleTags = skill?.tags ?? [];
  const candidateSimpleTags = useMemo(() => {
    const onSkill = new Set(skillSimpleTags.map((x) => x.toLowerCase()));
    const needle = search.trim().toLowerCase();
    return allSimpleTags.filter((tag) => {
      if (onSkill.has(tag.toLowerCase())) return false;
      if (!needle) return true;
      return tag.toLowerCase().includes(needle);
    });
  }, [allSimpleTags, skillSimpleTags, search]);

  if (!open || !skill) return null;

  const handleToggleSimple = (tag: string) => {
    // Toggle semantics (add if absent, remove if present) live in the parent's
    // onToggleSimpleTag — both branches used to call it identically.
    onToggleSimpleTag(skill, tag);
  };

  const handleCreate = () => {
    const name = newTagName.trim();
    if (!name || skill.tags.includes(name)) return;
    onCreateSimpleTag(skill, name);
    setNewTagName("");
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t("mySkills.tags.pickerTitle")}
    >
      <div className="absolute inset-0" onClick={onClose} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-bg-secondary shadow-[0_40px_90px_rgba(0,0,0,0.45)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-semibold text-primary">
              {t("mySkills.tags.pickerTitle")}
            </h2>
            <p className="mt-0.5 truncate text-[12px] text-muted">
              {skill.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-lg border border-border bg-background p-2 text-muted transition hover:border-border-subtle hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-border-subtle px-5 py-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("mySkills.tags.searchTags")}
              className="h-8 w-full rounded-md border border-border-subtle bg-surface pl-8 pr-3 text-[13px] text-primary outline-none transition-colors focus:border-accent"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        {/* Body: scrollable tag sections */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Smart tags — checkbox list */}
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              {t("mySkills.tags.smartTagsSection")}
            </h3>
            {smartTags.length === 0 ? (
              <p className="text-[12px] text-faint">
                {t("mySkills.tags.pickerNoSmartTags")}
              </p>
            ) : filteredSmartTags.length === 0 ? (
              <p className="text-[12px] text-faint">
                {t("mySkills.tags.noMatch")}
              </p>
            ) : (
              <div className="space-y-1">
                {filteredSmartTags.map((tag) => {
                  const checked = boundSmartTagIds.has(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => onToggleSmartTag(skill, tag.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                        checked
                          ? "border-accent/30 bg-accent/10"
                          : "border-border-subtle bg-surface hover:bg-surface-hover",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                          checked
                            ? "border-accent bg-accent text-white"
                            : "border-border text-transparent",
                        )}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-[13px] font-medium",
                            checked ? "text-accent" : "text-secondary",
                          )}
                        >
                          {tag.name}
                        </span>
                        {tag.description && (
                          <span className="block truncate text-[11px] text-muted">
                            {tag.description}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Simple tags — toggle chips */}
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              {t("mySkills.tags.simpleTagsSection")}
            </h3>

            {/* Already on this skill (click to remove) */}
            {skillSimpleTags.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {skillSimpleTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleToggleSimple(tag)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium transition-colors",
                      getTagColor(tag, allSimpleTags),
                      "hover:opacity-80",
                    )}
                  >
                    {tag}
                    <X className="h-3 w-3 opacity-60" />
                  </button>
                ))}
              </div>
            )}

            {/* Candidates (click to add) */}
            {candidateSimpleTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {candidateSimpleTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleToggleSimple(tag)}
                    className={cn(
                      "inline-flex items-center rounded-md border border-dashed border-current/30 px-2 py-1 text-[12px] font-medium transition-all hover:scale-[1.04] hover:border-current/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      getTagColor(tag, allSimpleTags),
                    )}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}

            {/* Create new */}
            <div className="mt-2 flex items-center gap-1.5">
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
                placeholder={t("mySkills.tags.pickerCreatePlaceholder")}
                className="h-7 flex-1 rounded-md border border-border-subtle bg-surface px-2.5 text-[12px] text-primary outline-none transition-colors focus:border-accent"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={!newTagName.trim()}
                className="rounded-md border border-border-subtle bg-surface px-2.5 py-1 text-[12px] font-medium text-secondary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("mySkills.tags.pickerAdd")}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
