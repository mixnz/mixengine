import { Suspense, useEffect, useLayoutEffect, useState } from "react";
import LoadingOverlay from "../components/LoadingOverlay";
import ErrorBoundary from "../components/ErrorBoundary";
import GlassFilter from "./components/GlassFilter";
import SettingsModal from "./components/SettingsModal";
import UpdateToast from "./components/UpdateToast";
import ContextMenu from "../components/ContextMenu";
import { moveTab, Tab, TabAction, tabKeyDown, TabStrip, TabTitle, useTabReorder } from "../components/TabStrip";
import { PlusIcon, SettingsIcon } from "../icons";
import { isBlockedReload } from "../core/reload";
import { useScrollAcceleration } from "../core/scroll";
import { useShortcut, useShortcutDispatcher } from "../core/shortcuts";
import { useAccent, useGlass, useTheme } from "./theme";
import { useUpdateCheck } from "./update";
import { useTranslation } from "../i18n";
import type { TabBadge } from "./module";
import { onTabRequest, takeTabRequests } from "./launch";
import { readSession, writeSession } from "./session";
import { rebadgeTab, restateTab, retitleTab, tabIdAtOffset, type TabInfo } from "./tabs";
import { DEFAULT_MODULE_ID, MODULES, moduleById } from "./registry";
import { ALL_SHORTCUTS, MODULE_TAB_SHORTCUTS } from "./shortcuts";
import "./App.css";
/* After App.css, so the glass surfaces override the plain ones they replace rather than the other
   way round. */
import "./glass.css";

function App() {
  const { t } = useTranslation();

  function newTab(moduleId: string = DEFAULT_MODULE_ID, state?: unknown): TabInfo {
    const def = moduleById(moduleId);
    return { id: crypto.randomUUID(), moduleId, title: t(def.defaultTitleKey), badges: [], state };
  }

  /* What was open when the app was last closed, read once on the way up. The strip and, per tab,
     one opaque value the module behind it asked to have kept — the shell carries it and does not
     read it. What a module does with its own is up to the module, and it does not do it until the
     tab is first looked at. See `shell/session.ts`. */
  const [restored] = useState(readSession);
  const [tabs, setTabs] = useState<TabInfo[]>(() =>
    // Badges are never stored; the module reports its own the moment it mounts.
    restored ? restored.tabs.map((tab) => ({ ...tab, badges: [] })) : [newTab()],
  );
  const [activeId, setActiveId] = useState(() => restored?.activeId ?? tabs[0].id);
  /* The tabs that have been in front at least once this launch — the only ones rendered.
     Restoring six tabs by mounting six panes would open six connection forms and start six
     shells at launch, for tabs the user may never come back to; the rest of them sit on the strip
     and wait, and mount the first time they are looked at. */
  const [mounted, setMounted] = useState<string[]>(() => [activeId]);
  const [theme, setTheme] = useTheme();
  const [accent, setAccent] = useAccent();
  const [glass, setGlass] = useGlass();
  const [settingsOpen, setSettingsOpen] = useState(false);
  /* Where the `[+]` menu was asked for, while it is open. Never set with one module: the button
     opens a tab outright then, exactly as it did before there was a registry. */
  const [moduleMenu, setModuleMenu] = useState<{ x: number; y: number } | null>(null);
  const update = useUpdateCheck();

  useScrollAcceleration();
  useShortcutDispatcher(ALL_SHORTCUTS);
  // Always listening — the tab bar is there on every screen the app has.
  useShortcut("app.newTab", () => openTab(), true);
  useShortcut("app.closeTab", () => closeTab(activeId), true);
  useShortcut("app.nextTab", () => setActiveId(tabIdAtOffset(tabs, activeId, 1)), true);
  useShortcut("app.prevTab", () => setActiveId(tabIdAtOffset(tabs, activeId, -1)), true);
  /* One number key per module — `Ctrl/Cmd+1` for the first in the registry, `2` for the second.
     Hooks in a loop, which is safe here and only here: `MODULE_TAB_SHORTCUTS` is a module-level
     constant, so the count and the order are fixed for the life of the app. Reading the list rather
     than naming the modules is what keeps this file from being the second place that knows them. */
  for (const { moduleId, def } of MODULE_TAB_SHORTCUTS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- module-level constant, see above: same count, same order, every render, for the life of the app.
    useShortcut(def.id, () => openTab(moduleId), true);
  }

  /* `state` is only ever given by the backend's tab requests below: it is what the module behind
     the tab reads on mount, through the same `restored` prop a tab from the last session gets. */
  function openTab(moduleId?: string, state?: unknown) {
    const tab = newTab(moduleId, state);
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      return next.length > 0 ? next : [newTab()];
    });
    setMounted((prev) => prev.filter((mountedId) => mountedId !== id));
  }

  /* Dragging a tab along the strip. The order is the tab list itself, so a move is a new list and
     everything that follows the list follows the move — `Ctrl+Tab` walks the strip as it is drawn,
     and the session file is written the moment it changes. */
  const reorder = useTabReorder((fromId, toId, side) => {
    setTabs((prev) => moveTab(prev, fromId, toId, side));
  });

  function renameTab(id: string, title: string) {
    setTabs((prev) => retitleTab(prev, id, title));
  }

  function setTabBadges(id: string, badges: TabBadge[]) {
    setTabs((prev) => rebadgeTab(prev, id, badges));
  }

  function setTabState(id: string, state: unknown) {
    setTabs((prev) => restateTab(prev, id, state));
  }

  // Keeps activeId pointing at a real tab whenever the active one disappears
  // (e.g. closing the last remaining tab spawns a fresh one that must be focused).
  useLayoutEffect(() => {
    if (!tabs.some((t) => t.id === activeId)) {
      setActiveId(tabs[tabs.length - 1].id);
    }
  }, [tabs, activeId]);

  // Whatever is in front is mounted, and stays mounted for the rest of the launch — every pane in
  // the app is written on the understanding that leaving a tab does not throw its state away.
  useEffect(() => {
    setMounted((prev) => (prev.includes(activeId) ? prev : [...prev, activeId]));
  }, [activeId]);

  /* Written as it changes rather than on the way out: a desktop app is closed by the window
     manager, by a crash, or by an update restarting it, and only the first of those would ever
     reach a handler. Badge changes bring this round too — they cost a `JSON.stringify` of three
     fields per tab, which is cheaper than working out whether they mattered. */
  useEffect(() => {
    writeSession(tabs, activeId);
  }, [tabs, activeId]);

  /* Tabs the backend asks for — see `shell/launch.ts` for what they are and why they are drained
     rather than delivered. No "cancelled" guard around the drain: what has been taken from the
     backend's queue is gone from it, and a request dropped because StrictMode remounted this
     component between the call and its answer would be a tab that never opens. */
  useEffect(() => {
    const ids = MODULES.map((m) => m.id);
    async function drain() {
      const requests = await takeTabRequests(ids).catch(() => []);
      for (const request of requests) openTab(request.moduleId, request.state);
    }
    const unlisten = onTabRequest(() => void drain());
    void drain();
    return () => {
      void unlisten.then((stop) => stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `openTab` is rebuilt every render and only ever calls the two stable setters; listening once is the point.
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Reloading the webview takes every open connection down with it, so no keystroke is left
      // able to ask for one. What `Ctrl+R` means instead is decided by the pane on screen, which
      // claims the key for its own reload button — see `useReloadShortcut`.
      //
      // The last chord not on the registry, and it is not a command: nothing is being asked for
      // here, only refused. See `isBlockedReload` for what differs between builds.
      if (isBlockedReload(e)) e.preventDefault();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <main className="app">
      {/* Draws nothing on its own — it is the filter the glass surfaces point at, and it has to
          outlive any one of them. Left out entirely while the setting is off, so a look nobody
          asked for costs nothing to have shipped. */}
      {glass && <GlassFilter />}
      {/* The one strip in the app that was reachable by mouse only. Every other one — the REST
          requests, the tabs inside the response pane — already says what it is and takes Enter and
          Space; this one is the app's own tab bar, so being the exception was the wrong way round.
          `Ctrl+Tab` moved between tabs all along, but only once one was already open and focused. */}
      <TabStrip
        role="tablist"
        aria-label={t("app.tabs")}
        {...reorder.strip}
        /* The app's name is also its settings button, which nothing about a bare word at 70%
           opacity said — so it wears a surface, a border and a gear, and reads as something to
           press before it is hovered.

           Once an update is out, this is also the way back to it after the panel in the corner is
           gone, so it carries a dot until the user installs or skips that version. A download
           waved away mid-flight goes on, and finishes behind this dot.

           In `leading`, so that a window full of tabs cannot scroll the way into Settings off the
           left-hand edge — it is the one control that is there on every screen the app has. */
        leading={
          <button
            type="button"
            className={update.pending ? "brand brand-update" : "brand"}
            onClick={() => setSettingsOpen(true)}
            title={update.pending && update.release ? t("update.available", { version: update.release.version }) : t("app.settings")}
            aria-label={t("app.settings")}
          >
            MixDB
            <SettingsIcon className="brand-gear" size={14} />
          </button>
        }
        trailing={
          <TabAction
            onClick={(e) => {
              // One module and a menu would be a list of one, so the button just opens it — which
              // is what it did before there was a registry at all.
              if (MODULES.length < 2) {
                openTab();
                return;
              }
              const rect = e.currentTarget.getBoundingClientRect();
              setModuleMenu({ x: rect.left, y: rect.bottom });
            }}
            title={t("app.newConnectionTab")}
            aria-label={t("app.newConnectionTab")}
          >
            <PlusIcon />
          </TabAction>
        }
      >
        {tabs.map((tab) => {
          const def = moduleById(tab.moduleId);
          return (
            <Tab
              key={tab.id}
              active={tab.id === activeId}
              role="tab"
              aria-selected={tab.id === activeId}
              tabIndex={0}
              className={tab.badges.map((b) => b.tabClassName).filter(Boolean).join(" ")}
              onClose={() => closeTab(tab.id)}
              closeLabel={t("app.closeTab")}
              onClick={() => setActiveId(tab.id)}
              onKeyDown={tabKeyDown(() => setActiveId(tab.id))}
              {...reorder.tab(tab.id)}
            >
              {/* A tab with nothing of its own to say still says which module it is, and most of
                  them have a spell of having nothing to say: a database tab wears no engine until
                  it is connected to one, a terminal none until a shell is picked, and a tab
                  restored from the last session has no module running behind it at all until it is
                  first looked at — it is a name on the strip and nothing else. So the module's own
                  mark stands in, the one the [+] menu opens it from, dimmer than a badge that was
                  actually asked for. */}
              {tab.badges.length === 0 && (
                <span className="tab-badge tab-module" title={t(def.labelKey)}>
                  <def.Icon size={14} />
                  <span className="visually-hidden">{t(def.labelKey)}</span>
                </span>
              )}
              {/* Ahead of the name, where the eye lands first: a mark is there to be seen before a
                  statement is typed, not after the connection has been identified. What each one
                  means is the module's business — the shell only puts it where it goes. The tab is
                  not a control with a name of its own, so the word travels with the mark for anyone
                  who can't see it. */}
              {tab.badges.map((badge) => (
                <span
                  key={badge.id}
                  className={badge.className ? `tab-badge ${badge.className}` : "tab-badge"}
                  title={badge.title}
                >
                  {badge.icon}
                  <span className="visually-hidden">{badge.label}</span>
                </span>
              ))}
              <TabTitle>{tab.title}</TabTitle>
            </Tab>
          );
        })}
      </TabStrip>

      {/* Unreachable while `MODULES` holds one entry, and here so that adding the second is a line
          in `registry.ts` rather than a tab bar to rewrite. Which also means it has never run: the
          module that lands beside `db` is the first thing that will exercise it. */}
      {moduleMenu && (
        <ContextMenu x={moduleMenu.x} y={moduleMenu.y} onClose={() => setModuleMenu(null)}>
          {MODULES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setModuleMenu(null);
                openTab(m.id);
              }}
            >
              <m.Icon size={14} />
              {t(m.labelKey)}
            </button>
          ))}
        </ContextMenu>
      )}

      <div className="tab-content">
        {/* Only the tabs that have been looked at. One restored from the last session is drawn on
            the strip above and has no pane down here until it is picked. */}
        {tabs.filter((tab) => mounted.includes(tab.id)).map((tab) => {
          const { Tab } = moduleById(tab.moduleId);
          return (
            <div
              key={tab.id}
              className="tab-panel"
              style={{ display: tab.id === activeId ? "flex" : "none" }}
            >
              {/* Each module's workspace arrives on first use — see the note beside its `Tab`.
                  One boundary per tab and not one around the list: a tab still loading must not
                  take the panes beside it off screen while it does. The Error Boundary follows
                  the same rule, and for the same reason: a tab that crashes must not take the
                  panes beside it, the tab strip, or useUpdateCheck (living in App, outside every
                  boundary) down with it. Keyed on tab.id so closing a crashed tab and opening a
                  new one is a fresh boundary, not the old one still remembering the error. */}
              <ErrorBoundary key={tab.id}>
                <Suspense fallback={<LoadingOverlay />}>
                  <Tab
                    active={tab.id === activeId}
                    onTitleChange={(title) => renameTab(tab.id, title)}
                    onBadgesChange={(badges) => setTabBadges(tab.id, badges)}
                    restored={tab.state}
                    onStateChange={(state) => setTabState(tab.id, state)}
                  />
                </Suspense>
              </ErrorBoundary>
            </div>
          );
        })}
      </div>

      {settingsOpen && (
        <SettingsModal
          theme={theme}
          onThemeChange={setTheme}
          accent={accent}
          onAccentChange={setAccent}
          glass={glass}
          onGlassChange={setGlass}
          update={update}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Settings says the same thing in more detail, so the corner steps out of the way of it. */}
      {update.announcing && !settingsOpen && <UpdateToast update={update} />}
    </main>
  );
}

export default App;
