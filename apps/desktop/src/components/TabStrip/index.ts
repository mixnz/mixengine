export { TabStrip, Tab, TabTitle, TabAction } from "./TabStrip";
/* The scrolling half of a strip, without the strip. A row of choices that outgrows its width has
   the same three problems a row of tabs does — no scrollbar to show, a wheel with only the wrong
   axis, and a selected item that may be off-screen — and solving them a second time somewhere else
   is how the three strips this folder was made to unify drifted apart in the first place. The
   connection form's database-kind row uses these two and draws itself. */
export { useStripScroll, useActiveTabInView } from "./useStripScroll";
export { tabKeyDown } from "./keyboard";
export { moveId, moveTab, type DropSide } from "./reorder";
export { useTabReorder } from "./useTabReorder";
