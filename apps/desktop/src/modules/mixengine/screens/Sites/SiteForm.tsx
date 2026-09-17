import { useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import Button from "../../../../components/Button";
import Input, { Textarea } from "../../../../components/Input";
import Modal from "../../../../components/Modal";
import Select from "../../../../components/Select";
import Checkbox from "../../../../components/Checkbox";
import Switch from "../../../../components/Switch";
import { errorMessage } from "../../../../core/errors";
import { PlusIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { SiteDetail } from "@mixengine/api";
import type { RouteTarget, SiteKind, SiteRoute } from "@mixengine/api";
import { joinDocRoot, parseDomains, relativeToRoot } from "../../siteState";
import styles from "./SiteForm.module.css";

type Kind = SiteKind["kind"];
type Target = RouteTarget["target"];

/**
 * Một route trong lúc đang sửa — T135.
 *
 * Phẳng, không phải union: người dùng đổi qua lại giữa các target và ô họ vừa gõ phải còn nguyên khi
 * họ đổi lại. `toApi` là chỗ nó hẹp lại đúng hình dạng daemon nhận.
 */
interface RouteRow {
  path: string;
  target: Target;
  upstream: string;
  pool: string;
  root: string;
}

/** Một `SiteRoute` từ daemon, mở rộng thành dòng đang sửa. */
function fromApi(route: SiteRoute): RouteRow {
  return {
    path: route.path,
    target: route.target,
    upstream: route.target === "proxy" ? route.upstream : "",
    pool: route.target === "php-fpm" ? (route.pool ?? "") : "",
    root: route.target === "static" ? route.root : "",
  };
}

/** Và ngược lại — chỉ gửi đúng field của target đang chọn. */
function toApi(row: RouteRow): SiteRoute {
  switch (row.target) {
    case "proxy":
      return { path: row.path, target: "proxy", upstream: row.upstream };
    case "php-fpm":
      return { path: row.path, target: "php-fpm", pool: row.pool === "" ? null : row.pool };
    case "static":
      return { path: row.path, target: "static", root: row.root };
  }
}

interface Props {
  /** `undefined` = tạo mới. Có giá trị = sửa, khoá project lại. */
  initial?: SiteDetail;
  /** Chọn sẵn khi tạo mới — Sites truyền project đang lọc, nếu có. Bỏ qua khi `initial` có giá trị. */
  defaultProject?: string;
  onCancel: () => void;
  /** Gọi sau khi lưu xong — cha tự `reload()`. */
  onSaved: () => void;
}

export default function SiteForm({ initial, defaultProject, onCancel, onSaved }: Props) {
  const { t } = useTranslation();
  const editing = initial !== undefined;

  const [projectNames, setProjectNames] = useState<string[]>([]);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  // `false` cho tới khi cả hai danh sách trên tới nơi — xem chỗ dùng nó ngay trước `return`.
  const [listsReady, setListsReady] = useState(false);

  const [project, setProject] = useState(
    editing && initial.site.owner.type === "project"
      ? initial.site.owner.name
      : (defaultProject ?? ""),
  );
  // Root của project sở hữu site — cho tạo mới, đọc lại mỗi khi đổi project (dưới); cho sửa,
  // `SiteDetail.root` đã có sẵn, project bị khoá nên không đổi nữa. Chỉ để hiển thị: giá trị gửi
  // lên daemon vẫn luôn là phần còn lại một mình (`docRoot`), đúng `SiteSummary.doc_root`.
  const [projectRoot, setProjectRoot] = useState(editing ? initial.root : "");
  // Đã có lần trả lời đầu tiên chưa — khác với `projectRoot !== ""`, vì "" là một câu trả lời hợp
  // lệ (không project nào chọn, hoặc project rỗng thật). Chỉ chặn Modal ở lần đầu; đổi project sau
  // khi Modal đã mở không đóng nó lại, xem chỗ dùng ngay trước `return`.
  const [projectRootReady, setProjectRootReady] = useState(editing);
  const [domainsText, setDomainsText] = useState(editing ? initial.domains.join(", ") : "");
  const [docRoot, setDocRoot] = useState(editing ? initial.site.doc_root : "");
  const [kind, setKind] = useState<Kind>(editing ? initial.site.kind.kind : "php-fpm");
  const [pool, setPool] = useState(
    editing && initial.site.kind.kind === "php-fpm" ? (initial.site.kind.pool ?? "") : "",
  );
  const [upstream, setUpstream] = useState(
    editing && initial.site.kind.kind === "reverse-proxy" ? initial.site.kind.upstream : "",
  );
  const [port, setPort] = useState(
    editing && initial.site.kind.kind === "node-app" ? String(initial.site.kind.port) : "",
  );
  // T135. `?? []` vì một daemon build trước T135 không gửi trường này.
  const [routes, setRoutes] = useState<RouteRow[]>(
    editing ? (initial.site.routes ?? []).map(fromApi) : [],
  );
  const [selectedServices, setSelectedServices] = useState<Set<string>>(
    new Set(editing ? initial.services.map((s) => s.service) : []),
  );
  const [https, setHttps] = useState(editing ? initial.site.https : false);
  /** T98. `?? false` vì một daemon build trước T98 không gửi trường này. Chỉ có nghĩa khi `https`
   *  bật — daemon từ chối `true` bên cạnh `https: false`, nên UI không bao giờ gửi tổ hợp đó. */
  const [httpsRedirect, setHttpsRedirect] = useState(
    editing ? (initial.site.https_redirect ?? false) : false,
  );
  const [acceptRiskyTld, setAcceptRiskyTld] = useState(false);
  const [enabled, setEnabled] = useState(editing ? initial.site.state === "enabled" : true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const actionsRef = useRef<HTMLDivElement>(null);

  // Dialog dài (nhiều field, danh sách service) cuộn được, nút Lưu ở cuối — lỗi vẽ ra ngay phía
  // trên nút đó nhưng chèn thêm nội dung không tự kéo trình duyệt theo, nên không cuộn tới thì lỗi
  // coi như vô hình. Cuộn theo `.actions`, không phải chính khối lỗi — cùng lý do/luật
  // `ProjectForm.tsx` đã áp (`block: "end"` theo khối lỗi sẽ đẩy hai nút ra ngoài tầm nhìn).
  useEffect(() => {
    if (error !== "") actionsRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [error]);

  useEffect(() => {
    void Promise.all([api.projects(), api.services()]).then(([projectList, serviceList]) => {
      setProjectNames(projectList.projects.map((p) => p.name));
      setServiceIds(serviceList.services.map((s) => s.id));
      setListsReady(true);
    });
  }, []);

  // Chỉ cho tạo mới — sửa thì project bị khoá và `initial.root` đã là root đúng, không đổi nữa.
  useEffect(() => {
    if (editing) return;
    if (project === "") {
      setProjectRoot("");
      setProjectRootReady(true);
      return;
    }
    let live = true;
    void api
      .projectShow(project)
      .then((detail) => {
        if (!live) return;
        setProjectRoot(detail.project.root);
        setProjectRootReady(true);
      })
      .catch(() => {
        if (!live) return;
        setProjectRoot("");
        setProjectRootReady(true);
      });
    return () => {
      live = false;
    };
  }, [editing, project]);

  const domains = parseDomains(domainsText);
  const needsRiskyTldConsent = domains.some((d) => d.endsWith(".local"));
  const noProjects = !editing && projectNames.length === 0;

  // Chưa đủ dữ liệu để biết hình dạng cuối cùng của form — chưa mở Modal. Không chờ thì danh sách
  // service (rỗng lúc đầu, đầy sau khi `api.services()` trả lời) và dòng "Full path" (chờ
  // `projectRoot`) nới chiều cao dialog ra đúng lúc animation mở nó còn đang chạy — dialog đang
  // animate ở một chiều cao, giữa chừng lại cao thêm, và đó chính là chỗ modal "dứt vị trí lên
  // trên" bị báo. `onEntered`/`.settled` (`dialogMotion.ts`) chỉ che được thay đổi *sau khi*
  // animation xong; thay đổi *trong lúc* nó đang chạy thì phải tránh từ gốc, không phải che sau đó.
  // Gọi cục bộ qua IPC nên thường xong trong một khung hình — một khoảng lặng rất ngắn trước khi mở
  // còn tốt hơn một cái giật hình sau khi đã mở.
  if (!listsReady || !projectRootReady) return null;

  function toggleService(id: string) {
    setSelectedServices((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateRoute(index: number, change: Partial<RouteRow>) {
    setRoutes((current) =>
      current.map((route, at) => (at === index ? { ...route, ...change } : route)),
    );
  }

  function kindPayload(): SiteKind {
    switch (kind) {
      case "php-fpm":
        return { kind: "php-fpm", pool: pool === "" ? null : pool };
      case "static":
        return { kind: "static" };
      case "reverse-proxy":
        return { kind: "reverse-proxy", upstream };
      case "node-app":
        return { kind: "node-app", port: Number(port) };
    }
  }

  /**
   * Dialog luôn trả một đường dẫn tuyệt đối — cắt bỏ phần project root trước khi lưu vào state, vì
   * đó là hình dạng thật `SiteSummary.doc_root` giữ ("Relative to the project's root, as stored").
   * Không cắt thì ô này hiện tuyệt đối ngay sau khi chọn nhưng lại hiện phần còn lại sau khi lưu
   * rồi mở lại — hai lần hiện khác nhau cho cùng một site.
   *
   * `defaultPath` mở sẵn đúng chỗ đang chọn (root, hoặc root/doc_root hiện tại) để bấm Browse là
   * đi thẳng vào project, không phải mò lại từ đầu ổ đĩa.
   */
  async function browseDocRoot() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: projectRoot === "" ? undefined : joinDocRoot(projectRoot, docRoot),
    });
    if (typeof picked !== "string") return;
    setDocRoot(projectRoot === "" ? picked : relativeToRoot(projectRoot, picked));
  }

  async function submit() {
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await api.siteUpdate({
          site: { domain: initial.site.domain },
          domains,
          doc_root: docRoot,
          kind: kindPayload(),
          services: [...selectedServices],
          routes: routes.map(toApi),
          https,
          https_redirect: https && httpsRedirect,
          state: enabled ? "enabled" : "disabled",
          accept_risky_tld: acceptRiskyTld,
        });
      } else {
        await api.siteCreate({
          project: { name: project },
          domains: domains.length > 0 ? domains : null,
          doc_root: docRoot === "" ? null : docRoot,
          kind: kindPayload(),
          services: [...selectedServices].length > 0 ? [...selectedServices] : null,
          // `null` chứ không phải `[]`: không khai gì thì để `site.create` rơi xuống
          // `[[site.routes]]` trong mixengine.toml, đúng như `kind` và `doc_root`.
          routes: routes.length > 0 ? routes.map(toApi) : null,
          https,
          https_redirect: https && httpsRedirect,
          accept_risky_tld: acceptRiskyTld,
        });
      }
      onSaved();
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      label={t(editing ? "mixengine.sites.form.editTitle" : "mixengine.sites.form.createTitle")}
      onClose={onCancel}
      locked={saving}
      overlayClassName={styles.overlay}
      className={styles.dialog}
    >
      {(close) => (
        <>
          <h3 className={styles.title}>
            {t(editing ? "mixengine.sites.form.editTitle" : "mixengine.sites.form.createTitle")}
          </h3>

          <div className={styles.form}>
            {!editing && (
              <label className={styles.field}>
                {t("mixengine.sites.form.project")}
                {noProjects ? (
                  <p className={styles.hint}>{t("mixengine.sites.form.noProjects")}</p>
                ) : (
                  <Select
                    value={project}
                    onChange={setProject}
                    disabled={saving}
                    options={projectNames.map((name) => ({ value: name, label: name }))}
                    placeholder={t("mixengine.sites.form.project")}
                  />
                )}
              </label>
            )}

            <label className={styles.field}>
              {t("mixengine.sites.form.domains")}
              <Textarea
                mono
                maxRows={6}
                value={domainsText}
                disabled={saving}
                onChange={(e) => setDomainsText(e.target.value)}
                placeholder={t("mixengine.sites.form.domainsPlaceholder")}
              />
            </label>

            {needsRiskyTldConsent && (
              <Checkbox
                className={styles.checkbox}
                label={t("mixengine.sites.form.acceptRiskyTld")}
                checked={acceptRiskyTld}
                disabled={saving}
                onChange={(e) => setAcceptRiskyTld(e.target.checked)}
              />
            )}

            <label className={styles.field}>
              {t("mixengine.sites.form.docRoot")}
              <div className={styles.docRoot}>
                <Input
                  mono
                  value={docRoot}
                  disabled={saving}
                  onChange={(e) => setDocRoot(e.target.value)}
                />
                <Button onClick={() => void browseDocRoot()} disabled={saving}>
                  {t("common.browse")}
                </Button>
              </div>
              {/* Ô trên chỉ giữ phần còn lại sau root (đúng cái daemon lưu) — dòng này là chỗ
                  duy nhất người dùng thấy root của project và đường dẫn đầy đủ thật sự là gì.
                  `projectRoot` đã chắc chắn có giá trị cuối cùng trước khi Modal này được mở (xem
                  `listsReady`/`projectRootReady` phía trên), nên render có điều kiện ở đây không
                  còn đổi chiều cao dialog sau khi nó đã mở. */}
              {projectRoot !== "" && (
                <p className={styles.hint}>
                  {t("mixengine.sites.form.docRootFull", {
                    path: joinDocRoot(projectRoot, docRoot),
                  })}
                </p>
              )}
            </label>

            <label className={styles.field}>
              {t("mixengine.sites.form.kind")}
              <Select
                value={kind}
                disabled={saving}
                onChange={(value) => setKind(value)}
                options={[
                  { value: "php-fpm", label: "php-fpm" },
                  { value: "static", label: "static" },
                  { value: "reverse-proxy", label: "reverse-proxy" },
                  { value: "node-app", label: "node-app" },
                ]}
              />
            </label>

            {kind === "php-fpm" && (
              <label className={styles.field}>
                {t("mixengine.sites.form.pool")}
                <Select
                  value={pool}
                  disabled={saving}
                  onChange={setPool}
                  placeholder={t("mixengine.sites.form.poolAuto")}
                  options={[
                    { value: "", label: t("mixengine.sites.form.poolAuto") },
                    ...serviceIds
                      .filter((id) => id.startsWith("php-fpm@"))
                      .map((id) => ({ value: id, label: id })),
                  ]}
                />
              </label>
            )}

            {kind === "reverse-proxy" && (
              <label className={styles.field}>
                {t("mixengine.sites.form.upstream")}
                <Input
                  value={upstream}
                  disabled={saving}
                  onChange={(e) => setUpstream(e.target.value)}
                  placeholder="http://127.0.0.1:3000"
                />
              </label>
            )}

            {kind === "node-app" && (
              <label className={styles.field}>
                {t("mixengine.sites.form.port")}
                <Input
                  type="number"
                  value={port}
                  disabled={saving}
                  onChange={(e) => setPort(e.target.value)}
                />
              </label>
            )}

            {/* T135. Khối này không kiểm tra gì cả — đường dẫn sai quay về bằng đúng câu daemon
                nói, giống mọi thứ khác trong form này. */}
            <div className={styles.field}>
              {t("mixengine.sites.form.routes")}
              <p className={styles.hint}>{t("mixengine.sites.form.routesHint")}</p>

              {routes.length === 0 ? (
                <p className={styles.hint}>{t("mixengine.sites.form.routesEmpty")}</p>
              ) : (
                <div className={styles.routeList}>
                  {routes.map((route, index) => (
                    <div key={index} className={styles.route}>
                      <Input
                        value={route.path}
                        disabled={saving}
                        placeholder="/api"
                        aria-label={t("mixengine.sites.form.routePath")}
                        onChange={(e) => updateRoute(index, { path: e.target.value })}
                      />
                      <Select
                        value={route.target}
                        disabled={saving}
                        onChange={(value) => updateRoute(index, { target: value as Target })}
                        options={[
                          { value: "proxy", label: "proxy" },
                          { value: "php-fpm", label: "php-fpm" },
                          { value: "static", label: "static" },
                        ]}
                      />
                      {route.target === "proxy" && (
                        <Input
                          value={route.upstream}
                          disabled={saving}
                          placeholder="http://127.0.0.1:3003/xyz"
                          aria-label={t("mixengine.sites.form.routeUpstream")}
                          onChange={(e) => updateRoute(index, { upstream: e.target.value })}
                        />
                      )}
                      {route.target === "php-fpm" && (
                        <Select
                          value={route.pool}
                          disabled={saving}
                          onChange={(value) => updateRoute(index, { pool: value })}
                          placeholder={t("mixengine.sites.form.poolAuto")}
                          options={[
                            { value: "", label: t("mixengine.sites.form.poolAuto") },
                            ...serviceIds
                              .filter((id) => id.startsWith("php-fpm@"))
                              .map((id) => ({ value: id, label: id })),
                          ]}
                        />
                      )}
                      {route.target === "static" && (
                        <Input
                          value={route.root}
                          disabled={saving}
                          placeholder="dist"
                          aria-label={t("mixengine.sites.form.routeRoot")}
                          onChange={(e) => updateRoute(index, { root: e.target.value })}
                        />
                      )}
                      <Button
                        variant="danger"
                        disabled={saving}
                        aria-label={t("mixengine.sites.form.routesRemove")}
                        onClick={() =>
                          setRoutes((current) => current.filter((_, at) => at !== index))
                        }
                      >
                        {t("common.delete")}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Button
                className={styles.addRoute}
                disabled={saving}
                onClick={() =>
                  setRoutes((current) => [
                    ...current,
                    { path: "", target: "proxy", upstream: "", pool: "", root: "" },
                  ])
                }
              >
                <PlusIcon size={14} />
                {t("mixengine.sites.form.routesAdd")}
              </Button>
            </div>

            <div className={styles.field}>
              {t("mixengine.sites.form.services")}
              <div className={styles.serviceList}>
                {serviceIds.map((id) => (
                  <Checkbox
                    key={id}
                    className={styles.checkbox}
                    label={id}
                    checked={selectedServices.has(id)}
                    disabled={saving}
                    onChange={() => toggleService(id)}
                  />
                ))}
              </div>
            </div>

            {/* Settings that take effect as the site is saved, as switch rows in one inset panel. */}
            <div className={styles.toggles}>
              <div className={styles.toggle}>
                <span id="site-form-https">{t("mixengine.sites.form.https")}</span>
                <Switch
                  aria-labelledby="site-form-https"
                  checked={https}
                  disabled={saving}
                  onChange={(next) => {
                    setHttps(next);
                    // Bỏ HTTPS là bỏ luôn redirect: không có địa chỉ HTTPS nào để chuyển tới.
                    if (!next) setHttpsRedirect(false);
                  }}
                />
              </div>
              <div className={https ? styles.toggle : `${styles.toggle} ${styles.toggleOff}`}>
                <span id="site-form-redirect">{t("mixengine.sites.form.httpsRedirect")}</span>
                <Switch
                  aria-labelledby="site-form-redirect"
                  checked={https && httpsRedirect}
                  disabled={saving || !https}
                  onChange={setHttpsRedirect}
                />
              </div>
              {editing && (
                <div className={styles.toggle}>
                  <span id="site-form-enabled">{t("mixengine.sites.form.enabled")}</span>
                  <Switch
                    aria-labelledby="site-form-enabled"
                    checked={enabled}
                    disabled={saving}
                    onChange={setEnabled}
                  />
                </div>
              )}
            </div>
          </div>

          {error !== "" && (
            <div className={styles.errors} role="alert">
              <p>{error}</p>
            </div>
          )}

          <div ref={actionsRef} className={styles.actions}>
            <Button size="large" onClick={() => close(onCancel)} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button
              size="large"
              variant="primary"
              onClick={() => void submit()}
              disabled={saving || (!editing && (project === "" || noProjects))}
            >
              {saving ? t("mixengine.sites.form.saving") : t("common.save")}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
