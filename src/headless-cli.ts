#!/usr/bin/env -S npx vite-node
// Executable adapter for src/headless.ts. Keep process wiring out of the reusable core entry.
import { runHeadlessCli } from './headless';

interface NodeProcessFacade {
  argv: string[];
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  exitCode?: number;
}

const processFacade = (globalThis as typeof globalThis & { process?: NodeProcessFacade }).process;
if (!processFacade) throw new Error('The headless CLI requires Node.js.');

void runHeadlessCli(processFacade.argv.slice(2), processFacade)
  .then(exitCode => { processFacade.exitCode = exitCode; });
