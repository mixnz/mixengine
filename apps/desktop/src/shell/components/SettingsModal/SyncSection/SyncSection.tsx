import { useCallback, useEffect, useState } from "react";
import ErrorBanner from "../../../../components/ErrorBanner";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import { requestSync } from "../../../sync";
import { syncDeviceName, syncStatus, type SyncStatus } from "../../../sync/api";
import { rememberServer } from "../../../sync/servers";
import AccountView from "./AccountView";
import ForgotPassword from "./ForgotPassword";
import RecoveryKey from "./RecoveryKey";
import SelfHosting from "./SelfHosting";
import SignInForm from "./SignInForm";
import VerifyCode from "./VerifyCode";

/** Where sign-up has got to. Lives as long as the pane: closing Settings drops the key on purpose. */
type Step =
  | { kind: "form" }
  | { kind: "recovery"; key: string; email: string }
  | { kind: "code"; email: string }
  | { kind: "forgot"; server: string; access: string | null; email: string };

/**
 * The Sync pane's screen. Which of four things it shows is decided by Rust's status and by how far sign-up
 * has got: signed in, the recovery key, the letter's code, or the form.
 */
function SyncScreen() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [step, setStep] = useState<Step>({ kind: "form" });
  /** Set by "start over": a registration still waiting in Rust is left to be replaced by the next. */
  const [startedOver, setStartedOver] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(() => {
    syncStatus()
      .then(setStatus)
      .catch((error: unknown) => setProblem(errorMessage(t, error)));
  }, [t]);
  useEffect(refresh, [refresh]);

  /* The server this machine is signed in to is the one the form offers after signing out —
     whichever way it got here: the form, a recovered password, or a move, which never passes
     through the form at all. */
  useEffect(() => {
    if (status?.signedIn && status.server) rememberServer(localStorage, status.server);
  }, [status]);

  useEffect(() => {
    void syncDeviceName()
      .then((name) => setDeviceName((current) => (current === "" ? name : current)))
      .catch(() => {});
  }, []);

  function signedIn(next: SyncStatus) {
    setStep({ kind: "form" });
    setStatus(next);
    requestSync();
  }

  if (problem) return <ErrorBanner message={problem} onDismiss={() => setProblem(null)} />;
  if (status === null) return null;
  // Keyed by the server: a finished move keeps this machine signed in, and without a new key React
  // would keep the old view — its open move form, and the old server's machines and freeze.
  if (status.signedIn) return <AccountView key={status.server} status={status} onChanged={refresh} />;

  if (step.kind === "recovery") {
    return <RecoveryKey recoveryKey={step.key} onDone={() => setStep({ kind: "code", email: step.email })} />;
  }

  if (step.kind === "forgot") {
    return (
      <ForgotPassword
        server={step.server}
        access={step.access}
        initialEmail={step.email}
        deviceName={deviceName}
        onDeviceNameChange={setDeviceName}
        onSignedIn={signedIn}
        onCancel={() => setStep({ kind: "form" })}
      />
    );
  }

  const waiting = step.kind === "code" || (status.verifying !== null && !startedOver);
  if (waiting) {
    return (
      <VerifyCode
        email={step.kind === "code" ? step.email : (status.verifying ?? "")}
        deviceName={deviceName}
        onDeviceNameChange={setDeviceName}
        lostKey={step.kind !== "code"}
        onVerified={signedIn}
        onStartOver={() => {
          setStep({ kind: "form" });
          setStartedOver(true);
        }}
      />
    );
  }

  return (
    <SignInForm
      deviceName={deviceName}
      onDeviceNameChange={setDeviceName}
      onSignedIn={signedIn}
      onForgot={(server, access, email) => setStep({ kind: "forgot", server, access, email })}
      onRegistered={(key, email) => {
        setStartedOver(false);
        setStep({ kind: "recovery", key, email });
      }}
    />
  );
}

/**
 * The Sync pane: the screen for where sign-in has got to, then the self-hosting line. The line sits
 * outside the screen so that no state, an error included, can leave it out.
 */
function SyncSection() {
  return (
    <>
      <SyncScreen />
      <SelfHosting />
    </>
  );
}

export default SyncSection;
