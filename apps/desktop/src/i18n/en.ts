const en = {
  common: {
    host: "Host",
    port: "Port",
    user: "User",
    password: "Password",
    database: "Database",
    connect: "Connect",
    disconnect: "Disconnect",
    save: "Save",
    cancel: "Cancel",
    confirm: "Confirm",
    delete: "Delete",
    duplicate: "Duplicate",
    browse: "Browse...",
    close: "Close",
    scrollTabsLeft: "Scroll tabs left",
    scrollTabsRight: "Scroll tabs right",
    loading: "Loading...",
    // Why anything that would write is greyed out, wherever in the workspace it is. One sentence
    // rather than one per panel: it is the same fact, and it names where to undo it.
    readOnlyConnection: "This connection is marked read-only. Change it from the connection's right-click menu.",
    // The same fact in the space a badge has: beside the name in the sidebar, and in the tab of a
    // connection that is already open.
    readOnly: "Read-only",
  },
  app: {
    settings: "Settings",
    /** The name of the app's own tab bar, for anyone reading the screen rather than looking at it. */
    tabs: "Open tabs",
    closeTab: "Close tab",
    newConnectionTab: "New connection tab",
    newConnectionTitle: "New Connection",
    /* What each module is called in the `[+]` menu — see `shell/registry.ts`, which is the list
       the menu is built from. */
    moduleDatabase: "Database",
    moduleRest: "REST",
    moduleTerminal: "Terminal",
    moduleTools: "Tools",
    moduleMixEngine: "MixEngine",
  },
  /* Which modules this window draws — T108. The first-run screen and the Settings pane share these
     words on purpose: a person meets the three presets once at the start and finds the same three
     names when they go looking for them again. */
  profiles: {
    title: "Modules",
    question: "What will you use MixLab for?",
    changeLater: "You can change this in Settings at any time.",
    presetMixengine: "MixEngine",
    presetMixengineAbout: "Sites, runtimes and services. The window MixEngine ships with.",
    presetEverything: "Everything",
    presetEverythingAbout: "MixEngine, and the database, REST and terminal tools.",
    presetDatabaseTools: "Database tools",
    presetDatabaseToolsAbout: "The database client, REST client, terminal and tools.",
    presets: "Presets",
    shown: "Modules shown",
    lastOne: "At least one module has to stay on.",
    confirmTitle: "Close these tabs?",
    confirmMessage:
      "Tabs open in {{modules}} will be closed. Nothing you have saved is deleted, and turning the module back on finds it where it was.",
    confirmAction: "Turn off and close",
    turnedOn:
      "{{module}} was turned on so this tab could open. Turn it off again in Settings → Modules.",
    turnedOnDismiss: "Dismiss this notice",
  },
  pagination: {
    previousPage: "Previous page",
    nextPage: "Next page",
    status: "Page {{page}} of {{pageCount}} \u00b7 {{total}} rows",
    perPage: "{{n}} / page",
  },
  select: {
    placeholder: "Select...",
    noOptions: "No options",
    noMatches: "No matches",
    searchPlaceholder: "Search...",
  },
  input: {
    clear: "Clear",
  },
  errorBanner: {
    dismiss: "Dismiss error",
  },
  cellDialog: {
    title: "{{column}}, row {{n}}",
    copy: "Copy",
  },
  settings: {
    title: "Settings",
    close: "Close",
    appearance: "Appearance",
    theme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    themeSystem: "System",
    accent: "Accent colour",
    accentBlue: "Blue",
    accentIndigo: "Indigo",
    accentViolet: "Violet",
    accentMagenta: "Magenta",
    accentOrange: "Orange",
    accentAmber: "Amber",
    accentGreen: "Green",
    accentTeal: "Teal",
    accentCyan: "Cyan",
    accentSlate: "Slate",
    glass: "Liquid glass",
    glassOff: "Off",
    glassOn: "On",
    glassHint: "Frosts and bends what is behind the layers that float over your data — menus, dropdowns, tooltips, the update toast and the loading pill. Dialogs become a frosted sheet over the window rather than a solid card, a grid's pinned header frosts the rows sliding under it, and the page and its controls take the same material. Off by default; it leans on the graphics card, so turn it off again if anything stutters.",
    language: "Language",
    languageEnglish: "English",
    languageVietnamese: "Ti\u1ebfng Vi\u1ec7t",
    privacyPolicy: "Privacy policy",
    privacyHint:
      "MixLab collects nothing about you and has no server of its own. What it keeps, it keeps on this machine.",
    logHint: "A file on this machine records crashes and errors, in case something needs a closer look.",
    openLogFolder: "Open log folder",
  },
  // The Ctrl/Cmd chords the app answers, as Settings lists them. A module's own chords are named in
  // that module's dictionary, beside the rest of its words — see `src/i18n/dicts.ts`, which will
  // not let two dictionaries claim the same group.
  shortcuts: {
    title: "Shortcuts",
    scope: {
      app: "App",
    },
    newTab: "New tab",
    // One row per module, filled from the module's own name — see `shell/shortcuts.ts`.
    newModuleTab: "New {{module}} tab",
    closeTab: "Close tab",
    nextTab: "Next tab",
    prevTab: "Previous tab",
    reload: "Reload the pane on screen",
  },
  // Which version is running, and where a newer one comes from. MixEngine's updater is the one that
  // replaces this window \u2014 T106 \u2014 so this block is a signpost and not a downloader.
  update: {
    title: "Updates",
    unavailable: "MixLab is updated with MixEngine.",
    runningNow: "You are running {{version}}",
    notCheckedYet: "Not checked yet.",
    openPage: "Open the download page",
    autoHint:
      "MixLab arrives and is replaced with MixEngine — its installer puts the window in place, and MixEngine's own updater keeps it current. There is nothing to check for here.",
  },
  // What a failed backend command says. The keys here are the `code` an `AppError` carries \u2014 see
  // src-tauri/src/error.rs \u2014 and `{{message}}` is where a driver's own words go, untranslated
  // because they are the server talking and the part worth searching for.
  error: {
    // MixEngine — the local daemon this app manages. `message` is the daemon's own words and is
    // never translated: it is what a search engine and MixEngine's own manual both index.
    // Restarting the window — T106, `src-tauri/src/relaunch.rs`. The first is a machine whose
    // operating system will not name this process's own executable; the second is one that would
    // not start it.
    relaunchNoExecutable: "MixLab could not work out which program to start again.",
    relaunchFailed: "MixLab could not start itself again: {{message}}",
    mixengineNoHome: "Could not work out where MixEngine keeps its files.",
    mixengineUnreachable: "No MixEngine daemon answered at {{endpoint}}.",
    mixenginePipeOwner:
      "The MixEngine pipe at {{endpoint}} is held by {{owner}}, not by this account.",
    mixengineRefused: "MixEngine refused: {{message}}",
    mixengineStartFailed: "Could not start MixEngine: {{message}}",
    mixengineProtocol: "MixEngine answered something this version does not understand: {{message}}",
    // SSH
    sshTimeout:
      "The SSH connection to {{host}}:{{port}} timed out after {{seconds}}s \u2014 check the host, the port and the firewall.",
    sshConnectFailed: "Cannot reach the SSH server: {{message}}",
    sshAuthFailed: "SSH authentication failed: {{message}}",
    sshShellFailed: "Could not open a shell on the SSH server: {{message}}",
    sshAuthRejected:
      "The SSH server rejected the login (partial success: {{partialSuccess}}). It accepts: {{methods}}.",
    sshHostKeyChanged:
      "The SSH server at {{endpoint}} is offering a different key than the one MixLab saw before ({{fingerprint}} now, {{known}} before). Either the server was rebuilt, or something is standing between you and it. If the change was expected, remove its entry from {{file}} and connect again.",
    cannotReadPrivateKey: "Cannot read the private key file: {{message}}",
    invalidPrivateKey: "That is not a private key MixLab can read: {{message}}",
    cannotBindTunnelPort: "Cannot open a local port for the tunnel: {{message}}",
    tunnelAcceptFailed:
      "The tunnel's local port has stopped taking connections: {{message}}. MixLab keeps trying — if it does not come back, close the tab and connect again.",
    cannotSaveKnownHost: "Cannot remember the server's key: {{message}}",
    sshUnavailable:
      "The SSH tunnel is not open at the moment \u2014 MixLab is trying to open it again.",
    // Saved passwords
    credentialStoreUnreachable: "Cannot reach the system credential store: {{message}}",
    cannotSavePassword: "Cannot save the password: {{message}}",
    cannotReadPassword: "Cannot read the saved password back: {{message}}",
    cannotRemovePassword: "Cannot remove the saved password: {{message}}",

    // The two both layers raise: a directory the app makes for itself, and work handed to a
    // background thread. The database module emits these as well, and reads them from here.
    cannotCreateDirectory: "Cannot create {{path}}: {{message}}",
    backgroundTaskFailed: "The task did not finish: {{message}}",
    // The one error in here the webview raises rather than the backend. Said out loud because the
    // alternative is a copy that did nothing and a paste, somewhere else, of what was there before.
    clipboard: "Nothing was copied — the clipboard refused: {{message}}",
    /** An error shape MixLab doesn't recognise \u2014 shown as-is rather than swallowed. */
    unknown: "{{message}}",
    /** The Error Boundary around one tab \u2014 the rest of the app (other tabs, the update check) is
     *  still alive. */
    crashedTab: "This tab hit a bug and could not go on. The rest of MixLab is unaffected.",
    /** The outermost Error Boundary \u2014 the whole App failed to render. No "Try again": there is
     *  nothing left to try it into, only a restart. */
    crashedApp: "MixLab hit a bug it could not recover from.",
    tryAgain: "Try again",
    restartApp: "Restart MixLab",
  },
};

/** The half of the dictionary no module owns. `src/i18n/dicts.ts` merges it with each module's. */
export type SharedDict = typeof en;

export default en;
