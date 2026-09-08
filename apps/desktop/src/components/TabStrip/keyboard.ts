/** The event a tab's key handler reads, and nothing more — so this file can be tested without a
 *  DOM. React's `KeyboardEvent` is assignable to it, which is all the call sites need. */
interface KeyPress {
  key: string;
  preventDefault: () => void;
}

/**
 * Enter and Space select a tab, as they would if the tab were a button.
 *
 * It cannot be one: a tab that closes carries a close button inside it, and a button inside a
 * button is not markup a browser keeps. So the keys a button would have handled are handled here,
 * `preventDefault` included — without it Space scrolls the page, which is what Space does to every
 * focusable element that is not a button.
 */
export function tabKeyDown(select: () => void) {
  return (e: KeyPress) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    select();
  };
}
