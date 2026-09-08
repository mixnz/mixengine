import { useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import Button from "../../../../components/Button";
import Input, { Textarea } from "../../../../components/Input";
import Select from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { DEFAULT_SSH_PORT, PRIVATE_KEY_PLACEHOLDER } from "../../../../core/ssh";
import { stableStringify } from "../../../../core/stableStringify";
import { useTranslation } from "../../../../i18n";
import { localShells } from "../../api";
import { ShellIcon } from "../../icons";
import {
  addTarget,
  removeTarget,
  updateTarget,
  useSavedTargets,
  useSavedTargetsLoaded,
} from "../../savedTargetsStore";
import { loadTerminalSettings } from "../../settingsStore";
import { shellLabel } from "../../shells";
import type { LocalShell, SavedTarget, SshAuth, SshConfig, TerminalChoice } from "../../types";
import SavedTargetList from "./SavedTargetList";
import styles from "./TargetForm.module.css";


/**
 * Một đích đã lưu rút xuống đúng phần "nó là cái gì" — không có `id`.
 *
 * Bỏ `id` ra là điều làm cho *Lưu thành mới* so sánh được: entry mới mang id khác mà nội dung y
 * hệt, và nút Cập nhật phải đọc ra "chưa đổi gì" ngay sau đó. Đi qua `stableStringify` vì thứ tự
 * khoá của một object form vừa dựng và của cùng object ấy sau một vòng qua JSON không giống nhau —
 * xem `core/stableStringify.ts`.
 */
function snapshotOf(target: SavedTarget): string {
  const { id: _id, ...body } = target;
  return stableStringify(body);
}

interface Props {
  onOpen: (choice: TerminalChoice) => void;
  onError: (message: string) => void;
  /** Cái tab vừa thử mở và hỏng. Form dựng lại đúng những gì người dùng đã gõ — một form bị xoá
   *  trắng sau mỗi lần sai mật khẩu là một form không ai dùng nổi. */
  initial: TerminalChoice | null;
}

/** Màn hình một tab terminal hiện trước khi có phiên: chọn máy này hay một máy chủ. */
function TargetForm({ onOpen, onError, initial }: Props) {
  const { t } = useTranslation();
  const targets = useSavedTargets();
  const targetsLoaded = useSavedTargetsLoaded();

  const [kind, setKind] = useState<"local" | "ssh">(initial?.kind ?? "local");

  /** Đích đã lưu mà form đang giữ, hoặc `null` khi nó là một cái gõ tay. */
  const [targetId, setTargetId] = useState<string | null>(initial?.targetId ?? null);
  const [name, setName] = useState("");
  /** Ảnh chụp của đích đã lưu lúc nó được nạp, để nút Cập nhật biết đã có gì đổi hay chưa. */
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [runOnConnect, setRunOnConnect] = useState(initial?.runOnConnect ?? "");

  // Máy này
  const [shells, setShells] = useState<LocalShell[]>([]);
  /* Tên chứ không phải đường dẫn, ở cả state lẫn giá trị của `Select`: tên là cái đi xuống đĩa, nên
     một dòng đã lưu nạp được vào form ngay cả khi danh sách shell của máy chưa đọc xong. */
  const [shellName, setShellName] = useState(initial?.kind === "local" ? initial.shell.name : "");
  const [cwd, setCwd] = useState(initial?.kind === "local" ? (initial.cwd ?? "") : "");

  // SSH
  const [host, setHost] = useState(initial?.kind === "ssh" ? initial.config.host : "");
  const [port, setPort] = useState(initial?.kind === "ssh" ? initial.config.port : DEFAULT_SSH_PORT);
  const [username, setUsername] = useState(initial?.kind === "ssh" ? initial.config.username : "");
  const [authType, setAuthType] = useState<"password" | "privatekey">(
    initial?.kind === "ssh" ? initial.config.auth.type : "password",
  );
  const [password, setPassword] = useState(
    initial?.kind === "ssh" && initial.config.auth.type === "password"
      ? initial.config.auth.password
      : "",
  );
  const [keyPath, setKeyPath] = useState(
    initial?.kind === "ssh" && initial.config.auth.type === "privatekey"
      ? initial.config.auth.key_path
      : "",
  );
  const [passphrase, setPassphrase] = useState(
    initial?.kind === "ssh" && initial.config.auth.type === "privatekey"
      ? (initial.config.auth.passphrase ?? "")
      : "",
  );

  useEffect(() => {
    /* Hai lượt đọc song song chứ không nối tiếp, và `loadTerminalSettings` chứ không
       `currentTerminalSettings`: store nạp file bất đồng bộ, nên hỏi nó ngay lúc này thường nhận
       về giá trị mặc định chứ không phải shell người dùng đã chọn. */
    Promise.all([localShells(), loadTerminalSettings()])
      .then(([found, settings]) => {
        setShells(found);
        const preferred = settings.defaultShell
          ? found.find((shell) => shell.name === settings.defaultShell)
          : undefined;
        /* `current ||` giữ nguyên cái `initial` đã đặt: một lần mở hỏng rồi thử lại phải quay về
           đúng shell vừa thử, không phải về shell mặc định. Shell mặc định đã gỡ khỏi máy thì
           `preferred` là `undefined` và cái Rust gợi ý đầu danh sách nhận chỗ. */
        setShellName((current) => current || preferred?.name || (found[0]?.name ?? ""));
        const dir = settings.defaultCwd;
        if (dir) setCwd((current) => current || dir);
      })
      .catch((e) => onError(errorMessage(t, e)));
    // Chỉ chạy một lần: danh sách shell của một máy không đổi giữa chừng.
  }, []);

  /** Đã đi tìm cái tên cho `initial` chưa — thắng hay thua đều tính, nên nó chỉ có một lượt. */
  const namedInitial = useRef(false);

  /**
   * Cái tên và ảnh chụp của đích mà tab này vừa rời khỏi.
   *
   * `TerminalChoice` mang được mọi thứ dựng lại form *trừ tên*: tên thuộc về entry đã lưu, không
   * thuộc về phiên. Thiếu bước này thì rời một phiên xong, form quay lại với đúng địa chỉ và đúng
   * mật khẩu nhưng ô Tên trống và nút Cập nhật chết — dòng trong cột có sáng lên thì cũng không ai
   * đọc ra rằng nó đang được giữ.
   *
   * Chỉ đặt tên và ảnh chụp, cố ý không nạp đè cả entry: cái người dùng vừa gõ phải ở nguyên đó.
   * Một lần mở hỏng vì sai mật khẩu mà form tự thay lại mật khẩu cũ là một form cãi lại người dùng.
   * Và vì ảnh chụp lấy từ entry chứ không từ form, một mật khẩu vừa sửa làm nút Cập nhật sống dậy —
   * đúng như nó phải thế.
   *
   * Chờ `targetsLoaded` vì danh sách rỗng cho tới khi file đọc xong, và trước đó mọi id đều trông
   * như đã bị xoá.
   */
  useEffect(() => {
    if (namedInitial.current || targetId === null || !targetsLoaded) return;
    namedInitial.current = true;
    const entry = targets.find((target) => target.id === targetId);
    if (entry === undefined) {
      /* Dòng ấy đã bị xoá trong lúc phiên đang chạy. Form giữ nguyên mọi thứ đang có — nó vẫn mở
         lại được — nhưng thôi trỏ vào một id không còn gì, để nút không còn nói "Cập nhật" về một
         entry không tồn tại. */
      setTargetId(null);
      return;
    }
    setName(entry.name);
    setSavedSnapshot(snapshotOf(entry));
  }, [targetsLoaded, targets]);

  const chosenShell = shells.find((shell) => shell.name === shellName);

  async function browseDirectory() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") setCwd(picked);
  }

  async function browseKeyFile() {
    const picked = await openDialog({ directory: false, multiple: false });
    if (typeof picked === "string") setKeyPath(picked);
  }

  function buildAuth(): SshAuth {
    return authType === "password"
      ? { type: "password", password }
      : { type: "privatekey", key_path: keyPath, passphrase: passphrase || undefined };
  }

  function buildConfig(): SshConfig {
    return { host: host.trim(), port, username: username.trim(), auth: buildAuth() };
  }

  /** Form đang mô tả đích nào, dưới cái id được đưa vào. Ô rỗng ghi ra `undefined` chứ không phải
   *  `""`: vắng mặt là mặc định, nên một entry chưa dùng tới ô ấy không mang theo một dòng chết. */
  function buildTarget(id: string): SavedTarget {
    const trimmedName = name.trim();
    const opening = runOnConnect.trim() || undefined;
    if (kind === "local") {
      return {
        id,
        name: trimmedName,
        kind: "local",
        shellName,
        cwd: cwd.trim() || null,
        runOnConnect: opening,
      };
    }
    return { id, name: trimmedName, kind: "ssh", config: buildConfig(), runOnConnect: opening };
  }

  /** Đủ để một lần thử có nghĩa: địa chỉ, người dùng, và cái mà cách xác thực đang chọn cần. */
  const sshReady =
    host.trim() !== "" &&
    username.trim() !== "" &&
    (authType === "password" ? password !== "" : keyPath.trim() !== "");

  /** Cái đang mở, dựng từ form. `null` khi form chưa đủ để một lần thử có nghĩa. */
  function buildChoice(): TerminalChoice | null {
    const opening = runOnConnect.trim() || null;
    if (kind === "local") {
      return chosenShell
        ? {
            kind: "local",
            shell: chosenShell,
            cwd: cwd.trim() || null,
            targetId,
            runOnConnect: opening,
          }
        : null;
    }
    return sshReady ? { kind: "ssh", config: buildConfig(), targetId, runOnConnect: opening } : null;
  }

  /** Đủ để lưu: một cái tên, và với máy này thì một shell có thật để lưu tên của nó. */
  const savable = name.trim() !== "" && (kind === "ssh" || chosenShell !== undefined);

  /* Nút Cập nhật chết khi form đang giữ đúng cái đã lưu. Chỉ hỏi câu này khi có entry để so: một
     đích gõ tay thì nút là Lưu, và Lưu thì không bao giờ vô nghĩa. */
  const unchanged = targetId !== null && savedSnapshot === snapshotOf(buildTarget(""));

  function applyTarget(entry: SavedTarget) {
    // Cột đích luôn ở đó, kể cả khi form đang ở loại kia — bấm một dòng mà form không đổi loại thì
    // cú bấm ấy trông như không có tác dụng gì.
    setKind(entry.kind);
    setTargetId(entry.id);
    setName(entry.name);
    setRunOnConnect(entry.runOnConnect ?? "");
    setSavedSnapshot(snapshotOf(entry));
    // Cái tên đã tìm rồi, và nó là cái này. Effect trên không còn lượt nào để ghi đè.
    namedInitial.current = true;
    if (entry.kind === "local") {
      setShellName(entry.shellName);
      setCwd(entry.cwd ?? "");
      /* Và dọn nhánh kia. Không dọn thì bấm sang tab SSH sau đó hiện ra địa chỉ và mật khẩu của
         một máy chủ khác — cái vừa được nạp trước đó — trong khi cột bên trái đang tô một dòng
         local, và nút Cập nhật thì sẵn sàng biến dòng ấy thành máy chủ. */
      resetSshFields();
      return;
    }
    // Đối xứng: thư mục bắt đầu của một dòng local khác không có việc gì ở đây nữa. Tên shell thì
    // ở lại — nó không thuộc về dòng nào cả, nó là cái tab "Máy này" mặc định mở ra.
    setCwd("");
    setHost(entry.config.host);
    setPort(entry.config.port);
    setUsername(entry.config.username);
    setAuthType(entry.config.auth.type);
    setPassword(entry.config.auth.type === "password" ? entry.config.auth.password : "");
    setKeyPath(entry.config.auth.type === "privatekey" ? entry.config.auth.key_path : "");
    setPassphrase(
      entry.config.auth.type === "privatekey" ? (entry.config.auth.passphrase ?? "") : "",
    );
  }

  /** Nháy đúp một dòng: nạp nó vào form rồi mở luôn. Cấu hình lấy thẳng từ mục được bấm chứ không
   *  từ state — `applyTarget` vừa gọi `setState`, mà state thì phải sang lần render sau mới đổi. */
  function openTarget(entry: SavedTarget) {
    applyTarget(entry);
    const opening = entry.runOnConnect ?? null;
    if (entry.kind === "ssh") {
      onOpen({ kind: "ssh", config: entry.config, targetId: entry.id, runOnConnect: opening });
      return;
    }
    /* Shell đã gỡ khỏi máy — một distro WSL bị xoá, một Git Bash gỡ đi. Form đã nạp xong và ô shell
       đang trống, nên người dùng thấy ngay là phải chọn cái khác; không có gì hỏng để báo. */
    const shell = shells.find((s) => s.name === entry.shellName);
    if (shell === undefined) return;
    onOpen({ kind: "local", shell, cwd: entry.cwd, targetId: entry.id, runOnConnect: opening });
  }

  /** Nửa SSH của form về trắng. Riêng ra vì `applyTarget` cũng cần nó: nạp một dòng local mà để lại
   *  thông tin đăng nhập của máy chủ vừa xem là để chúng nằm sau một tab chỉ cách một cú bấm. */
  function resetSshFields() {
    setHost("");
    setPort(DEFAULT_SSH_PORT);
    setUsername("");
    setAuthType("password");
    setPassword("");
    setKeyPath("");
    setPassphrase("");
  }

  /** Bỏ form về trắng. Loại đang chọn ở lại: "+" là "một cái mới thuộc loại tôi đang xem", và cả
   *  hai loại giờ đều lưu được. */
  function clearForm() {
    setTargetId(null);
    setName("");
    setSavedSnapshot(null);
    setRunOnConnect("");
    setCwd("");
    resetSshFields();
  }

  async function saveTarget() {
    if (!savable) return;
    try {
      const entry = buildTarget(targetId ?? crypto.randomUUID());
      if (targetId) {
        await updateTarget(entry);
      } else {
        await addTarget(entry);
        setTargetId(entry.id);
      }
      setSavedSnapshot(snapshotOf(entry));
    } catch (e) {
      onError(errorMessage(t, e));
    }
  }

  /** Cùng nội dung, id mới, và form chuyển sang giữ bản sao — cái đã lưu ở lại y như nó vốn có. */
  async function saveAsNew() {
    if (!savable) return;
    try {
      const entry = buildTarget(crypto.randomUUID());
      await addTarget(entry);
      setTargetId(entry.id);
      setSavedSnapshot(snapshotOf(entry));
    } catch (e) {
      onError(errorMessage(t, e));
    }
  }

  async function deleteTarget(id: string) {
    try {
      await removeTarget(id);
      if (targetId === id) clearForm();
    } catch (e) {
      onError(errorMessage(t, e));
    }
  }

  const choice = buildChoice();

  return (
    <div className={styles.layout}>
      {/* Luôn hiện, không chỉ ở tab SSH: đây là danh sách những chỗ người dùng hay tới, và một danh
          sách chỉ hiện ra sau khi đã bấm đúng tab thì không đỡ được ai lần bấm nào. */}
      <SavedTargetList
        targets={targets}
        selectedId={targetId}
        onSelect={applyTarget}
        onOpen={openTarget}
        onDelete={(id) => void deleteTarget(id)}
        onNew={clearForm}
      />

      <div className={styles.form}>
        {/* Hai kiểu đích. Nút chứ không phải `Select`: chỉ có hai, và cái đang chọn quyết định cả
            phần còn lại của form — đáng để thấy được cả hai cùng lúc. */}
        <div className={styles.kinds} role="tablist" aria-label={t("terminal.newTabTitle")}>
          <button
            type="button"
            role="tab"
            aria-selected={kind === "local"}
            className={`${styles.kind}${kind === "local" ? ` ${styles.kindActive}` : ""}`}
            onClick={() => setKind("local")}
          >
            {t("terminal.targetLocal")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === "ssh"}
            className={`${styles.kind}${kind === "ssh" ? ` ${styles.kindActive}` : ""}`}
            onClick={() => setKind("ssh")}
          >
            {t("terminal.targetSsh")}
          </button>
        </div>

        {/* Ngoài hai nhánh: cả hai loại đều lưu được, nên cả hai đều có tên. */}
        <div className={styles.row}>
          <label htmlFor="terminal-target-name">{t("terminal.targetName")}</label>
          <Input
            id="terminal-target-name"
            value={name}
            placeholder={
              kind === "local"
                ? t("terminal.targetNamePlaceholderLocal")
                : t("terminal.targetNamePlaceholderSsh")
            }
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {kind === "local" ? (
          <>
            <div className={styles.row}>
              {/* `Select` không nhận `id`, nên nhãn của nó là `ariaLabel` chứ không phải `htmlFor` */}
              <span>{t("terminal.shell")}</span>
              <Select
                value={shellName}
                options={shells.map((shell) => ({
                  value: shell.name,
                  label: (
                    <span className={styles.shellOption}>
                      <ShellIcon name={shell.name} />
                      {shellLabel(shell.name)}
                    </span>
                  ),
                  // Nhãn là node nên ô tìm kiếm không đọc được nó; đây là chữ nó đọc.
                  searchText: shellLabel(shell.name),
                }))}
                onChange={setShellName}
                ariaLabel={t("terminal.shell")}
                /* Máy không dò ra shell nào, và một dòng đã lưu trỏ tới shell đã gỡ khỏi máy, đều
                   hiện ra là ô trống — nhưng chúng không phải một chuyện, và "không tìm thấy shell
                   nào" nói sai hẳn khi danh sách bên dưới đang có năm cái. */
                placeholder={
                  shells.length === 0 ? t("terminal.noShells") : t("terminal.pickShell")
                }
              />
            </div>

            <div className={styles.row}>
              <label htmlFor="terminal-cwd">{t("terminal.startIn")}</label>
              <div className={styles.withButton}>
                <Input
                  id="terminal-cwd"
                  value={cwd}
                  placeholder={t("terminal.startInPlaceholder")}
                  onChange={(e) => setCwd(e.target.value)}
                />
                <Button onClick={() => void browseDirectory()}>{t("terminal.browse")}</Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className={styles.columns}>
              <div className={styles.row}>
                <label htmlFor="terminal-host">{t("terminal.host")}</label>
                <Input id="terminal-host" value={host} onChange={(e) => setHost(e.target.value)} />
              </div>
              <div className={`${styles.row} ${styles.narrow}`}>
                <label htmlFor="terminal-port">{t("terminal.port")}</label>
                <Input
                  id="terminal-port"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                />
              </div>
            </div>

            <div className={styles.row}>
              <label htmlFor="terminal-user">{t("terminal.username")}</label>
              <Input
                id="terminal-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className={styles.row}>
              <span>{t("terminal.authMethod")}</span>
              <Select
                value={authType}
                options={[
                  { value: "password", label: t("terminal.authPassword") },
                  { value: "privatekey", label: t("terminal.authPrivateKey") },
                ]}
                onChange={(value) => setAuthType(value)}
                ariaLabel={t("terminal.authMethod")}
              />
            </div>

            {authType === "password" ? (
              <div className={styles.row}>
                <label htmlFor="terminal-password">{t("terminal.password")}</label>
                <Input
                  id="terminal-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            ) : (
              <>
                <div className={styles.row}>
                  <label htmlFor="terminal-key">{t("terminal.privateKeyFile")}</label>
                  <div className={styles.withButton}>
                    <Input
                      id="terminal-key"
                      value={keyPath}
                      placeholder={PRIVATE_KEY_PLACEHOLDER}
                      onChange={(e) => setKeyPath(e.target.value)}
                    />
                    <Button onClick={() => void browseKeyFile()}>{t("terminal.browse")}</Button>
                  </div>
                </div>
                <div className={styles.row}>
                  <label htmlFor="terminal-passphrase">{t("terminal.keyPassphrase")}</label>
                  <Input
                    id="terminal-passphrase"
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                  />
                </div>
              </>
            )}
          </>
        )}

        {/* Ngoài hai nhánh, đúng như ô Tên: một shell trên máy này cũng có mấy dòng phải gõ lại mỗi
            lần mở, và `cd` bằng ô Bắt đầu ở chỉ làm được dòng đầu tiên trong số đó. */}
        <div className={styles.row}>
          <label htmlFor="terminal-run-on-connect">{t("terminal.runOnConnect")}</label>
          <Textarea
            id="terminal-run-on-connect"
            value={runOnConnect}
            placeholder={t("terminal.runOnConnectPlaceholder")}
            onChange={(e) => setRunOnConnect(e.target.value)}
          />
          <p className={styles.hint}>{t("terminal.runOnConnectHint")}</p>
        </div>

        <div className={styles.actions}>
          <Button disabled={!savable || unchanged} onClick={() => void saveTarget()}>
            {targetId ? t("terminal.updateTarget") : t("terminal.saveTarget")}
          </Button>
          {targetId && (
            <Button disabled={!savable} onClick={() => void saveAsNew()}>
              {t("terminal.saveAsNew")}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={choice === null}
            onClick={() => choice && onOpen(choice)}
          >
            {kind === "local" ? t("terminal.open") : t("terminal.connect")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default TargetForm;
