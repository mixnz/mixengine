# CSS Modules

This project styles components with CSS Modules (`ComponentName.module.css`), not global CSS.

Rules:
- Class names inside a `.module.css` file can stay short and plain (e.g. `.trigger`, `.listbox`) — no manual prefixing needed, since the build tool scopes each class to its own file automatically.
- Import styles as `import styles from './ComponentName.module.css'` and reference classes via `styles.className`.
- Do not add global, unscoped CSS files for component styling.
