// Shared viewport breakpoints bridging JS layout logic and the stylesheet.
// Consumed by UiStore (matchMedia subscription); UI reads ui.mobileShell.

/**
 * Mobile shell breakpoint: narrow portrait viewports plus short landscape
 * phones. When it matches, the app swaps to the fixed topbar + drawer
 * sidebar layout.
 *
 * MUST stay in sync with the
 * `@media (max-width: 640px), (max-width: 960px) and (max-height: 480px)`
 * block in src/styles/responsive.css.
 */
export const MOBILE_SHELL_QUERY = '(max-width: 640px), (max-width: 960px) and (max-height: 480px)';
