import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";

const PROMO_URL = "https://bbs.dguagua.com/topics/category/6";

/**
 * Full-width 30px promo strip, rendered across the top of the window
 * (below the drag bar, spanning sidebar + content). Clicking anywhere opens
 * the promo URL in the system browser via the opener plugin.
 *
 * Visual mirrors the reference design: dark→indigo gradient, ⚡ icon + title
 * on the left, a cyan CTA pill on the right. Fixed height so the layout's
 * top offset stays stable.
 */
export function PromoBanner() {
  const { t } = useTranslation();

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      await openUrl(PROMO_URL);
    } catch {
      window.open(PROMO_URL, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <a
      href={PROMO_URL}
      onClick={handleClick}
      className="absolute inset-x-0 top-[28px] z-40 flex h-[30px] items-center justify-between px-4 no-underline transition-shadow duration-200 bg-gradient-to-r from-[#0a0e27] to-[#4f46e5] hover:shadow-[0_2px_16px_rgba(79,70,229,0.5)]"
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
      {/* Right: CTA pill */}
      <span className="ml-2 flex shrink-0 items-center rounded-full bg-[#06b6d4] px-3 py-[3px] text-[12px] font-bold text-[#0a0e27] shadow-[0_0_12px_rgba(6,182,212,0.4)] transition-transform duration-200 hover:scale-105">
        {t("promo.cta")}
      </span>
    </a>
  );
}
