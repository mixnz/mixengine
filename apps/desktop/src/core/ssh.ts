import { IS_MAC, IS_WINDOWS } from "./platform";

/**
 * The SSH server, and the secrets that must not be written beside it.
 *
 * Here rather than in either module because the backend already made this call: `src-tauri/src/`
 * `ssh/mod.rs` has one `SshConfig`, and says why — "a terminal opened over SSH wants the same four
 * fields a tunnelled database connection does". Both modules were mirroring that one struct, so
 * two mirrors of it was not two types, it was one type written twice; the copies had already
 * drifted to two different example key paths.
 */

/** How to prove who you are to the SSH server. Mirrors Rust's `SshAuth`. */
export type SshAuth =
  | { type: "password"; password: string }
  | { type: "privatekey"; key_path: string; passphrase?: string };

/** The server to tunnel or open a session through. Mirrors Rust's `SshConfig`. */
export interface SshConfig {
  host: string;
  port: number;
  username: string;
  auth: SshAuth;
}

/** The port every SSH server is on unless it was moved. */
export const DEFAULT_SSH_PORT = 22;

/** What must not reach a JSON file. Named for the keyring entry each one is filed under, since
 *  that is the only place they go. */
export interface SshSecrets {
  sshPassword?: string;
  sshPassphrase?: string;
}

/**
 * A config split in two: the half that can be written to disk, and the half that goes to the OS
 * credential store.
 *
 * The password field is emptied rather than dropped, because the shape on disk still has to say
 * which kind of auth it was. An empty secrets object is meaningful too: `secrets_save` deletes the
 * entry for it, so a server with nothing to hide leaves nothing behind.
 */
export function splitSshSecrets(config: SshConfig): { config: SshConfig; secrets: SshSecrets } {
  if (config.auth.type === "password") {
    const password = config.auth.password;
    return {
      config: { ...config, auth: { type: "password", password: "" } },
      secrets: password ? { sshPassword: password } : {},
    };
  }
  const { key_path, passphrase } = config.auth;
  return {
    // The key path stays in the file: it is where to find the key, not the key.
    config: { ...config, auth: { type: "privatekey", key_path, passphrase: undefined } },
    secrets: passphrase ? { sshPassphrase: passphrase } : {},
  };
}

/** The config as a form needs it: what was on disk, with the secrets put back. What was already in
 *  hand wins over nothing at all, so a config that never went to disk survives this unchanged. */
export function mergeSshSecrets(config: SshConfig, secrets: SshSecrets): SshConfig {
  if (config.auth.type === "password") {
    return {
      ...config,
      auth: { type: "password", password: secrets.sshPassword ?? config.auth.password },
    };
  }
  return {
    ...config,
    auth: {
      type: "privatekey",
      key_path: config.auth.key_path,
      passphrase: secrets.sshPassphrase ?? config.auth.passphrase,
    },
  };
}

/**
 * An example key path written the way the host OS writes one — a Windows path is no help to
 * someone looking for `~/.ssh` on a Mac. It stays out of the dictionaries because a path is not
 * language: it follows the machine the app runs on, not the language it was asked to speak.
 *
 * `id_ed25519` and not `id_rsa`: it is what `ssh-keygen` has made by default since OpenSSH 9.5,
 * so it is the name most likely to be in the folder this points at. The two copies of this
 * constant disagreed about that, which is half of why there is now one.
 *
 * Which machine this is comes from {@link ./platform}. Linux is the fallback rather than a third
 * test: WebKitGTK spells its system several ways (`X11`, `Wayland`, `Linux`), and every remaining
 * desktop puts home directories under `/home`.
 */
export const PRIVATE_KEY_PLACEHOLDER = IS_WINDOWS
  ? "C:\Users\you\.ssh\id_ed25519"
  : IS_MAC
    ? "/Users/you/.ssh/id_ed25519"
    : "/home/you/.ssh/id_ed25519";
