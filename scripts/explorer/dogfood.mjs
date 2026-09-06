// Real desktop build, fictional dev scenarios, Explorer action receipts and captures.
// Run with a dev server on PORT and APP_EXPLORER_ROOT pointing at Explorer.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd(),
  explorer = process.env.APP_EXPLORER_ROOT ?? path.resolve(root, '../app-explorer');
const load = p => import(pathToFileURL(path.join(explorer, p)).href);
const {
    PageHost
  } = await load('src/host/index.mjs'),
  {
    DriveClient
  } = await load('src/drive/index.mjs'),
  {
    runStep
  } = await load('src/engine/step.mjs'),
  {
    loadConfig
  } = await load('src/config/index.mjs');
const out = process.env.EXPLORER_REPORT_DIR ?? path.join(root, '.explorer', 'dogfood', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(out, {
  recursive: true
});
const config = await loadConfig(root);
config.capture.adaptive = {
  enabled: true,
  intervalMs: 250,
  maxFrames: 80,
  maxDurationMs: 30000
};
config.budget.settleMs = 50;
const report = {
  schema: 'gatesai-chat/explorer-dogfood/v1',
  startedAt: Date.now(),
  fixture: 'built-in fictional desktop dev scenarios; unmatched external traffic aborted',
  seededFault: process.env.EXPLORER_STALL === '1' ? 'stalled-response-after-first-chunk' : null,
  cases: []
};
const draft = 'workspace.composer.draft',
  send = 'workspace.composer-input.composer-send-control';
async function scenario(name, scenarioName, body) {
  if (process.env.EXPLORER_CASE && process.env.EXPLORER_CASE !== name) return;
  const dir = path.join(out, name),
    row = {
      name,
      scenario: scenarioName,
      steps: [],
      status: 'incomplete'
    };
  report.cases.push(row);
  const host = await new PageHost({
    baseUrl: `http://127.0.0.1:${process.env.PORT ?? 8860}`
  }).start();
  host.page.setDefaultTimeout(10000);
  await host.page.route('**/*', route => new URL(route.request().url()).origin === host.baseUrl ? route.continue() : route.abort());
  const drive = new DriveClient(host.baseUrl);
  host.attachDrive(drive);
  let index = 0;
  const act = async (step, custom) => {
    const result = await runStep({
      host,
      drive: custom ? {
        command: async () => {
          await custom();
          return {
            ok: true,
            executor: 'playwright-goal',
            command: step,
            at: new Date().toISOString()
          };
        }
      } : drive,
      config,
      step,
      dir: path.join(dir, String(index++).padStart(3, '0'))
    });
    row.steps.push({
      step,
      ok: result.receipt.ok,
      evidence: result.evidence,
      route: host.page.url()
    });
    if (!result.receipt.ok) throw Error(result.receipt.detail);
    return result;
  };
  const goal = (name, fn) => act({
    action: 'expect',
    testId: send,
    predicate: name
  }, fn);
  try {
    await host.goto(`/?scenario=${scenarioName}`);
    await host.page.getByTestId(draft).waitFor();
    await host.page.waitForFunction(() => window.__gatesaiScenario?.sentinel === 'GATESAI_DEV_SCENARIO_LAYER' && window.__gatesaiScenario.ready);
    await body({
      host,
      act,
      goal
    });
    row.status = 'passed';
  } catch (error) {
    row.status = 'failed';
    row.error = String(error);
    await host.screenshot(path.join(dir, 'failure.png'));
  } finally {
    row.calls = await host.page.evaluate(() => window.__gatesaiScenario?.calls ?? []).catch(() => []);
    row.finishedAt = Date.now();
    await host.stop();
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
}
const sendPrompt = async act => {
  await act({
    action: 'fill',
    testId: draft,
    value: 'FICTIONAL Explorer probe'
  });
  await act({
    action: 'click',
    testId: send
  });
};
await scenario('stream-completion', 'slow-stream', async ({
  host,
  act
}) => {
  if (process.env.EXPLORER_STALL === '1') await host.page.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (!String(args[0]).includes('/chat/completions')) return response;
      const reader = response.body.getReader();
      return new Response(new ReadableStream({
        async start(controller) {
          const first = await reader.read();
          controller.enqueue(first.value);
        },
        cancel() {
          return reader.cancel();
        }
      }), {
        headers: response.headers
      });
    };
  });
  await sendPrompt(act);
  const progressId = await host.page.locator('[data-testid^="workspace.editorial-message.message-"]').last().getAttribute('data-testid');
  await act({
    action: 'expect',
    testId: send,
    predicate: 'disabled',
    timing: {
      timeoutMs: 40000,
      stableMs: 300,
      pollMs: 150,
      progress: {
        testId: progressId,
        selector: '.md-body',
        stallMs: 3000
      }
    }
  });
});
await scenario('cancel-stream', 'slow-stream', async ({
  host,
  act,
  goal
}) => {
  await sendPrompt(act);
  await act({
    action: 'click',
    testId: send
  });
  await goal('cancel stops later tokens', async () => {
    await host.page.getByRole('button', {
      name: 'Stop',
      exact: true
    }).waitFor({
      state: 'hidden'
    });
    const before = await host.page.locator('.md-body').last().innerText();
    await host.page.waitForTimeout(1500);
    if ((await host.page.locator('.md-body').last().innerText()) !== before) throw Error('Cancelled reply continued changing');
  });
});
await scenario('thread-switch', 'slow-stream', async ({
  host,
  act,
  goal
}) => {
  await sendPrompt(act);
  const oldURL = host.page.url();
  await act({
    action: 'click',
    testId: 'workspace.editorial-sidebar.begin-a-new-conversation'
  });
  await goal('background reply remains in its thread', async () => {
    if (host.page.url() === oldURL) throw Error('Thread did not change');
    if (await host.page.locator('.md-body').count()) throw Error('Old response leaked into new thread');
    await host.page.waitForTimeout(1500);
    if (await host.page.locator('.md-body').count()) throw Error('Late response leaked');
  });
});
await scenario('edit-resend', 'desktop-ready', async ({
  host,
  act,
  goal
}) => {
  await sendPrompt(act);
  await host.page.getByRole('button', {
    name: 'Stop',
    exact: true
  }).waitFor({
    state: 'hidden'
  });
  const edit = host.page.getByRole('button', {
    name: 'Edit and resend',
    exact: true
  }).last();
  const id = await edit.getAttribute('data-testid');
  await act({
    action: 'click',
    testId: id
  });
  const input = host.page.getByRole('textbox', {
    name: 'Edited message'
  });
  await act({
    action: 'fill',
    testId: await input.getAttribute('data-testid'),
    value: 'FICTIONAL revised prompt'
  });
  await act({
    action: 'click',
    testId: await host.page.getByRole('button', {
      name: 'Save & resend',
      exact: true
    }).getAttribute('data-testid')
  });
  const confirm = host.page.locator('[data-testid*="edit-confirm-save-"]');
  if (await confirm.count()) await act({
    action: 'click',
    testId: await confirm.getAttribute('data-testid')
  });
  await goal('revised prompt produces a new completion', async () => {
    await host.page.getByRole('button', {
      name: 'Stop',
      exact: true
    }).waitFor({
      state: 'hidden'
    });
    if (!(await host.page.getByText('FICTIONAL revised prompt', {
      exact: true
    }).count())) throw Error('Edited prompt absent');
  });
});
for (const offline of [false, true]) await scenario(offline ? 'offline-recovery' : 'provider-recovery', 'desktop-ready', async ({
  host,
  act,
  goal
}) => {
  await host.page.evaluate(offline => {
    const original = window.fetch;
    let fail = true;
    window.fetch = async (...args) => {
      if (String(args[0]).includes('/chat/completions') && fail) {
        if (offline) throw new TypeError('FICTIONAL offline network');
        return new Response(JSON.stringify({
          error: {
            message: 'FICTIONAL connection rejected'
          }
        }), {
          status: 400,
          headers: {
            'content-type': 'application/json'
          }
        });
      }
      return original(...args);
    };
    window.__explorerRecover = () => {
      fail = false;
    };
  }, offline);
  await sendPrompt(act);
  await goal('provider failure is visible', () => host.page.locator('.chat-error-banner').waitFor({
    timeout: 40000
  }));
  await host.page.evaluate(() => window.__explorerRecover());
  await sendPrompt(act);
  await goal('recovered provider completes and clears stale error', async () => {
    await host.page.getByRole('button', {
      name: 'Stop',
      exact: true
    }).waitFor({
      state: 'hidden'
    });
    await host.page.locator('.chat-error-banner').waitFor({
      state: 'hidden'
    });
    if (!(await host.page.locator('.md-body', {
      hasText: 'The mocked OpenRouter stream answered this turn.'
    }).count())) throw Error('Recovery reply absent');
  });
});
report.finishedAt = Date.now();
report.passed = report.cases.filter(c => c.status === 'passed').length;
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
await fs.writeFile(path.join(out, 'review.html'), `<!doctype html><meta charset="utf-8"><title>Chat Explorer dogfood</title><style>body{font:16px system-ui;background:#101815;color:#edf4ee;max-width:1000px;margin:40px auto}article{padding:20px;border:1px solid #40564a;margin:20px 0}img{max-width:100%}a{color:#96dfa8}summary{cursor:pointer}code{white-space:pre-wrap}</style><h1>GatesAI Chat · Explorer dogfood</h1><p>${report.passed}/${report.cases.length} goals passed. Fictional desktop scenarios; external traffic blocked. Each action includes actual Explorer timed frames and receipts.</p>${report.cases.map(c => `<article><h2>${esc(c.name)} · ${c.status}</h2>${c.error ? `<p>${esc(c.error)}</p>` : ''}${c.steps.map(s => `<details><summary>${esc(s.step.action + ' ' + (s.step.predicate ?? s.step.testId))}</summary><p>Route: ${esc(s.route)}</p><a href="${path.relative(out, s.evidence.step)}">Action receipt</a> · <a href="${path.relative(out, s.evidence.timeline)}">Measured timeline</a>${(s.evidence.burst ?? []).map(f => `<img loading="lazy" src="${path.relative(out, f)}">`).join('')}</details>`).join('')}</article>`).join('')}<a href="report.json">Machine report</a>`);
console.log(JSON.stringify({
  out,
  passed: report.passed,
  total: report.cases.length,
  cases: report.cases.map(({
    name,
    status,
    error
  }) => ({
    name,
    status,
    error
  }))
}));
process.exitCode = report.passed === report.cases.length ? 0 : 1;
