import Button from "../../../../components/Button";
import Select from "../../../../components/Select";
import { CloseIcon, FormatIcon } from "../../../../icons";
import { useTranslation, type TranslationKey } from "../../../../i18n";
import { pickFile } from "../../api";
import { BODY_CHOICES, bodyChoice, convertBody, type BodyChoice } from "../../bodyKind";
import { fileName, prettyJson } from "../../format";
import type { Body } from "../../types";
import KeyValueTable from "../KeyValueTable";
import MultipartTable from "../MultipartTable";
import styles from "./BodyEditor.module.css";

interface Props {
  body: Body;
  onChange: (body: Body) => void;
}

const LABELS: Record<BodyChoice, TranslationKey> = {
  none: "rest.bodyNone",
  json: "rest.langJson",
  xml: "rest.langXml",
  yaml: "rest.langYaml",
  text: "rest.langText",
  form: "rest.bodyForm",
  multipart: "rest.bodyMultipart",
  binary: "rest.bodyBinary",
};

/**
 * The Body tab.
 *
 * One picker, not two. A body is either absent or a string in some notation, and asking "which
 * kind?" and then "which language?" made the user answer a question whose only real answer was
 * the second one. Form, multipart and binary are the same picker's other settings, each with the
 * editor its shape asks for: a table, a table with a file column, and one chosen file.
 *
 * A plain `<textarea>` rather than the shared one, which grows to fit its text: this pane has a
 * height of its own and the box should fill it, not push the layout about as a body is pasted in.
 */
function BodyEditor({ body, onChange }: Props) {
  const { t } = useTranslation();

  const choice = bodyChoice(body);
  const options = BODY_CHOICES.map((value) => ({ value, label: t(LABELS[value]) }));

  /** Changing the picker is a change of body, and `convertBody` says what survives it: text keeps
   *  its text, a form and a multipart body keep each other's rows, and nothing else carries. */
  function pick(next: BodyChoice) {
    onChange(convertBody(body, next));
  }

  /** Dismissing the dialog keeps the file that was already chosen. */
  async function chooseFile() {
    const path = await pickFile();
    if (path !== null) onChange({ kind: "binary", filePath: path });
  }

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <Select<BodyChoice>
          className={styles.kind}
          size="small"
          value={choice}
          ariaLabel={t("rest.bodyKind")}
          options={options}
          onChange={pick}
        />
        {choice === "json" && body.kind === "raw" && (
          <Button size="small" onClick={() => onChange({ ...body, text: prettyJson(body.text) })}>
            <FormatIcon size="1em" />
          </Button>
        )}
      </div>
      {body.kind === "raw" ? (
        <textarea
          className={styles.text}
          value={body.text}
          placeholder={t("rest.bodyPlaceholder")}
          aria-label={t("rest.bodyTab")}
          spellCheck={false}
          onChange={(e) => onChange({ ...body, text: e.target.value })}
        />
      ) : body.kind === "form" ? (
        <KeyValueTable
          rows={body.fields}
          onChange={(fields) => onChange({ kind: "form", fields })}
        />
      ) : body.kind === "multipart" ? (
        <MultipartTable
          rows={body.fields}
          onChange={(fields) => onChange({ kind: "multipart", fields })}
        />
      ) : body.kind === "binary" ? (
        <div className={styles.file}>
          <div className={styles.fileRow}>
            <Button size="small" onClick={() => void chooseFile()}>
              {t("rest.chooseFile")}
            </Button>
            {body.filePath === "" ? (
              <span className="muted">{t("rest.noFile")}</span>
            ) : (
              <>
                <span className={styles.fileName} title={body.filePath}>
                  {fileName(body.filePath)}
                </span>
                <button
                  type="button"
                  className={styles.clear}
                  aria-label={t("rest.clearFile")}
                  title={t("rest.clearFile")}
                  onClick={() => onChange({ kind: "binary", filePath: "" })}
                >
                  <CloseIcon size="0.9em" />
                </button>
              </>
            )}
          </div>
          <p className="muted">{t("rest.binaryBodyHint")}</p>
        </div>
      ) : (
        <p className={`${styles.empty} muted`}>{t("rest.bodyNone")}</p>
      )}
    </div>
  );
}

export default BodyEditor;
