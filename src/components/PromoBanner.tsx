import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

// Centralized so a link change doesn't require chasing it through JSX. Lift to
// a remote config / settings entry if it ever needs to change without a release.
const PROMO_URL = "https://bbs.dguagua.com/topics/category/6";
// Per-browser-tab dismiss memory: "don't show again this session". Using
// sessionStorage (not localStorage) so a new app launch re-shows the banner.
export const PROMO_DISMISS_KEY = "skills-manager:promo-dismissed";
/** Banner height in px — Layout/Sidebar read this so the top offset tracks it. */
export const PROMO_HEIGHT = 30;

interface PromoBannerProps {
  /** Controlled visibility — Layout owns this so it can shrink the content
   * top-padding + sidebar safe-zone when the banner is dismissed. */
  visible: boolean;
  onDismiss: () => void;
}

/**
 * Full-width 30px promo strip, rendered across the top of the window
 * (below the drag bar, spanning sidebar + content). Clicking anywhere opens
 * the promo URL in the system browser via the opener plugin. A close button
 * on the right hides it for the rest of this session.
 *
 * Visual mirrors the reference design: dark→indigo gradient, ⚡ icon + title
 * on the left, a cyan CTA pill on the right. Fixed height so the layout's
 * top offset stays stable.
 */
export function PromoBanner({ visible, onDismiss }: PromoBannerProps) {
  const { t } = useTranslation();

  if (!visible) return null;

  const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    try {
      await openUrl(PROMO_URL);
    } catch {
      window.open(PROMO_URL, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="absolute inset-x-0 top-[28px] z-40 flex h-[30px] items-center bg-gradient-to-r from-[#0a0e27] to-[#4f46e5] px-4 transition-shadow duration-200 hover:shadow-[0_2px_16px_rgba(79,70,229,0.5)]">
      <a
        href={PROMO_URL}
        onClick={handleClick}
        rel="noopener noreferrer"
        className="flex min-w-0 flex-1 items-center justify-between no-underline"
        title={t("promo.tooltip")}
      >
        {/* Left: icon + title + tagline */}
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="text-[15px] leading-none text-[#06b6d4]">⚡</span>
          <span className="truncate text-[13px] font-bold tracking-wide text-white">
            {t("promo.title")}
          </span>
          <span className="hidden truncate border-l border-white/20 pl-2.5 text-[11px] text-white/60 sm:block">
            {t("promo.tagline")}
          </span>
        </span>
        <span className="ml-2 flex shrink-0 items-center rounded-full bg-[#06b6d4] px-3 py-[3px] text-[12px] font-bold text-[#0a0e27] shadow-[0_0_12px_rgba(6,182,212,0.4)] transition-transform duration-200 hover:scale-105">
          {t("promo.cta")}
        </span>
      </a>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("promo.dismiss")}
        title={t("promo.dismiss")}
        className="ml-2 flex shrink-0 items-center justify-center rounded-full p-1 text-white/90 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

