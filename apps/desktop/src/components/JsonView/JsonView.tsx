import { useMemo } from "react";
import { tokenize } from "./tokens";
import styles from "./JsonView.module.css";

interface Props {
  /** Anything `JSON.stringify` can render — in practice the result of parsing a stored value. */
  value: unknown;
  className?: string;
}

/**
 * A JSON document, indented and coloured, as read-only text.
 *
 * Deliberately not an editor and not a collapsible tree: this shows what a Redis value holds,
 * and the value is one opaque string as far as the server is concerned — there is nothing to
 * edit a branch of. The Mongo side has a tree editor because a document there really is made of
 * addressable fields; here it would be a picture of one.
 */
function JsonView({ value, className }: Props) {
  const tokens = useMemo(() => tokenize(JSON.stringify(value, null, 2) ?? ""), [value]);

  return (
    <pre className={`${styles.json}${className ? ` ${className}` : ""}`}>
      {tokens.map((token, i) =>
        token.kind === "punctuation" ? (
          token.text
        ) : (
          <span key={i} className={styles[token.kind]}>
            {token.text}
          </span>
        ),
      )}
    </pre>
  );
}

export default JsonView;
