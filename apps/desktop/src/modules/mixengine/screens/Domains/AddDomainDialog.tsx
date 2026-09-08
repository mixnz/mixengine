import { useEffect, useState } from "react";

import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Modal from "../../../../components/Modal";
import Select from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import * as api from "../../api";
import styles from "./AddDomainDialog.module.css";

interface Props {
  onCancel: () => void;
  onAdded: () => void;
}

export default function AddDomainDialog({ onCancel, onAdded }: Props) {
  const { t } = useTranslation();
  const [siteDomains, setSiteDomains] = useState<string[] | null>(null);
  const [site, setSite] = useState("");
  const [domain, setDomain] = useState("");
  const [acceptRiskyTld, setAcceptRiskyTld] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void api.sites().then((list) => {
      const names = list.sites.map((s) => s.domain);
      setSiteDomains(names);
      setSite((current) => current || (names[0] ?? ""));
    });
  }, []);

  const needsRiskyTldConsent = domain.trim().endsWith(".local");

  async function submit() {
    setSaving(true);
    setError("");
    try {
      await api.domainAdd(site, domain.trim(), acceptRiskyTld);
      onAdded();
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      label={t("mixengine.domains.addDomain")}
      onClose={onCancel}
      locked={saving}
      overlayClassName={styles.overlay}
      className={styles.dialog}
    >
      {(close) => (
        <>
          <h3 className={styles.title}>{t("mixengine.domains.addDomain")}</h3>

          <div className={styles.form}>
            <label className={styles.field}>
              {t("mixengine.domains.columnSite")}
              <Select
                value={site}
                disabled={siteDomains === null || saving}
                onChange={setSite}
                options={(siteDomains ?? []).map((d) => ({ value: d, label: d }))}
              />
            </label>

            <label className={styles.field}>
              {t("mixengine.domains.columnDomain")}
              <Input value={domain} disabled={saving} onChange={(e) => setDomain(e.target.value)} />
            </label>

            {needsRiskyTldConsent && (
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={acceptRiskyTld}
                  disabled={saving}
                  onChange={(e) => setAcceptRiskyTld(e.target.checked)}
                />
                {t("mixengine.sites.form.acceptRiskyTld")}
              </label>
            )}
          </div>

          {error !== "" && (
            <div className={styles.errors} role="alert">
              <p>{error}</p>
            </div>
          )}

          <div className={styles.actions}>
            <Button size="large" onClick={() => close(onCancel)} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button
              size="large"
              variant="primary"
              onClick={() => void submit()}
              disabled={saving || site === "" || domain.trim() === ""}
            >
              {t("common.save")}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
