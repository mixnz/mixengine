import { StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  hoverTooltip,
  type DecorationSet,
} from "@codemirror/view";
import { hasPrimaryModifier } from "../../../../core/platform";
import { docText } from "./extensions";
import styles from "./SqlEditor.module.css";

/**
 * Looking things up in the script: what a name means, and where it leads.
 *
 * Like the error checking beside it, this component holds none of the answers. It knows how to ask
 * about a position and how to draw what comes back — the caller knows what a table is, which
 * database is connected, and which language the app is set to. Everything in {@link EditorHover} is
 * already translated by the time it arrives here.
 */

/** What to say about the name the pointer is resting on. */
export interface EditorHover {
  /** The range the tooltip belongs to — the word itself, so it stays put while the pointer moves
   *  within it. */
  from: number;
  to: number;
  /** The headline, drawn in the editor's own monospace: a table's name, a column's, a signature. */
  title: string;
  /** One line under it, in words rather than in code. */
  subtitle?: string;
  /** A list under that — a table's columns, each with its type beside it. */
  items?: readonly { name: string; detail: string }[];
  /** The last line, smaller and quieter: what was left out, and what a click would do. */
  footer?: string;
}

/** Somewhere the script points at, and how to follow it. */
export interface EditorTarget {
  /** The range to underline while the modifier is held. */
  from: number;
  to: number;
  open: () => void;
}

/**
 * The two questions the editor asks about a position, both answerable with nothing.
 *
 * They are separate because they are asked at different moments and about different things: the
 * pointer resting anywhere at all asks the first, while the second is asked on every pointer move
 * with `Ctrl` held and must therefore stay cheap.
 */
export interface EditorLookup {
  hover: (doc: string, pos: number) => EditorHover | null;
  target: (doc: string, pos: number) => EditorTarget | null;
}

/** How long the pointer has to rest before the tooltip appears. Long enough that reading across a
 *  line does not leave a trail of them behind. */
const HOVER_MS = 350;

function line(parent: HTMLElement, className: string, text: string): HTMLElement {
  const element = parent.appendChild(document.createElement("div"));
  element.className = className;
  element.textContent = text;
  return element;
}

function renderHover(info: EditorHover): HTMLElement {
  const dom = document.createElement("div");
  dom.className = styles.hover;
  line(dom, styles.hoverTitle, info.title);
  if (info.subtitle) line(dom, styles.hoverSubtitle, info.subtitle);
  if (info.items && info.items.length > 0) {
    const list = dom.appendChild(document.createElement("ul"));
    list.className = styles.hoverList;
    for (const item of info.items) {
      const row = list.appendChild(document.createElement("li"));
      row.className = styles.hoverRow;
      line(row, styles.hoverName, item.name);
      line(row, styles.hoverDetail, item.detail);
    }
  }
  if (info.footer) line(dom, styles.hoverFooter, info.footer);
  return dom;
}

/** The tooltip that appears when the pointer rests on a name. */
export function sqlHover(lookup: () => EditorLookup | null): Extension {
  return hoverTooltip(
    (view, pos) => {
      const active = lookup();
      if (!active) return null;
      const info = active.hover(docText(view.state.doc), pos);
      if (!info) return null;
      return {
        pos: info.from,
        end: info.to,
        // Above the word, so the tooltip does not cover the line being read next.
        above: true,
        create: () => ({ dom: renderHover(info) }),
      };
    },
    { hoverTime: HOVER_MS }
  );
}

/** Underline this range, or clear the underline when null. */
const markTarget = StateEffect.define<{ from: number; to: number } | null>();

const targetMark = Decoration.mark({ class: styles.jumpTarget });

/**
 * The underline under whatever a click would follow.
 *
 * A state field rather than a plugin's own decorations: what is underlined changes on a mouse move
 * and on a modifier being pressed, neither of which is a document change, and a plugin cannot
 * redraw itself outside an update. An effect can — so the handlers below dispatch one.
 */
const targetField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    // Mapped through the changes rather than dropped: the pointer may be over a word while the
    // text above it is edited from the keyboard.
    marks = marks.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(markTarget)) continue;
      marks = effect.value
        ? Decoration.set([targetMark.range(effect.value.from, effect.value.to)])
        : Decoration.none;
    }
    return marks;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Whether the event is holding the key that turns a click into a jump — the same modifier every
 *  other shortcut in the app is under, which on a Mac is `Cmd` and not `Ctrl`. */
function held(event: MouseEvent | KeyboardEvent): boolean {
  return hasPrimaryModifier(event);
}

/**
 * `Ctrl+Click` on a name that leads somewhere.
 *
 * The underline is what makes it discoverable: nobody tries a modifier click on the off-chance, but
 * a word that underlines itself under the pointer is asking to be clicked. So the target is
 * resolved on every pointer move with the modifier down — which is why {@link EditorLookup.target}
 * has to be cheap — and on the modifier itself going down or up without the pointer having moved.
 *
 * The modifier is watched on the window rather than on the editor, because the editor is not
 * necessarily the thing with focus: the pointer can rest on a name in a script nobody has clicked
 * into yet, and a key pressed then would never reach it. The same goes for letting go — a window
 * left with the key held would otherwise come back to a word still underlined and nothing to click.
 */
function jumpTargets(lookup: () => EditorLookup | null): Extension {
  return ViewPlugin.fromClass(
    class {
      /** Where the pointer was last seen, so pressing the modifier can answer without it moving. */
      at: { x: number; y: number } | null = null;
      /** What is underlined now, so an unchanged answer costs no transaction. */
      marked: EditorTarget | null = null;

      /** Bound once, so the same references come off the window again in `destroy`. */
      readonly onKey = (event: KeyboardEvent) => {
        if (event.key !== "Control" && event.key !== "Meta") return;
        // Read from the event rather than assumed from its type: `keyup` on `Control` with `Cmd`
        // still down has let go of neither.
        this.show(held(event) ? this.find() : null);
      };
      readonly onLeave = () => this.show(null);

      constructor(readonly view: EditorView) {
        window.addEventListener("keydown", this.onKey);
        window.addEventListener("keyup", this.onKey);
        // The window itself losing focus — Alt+Tab with the key held, which sends no `keyup` here.
        window.addEventListener("blur", this.onLeave);
      }

      destroy() {
        window.removeEventListener("keydown", this.onKey);
        window.removeEventListener("keyup", this.onKey);
        window.removeEventListener("blur", this.onLeave);
      }

      /**
       * What a click at the last known pointer position would follow.
       *
       * The second half of this is what keeps it honest. `posAtCoords` answers for the whole width
       * of a line, so a pointer resting in the empty space to the right of `FROM users` comes back
       * as the end of `users` — and a word would underline itself for a pointer that is nowhere
       * near it. So where the word is drawn is measured against where the pointer actually is.
       */
      find(): EditorTarget | null {
        const active = lookup();
        if (!active || !this.at) return null;
        const pos = this.view.posAtCoords(this.at);
        if (pos === null) return null;
        const target = active.target(docText(this.view.state.doc), pos);
        if (!target) return null;
        const start = this.view.coordsAtPos(target.from);
        const end = this.view.coordsAtPos(target.to);
        if (!start || !end) return null;
        return this.at.x >= start.left && this.at.x <= end.right ? target : null;
      }

      show(target: EditorTarget | null) {
        if (target?.from === this.marked?.from && target?.to === this.marked?.to) {
          // Same word — but a fresh `open`, since the document it closed over may have moved on.
          this.marked = target;
          return;
        }
        this.marked = target;
        this.view.dispatch({
          effects: markTarget.of(target ? { from: target.from, to: target.to } : null),
        });
      }
    },
    {
      eventHandlers: {
        mousemove(event: MouseEvent) {
          this.at = { x: event.clientX, y: event.clientY };
          this.show(held(event) ? this.find() : null);
        },
        mouseleave() {
          this.at = null;
          this.show(null);
        },
        mousedown(event: MouseEvent) {
          // The left button only: a `Ctrl`-right-click is how a Mac opens a context menu.
          if (event.button !== 0 || !held(event)) return false;
          this.at = { x: event.clientX, y: event.clientY };
          const target = this.find();
          if (!target) return false;
          // Taken before CodeMirror sees it: the same click would otherwise drop a second cursor
          // into the script on its way out of the editor.
          event.preventDefault();
          this.show(null);
          target.open();
          return true;
        },
      },
    }
  );
}

/** The tooltip and the jump, which are one feature from where the user sits. */
export function sqlLookup(lookup: () => EditorLookup | null): Extension {
  return [targetField, sqlHover(lookup), jumpTargets(lookup)];
}
