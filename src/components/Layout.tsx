import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { StatusBanner } from "./StatusBanner";
import { CommandPalette } from "./CommandPalette";
import { PromoBanner, PROMO_DISMISS_KEY, PROMO_HEIGHT } from "./PromoBanner";
import { useApp } from "../context/AppContext";
import { useTranslation } from "react-i18next";
import { useDragWindow } from "../hooks/useDragWindow";

// Drag bar (28px) + promo banner (30px). When the banner is dismissed, only
// the drag bar remains, so the content/sidebar top offset shrinks accordingly.
const DRAG_BAR_HEIGHT = 28;

export function Layout() {
  const { t } = useTranslation();
  const { appError, refreshAppData } = useApp();
  const onDrag = useDragWindow();
  const navigate = useNavigate();

  // Layout owns banner visibility so it can shrink the content padding and the
  // sidebar safe-zone in lockstep when the user dismisses it.
  const [promoVisible, setPromoVisible] = useState(() =>
    typeof sessionStorage !== "undefined"
      ? sessionStorage.getItem(PROMO_DISMISS_KEY) !== "1"
      : true,
  );
  const handleDismissPromo = () => {
    try {
      sessionStorage.setItem(PROMO_DISMISS_KEY, "1");
    } catch {
      // sessionStorage may throw in private mode; the in-memory flag still
      // hides the banner for this session.
    }
    setPromoVisible(false);
  };
  // Top offset for content + sidebar: drag bar + (banner height if visible).
  const topOffset = DRAG_BAR_HEIGHT + (promoVisible ? PROMO_HEIGHT : 0);

  // Cmd+, to open Settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();
        navigate("/settings");
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();
        refreshAppData();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, refreshAppData]);

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-background text-primary">
      {/* Full-width top drag bar — spans sidebar + content, with bottom divider */}
      <div
        onMouseDown={onDrag}
        className="absolute inset-x-0 top-0 z-50 h-[28px] border-b border-border-subtle bg-bg-secondary"
      />
      {/* Full-width promo strip — below the drag bar, above all content */}
      <PromoBanner visible={promoVisible} onDismiss={handleDismissPromo} />
      <Sidebar topOffset={topOffset} />
      <div className="relative flex min-w-[600px] flex-1 flex-col overflow-hidden">
        <div
          className="flex-1 overflow-y-auto px-5 pb-5 scrollbar-hide"
          style={{ paddingTop: `calc(${topOffset}px + 20px)` }}
        >
          <div className="mx-auto flex min-h-full max-w-[1200px] flex-col gap-4">
            {appError ? (
              <StatusBanner
                compact
                title={t("common.dataOutOfDate")}
                description={appError}
                actionLabel={t("common.retry")}
                onAction={refreshAppData}
                tone="danger"
              />
            ) : null}
            <Outlet />
          </div>
        </div>
      </div>
      <CommandPalette />
    </div>
  );
}
