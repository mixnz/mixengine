import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Select from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import { localShells } from "../../api";
import { installedFonts } from "../../fontProbe";
import { MAX_FONT_SIZE, MIN_FONT_SIZE, stepFontSize } from "../../fontSize";
import { TERMINAL_FONTS, familyOf, fontStack } from "../../fonts";
import {
  MAX_SCROLLBACK,
  MIN_SCROLLBACK,
  clampScrollback,
  type CursorStyle,
} from "../../settings";
import { updateTerminalSettings, useTerminalSettings } from "../../settingsStore";
import { shellLabel } from "../../shells";
import type { LocalShell } from "../../types";
import styles from "./TerminalSettings.module.css";

/** Giá trị của ô chọn shell khi không đặt gì. `Select` nhận `string | number`, không nhận `null` —
 *  chuỗi rỗng là cách viết `null` ở tầng ấy, và nó không đụng tên shell nào. */
const NO_DEFAULT_SHELL = "";

/**
 * Pane của module terminal trong hộp Cài đặt của app.
 *
 * Mọi ô ghi thẳng vào `terminal-settings.json` khi nó đổi, nên không có nút Lưu — đúng như pane
 * của module REST. Hai ô số ghi lúc rời ô hoặc lúc `Enter` chứ không ghi từng phím: `clampScrollback`
 * sẽ kéo một số đang gõ dở về giới hạn ngay giữa chừng, và người dùng gõ "12000" sẽ thấy ô nhảy
 * về 100 sau chữ số đầu tiên.
 */
function TerminalSettings() {
  const { t } = useTranslation();
  const settings = useTerminalSettings();
  const [shells, setShells] = useState<LocalShell[]>([]);
  const [fonts, setFonts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Hai ô số trong lúc đang được gõ, để một số dở dang không bị kẹp giữa chừng. */
  const [fontSizeText, setFontSizeText] = useState<string | null>(null);
  const [scrollbackText, setScrollbackText] = useState<string | null>(null);

  useEffect(() => {
    localShells()
      .then(setShells)
      // Không dò được shell nào thì ô chọn chỉ còn mục "cái máy này đưa ra trước tiên", và đó vẫn
      // là một câu trả lời dùng được. Lỗi hiện dưới ô chứ không nuốt.
      .catch((e) => setError(errorMessage(t, e)));
    // Một lần: danh sách shell của một máy không đổi giữa chừng.
  }, []);

  /* Cũng một lần, và cũng vì cùng lý do — font cài trên máy không mọc thêm trong lúc hộp thoại
     đang mở. Đo bằng canvas nên nó chỉ chạy được sau khi có DOM, tức là trong effect. */
  useEffect(() => {
    let live = true;
    installedFonts(TERMINAL_FONTS).then((found) => {
      if (live) setFonts(found);
    });
    return () => {
      live = false;
    };
  }, []);

  const family = familyOf(settings.fontFamily);

  /* Font đang dùng luôn có mặt, kể cả khi phép đo không nhận ra nó: một hộp chọn không chỉ vào
     đâu cả là một hộp chọn nói dối về cái đang chạy. */
  const fontOptions = useMemo(() => {
    const names = fonts.includes(family) ? fonts : [family, ...fonts];
    return names.map((name) => ({
      value: name,
      label: name,
      // Mỗi mục vẽ bằng chính nó: chọn một phông chữ mà không thấy nó thì chọn bằng gì.
      optionLabel: <span style={{ fontFamily: fontStack(name) }}>{name}</span>,
    }));
  }, [fonts, family]);

  function commitFontSize(text: string) {
    updateTerminalSettings({ fontSize: stepFontSize(Number(text), 0) });
    setFontSizeText(null);
  }

  function commitScrollback(text: string) {
    updateTerminalSettings({ scrollback: clampScrollback(Number(text)) });
    setScrollbackText(null);
  }

  async function browseDirectory() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") updateTerminalSettings({ defaultCwd: picked });
  }

  return (
    <>
      <div className={styles.group}>
        <span className={styles.groupLabel}>{t("terminal.settingsScreenGroup")}</span>

        <div className={styles.row}>
          <span className={styles.label}>{t("terminal.settingsFontFamily")}</span>
          {/* Hộp chọn chứ không phải ô nhập, và không chỉ vì gõ tên font thì mệt: một ô nhập ghi
              từng phím, nên nó đi qua cả những giá trị dở dang — kể cả chuỗi rỗng. xterm dựng
              `ctx.font` từ giá trị ấy, chuỗi hỏng thì canvas lặng lẽ giữ số đo ô chữ cũ, và màn
              hình cắt ngang mọi dòng. Ở đây mọi giá trị đều đi qua `fontStack`. */}
          <Select<string>
            size="small"
            className={styles.wide}
            searchable
            searchPlaceholder={t("terminal.settingsFontSearch")}
            value={family}
            ariaLabel={t("terminal.settingsFontFamily")}
            options={fontOptions}
            onChange={(name) => updateTerminalSettings({ fontFamily: fontStack(name) })}
          />
        </div>
        <p className={styles.hint}>{t("terminal.settingsFontFamilyHint")}</p>

        <div className={styles.row}>
          <span className={styles.label}>{t("terminal.settingsFontSize")}</span>
          <Input
            size="small"
            type="number"
            className={styles.number}
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            value={fontSizeText ?? String(settings.fontSize)}
            aria-label={t("terminal.settingsFontSize")}
            onChange={(e) => setFontSizeText(e.target.value)}
            onBlur={(e) => commitFontSize(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitFontSize(e.currentTarget.value);
            }}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>{t("terminal.settingsScrollback")}</span>
          <Input
            size="small"
            type="number"
            className={styles.number}
            min={MIN_SCROLLBACK}
            max={MAX_SCROLLBACK}
            value={scrollbackText ?? String(settings.scrollback)}
            aria-label={t("terminal.settingsScrollback")}
            onChange={(e) => setScrollbackText(e.target.value)}
            onBlur={(e) => commitScrollback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitScrollback(e.currentTarget.value);
            }}
          />
          <span className={styles.unit}>{t("terminal.settingsScrollbackUnit")}</span>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>{t("terminal.settingsCursorStyle")}</span>
          <Select<CursorStyle>
            size="small"
            value={settings.cursorStyle}
            ariaLabel={t("terminal.settingsCursorStyle")}
            options={[
              { value: "block", label: t("terminal.settingsCursorBlock") },
              { value: "underline", label: t("terminal.settingsCursorUnderline") },
              { value: "bar", label: t("terminal.settingsCursorBar") },
            ]}
            onChange={(cursorStyle) => updateTerminalSettings({ cursorStyle })}
          />
        </div>

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={settings.cursorBlink}
            onChange={(e) => updateTerminalSettings({ cursorBlink: e.target.checked })}
          />
          <span>{t("terminal.settingsCursorBlink")}</span>
        </label>
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>{t("terminal.settingsSessionGroup")}</span>

        <div className={styles.row}>
          <span className={styles.label}>{t("terminal.settingsDefaultShell")}</span>
          <Select<string>
            size="small"
            value={settings.defaultShell ?? NO_DEFAULT_SHELL}
            ariaLabel={t("terminal.settingsDefaultShell")}
            options={[
              { value: NO_DEFAULT_SHELL, label: t("terminal.settingsDefaultShellAuto") },
              ...shells.map((shell) => ({ value: shell.name, label: shellLabel(shell.name) })),
            ]}
            onChange={(name) =>
              updateTerminalSettings({ defaultShell: name === NO_DEFAULT_SHELL ? null : name })
            }
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>{t("terminal.settingsDefaultCwd")}</span>
          <Input
            size="small"
            className={styles.wide}
            placeholder={t("terminal.startInPlaceholder")}
            value={settings.defaultCwd ?? ""}
            aria-label={t("terminal.settingsDefaultCwd")}
            onChange={(e) => updateTerminalSettings({ defaultCwd: e.target.value || null })}
          />
          <Button size="small" onClick={browseDirectory}>
            {t("terminal.browse")}
          </Button>
        </div>

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={settings.rightClickPastes}
            onChange={(e) => updateTerminalSettings({ rightClickPastes: e.target.checked })}
          />
          <span>{t("terminal.settingsRightClickPastes")}</span>
        </label>
        <p className={styles.hint}>{t("terminal.settingsRightClickPastesHint")}</p>

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={settings.titleShowsTargetName}
            onChange={(e) => updateTerminalSettings({ titleShowsTargetName: e.target.checked })}
          />
          <span>{t("terminal.settingsTitleShowsTargetName")}</span>
        </label>
        <p className={styles.hint}>{t("terminal.settingsTitleShowsTargetNameHint")}</p>

        {error && <p className={styles.hint}>{error}</p>}
        <p className={styles.hint}>{t("terminal.settingsGlobalHint")}</p>
      </div>
    </>
  );
}

export default TerminalSettings;
