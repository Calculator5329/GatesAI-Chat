# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: journeys.generated.spec.ts >> markdown-links-open-workspace-path: A workspace path in a reply hands the file to the OS through the bridge; an external link is hovered but never followed.
- Location: tests/e2e/journeys.generated.spec.ts:991:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('workspace.markdown-chunk.open-workspace-path')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByTestId('workspace.markdown-chunk.open-workspace-path')

```

```yaml
- complementary:
  - button "GatesAI"
  - button "Begin a new conversation":
    - img
    - text: Begin a new conversation
  - text: Pinned
  - button "Screenshot tour planning Rename \"Screenshot tour planning\" Unpin \"Screenshot tour planning\" Delete \"Screenshot tour planning\"":
    - text: Screenshot tour planning
    - button "Rename \"Screenshot tour planning\"":
      - img
    - button "Unpin \"Screenshot tour planning\"":
      - img
    - button "Delete \"Screenshot tour planning\"":
      - img
  - text: Agent tasks
  - button "Audit menu copy starts in ~60m starts in ~60m":
    - text: Audit menu copy
    - img
    - text: starts in ~60m
  - text: Today
  - button "HTML artifact reply Rename \"HTML artifact reply\" Pin \"HTML artifact reply\" Delete \"HTML artifact reply\"":
    - text: HTML artifact reply
    - button "Rename \"HTML artifact reply\"":
      - img
    - button "Pin \"HTML artifact reply\"":
      - img
    - button "Delete \"HTML artifact reply\"":
      - img
  - button "Long conversation"
  - button "Message with attachments"
  - button "Four-turn exchange"
  - button "Grouped terminal activity"
  - button "Memory sources of every kind"
  - button "Image jobs in every state"
  - button "Tool activity example"
  - text: Yesterday
  - button "Usage rollup sample"
  - button "Settings Bridge status. Click to re-poll.":
    - img
    - text: Settings
    - button "Bridge status. Click to re-poll."
- text: You · 07:07 PM
- button "Copy message":
  - img
- button "Edit and resend":
  - img
- button "Branch conversation":
  - img
- paragraph: Write the landing page and tell me where you saved it.
- text: Gemini 3 Flash · 07:07 PM
- button "Copy message":
  - img
- button "Regenerate response":
  - img
- button "Branch conversation":
  - img
- text: "Here is the landing page as a complete document: ``"
- code: html <!doctype html> <html lang="en"> <head><meta charset="utf-8"><title>Preview works</title></head> <body><h1>Preview works</h1><p>Rendered inside a sandboxed frame.</p></body> </html>
- text: "`"
- code: The saved copy lives at
- text: /workspace/site/index.html
- code: ", and the plan is in"
- text: "/workspace/notes/audit-plan.md`. The upstream reference is"
- link "the journey catalog":
  - /url: https://example.test/journeys
- text: .
- button "Attach file" [disabled]:
  - img
- textbox "Continue the thought..."
- button "Send" [disabled]:
  - img
- 'button "Model: Gemini 3 Flash"':
  - text: Gemini 3 Flash
  - img
- 'button "Skill: No skill"':
  - img
  - img
- button "Start deep research" [disabled]:
  - img
  - text: Research
- text: ·
- combobox "Thinking effort":
  - option "thinking fast" [selected]
  - option "thinking balanced"
  - option "thinking deep"
- text: ·
- 'img "Context estimate: 8.3k of 1M (1%) Spent in this chat: $0.0012 ($0.0012 LLM, $0.00 images)"': 8.3k / 1M $0.0012
```

# Test source

```ts
  895  | }) => {
  896  |   await page.goto("/?scenario=rich-transcript#/thread/html");
  897  |   await expect(page.getByTestId("workspace.markdown-chunk.open")).toBeVisible();
  898  |   await reconcileRuntime(page, "code-block-open-and-download", 1);
  899  |   await page.getByTestId("workspace.markdown-chunk.open").click();
  900  |   await reconcileRuntime(page, "code-block-open-and-download", 2);
  901  |   await expect(page.getByTestId("workspace.markdown-chunk.download")).toBeVisible();
  902  |   await reconcileRuntime(page, "code-block-open-and-download", 3);
  903  |   await page.getByTestId("workspace.markdown-chunk.download").click();
  904  |   await reconcileRuntime(page, "code-block-open-and-download", 4);
  905  |   await expect(page.getByTestId("workspace.composer.draft")).toBeVisible();
  906  |   await reconcileRuntime(page, "code-block-open-and-download", 5);
  907  |   await recordFinalPageState(page, "code-block-open-and-download");
  908  | });
  909  | 
  910  | test("html-artifact-view-fullscreen: The inline artifact card enables View once the bridge has read the file; the full-screen viewer offers Open in OS and Close.", async ({
  911  |   page,
  912  | }) => {
  913  |   await page.goto("/?scenario=rich-transcript#/thread/html");
  914  |   await expect(page.getByTestId("workspace.html-artifact-preview.html-artifact-preview")).toBeVisible();
  915  |   await reconcileRuntime(page, "html-artifact-view-fullscreen", 1);
  916  |   await expect(page.getByTestId("workspace.html-artifact-preview.view")).toBeEnabled({ timeout: 30000 });
  917  |   await reconcileRuntime(page, "html-artifact-view-fullscreen", 2);
  918  |   await page.getByTestId("workspace.html-artifact-preview.view").click();
  919  |   await reconcileRuntime(page, "html-artifact-view-fullscreen", 3);
  920  |   await expect(page.getByTestId("workspace.html-artifact-preview.close-html-preview")).toBeVisible();
  921  |   await reconcileRuntime(page, "html-artifact-view-fullscreen", 4);
  922  |   await page.getByTestId("workspace.html-artifact-preview.fullscreen-open-in-os").click();
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
> 995  |   await expect(page.getByTestId("workspace.markdown-chunk.open-workspace-path")).toBeVisible();
       |                                                                                  ^ Error: expect(locator).toBeVisible() failed
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
  1023 |   await expect(page.getByTestId("workspace.editorial-chat.show")).toBeVisible();
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
```