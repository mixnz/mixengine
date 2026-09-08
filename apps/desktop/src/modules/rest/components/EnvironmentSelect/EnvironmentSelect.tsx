import Select from "../../../../components/Select";
import { SettingsIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import type { Environment } from "../../environments";
import styles from "./EnvironmentSelect.module.css";

/** Two values that are not an environment id. Ids are `crypto.randomUUID()`, so neither can ever
 *  be one. */
const NONE = "none";
const MANAGE = "manage";

interface Props {
  environments: Environment[];
  /** Null is None, which is also what a chosen environment since deleted resolves to. */
  value: string | null;
  onChange: (id: string | null) => void;
  onManage: () => void;
}

/**
 * Which environment this REST tab resolves against, pinned at the end of the tab strip.
 *
 * It sits with the tabs rather than in the request pane because an environment is a property of
 * the workspace, not of a request: the same request is sent against dev and against prod, and the
 * list of requests does not change when the environment does.
 *
 * *Manage environments* is the last entry rather than a button of its own — it is reached rarely,
 * and it is reached from here, which is the only place the environments are named. It is the one
 * entry that does not pick anything, so it is the one entry that carries a mark: the gear says it
 * opens something, which is the job the trailing ellipsis used to do in a word.
 */
function EnvironmentSelect({ environments, value, onChange, onManage }: Props) {
  const { t } = useTranslation();
  return (
    <Select<string>
      className={styles.select}
      size="small"
      value={value ?? NONE}
      ariaLabel={t("rest.envLabel")}
      title={t("rest.envLabel")}
      optionAlign="right"
      /* An environment is named by whoever made it, and the name is the only thing that says which
         one a request is about to be sent against. Cut short it stops answering that — `staging`
         and `staging-eu` end the same — so the control takes the width the name needs and gives
         back what a short one does not. */
      truncate={false}
      options={[
        { value: NONE, label: t("rest.envNone") },
        ...environments.map((env) => ({ value: env.id, label: env.name })),
        {
          value: MANAGE,
          /* `inline-flex`, not `flex`, and that is what `optionAlign="right"` above is asking
             for: a block would fill the row and take the mark with it to the left edge, away
             from the names it is listed under. */
          label: (
            <span className={styles.manage}>
              <SettingsIcon size="1em" />
              {t("rest.envManage")}
            </span>
          ),
        },
      ]}
      onChange={(picked) => {
        if (picked === MANAGE) {
          onManage();
          return;
        }
        onChange(picked === NONE ? null : picked);
      }}
    />
  );
}

export default EnvironmentSelect;
