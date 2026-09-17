import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";

import Button from "../../../../components/Button";
import Card from "../../../../components/Card";
import EmptyState from "../../../../components/EmptyState";
import ErrorBanner from "../../../../components/ErrorBanner";
import PageHeader from "../../../../components/PageHeader";
import Select from "../../../../components/Select";
import StatusPill from "../../../../components/StatusPill";
import Table from "../../../../components/Table";
import { FolderIcon, GlobeIcon, LockIcon, PlusIcon } from "../../../../icons";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { SiteDetail } from "@mixengine/api";
import type { SiteSharing } from "@mixengine/api";
import { subscribeDaemonWatch } from "../../daemonWatch";
import {
  applySharingChange,
  canEditSite,
  formatRemaining,
  siteVisit,
  type SiteRow,
} from "../../siteState";
import { takePendingSitesFilter } from "../../sitesNavigation";
import ShareDialog from "./ShareDialog";
import SiteForm from "./SiteForm";
import styles from "./Sites.module.css";

/** Ô chia sẻ: nút Chia sẻ khi chưa, đếm ngược sống + nút Bỏ chia sẻ khi đang. */
function SharingCell({
  sharing,
  onShare,
  onUnshare,
}: {
  sharing: SiteSharing | null | undefined;
  onShare: () => void;
  onUnshare: () => void;
}) {
  const { t } = useTranslation();
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!sharing?.until) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [sharing?.until]);

  if (!sharing) {
    return (
      <Button onClick={onShare} size="small" variant="soft">
        {t("mixengine.sites.share.share")}
      </Button>
    );
  }

  return (
    <span className={styles.sharing}>
      {sharing.until ? formatRemaining(sharing.until) : t("mixengine.sites.sharingIndefinite")}
      <Button onClick={onUnshare} size="small">
        {t("mixengine.sites.share.unshare")}
      </Button>
    </span>
  );
}

/**
 * Mọi site trong home, và trạng thái chia sẻ LAN của chúng.
 *
 * **Chia sẻ đến từ stream, không từ suy đoán** — `site_sharing_changed` là chỗ roadmap gọi là "chỗ
 * duy nhất `mix` là client yếu hơn": với CLI lý do nằm trong log không ai đọc, ở đây nó phải là một
 * dòng thấy được ngay khi nó tới.
 */
export default function Sites({ active }: { active: boolean }) {
  const [rows, setRows] = useState<SiteRow[]>([]);
  const [projectNames, setProjectNames] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SiteDetail | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  /**
   * Domain đang chờ bật service, khoá **cả bảng** chứ không riêng hàng ấy.
   *
   * Một biến giữ một domain, nên hai lượt chồng nhau sẽ giẫm lên nhau: lượt xong trước xoá luôn
   * dấu chờ của lượt còn đang chạy. Khoá cả bảng là cách rẻ nhất để chuyện đó không xảy ra, và cái
   * giá — vài giây không bấm được hàng khác — nhỏ hơn một bảng nói sai nó đang làm gì.
   */
  const [opening, setOpening] = useState<string | null>(null);
  const { t } = useTranslation();

  // `filterOverride` là đường thoát khỏi độ trễ một nhịp của `setState`: effect refresh project
  // list dưới đây tính ra filter hợp lệ rồi cần đọc site *ngay* với giá trị đó, không phải với
  // `projectFilter` cũ còn nằm trong closure cho tới lần render kế tiếp.
  const reload = useCallback(
    async (filterOverride?: string) => {
      const filter = filterOverride ?? projectFilter;
      try {
        const list = await api.sites(filter === "" ? undefined : filter);
        setRows(list.sites);
        setError("");
      } catch (e) {
        setError(errorMessage(t, e));
      }
    },
    [projectFilter, t],
  );

  /**
   * Đọc lại danh sách project mỗi khi vừa quay lại màn này — một project có thể vừa được
   * thêm/sửa/xoá ở màn Projects trong lúc màn này bị ẩn, và trước đây danh sách chỉ đọc một lần lúc
   * mount nên Select đứng yên với dữ liệu cũ.
   *
   * **Validate `projectFilter` trước khi gọi `site.list`, không phải sau.** Filter đang chọn có thể
   * trỏ tới một project vừa bị xoá — gọi `site.list` với một project không còn tồn tại là daemon từ
   * chối thẳng ("no such project: …"), không phải trả một danh sách rỗng, nên phải đổi filter về
   * "tất cả" *trước* khi đọc site, không phải bắt lỗi rồi thử lại.
   *
   * Cũng là chỗ đọc yêu cầu điều hướng từ `sitesNavigation.ts` (Projects → "mở Sites, lọc theo
   * project X") — gộp chung vì cả hai đều quyết định filter nào là đúng trước khi gọi `site.list`.
   */
  useEffect(() => {
    if (!active) return;
    let live = true;
    void (async () => {
      const requested = takePendingSitesFilter();
      try {
        const list = await api.projects();
        if (!live) return;
        const names = list.projects.map((p) => p.name);
        setProjectNames(names);
        const wanted = requested ?? projectFilter;
        const valid = wanted !== "" && names.includes(wanted) ? wanted : "";
        if (valid !== projectFilter) setProjectFilter(valid);
        await reload(valid);
      } catch (e) {
        if (live) setError(errorMessage(t, e));
      }
    })();
    return () => {
      live = false;
    };
    // `reload`/`projectFilter` cố ý đọc từ closure tại thời điểm effect chạy, không phải deps: đây
    // là lần refresh cho một lượt `active` mới, không phải một effect nên chạy lại mỗi khi
    // `projectFilter` tự đổi (SiteForm lưu xong đã có `reload()` riêng cho việc đó).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    return subscribeDaemonWatch((raw) => {
      setRows((current) => applySharingChange(current, raw));
    });
  }, []);

  async function edit(domain: string) {
    try {
      setEditing(await api.site(domain));
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }

  /**
   * Bấm vào domain: bật những service site này cần, rồi mở nó.
   *
   * **Không đợi service báo khoẻ, chỉ đợi `service.start` trả về** — cùng luật `AfterApply` đã
   * theo. Sức khoẻ thật là câu hỏi của màn Services; ở đây chờ thêm chỉ là giữ người dùng lại
   * trước một trình duyệt đằng nào cũng tự thử lại.
   *
   * Start hỏng thì **không** mở: một trang lỗi không nói được rằng service mới là thứ hỏng, còn
   * `ErrorBanner` thì nói đúng câu daemon trả về.
   */
  async function visit(row: SiteRow) {
    const { startProject, url } = siteVisit(row);
    setOpening(row.domain);
    try {
      if (startProject !== null) await api.serviceStartProject(startProject);
      await openUrl(url);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setOpening(null);
    }
  }

  /**
   * Bỏ chia sẻ. Cập nhật hàng ngay khi call trả về, không đợi `site_sharing_changed` — sự kiện đó
   * là cho lúc nó **tự** đổi (hết giờ, mất mạng), không phải cho lúc người dùng vừa bấm.
   */
  async function unshare(domain: string) {
    try {
      await api.siteUnshare(domain);
      setRows((current) =>
        current.map((row) => (row.domain === domain ? { ...row, sharing: null } : row)),
      );
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }

  return (
    <div className={`mixengine-page ${styles.sites}`}>
      {error !== "" && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      <PageHeader
        title={t("mixengine.sidebar.sites")}
        description={t("mixengine.sites.about")}
        actions={
          <>
            <Select
              className={styles.filter}
              size="large"
              value={projectFilter}
              onChange={(value) => {
                // The refresh effect above only runs for a new `active` turn, so while this screen is
                // already open a filter change has to read the sites itself — with `value`, not with
                // the `projectFilter` that stays one beat stale in the closure.
                setProjectFilter(value);
                void reload(value);
              }}
              searchable
              options={[
                { value: "", label: t("mixengine.sites.filterAllProjects") },
                ...projectNames.map((name) => ({ value: name, label: name })),
              ]}
            />
            <Button size="large" variant="primary" onClick={() => setCreating(true)}>
              <PlusIcon size={15} />
              {t("mixengine.sites.newSite")}
            </Button>
          </>
        }
      />

      <Card flush>
        {rows.length === 0 ? (
          <EmptyState title={t("mixengine.sites.empty")} />
        ) : (
          <Table aria-label={t("mixengine.sidebar.sites")}>
            <thead>
              <tr>
                <th>{t("mixengine.sites.columnDomain")}</th>
                <th>{t("mixengine.sites.columnOwner")}</th>
                <th>{t("mixengine.sites.columnKind")}</th>
                <th>{t("mixengine.sites.columnRoutes")}</th>
                <th>{t("mixengine.sites.columnHttps")}</th>
                <th>{t("mixengine.sites.columnState")}</th>
                <th>{t("mixengine.sites.columnSharing")}</th>
                <th data-align="end">{t("mixengine.sites.columnActions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const routes = (row.routes ?? []).length; // T135. `?? []` for a daemon from before the field.
                return (
                  <tr key={row.domain}>
                    <td>
                      <span className={styles.domain}>
                        <span className={row.https ? styles.lockOn : styles.lockOff} aria-hidden="true">
                          <LockIcon size={14} />
                        </span>
                        <Button
                          variant="link"
                          disabled={opening !== null}
                          onClick={() => void visit(row)}
                          title={t("mixengine.sites.openHint", { url: siteVisit(row).url })}
                        >
                          {row.domain}
                        </Button>
                        {opening === row.domain && (
                          <span className={styles.opening}>{t("mixengine.sites.opening")}</span>
                        )}
                      </span>
                    </td>
                    <td>
                      <span className={styles.owner}>
                        {row.owner.type === "project" ? (
                          <>
                            <FolderIcon size={14} className={styles.ownerIcon} />
                            {row.owner.name}
                          </>
                        ) : (
                          t("mixengine.sites.ownerExtension", { id: row.owner.id })
                        )}
                        {!canEditSite(row.owner) && (
                          <span className={styles.readOnly} title={t("mixengine.sites.editDisabledHint")}>
                            <LockIcon size={12} />
                          </span>
                        )}
                      </span>
                    </td>
                    <td>
                      <span className={styles.kind}>{row.kind.kind}</span>
                    </td>
                    <td className={routes === 0 ? styles.none : undefined}>
                      {routes === 0 ? t("mixengine.sites.routesNone") : routes}
                    </td>
                    <td data-nowrap>
                      <span className={row.https ? styles.httpsOn : styles.none}>
                        {row.https ? t("mixengine.sites.httpsOn") : t("mixengine.sites.httpsOff")}
                      </span>
                      {/* T98: site ép HTTPS — `?? false` cho daemon build trước khi trường này tồn tại. */}
                      {row.https && (row.https_redirect ?? false) && (
                        <span className={styles.redirect}> {t("mixengine.sites.redirect")}</span>
                      )}
                    </td>
                    <td>
                      <StatusPill tone={row.state === "enabled" ? "success" : "neutral"}>
                        {row.state === "enabled"
                          ? t("mixengine.sites.stateEnabled")
                          : t("mixengine.sites.stateDisabled")}
                      </StatusPill>
                    </td>
                    <td>
                      <SharingCell
                        sharing={row.sharing}
                        onShare={() => setSharing(row.domain)}
                        onUnshare={() => void unshare(row.domain)}
                      />
                    </td>
                    <td data-align="end" data-nowrap>
                      <span className={styles.rowActions}>
                        <Button size="small" disabled={opening !== null} onClick={() => void visit(row)}>
                          <GlobeIcon size={14} />
                          {t("mixengine.sites.open")}
                        </Button>
                        <Button
                          size="small"
                          onClick={() => void edit(row.domain)}
                          disabled={!canEditSite(row.owner)}
                          title={canEditSite(row.owner) ? undefined : t("mixengine.sites.editDisabledHint")}
                        >
                          {t("mixengine.sites.edit")}
                        </Button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {creating && (
        <SiteForm
          defaultProject={projectFilter === "" ? undefined : projectFilter}
          onCancel={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void reload();
          }}
        />
      )}

      {editing && (
        <SiteForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}

      {sharing && (
        <ShareDialog
          domain={sharing}
          onCancel={() => setSharing(null)}
          onShared={(next) => {
            setRows((current) =>
              current.map((row) => (row.domain === sharing ? { ...row, sharing: next } : row)),
            );
            setSharing(null);
          }}
        />
      )}
    </div>
  );
}
