# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: journeys.generated.spec.ts >> whats-new-dismiss: The close control on the welcome panel dismisses it without Got it.
- Location: tests/e2e/journeys.generated.spec.ts:2069:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('app.whats-new.presentation')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByTestId('app.whats-new.presentation')

```

# Test source

```ts
  1971 |   await reconcileRuntime(page, "dock-file-viewers", 7);
  1972 |   await expect(page.getByTestId("workspace.file-viewer.json")).toBeVisible({ timeout: 20000 });
  1973 |   await reconcileRuntime(page, "dock-file-viewers", 8);
  1974 |   await page.getByTestId("workspace.file-viewer-panel.summary-theme").click();
  1975 |   await reconcileRuntime(page, "dock-file-viewers", 9);
  1976 |   await page.getByTestId("workspace.file-explorer-panel.entry-audit-plan.md").click();
  1977 |   await reconcileRuntime(page, "dock-file-viewers", 10);
  1978 |   await expect(page.getByTestId("workspace.file-viewer.markdown")).toBeVisible();
  1979 |   await reconcileRuntime(page, "dock-file-viewers", 11);
  1980 |   await page.getByTestId("workspace.file-explorer-panel.entry-unreadable.txt").click();
  1981 |   await reconcileRuntime(page, "dock-file-viewers", 12);
  1982 |   await expect(page.getByTestId("workspace.file-viewer.notice")).toBeVisible({ timeout: 20000 });
  1983 |   await reconcileRuntime(page, "dock-file-viewers", 13);
  1984 |   await page.getByTestId("workspace.file-explorer-panel.parent-directory").click();
  1985 |   await reconcileRuntime(page, "dock-file-viewers", 14);
  1986 |   await page.getByTestId("workspace.file-explorer-panel.entry-attachments").click();
  1987 |   await reconcileRuntime(page, "dock-file-viewers", 15);
  1988 |   await page.getByTestId("workspace.file-explorer-panel.entry-notes.txt").click();
  1989 |   await reconcileRuntime(page, "dock-file-viewers", 16);
  1990 |   await expect(page.getByTestId("workspace.file-viewer.text")).toBeVisible({ timeout: 20000 });
  1991 |   await reconcileRuntime(page, "dock-file-viewers", 17);
  1992 |   await page.getByTestId("workspace.dock-panel.close-1").click();
  1993 |   await reconcileRuntime(page, "dock-file-viewers", 18);
  1994 |   await page.getByTestId("workspace.dock-panel.close-0").click();
  1995 |   await reconcileRuntime(page, "dock-file-viewers", 19);
  1996 |   await recordFinalPageState(page, "dock-file-viewers");
  1997 | });
  1998 | 
  1999 | test("skill-picker-choose-and-clear: The skill control opens a picker; choose Research, then clear back to none.", async ({ page }) => {
  2000 |   await page.goto("/?scenario=desktop-ready#/workspace");
  2001 |   await expect(page.getByTestId("workspace.composer-meta.workspace-skill")).toBeVisible();
  2002 |   await reconcileRuntime(page, "skill-picker-choose-and-clear", 1);
  2003 |   await page.getByTestId("workspace.composer-meta.workspace-skill").click();
  2004 |   await reconcileRuntime(page, "skill-picker-choose-and-clear", 2);
  2005 |   await expect(page.getByTestId("workspace.skill-picker.option-research")).toBeVisible();
  2006 |   await reconcileRuntime(page, "skill-picker-choose-and-clear", 3);
  2007 |   await page.getByTestId("workspace.skill-picker.option-research").click();
  2008 |   await reconcileRuntime(page, "skill-picker-choose-and-clear", 4);
  2009 |   await page.getByTestId("workspace.composer-meta.workspace-skill").click();
  2010 |   await reconcileRuntime(page, "skill-picker-choose-and-clear", 5);
  2011 |   await page.getByTestId("workspace.skill-picker.option-none").click();
  2012 |   await reconcileRuntime(page, "skill-picker-choose-and-clear", 6);
  2013 |   await expect(page.getByTestId("workspace.composer.draft")).toBeVisible();
  2014 |   await reconcileRuntime(page, "skill-picker-choose-and-clear", 7);
  2015 |   await recordFinalPageState(page, "skill-picker-choose-and-clear");
  2016 | });
  2017 | 
  2018 | test("favorite-a-model: Starring a model adds it to the Favorites section; unstarring it from there removes the section again; picking the model from the Favorites row selects it for the composer.", async ({
  2019 |   page,
  2020 | }) => {
  2021 |   await page.goto("/?scenario=desktop-ready#/workspace");
  2022 |   await page.getByTestId("workspace.composer-meta.model").click();
  2023 |   await reconcileRuntime(page, "favorite-a-model", 1);
  2024 |   await expect(page.getByTestId("workspace.model-popover.favorite-or-gpt-5.5")).toBeVisible();
  2025 |   await reconcileRuntime(page, "favorite-a-model", 2);
  2026 |   await page.getByTestId("workspace.model-popover.favorite-or-gpt-5.5").click();
  2027 |   await reconcileRuntime(page, "favorite-a-model", 3);
  2028 |   await expect(page.getByTestId("workspace.model-popover.favorites-favorite-or-gpt-5.5")).toBeVisible();
  2029 |   await reconcileRuntime(page, "favorite-a-model", 4);
  2030 |   await page.getByTestId("workspace.model-popover.favorites-row-or-gpt-5.5").click();
  2031 |   await reconcileRuntime(page, "favorite-a-model", 5);
  2032 |   await expect(page.getByTestId("workspace.composer-meta.model")).toContainText("GPT-5.5");
  2033 |   await reconcileRuntime(page, "favorite-a-model", 6);
  2034 |   await page.getByTestId("workspace.composer-meta.model").click();
  2035 |   await reconcileRuntime(page, "favorite-a-model", 7);
  2036 |   await page.getByTestId("workspace.model-popover.favorites-favorite-or-gpt-5.5").click();
  2037 |   await reconcileRuntime(page, "favorite-a-model", 8);
  2038 |   await expect(page.getByTestId("workspace.model-popover.favorite-or-gpt-5.5")).toBeVisible();
  2039 |   await reconcileRuntime(page, "favorite-a-model", 9);
  2040 |   await expect(page.getByTestId("workspace.model-popover.search-models")).toBeVisible();
  2041 |   await reconcileRuntime(page, "favorite-a-model", 10);
  2042 |   await recordFinalPageState(page, "favorite-a-model");
  2043 | });
  2044 | 
  2045 | test("local-context-mode: With a local model selected the composer offers a context mode; pick bare prompt.", async ({ page }) => {
  2046 |   await page.goto("/?scenario=local-ollama#/workspace");
  2047 |   await expect(page.getByTestId("workspace.composer-meta.local-context-mode")).toBeVisible();
  2048 |   await reconcileRuntime(page, "local-context-mode", 1);
  2049 |   await page.getByTestId("workspace.composer-meta.local-context-mode").selectOption("bare");
  2050 |   await reconcileRuntime(page, "local-context-mode", 2);
  2051 |   await page.getByTestId("workspace.composer-meta.local-context-mode").selectOption("full");
  2052 |   await reconcileRuntime(page, "local-context-mode", 3);
  2053 |   await recordFinalPageState(page, "local-context-mode");
  2054 | });
  2055 | 
  2056 | test("sidebar-brand-and-bridge-dot: Clicking the brand mark opens the menu; the settings dot re-polls the bridge.", async ({ page }) => {
  2057 |   await page.goto("/?scenario=desktop-ready#/workspace");
  2058 |   await expect(page.getByTestId("workspace.sidebar-settings-button.dot")).toBeVisible();
  2059 |   await reconcileRuntime(page, "sidebar-brand-and-bridge-dot", 1);
  2060 |   await page.getByTestId("workspace.sidebar-settings-button.dot").click();
  2061 |   await reconcileRuntime(page, "sidebar-brand-and-bridge-dot", 2);
  2062 |   await page.getByTestId("workspace.editorial-sidebar.brand").click();
  2063 |   await reconcileRuntime(page, "sidebar-brand-and-bridge-dot", 3);
  2064 |   await expect(page.getByTestId("settings.gates-menu.tab-settings")).toBeVisible();
  2065 |   await reconcileRuntime(page, "sidebar-brand-and-bridge-dot", 4);
  2066 |   await recordFinalPageState(page, "sidebar-brand-and-bridge-dot");
  2067 | });
  2068 | 
  2069 | test("whats-new-dismiss: The close control on the welcome panel dismisses it without Got it.", async ({ page }) => {
  2070 |   await page.goto("/?scenario=whats-new#/workspace");
> 2071 |   await expect(page.getByTestId("app.whats-new.presentation")).toBeVisible();
       |                                                                ^ Error: expect(locator).toBeVisible() failed
  2072 |   await reconcileRuntime(page, "whats-new-dismiss", 1);
  2073 |   await page.getByTestId("app.whats-new.dismiss-what-s-new").click();
  2074 |   await reconcileRuntime(page, "whats-new-dismiss", 2);
  2075 |   await expect(page.getByTestId("workspace.composer.draft")).toBeVisible();
  2076 |   await reconcileRuntime(page, "whats-new-dismiss", 3);
  2077 |   await recordFinalPageState(page, "whats-new-dismiss");
  2078 | });
  2079 | 
  2080 | test("mobile-open-sidebar-and-menu: On a phone the top bar opens the sidebar; from it the menu opens and the back control returns to the chat.", async ({
  2081 |   page,
  2082 | }) => {
  2083 |   await page.goto("/?scenario=desktop-ready#/workspace");
  2084 |   await expect(page.getByTestId("workspace.editorial-sidebar.button")).toBeVisible();
  2085 |   await reconcileRuntime(page, "mobile-open-sidebar-and-menu", 1);
  2086 |   await page.getByTestId("workspace.editorial-sidebar.open-sidebar").click();
  2087 |   await reconcileRuntime(page, "mobile-open-sidebar-and-menu", 2);
  2088 |   await expect(page.getByTestId("workspace.editorial-sidebar.close-mobile-sidebar")).toBeVisible();
  2089 |   await reconcileRuntime(page, "mobile-open-sidebar-and-menu", 3);
  2090 |   await page.getByTestId("workspace.editorial-sidebar.menu-and-settings").click();
  2091 |   await reconcileRuntime(page, "mobile-open-sidebar-and-menu", 4);
  2092 |   await expect(page.getByTestId("settings.gates-menu.tab-settings")).toBeVisible();
  2093 |   await reconcileRuntime(page, "mobile-open-sidebar-and-menu", 5);
  2094 |   await page.getByTestId("workspace.editorial-sidebar.button").click();
  2095 |   await reconcileRuntime(page, "mobile-open-sidebar-and-menu", 6);
  2096 |   await expect(page.getByTestId("workspace.composer.draft")).toBeVisible();
  2097 |   await reconcileRuntime(page, "mobile-open-sidebar-and-menu", 7);
  2098 |   await recordFinalPageState(page, "mobile-open-sidebar-and-menu");
  2099 | });
  2100 | 
  2101 | test("mobile-sidebar-close-controls: The title opens the sidebar, the close control shuts it, the backdrop shuts it, and the hamburger opens it again.", async ({
  2102 |   page,
  2103 | }) => {
  2104 |   await page.goto("/?scenario=desktop-ready#/workspace");
  2105 |   await page.getByTestId("workspace.editorial-sidebar.title").click();
  2106 |   await reconcileRuntime(page, "mobile-sidebar-close-controls", 1);
  2107 |   await page.getByTestId("workspace.editorial-sidebar.close-mobile-sidebar").click();
  2108 |   await reconcileRuntime(page, "mobile-sidebar-close-controls", 2);
  2109 |   await page.getByTestId("workspace.editorial-sidebar.button").click();
  2110 |   await reconcileRuntime(page, "mobile-sidebar-close-controls", 3);
  2111 |   await expect(page.getByTestId("workspace.editorial-sidebar.close-sidebar")).toBeVisible();
  2112 |   await reconcileRuntime(page, "mobile-sidebar-close-controls", 4);
  2113 |   await page.getByTestId("workspace.editorial-sidebar.close-sidebar").click();
  2114 |   await reconcileRuntime(page, "mobile-sidebar-close-controls", 5);
  2115 |   await expect(page.getByTestId("workspace.composer.draft")).toBeVisible();
  2116 |   await reconcileRuntime(page, "mobile-sidebar-close-controls", 6);
  2117 |   await recordFinalPageState(page, "mobile-sidebar-close-controls");
  2118 | });
  2119 | 
  2120 | test("mobile-new-conversation-and-copy-link: The top bar starts a new conversation and copies the thread link.", async ({ page }) => {
  2121 |   await page.goto("/?scenario=desktop-ready#/workspace");
  2122 |   await page.getByTestId("workspace.editorial-sidebar.new-conversation").click();
  2123 |   await reconcileRuntime(page, "mobile-new-conversation-and-copy-link", 1);
  2124 |   await expect(page.getByTestId("workspace.composer.draft")).toBeVisible();
  2125 |   await reconcileRuntime(page, "mobile-new-conversation-and-copy-link", 2);
  2126 |   await page.getByTestId("workspace.editorial-sidebar.copy-link").click();
  2127 |   await reconcileRuntime(page, "mobile-new-conversation-and-copy-link", 3);
  2128 |   await expect(page.getByTestId("workspace.editorial-sidebar.title")).toBeVisible();
  2129 |   await reconcileRuntime(page, "mobile-new-conversation-and-copy-link", 4);
  2130 |   await recordFinalPageState(page, "mobile-new-conversation-and-copy-link");
  2131 | });
  2132 | 
  2133 | test("web-lite-download-cue: An empty conversation in Web Lite shows the desktop download cue; the link is hovered, never followed.", async ({
  2134 |   page,
  2135 | }) => {
  2136 |   await page.goto("/?scenario=desktop-ready#/workspace");
  2137 |   await page.getByTestId("workspace.editorial-sidebar.begin-a-new-conversation").click();
  2138 |   await reconcileRuntime(page, "web-lite-download-cue", 1);
  2139 |   await expect(page.getByTestId("workspace.editorial-chat.link")).toBeVisible();
  2140 |   await reconcileRuntime(page, "web-lite-download-cue", 2);
  2141 |   await page.getByTestId("workspace.editorial-chat.link").hover();
  2142 |   await reconcileRuntime(page, "web-lite-download-cue", 3);
  2143 |   await expect(page.getByTestId("workspace.composer.draft")).toBeVisible();
  2144 |   await reconcileRuntime(page, "web-lite-download-cue", 4);
  2145 |   await recordFinalPageState(page, "web-lite-download-cue");
  2146 | });
  2147 | 
```