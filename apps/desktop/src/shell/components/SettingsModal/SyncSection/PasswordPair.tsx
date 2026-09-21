import Input from "../../../../components/Input";
import { useTranslation } from "../../../../i18n";
import Field from "./Field";

interface Props {
  label: string;
  hint?: string;
  password: string;
  again: string;
  onPassword: (value: string) => void;
  onAgain: (value: string) => void;
}

/** A new password, typed twice: nobody can reset it for you and keep your data (D6). */
function PasswordPair({ label, hint, password, again, onPassword, onAgain }: Props) {
  const { t } = useTranslation();
  return (
    <>
      <Field label={label} hint={hint}>
        <Input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => onPassword(event.target.value)}
        />
      </Field>
      <Field label={t("sync.passwordAgain")}>
        <Input
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(event) => onAgain(event.target.value)}
        />
      </Field>
    </>
  );
}

export default PasswordPair;
