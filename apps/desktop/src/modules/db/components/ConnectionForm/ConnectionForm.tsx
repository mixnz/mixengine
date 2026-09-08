import { useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import Select from "../../../../components/Select";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import { EyeIcon, EyeOffIcon } from "../../../../icons";
import { DatabaseIcon } from "../../icons";
import { useActiveTabInView, useStripScroll } from "../../../../components/TabStrip";
import { PRIVATE_KEY_PLACEHOLDER } from "../../../../core/ssh";
import { useTranslation } from "../../../../i18n";
import { errorMessage } from "../../../../core/errors";
import { createSqliteFile } from "../../sqlite/api";
import { kindLabel, type ConnectionForm as FormState } from "../../connectionForm";
import type { DbKind } from "../../types";

/**
 * The connection form: what is filled in before Connect, and what a saved connection is edited in.
 *
 * Out of `DbTab` because it was 250 lines of the tab's 1100, and because none of it is about being
 * a tab: it reads one value and reports one field at a time changed. Everything that is only about
 * how the form looks — the mask over a connection string, the example key path, the warning about
 * Redis's protected mode — came out with it, since nothing else was ever asking.
 */

/**
 * Whether dialling `host` means talking to this machine — the one case a server refusing everything
 * but loopback is happy with. The whole `127.0.0.0/8` block counts, not just `127.0.0.1`, and IPv6
 * writes its loopback either bare or in the brackets a host field may still carry.
 */
function isLoopback(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (
    name === "localhost" ||
    name === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(name)
  );
}

/** Fixed width, not the value's own: the length of a password is itself worth not showing. */
const MASK = "****";

/** The `user:password@` prefix, i.e. everything the string reveals about credentials. */
const MONGO_URI_CREDENTIALS_RE = /^(mongodb(?:\+srv)?:\/\/)([^@/?]+)@/i;

/**
 * What the field shows while hidden. Only the credentials are covered, so the host and options
 * stay readable — those are what you check a connection against at a glance. A string with no
 * credentials in it isn't therefore safe to show: it may be one this app never parsed as Mongo at
 * all, so nothing in it is known to be harmless and the whole value is covered instead.
 */
function maskMongoUri(uri: string): string {
  if (!uri) return "";
  const credentials = MONGO_URI_CREDENTIALS_RE.exec(uri);
  if (!credentials) return MASK;
  const [full, scheme, userinfo] = credentials;
  // `user:password`, `user` alone, and the empty-password `user:` all mask one part per segment.
  const masked = userinfo
    .split(":")
    .map(() => MASK)
    .join(":");
  return `${scheme}${masked}@${uri.slice(full.length)}`;
}


interface Props {
  form: FormState;
  /** One field changed. The only way the inputs below write anything. */
  onChange: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
  /** The kind picked. Apart from `onChange` because it moves the port with it. */
  onKindChange: (kind: DbKind) => void;
  /** The id of the saved connection being edited, or null for one that is not saved yet. What
   *  decides whether the button says Save or Update, and whether Save as new is offered. */
  editingId: string | null;
  name: string;
  onNameChange: (name: string) => void;
  /** Whether Save would do anything: a name is needed, and an edit that changes nothing is not a
   *  save. Worked out by the tab, which is what holds the saved list. */
  saveDisabled: boolean;
  /** What the tab is saying about the connection attempt, beside the Connect button. */
  status: string;
  connecting: boolean;
  tunnelStatus: { tone: string; message: string } | null;
  /** Bumped each time the tab wants the caret in the password field — a handed-over connection
   *  that arrived with everything but the password. A counter rather than a flag, so asking twice
   *  moves it twice. `0`, or absent, asks nothing. */
  focusPassword?: number;
  onSave: () => void;
  onSaveAsNew: () => void;
  onConnect: () => void;
  onTestTunnel: () => void;
}

function ConnectionForm({
  form,
  onChange: set,
  onKindChange: changeKind,
  editingId,
  name: saveAsName,
  onNameChange: setSaveAsName,
  saveDisabled,
  status,
  connecting,
  tunnelStatus,
  focusPassword = 0,
  onSave: saveConnection,
  onSaveAsNew: saveConnectionAsNew,
  onConnect: connect,
  onTestTunnel: testTunnel,
}: Props) {
  const { t } = useTranslation();
  const passwordRef = useRef<HTMLInputElement>(null);
  /* The database-kind row scrolls sideways rather than wrapping — see the row itself below. Both
     hooks are the tab strip's: one gives the wheel the axis it lacks and reports which end is
     overrun, the other keeps the selected kind in view when a saved connection is opened. */
  const kindScroller = useRef<HTMLDivElement | null>(null);
  const { overflowing, atStart, atEnd } = useStripScroll(kindScroller);
  useActiveTabInView(kindScroller);
  /* Fade only on a side that is actually hiding something: a mask on an edge with nothing past it
     dims the first and last kind for no reason. */
  const kindFade = !overflowing
    ? ""
    : `${atStart ? "" : " choice-row-fade-start"}${atEnd ? "" : " choice-row-fade-end"}`;

  /** What went wrong making a database file, shown under the field. Cleared by the next attempt. */
  const [fileError, setFileError] = useState("");
  useEffect(() => {
    if (focusPassword > 0) passwordRef.current?.focus();
  }, [focusPassword]);
  const {
    kind, host, port, username, password, database, uri, path, uriRevealed, confirmingReveal, useSsl,
    tunnelType, sshHost, sshPort, sshUser, sshAuthType, sshPassword, sshKeyPath, sshPassphrase,
  } = form;

  async function browseForPrivateKey() {
    const path = await open({
      title: t("connection.selectPrivateKeyDialogTitle"),
      multiple: false,
      directory: false,
    });
    if (typeof path === "string") {
      set("sshKeyPath", path);
    }
  }

  /** The extensions a SQLite file is usually given, and an "any file" entry after them: the
   *  extension is a convention, not a format — plenty of applications keep theirs with no suffix at
   *  all, or with one of their own. */
  function sqliteFilters() {
    return [
      { name: "SQLite", extensions: ["db", "sqlite", "sqlite3", "db3"] },
      { name: t("connection.allFilesFilter"), extensions: ["*"] },
    ];
  }

  async function browseForDatabaseFile() {
    const chosen = await open({
      title: t("connection.selectSqliteFileDialogTitle"),
      multiple: false,
      directory: false,
      filters: sqliteFilters(),
    });
    if (typeof chosen === "string") {
      setFileError("");
      set("path", chosen);
    }
  }

  /**
   * Makes an empty database file and puts it in the box, ready to connect to.
   *
   * Two steps rather than one, and deliberately: connecting never creates a file, so that a
   * mistyped path is reported as the typo it is instead of opening an empty database nobody asked
   * for. Creating one is this button and nothing else.
   */
  async function createDatabaseFile() {
    const chosen = await save({
      title: t("connection.newSqliteFileDialogTitle"),
      defaultPath: "database.db",
      filters: sqliteFilters(),
    });
    if (typeof chosen !== "string") return;
    try {
      await createSqliteFile(chosen);
      set("path", chosen);
      setFileError("");
    } catch (e) {
      // Beside the field rather than in the tab's banner: the banner is for a failed connection,
      // and nothing has been connected to yet.
      setFileError(errorMessage(t, e));
    }
  }

  const isMongo = kind === "mongo";
  const isSqlite = kind === "sqlite";

  /* A Redis server whose default user has no password runs in protected mode unless it was told
     otherwise, and protected mode answers anything that isn't loopback with `-DENIED` and hangs
     up. The client only finds out when its next write hits the closed socket, so the tab reports
     a broken pipe and says nothing about why — hence the warning up here, where it can still be
     acted on.
     The tunnel doesn't come into it: this host is the address whoever dials Redis uses — this
     machine directly, or the SSH server on its behalf — so a loopback address means Redis is on
     the dialling machine either way, and anything else means it is not. */
  const showRedisProtectedModeHint =
    kind === "redis" && password === "" && !isLoopback(host);

  /**
   * Whether the SSH fields hold enough for a test to mean anything. Everything the chosen auth
   * method needs and nothing it doesn't: a passphrase belongs to a key that was encrypted, and an
   * unencrypted one has none, so it is never required. A test without these would only come back
   * with the server's own complaint about a missing host or user, one round trip later.
   */
  const sshInputsComplete =
    sshHost.trim() !== "" &&
    sshUser.trim() !== "" &&
    sshPort > 0 &&
    (sshAuthType === "password" ? sshPassword !== "" : sshKeyPath.trim() !== "");

  return (
    <>
      <div className="row row-name">
        <label className="field-name">
          {editingId ? t("connection.nameLabel") : t("connection.saveAsLabel")}{" "}
          <Input
            value={saveAsName}
            onChange={(e) => setSaveAsName(e.target.value)}
            placeholder={t("connection.connectionNamePlaceholder")}
          />
        </label>
      </div>

      <fieldset>
        <legend>{t("connection.databaseLegend")}</legend>
        {/* The one row in this form that is allowed the full width of the pane, and the one that
            needs it: a kind is added to this list every time an engine is, and seven of them
            already outrun the measure the fields are set to. It scrolls rather than wraps — a
            segmented control that becomes two rows stops reading as one control. */}
        <div className={`choice-row choice-row-kind${kindFade}`}>
          <div className="choice-scroller" ref={kindScroller} role="tablist">
            {(["mysql", "postgres", "mssql", "sqlite", "mongo", "redis", "clickhouse"] as DbKind[]).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                /* `data-active` is what `useActiveTabInView` looks for, so opening a saved
                   connection whose kind sits off the right-hand end scrolls it into view instead
                   of showing a row that looks like nothing is selected. */
                data-active={kind === k ? "" : undefined}
                className={`choice kind-${k}${kind === k ? " choice-active" : ""}`}
                onClick={() => changeKind(k)}
              >
                {/* Logo before the name, not instead of it: this row is the one place the kinds are
                    read side by side, so the word stays and the mark only makes it quicker to find. */}
                <DatabaseIcon kind={k} className="choice-icon" size="1.05em" />
                {t(kindLabel(k))}
              </button>
            ))}
          </div>
        </div>
        {isSqlite ? (
          /* A path and nothing else. There is no host to reach, no account to be on and no
             database to pick inside the file — the file is the database. */
          <div className="row">
            <label className="field-file-path">
              {t("connection.sqlitePathLabel")}{" "}
              <Input
                value={path}
                onChange={(e) => {
                  // The complaint was about the path that was there; a different one is a
                  // different question, and the answer to it comes from Connect.
                  setFileError("");
                  set("path", e.target.value);
                }}
                placeholder={t("connection.sqlitePathPlaceholder")}
              />
              <Button onClick={browseForDatabaseFile}>{t("common.browse")}</Button>
              <Button onClick={createDatabaseFile}>{t("connection.newSqliteFile")}</Button>
            </label>
          </div>
        ) : isMongo ? (
          <div className="row">
            <label className="field-connection-string">
              {t("connection.connectionStringLabel")}{" "}
              <Input
                value={uriRevealed ? uri : maskMongoUri(uri)}
                onChange={(e) => set("uri", e.target.value)}
                placeholder={t("connection.connectionStringPlaceholder")}
                readOnly={!uriRevealed}
              />
              <Button
                className="reveal-toggle"
                aria-pressed={uriRevealed}
                title={uriRevealed ? t("connection.hideConnectionString") : t("connection.revealConnectionString")}
                onClick={() => (uriRevealed ? set("uriRevealed", false) : set("confirmingReveal", true))}
              >
                {/* The struck-through eye marks the state the button moves *to*: shown now,
                    click to hide. */}
                {uriRevealed ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </Button>
            </label>
          </div>
        ) : (
          /* One row for the whole endpoint: each field is held to half the width, so they pair
             themselves off two to a line — host and port, then the credentials, then the
             database on a line of its own. */
          <div className="row">
            <label>
              {t("common.host")}{" "}
              <Input value={host} onChange={(e) => set("host", e.target.value)} />
            </label>
            <label>
              {t("common.port")}{" "}
              <Input
                type="number"
                value={port}
                onChange={(e) => set("port", Number(e.target.value))}
              />
            </label>
            <label>
              {t("common.user")}{" "}
              <Input value={username} onChange={(e) => set("username", e.target.value)} />
            </label>
            <label>
              {t("common.password")}{" "}
              <Input
                ref={passwordRef}
                type="password"
                value={password}
                onChange={(e) => set("password", e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label>
              {kind === "redis" ? t("connection.dbIndexLabel") : t("common.database")}{" "}
              <Input value={database} onChange={(e) => set("database", e.target.value)} />
            </label>
          </div>
        )}

        {/* Under the field it is about, and outside the row so it takes the width rather than a
            flex item's share of it. Amber like the Redis hint below: nothing has been connected to
            yet, so this is a note about the box above, not a failed connection. */}
        {fileError !== "" && (
          <p className="field-warning" role="alert">
            {fileError}
          </p>
        )}

        {showRedisProtectedModeHint && (
          <p className="field-warning" role="status">
            {t("connection.redisNoPasswordWarning")}
          </p>
        )}

        {/* Not `isSqlKind`: SQLite is one, and has no transport to secure. */}
        {(kind === "mysql" || kind === "postgres" || kind === "clickhouse" || kind === "mssql") && (
          <div className="row">
            <label>
              <input type="checkbox" checked={useSsl} onChange={(e) => set("useSsl", e.target.checked)} />{" "}
              {t("connection.useSslLabel")}
            </label>
          </div>
        )}
      </fieldset>

      {/* There is nothing to tunnel to: the file is on this machine. Hidden rather than disabled,
          because a disabled control still says the choice exists. */}
      {!isSqlite && (
      <fieldset>
        <legend>{t("connection.connectionMethodLegend")}</legend>
        <div className="choice-row" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tunnelType === "direct"}
            className={`choice${tunnelType === "direct" ? " choice-active" : ""}`}
            onClick={() => set("tunnelType", "direct")}
          >
            {t("connection.methodTcpIp")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tunnelType === "ssh"}
            className={`choice${tunnelType === "ssh" ? " choice-active" : ""}`}
            onClick={() => set("tunnelType", "ssh")}
          >
            {t("connection.methodSsh")}
          </button>
        </div>
        {tunnelType === "ssh" && (
          <>
            <div className="row">
              <label>
                {t("connection.sshHost")}{" "}
                <Input value={sshHost} onChange={(e) => set("sshHost", e.target.value)} />
              </label>
              <label>
                {t("connection.sshPort")}{" "}
                <Input
                  type="number"
                  value={sshPort}
                  onChange={(e) => set("sshPort", Number(e.target.value))}
                />
              </label>
              <label>
                {t("connection.sshUser")}{" "}
                <Input value={sshUser} onChange={(e) => set("sshUser", e.target.value)} />
              </label>
              <label>
                {t("connection.auth")}{" "}
                <Select
                  value={sshAuthType}
                  onChange={(v) => set("sshAuthType", v)}
                  options={[
                    { value: "password", label: t("connection.authPassword") },
                    { value: "privatekey", label: t("connection.authPrivateKey") },
                  ]}
                />
              </label>
            </div>
            {sshAuthType === "password" && (
              <div className="row">
                <label>
                  {t("connection.sshPassword")}{" "}
                  <Input
                    type="password"
                    value={sshPassword}
                    onChange={(e) => set("sshPassword", e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
              </div>
            )}
            {sshAuthType === "privatekey" && (
              <div className="row">
                <label>
                  {t("connection.privateKeyFile")}{" "}
                  <Input
                    value={sshKeyPath}
                    onChange={(e) => set("sshKeyPath", e.target.value)}
                    placeholder={PRIVATE_KEY_PLACEHOLDER}
                  />
                </label>
                <Button onClick={browseForPrivateKey}>
                  {t("common.browse")}
                </Button>
                <label>
                  {t("connection.keyPassphrase")}{" "}
                  <Input
                    type="password"
                    value={sshPassphrase}
                    onChange={(e) => set("sshPassphrase", e.target.value)}
                    placeholder={t("connection.passphrasePlaceholder")}
                    autoComplete="new-password"
                  />
                </label>
              </div>
            )}
            <div className="row">
              <Button onClick={testTunnel} disabled={!sshInputsComplete}>
                {t("connection.testTunnel")}
              </Button>
              {tunnelStatus && (
                <span className={`tunnel-status tunnel-status-${tunnelStatus.tone}`}>{tunnelStatus.message}</span>
              )}
            </div>
          </>
        )}
      </fieldset>
      )}

      <div className="row row-actions">
        <div className="row-actions-left">
          <Button
            onClick={saveConnection}
            disabled={saveDisabled}
          >
            {editingId ? t("connection.updateConnection") : t("connection.saveConnection")}
          </Button>
          {editingId && (
            <Button onClick={saveConnectionAsNew} disabled={!saveAsName.trim()}>
              {t("connection.saveAsNew")}
            </Button>
          )}
        </div>
        <div className="row-actions-right">
          <span>{status}</span>
          <Button variant="primary" onClick={() => connect()} disabled={connecting}>
            {t("common.connect")}
          </Button>
        </div>
      </div>

      {confirmingReveal && (
        <ConfirmDialog
          title={t("connection.revealConnectionStringTitle")}
          message={t("connection.revealConnectionStringMessage")}
          confirmLabel={t("connection.revealConnectionStringConfirm")}
          onConfirm={() => {
            set("uriRevealed", true);
            set("confirmingReveal", false);
          }}
          onCancel={() => set("confirmingReveal", false)}
        />
      )}
    </>
  );
}

export default ConnectionForm;
