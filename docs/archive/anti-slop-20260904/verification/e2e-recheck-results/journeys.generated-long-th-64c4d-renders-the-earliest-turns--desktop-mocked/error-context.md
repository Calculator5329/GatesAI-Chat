# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: journeys.generated.spec.ts >> long-thread-show-earlier: Past one page the transcript collapses its head behind a Show control; clicking it renders the earliest turns.
- Location: tests/e2e/journeys.generated.spec.ts:1019:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('workspace.editorial-chat.show')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByTestId('workspace.editorial-chat.show')

```

# Test source

```ts
  923  |   await reconcileRuntime(page, "html-artifact-view-fullscreen", 5);
  924  |   await page.getByTestId("workspace.html-artifact-preview.close-html-preview").click();
  925  |   await reconcileRuntime(page, "html-artifact-view-fullscreen", 6);
  926  |   await expect(page.getByTestId("workspace.html-artifact-preview.view")).toBeVisible({ timeout: 30000 });
  927  |   await reconcileRuntime(page, "html-artifact-view-fullscreen", 7);
  928  |   await recordFinalPageState(page, "html-artifact-view-fullscreen");
  929  | });
  930  | 
  931  | test("html-artifact-open-in-dock: Open in dock renders the HTML file in a dock file viewer with an inline preview; Open in OS is a no-op against the mocked bridge.", async ({
  932  |   page,
  933  | }) => {
  934  |   await page.goto("/?scenario=rich-transcript#/thread/html");
  935  |   await page.getByTestId("workspace.html-artifact-preview.html-artifact-preview").click();
  936  |   await reconcileRuntime(page, "html-artifact-open-in-dock", 1);
  937  |   await page.getByTestId("workspace.html-artifact-preview.open-in-dock").click();
  938  |   await reconcileRuntime(page, "html-artifact-open-in-dock", 2);
  939  |   await expect(page.getByTestId("workspace.dock.panel")).toBeVisible();
  940  |   await reconcileRuntime(page, "html-artifact-open-in-dock", 3);
  941  |   await expect(page.getByTestId("workspace.file-viewer.html")).toBeVisible({ timeout: 20000 });
  942  |   await reconcileRuntime(page, "html-artifact-open-in-dock", 4);
  943  |   await expect(page.getByTestId("workspace.html-preview.inline")).toBeVisible();
  944  |   await reconcileRuntime(page, "html-artifact-open-in-dock", 5);
  945  |   await page.getByTestId("workspace.html-artifact-preview.open-in-os").click();
  946  |   await reconcileRuntime(page, "html-artifact-open-in-dock", 6);
  947  |   await page.getByTestId("workspace.dock-panel.close-0").click();
  948  |   await reconcileRuntime(page, "html-artifact-open-in-dock", 7);
  949  |   await recordFinalPageState(page, "html-artifact-open-in-dock");
  950  | });
  951  | 
  952  | test("registered-artifact-panel: The artifact registry lists a landing page; opening it from the palette shows the dock artifact panel with source toggle, open and download.", async ({
  953  |   page,
  954  | }) => {
  955  |   await page.goto("/?scenario=rich-transcript#/thread/html");
  956  |   await expect(page.getByTestId("workspace.html-artifact-preview.html-artifact-preview")).toBeVisible();
  957  |   await reconcileRuntime(page, "registered-artifact-panel", 1);
  958  |   await expect(page.getByTestId("workspace.html-artifact-preview.view")).toBeEnabled({ timeout: 30000 });
  959  |   await reconcileRuntime(page, "registered-artifact-panel", 2);
  960  |   await page.getByTestId("workspace.composer.draft").click();
  961  |   await reconcileRuntime(page, "registered-artifact-panel", 3);
  962  |   await page.getByTestId("workspace.composer.draft").press("Control+k");
  963  |   await reconcileRuntime(page, "registered-artifact-panel", 4);
  964  |   await expect(page.getByTestId("app.command-palette.search-commands-and-threads")).toBeVisible();
  965  |   await reconcileRuntime(page, "registered-artifact-panel", 5);
  966  |   await page.getByTestId("app.command-palette.search-commands-and-threads").fill("artifact");
  967  |   await reconcileRuntime(page, "registered-artifact-panel", 6);
  968  |   await page.getByTestId("app.command-palette.row-action:open-artifact-landing").click();
  969  |   await reconcileRuntime(page, "registered-artifact-panel", 7);
  970  |   await expect(page.getByTestId("workspace.dock.html-artifact")).toBeVisible();
  971  |   await reconcileRuntime(page, "registered-artifact-panel", 8);
  972  |   await expect(page.getByTestId("workspace.html-artifact-panel.html-artifact-preview")).toBeVisible();
  973  |   await reconcileRuntime(page, "registered-artifact-panel", 9);
  974  |   await expect(page.getByTestId("workspace.html-artifact-preview.toggle-source")).toBeVisible({ timeout: 30000 });
  975  |   await reconcileRuntime(page, "registered-artifact-panel", 10);
  976  |   await page.getByTestId("workspace.html-artifact-preview.toggle-source").click();
  977  |   await reconcileRuntime(page, "registered-artifact-panel", 11);
  978  |   await page.getByTestId("workspace.html-artifact-preview.toggle-source").click();
  979  |   await reconcileRuntime(page, "registered-artifact-panel", 12);
  980  |   await page.getByTestId("workspace.html-artifact-preview.download-file").click();
  981  |   await reconcileRuntime(page, "registered-artifact-panel", 13);
  982  |   await page.getByTestId("workspace.html-artifact-preview.open-file").click();
  983  |   await reconcileRuntime(page, "registered-artifact-panel", 14);
  984  |   await page.getByTestId("workspace.html-artifact-panel.open-in-os").click();
  985  |   await reconcileRuntime(page, "registered-artifact-panel", 15);
  986  |   await page.getByTestId("workspace.dock-panel.close-0").click();
  987  |   await reconcileRuntime(page, "registered-artifact-panel", 16);
  988  |   await recordFinalPageState(page, "registered-artifact-panel");
  989  | });
  990  | 
  991  | test("markdown-links-open-workspace-path: A workspace path in a reply hands the file to the OS through the bridge; an external link is hovered but never followed.", async ({
  992  |   page,
  993  | }) => {
  994  |   await page.goto("/?scenario=rich-transcript#/thread/html");
  995  |   await expect(page.getByTestId("workspace.markdown-chunk.open-workspace-path")).toBeVisible();
  996  |   await reconcileRuntime(page, "markdown-links-open-workspace-path", 1);
  997  |   await page.getByTestId("workspace.markdown-chunk.open-workspace-path").click();
  998  |   await reconcileRuntime(page, "markdown-links-open-workspace-path", 2);
  999  |   await page.getByTestId("workspace.markdown-chunk.a").hover();
  1000 |   await reconcileRuntime(page, "markdown-links-open-workspace-path", 3);
  1001 |   await recordFinalPageState(page, "markdown-links-open-workspace-path");
  1002 | });
  1003 | 
  1004 | test("message-copy-from-hover-actions: Hovering a message reveals its action row; Copy puts the text on the clipboard.", async ({
  1005 |   page,
  1006 | }) => {
  1007 |   await page.goto("/?scenario=rich-transcript#/thread/html");
  1008 |   await page.getByTestId("workspace.editorial-message.message-html-assistant").hover();
  1009 |   await reconcileRuntime(page, "message-copy-from-hover-actions", 1);
  1010 |   await expect(page.getByTestId("workspace.editorial-message.actions-html-assistant")).toBeVisible();
  1011 |   await reconcileRuntime(page, "message-copy-from-hover-actions", 2);
  1012 |   await page.getByTestId("workspace.editorial-message.copy-html-assistant").click();
  1013 |   await reconcileRuntime(page, "message-copy-from-hover-actions", 3);
  1014 |   await expect(page.getByTestId("workspace.editorial-message.actions-html-assistant")).toBeVisible();
  1015 |   await reconcileRuntime(page, "message-copy-from-hover-actions", 4);
  1016 |   await recordFinalPageState(page, "message-copy-from-hover-actions");
  1017 | });
  1018 | 
  1019 | test("long-thread-show-earlier: Past one page the transcript collapses its head behind a Show control; clicking it renders the earliest turns.", async ({
  1020 |   page,
  1021 | }) => {
  1022 |   await page.goto("/?scenario=rich-transcript#/thread/long");
> 1023 |   await expect(page.getByTestId("workspace.editorial-chat.show")).toBeVisible();
       |                                                                   ^ Error: expect(locator).toBeVisible() failed
  1024 |   await reconcileRuntime(page, "long-thread-show-earlier", 1);
  1025 |   await page.getByTestId("workspace.editorial-chat.show").click();
  1026 |   await reconcileRuntime(page, "long-thread-show-earlier", 2);
  1027 |   await expect(page.getByTestId("workspace.editorial-message.message-long-user-1")).toBeVisible();
  1028 |   await reconcileRuntime(page, "long-thread-show-earlier", 3);
  1029 |   await recordFinalPageState(page, "long-thread-show-earlier");
  1030 | });
  1031 | 
  1032 | test("long-thread-jump-to-latest: Scrolling up a long transcript shows Jump to latest; clicking it returns to the newest turn and hides the control.", async ({
  1033 |   page,
  1034 | }) => {
  1035 |   await page.goto("/?scenario=rich-transcript#/thread/long");
  1036 |   await expect(page.getByTestId("workspace.editorial-chat.show")).toBeVisible();
  1037 |   await reconcileRuntime(page, "long-thread-jump-to-latest", 1);
  1038 |   await page.getByTestId("workspace.editorial-message.message-long-user-7").hover();
  1039 |   await reconcileRuntime(page, "long-thread-jump-to-latest", 2);
  1040 |   await expect(page.getByTestId("workspace.editorial-chat.editorial-jump-to-bottom")).toBeVisible({ timeout: 15000 });
  1041 |   await reconcileRuntime(page, "long-thread-jump-to-latest", 3);
  1042 |   await page.getByTestId("workspace.editorial-chat.editorial-jump-to-bottom").click();
  1043 |   await reconcileRuntime(page, "long-thread-jump-to-latest", 4);
  1044 |   await expect(page.getByTestId("workspace.editorial-message.message-long-assistant-66")).toBeVisible();
  1045 |   await reconcileRuntime(page, "long-thread-jump-to-latest", 5);
  1046 |   await recordFinalPageState(page, "long-thread-jump-to-latest");
  1047 | });
  1048 | 
  1049 | test("regenerate-confirm-and-cancel: Regenerating an answer that is not the last one shows a confirm panel; Cancel keeps the thread as it was.", async ({
  1050 |   page,
  1051 | }) => {
  1052 |   await page.goto("/?scenario=rich-transcript#/thread/middle");
  1053 |   await page.getByTestId("workspace.editorial-message.message-middle-assistant-1").hover();
  1054 |   await reconcileRuntime(page, "regenerate-confirm-and-cancel", 1);
  1055 |   await page.getByTestId("workspace.editorial-message.regenerate-middle-assistant-1").click();
  1056 |   await reconcileRuntime(page, "regenerate-confirm-and-cancel", 2);
  1057 |   await expect(page.getByTestId("workspace.editorial-message.confirm-panel-middle-assistant-1")).toBeVisible();
  1058 |   await reconcileRuntime(page, "regenerate-confirm-and-cancel", 3);
  1059 |   await expect(page.getByTestId("workspace.editorial-message.confirm-regenerate-middle-assistant-1")).toBeVisible();
  1060 |   await reconcileRuntime(page, "regenerate-confirm-and-cancel", 4);
  1061 |   await page.getByTestId("workspace.editorial-message.confirm-cancel-middle-assistant-1").click();
  1062 |   await reconcileRuntime(page, "regenerate-confirm-and-cancel", 5);
  1063 |   await expect(page.getByTestId("workspace.editorial-message.message-middle-assistant-2")).toBeVisible();
  1064 |   await reconcileRuntime(page, "regenerate-confirm-and-cancel", 6);
  1065 |   await recordFinalPageState(page, "regenerate-confirm-and-cancel");
  1066 | });
  1067 | 
  1068 | test("edit-mid-thread-confirm-and-cancel: Editing an earlier question opens the edit panel; Save asks to confirm because later turns would be dropped, and both cancels back out.", async ({
  1069 |   page,
  1070 | }) => {
  1071 |   await page.goto("/?scenario=rich-transcript#/thread/middle");
  1072 |   await page.getByTestId("workspace.editorial-message.message-middle-user-1").hover();
  1073 |   await reconcileRuntime(page, "edit-mid-thread-confirm-and-cancel", 1);
  1074 |   await page.getByTestId("workspace.editorial-message.edit-middle-user-1").click();
  1075 |   await reconcileRuntime(page, "edit-mid-thread-confirm-and-cancel", 2);
  1076 |   await expect(page.getByTestId("workspace.editorial-message.edit-panel-middle-user-1")).toBeVisible();
  1077 |   await reconcileRuntime(page, "edit-mid-thread-confirm-and-cancel", 3);
  1078 |   await page.getByTestId("workspace.editorial-message.edit-input-middle-user-1").fill("First question, reworded.");
  1079 |   await reconcileRuntime(page, "edit-mid-thread-confirm-and-cancel", 4);
  1080 |   await page.getByTestId("workspace.editorial-message.edit-save-middle-user-1").click();
  1081 |   await reconcileRuntime(page, "edit-mid-thread-confirm-and-cancel", 5);
  1082 |   await expect(page.getByTestId("workspace.editorial-message.edit-confirm-cancel-middle-user-1")).toBeVisible();
  1083 |   await reconcileRuntime(page, "edit-mid-thread-confirm-and-cancel", 6);
  1084 |   await page.getByTestId("workspace.editorial-message.edit-confirm-cancel-middle-user-1").click();
  1085 |   await reconcileRuntime(page, "edit-mid-thread-confirm-and-cancel", 7);
  1086 |   await page.getByTestId("workspace.editorial-message.edit-cancel-middle-user-1").click();
  1087 |   await reconcileRuntime(page, "edit-mid-thread-confirm-and-cancel", 8);
  1088 |   await expect(page.getByTestId("workspace.editorial-message.message-middle-user-2")).toBeVisible();
  1089 |   await reconcileRuntime(page, "edit-mid-thread-confirm-and-cancel", 9);
  1090 |   await recordFinalPageState(page, "edit-mid-thread-confirm-and-cancel");
  1091 | });
  1092 | 
  1093 | test("grouped-activity-timeline: Consecutive tool calls fold into one group; the group control expands and collapses them.", async ({
  1094 |   page,
  1095 | }) => {
  1096 |   await page.goto("/?scenario=rich-transcript#/thread/grouped");
  1097 |   await expect(page.getByTestId("workspace.activity-timeline-group.button")).toBeVisible();
  1098 |   await reconcileRuntime(page, "grouped-activity-timeline", 1);
  1099 |   await page.getByTestId("workspace.activity-timeline-group.button").click();
  1100 |   await reconcileRuntime(page, "grouped-activity-timeline", 2);
  1101 |   await page.getByTestId("workspace.activity-timeline-group.button").click();
  1102 |   await reconcileRuntime(page, "grouped-activity-timeline", 3);
  1103 |   await recordFinalPageState(page, "grouped-activity-timeline");
  1104 | });
  1105 | 
  1106 | test("memory-sources-open-and-unavailable: A reply grounded in a message, a vanished message and a library file: each chip opens its detail, and the vanished one is marked unavailable.", async ({
  1107 |   page,
  1108 | }) => {
  1109 |   await page.goto("/?scenario=rich-transcript#/thread/memory");
  1110 |   await expect(page.getByTestId("workspace.memory-disclosure.chip-message:tool-user")).toBeVisible();
  1111 |   await reconcileRuntime(page, "memory-sources-open-and-unavailable", 1);
  1112 |   await page.getByTestId("workspace.memory-disclosure.chip-message:tool-user").click();
  1113 |   await reconcileRuntime(page, "memory-sources-open-and-unavailable", 2);
  1114 |   await expect(page.getByTestId("workspace.memory-disclosure.open-source")).toBeVisible();
  1115 |   await reconcileRuntime(page, "memory-sources-open-and-unavailable", 3);
  1116 |   await page.getByTestId("workspace.memory-disclosure.why-was-this-used").click();
  1117 |   await reconcileRuntime(page, "memory-sources-open-and-unavailable", 4);
  1118 |   await page.getByTestId("workspace.memory-disclosure.don-apos-t-use-this-source").click();
  1119 |   await reconcileRuntime(page, "memory-sources-open-and-unavailable", 5);
  1120 |   await expect(page.getByTestId("workspace.memory-disclosure.exclude")).toBeVisible();
  1121 |   await reconcileRuntime(page, "memory-sources-open-and-unavailable", 6);
  1122 |   await page.getByTestId("workspace.memory-disclosure.cancel").click();
  1123 |   await reconcileRuntime(page, "memory-sources-open-and-unavailable", 7);
```