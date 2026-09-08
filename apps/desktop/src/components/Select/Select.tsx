import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "../../icons";
import { useTranslation } from "../../i18n";
import { centeredScrollTop } from "./scroll";
import styles from "./Select.module.css";

export interface SelectOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  /** Overrides what's shown for this option inside the open dropdown; defaults to `label`. */
  optionLabel?: React.ReactNode;
  /** What the search box matches against, for an option whose label isn't plain text. Without it
   * a node label falls back to the value, which is all the option really has to go on. */
  searchText?: string;
  disabled?: boolean;
  /** Leaves the menu open after this option is chosen. For an option that acts on the list itself
   * — reloading it — rather than picking something out of it: closing would hide the very result
   * the user asked for. */
  keepOpen?: boolean;
}

export type SelectSize = "small" | "normal" | "large";

interface SelectProps<T extends string | number> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: SelectSize;
  className?: string;
  triggerClassName?: string;
  ariaLabel?: string;
  /** Hover text for the control. Worth it where the trigger is too narrow to say what it picks —
   * the menu spells its options out, but only once it is open. */
  title?: string;
  optionAlign?: "left" | "right" | "center";
  /** Cuts the trigger's value with an ellipsis when it is wider than the room it has. On by
   * default. Turn it off where the whole value matters more than a settled width: the trigger then
   * shrinks to a short value and grows for a long one, which is wrong for anything sitting in a
   * fixed slot beside other controls. The open menu is not affected either way — it is always as
   * wide as its longest option, up to the edge of the window. */
  truncate?: boolean;
  /** Puts a search box at the head of the open dropdown and narrows the list to what it matches.
   * Worth it for lists long enough to scroll — databases, columns, operators. */
  searchable?: boolean;
  searchPlaceholder?: string;
}

const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;
/** Rough height of one row, used only to guess whether the menu fits below the trigger. */
const ROW_HEIGHT = 34;

/** Where the menu sits for the one render before it has been measured. It has to be taken out of
 * the flow from the very first frame: laid out at the end of `<body>` instead, it stretches the
 * page, and the scrollbar that appears is itself a resize — which closed the menu on its first
 * open, before it had a position to remember. */
const UNMEASURED: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  visibility: "hidden",
};

/** The text an option is searched by: what was given for it, else its label when that is plain
 * text, else the value — never a rendered node, which has nothing readable to match on. */
function optionText<T extends string | number>(opt: SelectOption<T>): string {
  if (opt.searchText !== undefined) return opt.searchText;
  if (typeof opt.label === "string" || typeof opt.label === "number") return String(opt.label);
  return String(opt.value);
}

function Select<T extends string | number>({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  size = "normal",
  className,
  triggerClassName,
  ariaLabel,
  title,
  optionAlign = "left",
  truncate = true,
  searchable = false,
  searchPlaceholder,
}: SelectProps<T>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>(UNMEASURED);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const skipScrollRef = useRef(false);
  const centredRef = useRef(false);

  const selected = options.find((o) => o.value === value);

  // Everything below indexes into the visible list, not the full one: with a query typed, the
  // keyboard and the mouse have to agree on what "the third option" means.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!searchable || needle === "") return options;
    return options.filter((o) => optionText(o).toLowerCase().includes(needle));
  }, [options, query, searchable]);
  const selectedIndex = visible.findIndex((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function close(e?: Event) {
      const target = e?.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    // Listening only from the next frame on. Opening the menu can scroll the page by itself —
    // measuring it, focusing the search box — and closing over the movement it just made would
    // shut the menu the moment it appeared.
    const frame = requestAnimationFrame(() => {
      window.addEventListener("resize", close);
      window.addEventListener("scroll", close, true);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  /** Measures the trigger and works out where the menu goes. Positioned off the full list, not
   * the filtered one, so the menu doesn't hop around the trigger as the query narrows it. */
  function measureMenu(): React.CSSProperties {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return UNMEASURED;
    const rows = options.length + (searchable ? 1 : 0);
    const estimatedHeight = Math.min(rows * ROW_HEIGHT + 8, 256);
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - VIEWPORT_MARGIN;
    const openUp = estimatedHeight > spaceBelow && spaceAbove > spaceBelow;
    // Pinned to whichever edge of the trigger has more room beside it, and given all of it. Always
    // grown rightwards, a menu under a control near the right of the window — the environment
    // picker at the end of the tab strip is one — has barely the trigger's own width to live in,
    // and every option longer than the trigger comes out as an ellipsis.
    const spaceRight = window.innerWidth - rect.left - VIEWPORT_MARGIN;
    const spaceLeft = rect.right - VIEWPORT_MARGIN;
    const openLeft = spaceLeft > spaceRight;
    return {
      position: "fixed",
      minWidth: rect.width,
      ...(openLeft
        ? { right: window.innerWidth - rect.right, maxWidth: spaceLeft }
        : { left: rect.left, maxWidth: spaceRight }),
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + MENU_GAP, maxHeight: spaceAbove }
        : { top: rect.bottom + MENU_GAP, maxHeight: spaceBelow }),
    };
  }

  /** Measures before opening rather than after, so the menu is in place on the very first render.
   * A menu that spends a frame at `UNMEASURED` is hidden, and a hidden search box cannot take
   * focus — which is why the first open used to leave the keyboard on the trigger. */
  function openMenu() {
    setMenuStyle(measureMenu());
    setOpen(true);
  }

  // Still measured on open as well: the list can grow while the menu is up, and the estimate the
  // trigger was measured against goes with it.
  useLayoutEffect(() => {
    if (!open) return;
    setMenuStyle(measureMenu());
  }, [open, options.length, searchable]);

  // `width: max-content` is the widest option — until something takes a few pixels back out of it
  // again: the frame drawn around the list, the scrollbar that appears once the list is long
  // enough to want one. Whatever it is, the shortfall lands on the longest option and only that
  // one, which then ends in an ellipsis inside a menu with room to spare. So it is measured
  // instead of trusted: every row says what it would need, and the menu is widened to the widest
  // of them. `maxWidth` still has the last word, which is what keeps it on the screen.
  useLayoutEffect(() => {
    const list = listRef.current;
    const menu = menuRef.current;
    if (!open || !list || !menu) return;
    let needed = 0;
    for (let i = 0; i < list.children.length; i++) {
      needed = Math.max(needed, list.children[i].scrollWidth);
    }
    // `scrollWidth` is a whole number and the text under it is not, so the last pixel is bought.
    const grow = needed + 1 - list.clientWidth;
    if (grow <= 0) return;
    const width = menu.offsetWidth + grow;
    setMenuStyle((prev) => ({ ...prev, width }));
  }, [open, visible]);

  // A query is a fresh start each time the menu opens — reopening on last time's filtered list
  // would hide options the trigger says nothing about.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Before the paint, so the box is focused by the time the menu is first seen.
  useLayoutEffect(() => {
    if (!open || !searchable) return;
    // `preventScroll` because the menu is already where it should be — letting the browser
    // scroll to reveal the box it just focused would only move the page under the trigger.
    searchRef.current?.focus({ preventScroll: true });
  }, [open, searchable]);

  useEffect(() => {
    if (open) {
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
  }, [open, query, selectedIndex]);

  /* Opens the list on the option it is showing, in the middle of the menu rather than wherever
   * the top of the list happens to leave it. A select down its own list — a column, a database,
   * one of forty operators — otherwise opens on options that have nothing to do with the value in
   * the trigger, and the first thing the user has to do is find out where they are.
   *
   * A layout effect, so the list has never been painted at the top: as a passive one the menu
   * appears at the top of its list and jumps a frame later, which reads as the menu correcting a
   * mistake it made in front of you.
   *
   * Once per opening, held by the ref rather than by the dependency list. `selectedIndex` has to
   * be a dependency — it is what is being scrolled to, and options that arrive after the menu is
   * already up would otherwise never be centred at all — but re-running on every change of it
   * would also re-centre on each keystroke in the search box, dragging the list out from under a
   * pointer that has not moved. The ref is only set once an option was actually found, so a menu
   * opened over an empty list is still centred by the render that fills it.
   *
   * The minimal scroll below is left to it after that: with the option centred it has nothing to
   * do until an arrow key moves off it, which is exactly when it should take over. */
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!open) {
      centredRef.current = false;
      return;
    }
    if (centredRef.current || !list || selectedIndex < 0) return;
    const el = list.children[selectedIndex] as HTMLElement | undefined;
    if (!el) return;
    /* Measured against the list's own box rather than read off `offsetTop`, which is relative to
       whichever ancestor is positioned — here the menu, so a select with a search box above its
       list would centre on a number that had the box's height built into it. Adding back what the
       list is already scrolled by is what turns the two rects into a content offset. */
    const listRect = list.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    list.scrollTop = centeredScrollTop({
      itemTop: rect.top - listRect.top + list.scrollTop,
      itemHeight: rect.height,
      viewportHeight: list.clientHeight,
      scrollHeight: list.scrollHeight,
    });
    centredRef.current = true;
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    if (skipScrollRef.current) {
      skipScrollRef.current = false;
      return;
    }
    const list = listRef.current;
    const el = list?.children[activeIndex] as HTMLElement | undefined;
    if (!list || !el) return;
    // Scrolling the list by hand rather than with `scrollIntoView`, which walks up to the page
    // whenever the list itself has no room to give — and a page scroll closes the menu.
    const listRect = list.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (rect.top < listRect.top) list.scrollTop -= listRect.top - rect.top;
    else if (rect.bottom > listRect.bottom) list.scrollTop += rect.bottom - listRect.bottom;
  }, [open, activeIndex]);

  /** Closes and hands focus back to the trigger — with a search box the focus is inside the
   * portal, and leaving it on a menu that is gone would strand the keyboard on the body. */
  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function commit(index: number) {
    const opt = visible[index];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    if (!opt.keepOpen) close();
  }

  function moveActive(delta: number) {
    setActiveIndex((prev) => {
      let next = prev;
      for (let i = 0; i < visible.length; i++) {
        next = (next + delta + visible.length) % visible.length;
        if (!visible[next].disabled) break;
      }
      return next;
    });
  }

  /** `fromSearch` marks the keys pressed in the search box, where a space is text being typed
   * rather than the shortcut it is on the trigger. */
  function onKeyDown(e: React.KeyboardEvent, fromSearch = false) {
    if (disabled) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) openMenu();
        else moveActive(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) openMenu();
        else moveActive(-1);
        break;
      case " ":
      case "Enter":
        // A space typed into the search box is part of what is being searched for, not the
        // trigger's shortcut for opening and choosing.
        if (e.key === " " && fromSearch && open) break;
        e.preventDefault();
        if (!open) openMenu();
        else commit(activeIndex);
        break;
      case "Escape":
        if (open) {
          /* Both halves matter. `preventDefault` marks the press spent for anyone who asks —
             `isUnhandledEscape` does — and `stopPropagation` keeps it from reaching the `window`
             listeners that do not: React's own listener sits on the root container, so stopping
             there is stopping before `window` ever hears it. A dialog around this select would
             otherwise close on the press that only meant to close this menu. */
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div
      ref={rootRef}
      className={`${styles.select}${disabled ? ` ${styles.disabled}` : ""}${truncate ? "" : ` ${styles.fit}`}${className ? ` ${className}` : ""}`}
      title={title}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${styles[size]}${triggerClassName ? ` ${triggerClassName}` : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        {/* Chưa chọn gì thì chữ trên trigger phải đọc ra là một lời mời, không phải một giá trị:
            cùng một chỗ, cùng một cỡ chữ, nên độ đậm là thứ duy nhất phân biệt được hai nghĩa. */}
        <span
          className={selected ? styles.value : `${styles.value} ${styles.placeholder}`}
          style={{ textAlign: optionAlign }}
        >
          {selected ? selected.label : placeholder ?? t("select.placeholder")}
        </span>
        {/* Sized above 1em because the shared icon grid leaves margin around the glyph it
            draws, and below the trigger's line box so the icon never sets its height. */}
        <ChevronDownIcon size="1.2em" className={styles.chevron} />
      </button>
      {open &&
        createPortal(
          <div
            className={`${styles.menu} glass`}
            ref={menuRef}
            style={menuStyle}
          >
            {searchable && (
              <input
                ref={searchRef}
                type="text"
                className={styles.search}
                value={query}
                placeholder={searchPlaceholder ?? t("select.searchPlaceholder")}
                aria-label={searchPlaceholder ?? t("select.searchPlaceholder")}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => onKeyDown(e, true)}
              />
            )}
            <ul className={styles.listbox} role="listbox" ref={listRef} tabIndex={-1}>
              {visible.map((opt, i) => (
                <li
                  key={String(opt.value)}
                  role="option"
                  aria-selected={opt.value === value}
                  className={`${styles.option}${opt.value === value ? ` ${styles.optionSelected}` : ""}${
                    i === activeIndex ? ` ${styles.optionActive}` : ""
                  }${opt.disabled ? ` ${styles.optionDisabled}` : ""}`}
                  style={{ textAlign: optionAlign }}
                  onMouseEnter={() => {
                    skipScrollRef.current = true;
                    setActiveIndex(i);
                  }}
                  onClick={() => commit(i)}
                >
                  {opt.optionLabel ?? opt.label}
                </li>
              ))}
              {visible.length === 0 && (
                <li className={styles.empty}>
                  {query.trim() === "" ? t("select.noOptions") : t("select.noMatches")}
                </li>
              )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default Select;
