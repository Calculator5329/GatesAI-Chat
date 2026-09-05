# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: journeys.generated.spec.ts >> aurora-reply-footer: The suggested follow-up sends as the next message; the source chip then opens the Agent tab of the menu, where recall sources live.
- Location: tests/e2e/journeys.generated.spec.ts:1284:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('workspace.aurora-aurora-reply-footer.aurora-chip-muted')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByTestId('workspace.aurora-aurora-reply-footer.aurora-chip-muted')

```

# Test source

```ts
  1188 |   await reconcileRuntime(page, "image-lightbox-navigation", 9);
  1189 |   await page.getByTestId("app.lightbox.close").click();
  1190 |   await reconcileRuntime(page, "image-lightbox-navigation", 10);
  1191 |   await expect(page.getByTestId("workspace.composer.draft")).toBeVisible();
  1192 |   await reconcileRuntime(page, "image-lightbox-navigation", 11);
  1193 |   await recordFinalPageState(page, "image-lightbox-navigation");
  1194 | });
  1195 | 
  1196 | test("image-job-retry-failed-and-cancelled: Failed and cancelled image jobs keep Retry; Copy error copies the failure and a retried job can be cancelled while it is still pending.", async ({
  1197 |   page,
  1198 | }) => {
  1199 |   await page.goto("/?scenario=rich-transcript#/thread/images");
  1200 |   await expect(page.getByTestId("workspace.image-job-card.retry")).toBeVisible();
  1201 |   await reconcileRuntime(page, "image-job-retry-failed-and-cancelled", 1);
  1202 |   await page.getByTestId("workspace.image-job-card.action").click();
  1203 |   await reconcileRuntime(page, "image-job-retry-failed-and-cancelled", 2);
  1204 |   await page.getByTestId("workspace.image-job-card.retry-cancelled").click();
  1205 |   await reconcileRuntime(page, "image-job-retry-failed-and-cancelled", 3);
  1206 |   await page.getByTestId("workspace.image-job-card.retry").click();
  1207 |   await reconcileRuntime(page, "image-job-retry-failed-and-cancelled", 4);
  1208 |   await expect(page.getByTestId("workspace.image-job-card.cancel-pending-img-failed")).toBeVisible({ timeout: 20000 });
  1209 |   await reconcileRuntime(page, "image-job-retry-failed-and-cancelled", 5);
  1210 |   await page.getByTestId("workspace.image-job-card.cancel-pending-img-failed").click();
  1211 |   await reconcileRuntime(page, "image-job-retry-failed-and-cancelled", 6);
  1212 |   await expect(page.getByTestId("workspace.image-job-card.retry-cancelled")).toBeVisible();
  1213 |   await reconcileRuntime(page, "image-job-retry-failed-and-cancelled", 7);
  1214 |   await recordFinalPageState(page, "image-job-retry-failed-and-cancelled");
  1215 | });
  1216 | 
  1217 | test("activity-rows-toggle: Each image job row on the thread can be expanded and collapsed.", async ({ page }) => {
  1218 |   await page.goto("/?scenario=rich-transcript#/thread/images");
  1219 |   await page.getByTestId("workspace.activity-row.toggle-call-img-tour:0").click();
  1220 |   await reconcileRuntime(page, "activity-rows-toggle", 1);
  1221 |   await page.getByTestId("workspace.activity-row.toggle-call-img-failed:1").click();
  1222 |   await reconcileRuntime(page, "activity-rows-toggle", 2);
  1223 |   await page.getByTestId("workspace.activity-row.toggle-call-img-cancelled:2").click();
  1224 |   await reconcileRuntime(page, "activity-rows-toggle", 3);
  1225 |   await page.getByTestId("workspace.activity-row.toggle-call-img-tour:0").click();
  1226 |   await reconcileRuntime(page, "activity-rows-toggle", 4);
  1227 |   await recordFinalPageState(page, "activity-rows-toggle");
  1228 | });
  1229 | 
  1230 | test("aurora-activity-stream-diff: In the Aurora pack the reply folds its work behind chips; expanding shows the work note and the edit call with its diff card.", async ({
  1231 |   page,
  1232 | }) => {
  1233 |   await page.goto("/?scenario=aurora-pack#/thread/aurora-active");
  1234 |   await expect(page.getByTestId("workspace.aurora-aurora-activity-stream.chips")).toBeVisible();
  1235 |   await reconcileRuntime(page, "aurora-activity-stream-diff", 1);
  1236 |   await page.getByTestId("workspace.aurora-aurora-activity-stream.chips").click();
  1237 |   await reconcileRuntime(page, "aurora-activity-stream-diff", 2);
  1238 |   await expect(page.getByTestId("workspace.aurora-aurora-activity-stream.head-aurora-assistant:work-note:0")).toBeVisible();
  1239 |   await reconcileRuntime(page, "aurora-activity-stream-diff", 3);
  1240 |   await page.getByTestId("workspace.aurora-aurora-activity-stream.head-aurora-assistant:work-note:0").click();
  1241 |   await reconcileRuntime(page, "aurora-activity-stream-diff", 4);
  1242 |   await page.getByTestId("workspace.aurora-aurora-activity-stream.head-call-edit:0").click();
  1243 |   await reconcileRuntime(page, "aurora-activity-stream-diff", 5);
  1244 |   await expect(page.getByTestId("workspace.aurora.diff-card")).toBeVisible();
  1245 |   await reconcileRuntime(page, "aurora-activity-stream-diff", 6);
  1246 |   await page.getByTestId("workspace.aurora-diff-card.show").click();
  1247 |   await reconcileRuntime(page, "aurora-activity-stream-diff", 7);
  1248 |   await page.getByTestId("workspace.aurora-aurora-activity-stream.chips").click();
  1249 |   await reconcileRuntime(page, "aurora-activity-stream-diff", 8);
  1250 |   await recordFinalPageState(page, "aurora-activity-stream-diff");
  1251 | });
  1252 | 
  1253 | test("aurora-fine-tune-render: The cover render exposes a fine-tune card: adjust images, size and seed, reset, then render again.", async ({
  1254 |   page,
  1255 | }) => {
  1256 |   await page.goto("/?scenario=aurora-pack#/thread/aurora-active");
  1257 |   await page.getByTestId("workspace.aurora-aurora-activity-stream.chips").click();
  1258 |   await reconcileRuntime(page, "aurora-fine-tune-render", 1);
  1259 |   await page.getByTestId("workspace.aurora-aurora-activity-stream.head-call-cover:1").click();
  1260 |   await reconcileRuntime(page, "aurora-fine-tune-render", 2);
  1261 |   await expect(page.getByTestId("workspace.image-job.fine-tune")).toBeVisible();
  1262 |   await reconcileRuntime(page, "aurora-fine-tune-render", 3);
  1263 |   await page.getByTestId("workspace.aurora-fine-tune-card.toggle").click();
  1264 |   await reconcileRuntime(page, "aurora-fine-tune-render", 4);
  1265 |   await expect(page.getByTestId("workspace.aurora-fine-tune-card.number-input-images")).toBeVisible();
  1266 |   await reconcileRuntime(page, "aurora-fine-tune-render", 5);
  1267 |   await page.getByTestId("workspace.aurora-fine-tune-card.number-input-images").fill("2");
  1268 |   await reconcileRuntime(page, "aurora-fine-tune-render", 6);
  1269 |   await page.getByTestId("workspace.aurora-fine-tune-card.number-input-width").fill("768");
  1270 |   await reconcileRuntime(page, "aurora-fine-tune-render", 7);
  1271 |   await page.getByTestId("workspace.aurora-fine-tune-card.number-input-height").fill("768");
  1272 |   await reconcileRuntime(page, "aurora-fine-tune-render", 8);
  1273 |   await page.getByTestId("workspace.aurora-fine-tune-card.number-input-seed").fill("7");
  1274 |   await reconcileRuntime(page, "aurora-fine-tune-render", 9);
  1275 |   await page.getByTestId("workspace.aurora-fine-tune-card.reset").click();
  1276 |   await reconcileRuntime(page, "aurora-fine-tune-render", 10);
  1277 |   await page.getByTestId("workspace.aurora-fine-tune-card.render-again").click();
  1278 |   await reconcileRuntime(page, "aurora-fine-tune-render", 11);
  1279 |   await expect(page.getByTestId("workspace.composer.draft")).toBeVisible();
  1280 |   await reconcileRuntime(page, "aurora-fine-tune-render", 12);
  1281 |   await recordFinalPageState(page, "aurora-fine-tune-render");
  1282 | });
  1283 | 
  1284 | test("aurora-reply-footer: The suggested follow-up sends as the next message; the source chip then opens the Agent tab of the menu, where recall sources live.", async ({
  1285 |   page,
  1286 | }) => {
  1287 |   await page.goto("/?scenario=aurora-pack#/thread/aurora-active");
> 1288 |   await expect(page.getByTestId("workspace.aurora-aurora-reply-footer.aurora-chip-muted")).toBeVisible();
       |                                                                                            ^ Error: expect(locator).toBeVisible() failed
  1289 |   await reconcileRuntime(page, "aurora-reply-footer", 1);
  1290 |   await page.getByTestId("workspace.aurora-aurora-reply-footer.aurora-followup-0").click();
  1291 |   await reconcileRuntime(page, "aurora-reply-footer", 2);
  1292 |   await expect(page.getByTestId("workspace.editorial-chat.stream")).toContainText("Want me to run the full suite next?", { timeout: 20000 });
  1293 |   await reconcileRuntime(page, "aurora-reply-footer", 3);
  1294 |   await page.getByTestId("workspace.aurora-aurora-reply-footer.aurora-chip-muted").click();
  1295 |   await reconcileRuntime(page, "aurora-reply-footer", 4);
  1296 |   await expect(page.getByTestId("settings.gates-menu.tab-agent")).toBeVisible();
  1297 |   await reconcileRuntime(page, "aurora-reply-footer", 5);
  1298 |   await recordFinalPageState(page, "aurora-reply-footer");
  1299 | });
  1300 | 
  1301 | test("prompt-cards-answer-each-way: Three pending prompts: pick an option, write a free answer and send it, and skip the last.", async ({
  1302 |   page,
  1303 | }) => {
  1304 |   await page.goto("/?scenario=prompt-cards#/workspace");
  1305 |   await expect(page.getByTestId("workspace.prompt-card.container")).toBeVisible();
  1306 |   await reconcileRuntime(page, "prompt-cards-answer-each-way", 1);
  1307 |   await page.getByTestId("workspace.prompt-cards.option-prompt-approve-yes").click();
  1308 |   await reconcileRuntime(page, "prompt-cards-answer-each-way", 2);
  1309 |   await page.getByTestId("workspace.prompt-cards.free-prompt-recommend").click();
  1310 |   await reconcileRuntime(page, "prompt-cards-answer-each-way", 3);
  1311 |   await page.getByTestId("workspace.prompt-cards.answer-prompt-recommend").fill("Use the audit plan first.");
  1312 |   await reconcileRuntime(page, "prompt-cards-answer-each-way", 4);
  1313 |   await expect(page.getByTestId("workspace.prompt-cards.send-prompt-recommend")).toBeEnabled();
  1314 |   await reconcileRuntime(page, "prompt-cards-answer-each-way", 5);
  1315 |   await page.getByTestId("workspace.prompt-cards.send-prompt-recommend").click();
  1316 |   await reconcileRuntime(page, "prompt-cards-answer-each-way", 6);
  1317 |   await page.getByTestId("workspace.prompt-cards.skip-prompt-skip").click();
  1318 |   await reconcileRuntime(page, "prompt-cards-answer-each-way", 7);
  1319 |   await expect(page.getByTestId("workspace.composer.draft")).toBeVisible();
  1320 |   await reconcileRuntime(page, "prompt-cards-answer-each-way", 8);
  1321 |   await recordFinalPageState(page, "prompt-cards-answer-each-way");
  1322 | });
  1323 | 
  1324 | test("prompt-cards-skip-and-option: Skip the approval prompt outright and answer the recommendation with one of its options.", async ({
  1325 |   page,
  1326 | }) => {
  1327 |   await page.goto("/?scenario=prompt-cards#/workspace");
  1328 |   await page.getByTestId("workspace.prompt-cards.skip-prompt-approve").click();
  1329 |   await reconcileRuntime(page, "prompt-cards-skip-and-option", 1);
  1330 |   await page.getByTestId("workspace.prompt-cards.option-prompt-recommend-audit").click();
  1331 |   await reconcileRuntime(page, "prompt-cards-skip-and-option", 2);
  1332 |   await expect(page.getByTestId("workspace.prompt-card.container")).toBeVisible();
  1333 |   await reconcileRuntime(page, "prompt-cards-skip-and-option", 3);
  1334 |   await recordFinalPageState(page, "prompt-cards-skip-and-option");
  1335 | });
  1336 | 
  1337 | test("command-palette-empty-and-backdrop: A query nothing matches shows the empty row; clicking the backdrop closes the palette.", async ({
  1338 |   page,
  1339 | }) => {
  1340 |   await page.goto("/?scenario=desktop-ready#/workspace");
  1341 |   await page.getByTestId("workspace.composer.draft").click();
  1342 |   await reconcileRuntime(page, "command-palette-empty-and-backdrop", 1);
  1343 |   await page.getByTestId("workspace.composer.draft").press("Control+k");
  1344 |   await reconcileRuntime(page, "command-palette-empty-and-backdrop", 2);
  1345 |   await expect(page.getByTestId("app.command-palette.search-commands-and-threads")).toBeVisible();
  1346 |   await reconcileRuntime(page, "command-palette-empty-and-backdrop", 3);
  1347 |   await expect(page.getByTestId("app.command-palette.command-palette")).toBeVisible();
  1348 |   await reconcileRuntime(page, "command-palette-empty-and-backdrop", 4);
  1349 |   await page.getByTestId("app.command-palette.search-commands-and-threads").fill("zzzz nothing matches");
  1350 |   await reconcileRuntime(page, "command-palette-empty-and-backdrop", 5);
  1351 |   await expect(page.getByTestId("app.command-palette.empty-classic")).toBeVisible();
  1352 |   await reconcileRuntime(page, "command-palette-empty-and-backdrop", 6);
  1353 |   await page.getByTestId("app.command-palette.backdrop").click();
  1354 |   await reconcileRuntime(page, "command-palette-empty-and-backdrop", 7);
  1355 |   await expect(page.getByTestId("workspace.composer.draft")).toBeVisible();
  1356 |   await reconcileRuntime(page, "command-palette-empty-and-backdrop", 8);
  1357 |   await recordFinalPageState(page, "command-palette-empty-and-backdrop");
  1358 | });
  1359 | 
  1360 | test("aurora-command-palette-empty: In the Aurora pack, a query that matches nothing shows the empty state that names the query, and the backdrop closes the palette.", async ({
  1361 |   page,
  1362 | }) => {
  1363 |   await page.goto("/?scenario=aurora-pack#/workspace");
  1364 |   await page.getByTestId("workspace.composer.draft").click();
  1365 |   await reconcileRuntime(page, "aurora-command-palette-empty", 1);
  1366 |   await page.getByTestId("workspace.composer.draft").press("Control+k");
  1367 |   await reconcileRuntime(page, "aurora-command-palette-empty", 2);
  1368 |   await expect(page.getByTestId("app.command-palette.search-commands-and-threads")).toBeVisible();
  1369 |   await reconcileRuntime(page, "aurora-command-palette-empty", 3);
  1370 |   await expect(page.getByTestId("app.command-palette.command-palette")).toBeVisible();
  1371 |   await reconcileRuntime(page, "aurora-command-palette-empty", 4);
  1372 |   await page.getByTestId("app.command-palette.search-commands-and-threads").fill("zzzz nothing matches");
  1373 |   await reconcileRuntime(page, "aurora-command-palette-empty", 5);
  1374 |   await expect(page.getByTestId("app.command-palette.empty")).toBeVisible();
  1375 |   await reconcileRuntime(page, "aurora-command-palette-empty", 6);
  1376 |   await page.getByTestId("app.command-palette.backdrop").click();
  1377 |   await reconcileRuntime(page, "aurora-command-palette-empty", 7);
  1378 |   await expect(page.getByTestId("workspace.composer.draft")).toBeVisible();
  1379 |   await reconcileRuntime(page, "aurora-command-palette-empty", 8);
  1380 |   await recordFinalPageState(page, "aurora-command-palette-empty");
  1381 | });
  1382 | 
  1383 | test("update-pill-install-and-dismiss: With an update staged the pill offers install; dismiss hides the notice.", async ({ page }) => {
  1384 |   await page.goto("/?scenario=update-available#/workspace");
  1385 |   await expect(page.getByTestId("workspace.update-pill.on-click")).toBeVisible();
  1386 |   await reconcileRuntime(page, "update-pill-install-and-dismiss", 1);
  1387 |   await page.getByTestId("workspace.update-pill.on-click").click();
  1388 |   await reconcileRuntime(page, "update-pill-install-and-dismiss", 2);
```