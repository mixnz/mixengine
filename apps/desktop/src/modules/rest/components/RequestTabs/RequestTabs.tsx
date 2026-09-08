import {
  Tab,
  TabAction,
  TabStrip,
  TabTitle,
  tabKeyDown,
  useTabReorder,
  type DropSide,
} from "../../../../components/TabStrip";
import { PlusIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import type { RestRequest } from "../../types";

interface Props {
  tabs: RestRequest[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** A tab was dragged and let go against one edge of another. The order lives in the workspace,
   *  not here, so the move goes back to whoever keeps it. */
  onReorder: (fromId: string, toId: string, side: DropSide) => void;
  onNew: () => void;
  /** What a request with neither name nor URL is called. */
  label: (request: RestRequest) => string;
  /** Handed to the strip. The workspace puts the environment dropdown beside it and moves the
   *  background and the bottom edge onto the row that holds both. */
  className?: string;
}

/**
 * The open requests, across the top of the main area.
 *
 * Drawn by the shared `TabStrip`, which is also what the app's own tab bar is drawn by — a tab is
 * a tab, and a second strip two rows below the first one that answered to different rules read as
 * a different app.
 *
 * Closing asks nothing: there is no unsaved state to lose, because every edit is written through
 * to the request as it is made. Middle-click closes too, and the tabs drag into any order — both
 * come from the shared strip, so this one and the shell's cannot drift apart on either.
 */
function RequestTabs({ tabs, activeId, onSelect, onClose, onReorder, onNew, label, className }: Props) {
  const { t } = useTranslation();
  const reorder = useTabReorder(onReorder);
  return (
    <TabStrip
      role="tablist"
      className={className}
      {...reorder.strip}
      /* Held against the right edge rather than trailing the last tab, as the shell's is: a row of
         requests that has run past the edge is exactly the row on which a new one is hardest to
         reach, and that is the row it matters on. */
      trailing={
        <TabAction aria-label={t("rest.newRequest")} title={t("rest.newRequest")} onClick={onNew}>
          <PlusIcon size="1em" />
        </TabAction>
      }
    >
      {tabs.map((request) => (
        <Tab
          key={request.id}
          active={request.id === activeId}
          role="tab"
          aria-selected={request.id === activeId}
          tabIndex={0}
          onClose={() => onClose(request.id)}
          closeLabel={t("rest.shortcutCloseRequest")}
          onClick={() => onSelect(request.id)}
          onKeyDown={tabKeyDown(() => onSelect(request.id))}
          {...reorder.tab(request.id)}
        >
          <span className={`rest-method rest-method-${request.method}`}>{request.method}</span>
          <TabTitle>{label(request)}</TabTitle>
        </Tab>
      ))}
    </TabStrip>
  );
}

export default RequestTabs;
