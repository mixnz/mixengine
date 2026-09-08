import { useEffect, useState } from "react";

import Button from "../../../../components/Button";
import Modal from "../../../../components/Modal";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import type { ExtensionOrigin } from "../../api/types/ExtensionOrigin";
import type { ExtensionPlan } from "../../api/types/ExtensionPlan";
import styles from "./PlanDialog.module.css";

interface Props {
  source: ExtensionOrigin;
  onCancel: () => void;
  onInstalled: () => void;
}

/**
 * Xem trước một install trước khi gửi, cho cả nguồn registry lẫn nguồn thư mục cục bộ.
 *
 * `extension.plan` là bước duy nhất — không gọi `extension.inspect` trước (Quyết định D2, spec).
 * Đăng nhập (`site.signs_in`) vẽ **trong** khối quyền, không cạnh domain (spec, mục 2).
 */
export default function PlanDialog({ source, onCancel, onInstalled }: Props) {
  const { t } = useTranslation();
  const [plan, setPlan] = useState<ExtensionPlan | null>(null);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    api
      .extensionPlan({ source })
      .then(setPlan)
      .catch((e: unknown) => setError(errorMessage(t, e)));
  }, [source, t]);

  async function install() {
    if (!plan) return;
    setInstalling(true);
    setError("");
    try {
      // `consent` trích nguyên từ `plan` — không build lại từ input, xem Quyết định D3.
      await api.extensionInstall({
        source,
        consent: {
          id: plan.id,
          version: plan.version,
          signed: plan.signed,
          network: plan.permissions.network,
        },
      });
      onInstalled();
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Modal
      label={t("mixengine.extensions.plan.title", { name: plan?.name ?? "" })}
      onClose={onCancel}
      locked={installing}
      overlayClassName={styles.overlay}
      className={styles.dialog}
    >
      {(close) => (
        <>
          <h3 className={styles.title}>
            {t("mixengine.extensions.plan.title", { name: plan?.name ?? "…" })}
          </h3>

          {plan && (
            <div className={styles.body}>
              {!plan.signed && (
                <p className={styles.warning}>{t("mixengine.extensions.plan.unsigned")}</p>
              )}
              <p>{plan.description}</p>
              {plan.homepage && (
                <p>{t("mixengine.extensions.plan.homepage", { url: plan.homepage })}</p>
              )}

              <h4>{t("mixengine.extensions.plan.permissionsTitle")}</h4>
              <ul className={styles.list}>
                {plan.permissions.services.map((access, i) => (
                  <li key={i}>
                    {access === "read"
                      ? t("mixengine.extensions.plan.apiRead")
                      : t("mixengine.extensions.plan.apiWrite")}
                  </li>
                ))}
                <li>{t("mixengine.extensions.plan.network", { reach: plan.permissions.network })}</li>
                {plan.permissions.filesystem.map((reach, i) => (
                  <li key={i}>{t("mixengine.extensions.plan.filesystem", { reach })}</li>
                ))}
                {plan.site?.signs_in && (
                  <li>{t("mixengine.extensions.plan.signsIn", { account: plan.site.signs_in })}</li>
                )}
              </ul>

              {plan.site && (
                <p>
                  {t("mixengine.extensions.plan.site", {
                    domain: plan.site.domain,
                    pool: plan.site.pool,
                  })}
                  {plan.site.database && (
                    <> — {t("mixengine.extensions.plan.database", { database: plan.site.database })}</>
                  )}
                </p>
              )}

              {plan.ports.map((port, i) => (
                <p key={i}>
                  {t("mixengine.extensions.plan.ports", { name: port.name, wanted: port.wanted })}
                </p>
              ))}

              <p>{t("mixengine.extensions.plan.installDir", { dir: plan.install_dir })}</p>
              <p>{t("mixengine.extensions.plan.dataDir", { dir: plan.data_dir })}</p>

              {plan.client && (
                <p>
                  {plan.client.state === "installed"
                    ? t("mixengine.extensions.plan.clientInstalled", { program: plan.client.program })
                    : t("mixengine.extensions.plan.clientNotInstalled", {
                        searched: plan.client.searched,
                      })}
                </p>
              )}
            </div>
          )}

          {error !== "" && (
            <div className={styles.errors} role="alert">
              <p>{error}</p>
            </div>
          )}

          <div className={styles.actions}>
            <Button size="large" onClick={() => close(onCancel)} disabled={installing}>
              {t("common.cancel")}
            </Button>
            <Button
              size="large"
              variant="primary"
              onClick={() => void install()}
              disabled={!plan || installing}
            >
              {installing
                ? t("mixengine.extensions.plan.installing")
                : t("mixengine.extensions.plan.installButton")}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
