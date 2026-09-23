# Themes

Three light color themes for the shared Paper & ink layout: Forest & linen, Blue & porcelain, and Ochre & parchment.

## Public interface

- `themes` lists the available palettes. Each contains semantic CSS tokens and an xterm-compatible terminal palette.
- `defaultThemeId` is `forest`. This follows the recommended starting palette and can be changed without affecting saved preferences.
- `getTheme(id)` returns a palette. `isThemeId(value)` validates stored or external values.
- `loadTheme()` restores and applies this device's saved theme, falling back to Forest & linen for missing, invalid, or unavailable storage.
- `selectTheme(id)` applies a theme and saves it locally. Both application functions return the selected palette so the terminal owner can assign `terminal.options.theme = theme.terminal`.

Call `loadTheme()` in the renderer before showing the workspace. Use a native select control populated from `themes`, and call `selectTheme` when it changes. Import only from this module's `index.ts`.

## Boundaries

Colors change, while layout, typography, task status, and terminal ownership stay the same. Preference is local to the app profile, never published to workspace members. This module does not render the theme picker, select fonts, implement dark mode, or control terminal sessions.

Dependencies: browser DOM and localStorage. No network, provider, or server dependency. If local storage is unavailable, the current session still changes theme but does not remember it after restart.
