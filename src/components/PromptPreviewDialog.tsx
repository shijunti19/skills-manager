import { useState } from "react";
import { Copy, RefreshCw, X } from "lucide-react";
import { writeText as clipboardWriteText } from "@tauri-apps/plugin-clipboard-manager";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface PromptPreviewDialogProps {
  open: boolean;
  /** Pre-assembled prompt text (tag descriptions + skill links + tag prompts). */
  generatedText: string;
  onClose: () => void;
  /** Called when the user clicks "regenerate" — parent should rebuild generatedText. */
  onRegenerate: () => void;
}

const TASK_DRAFT_KEY = "skills-manager:taskDraft";

/** Read the cached task draft once at mount (lazy initializer). */
function readCachedDraft(): string {
  try {
    return localStorage.getItem(TASK_DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Modal that previews the assembled prompt and lets the user append a
 * free-form task description. The task text is cached in localStorage so it
 * survives across opens. "Copy all" copies the generated text + task to the
 * clipboard ready to paste into an AI agent.
 */
export function PromptPreviewDialog({
  open,
  generatedText,
  onClose,
  onRegenerate,
}: PromptPreviewDialogProps) {
  const { t } = useTranslation();
  const [taskDraft, setTaskDraft] = useState(readCachedDraft);
  const [copied, setCopied] = useState(false);

  // Persist the task draft on every change (best-effort).
  const handleTaskChange = (value: string) => {
    setTaskDraft(value);
    try {
      localStorage.setItem(TASK_DRAFT_KEY, value);
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  };

  if (!open) return null;

  const fullText = taskDraft.trim()
    ? `${generatedText}\n\n---\n${taskDraft.trim()}`
    : generatedText;

  const handleCopyAll = async () => {
    try {
      await clipboardWriteText(fullText);
      setCopied(true);
      toast.success(t("promptPreview.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("promptPreview.copyFailed"));
    }
  };

  const handleRegenerate = () => {
    // Clear the cached task and let the parent rebuild the generated text.
    try {
      localStorage.removeItem(TASK_DRAFT_KEY);
    } catch {
      /* ignore */
    }
    setTaskDraft("");
    onRegenerate();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-6 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-border bg-bg-secondary shadow-[0_40px_90px_rgba(0,0,0,0.45)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold text-primary">
              {t("promptPreview.title")}
            </h2>
            <p className="mt-0.5 text-[12px] text-muted">
              {t("promptPreview.subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyAll}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-accent-hover"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? t("promptPreview.copied") : t("promptPreview.copyAll")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-background p-2 text-muted transition hover:border-border-subtle hover:text-secondary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body: generated text (read-only) + task input */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">
              {t("promptPreview.generatedLabel")}
            </p>
            <pre className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border-subtle bg-surface px-3 py-2.5 font-mono text-[12px] leading-5 text-secondary">
              {generatedText}
            </pre>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">
              {t("promptPreview.taskLabel")}
            </p>
            <textarea
              value={taskDraft}
              onChange={(e) => handleTaskChange(e.target.value)}
              placeholder={t("promptPreview.taskPlaceholder")}
              rows={5}
              className="w-full resize-y rounded-lg border border-border-subtle bg-surface px-3 py-2.5 text-[13px] leading-5 text-primary placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
          <span className="text-[11px] text-faint">
            {t("promptPreview.cacheHint")}
          </span>
          <button
            type="button"
            onClick={handleRegenerate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-[12px] font-medium text-secondary transition hover:bg-surface-hover"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("promptPreview.regenerate")}
          </button>
        </div>
      </div>
    </div>
  );
}
