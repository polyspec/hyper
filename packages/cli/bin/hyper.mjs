#!/usr/bin/env node
// The command tool of the region protocol (HR-96): `hyper build` and `hyper check`. A caller relies on the bin, its
// arguments and its exit code only: 0 for success, 2 for a usage error, an unknown subcommand or an unknown option,
// and 1 for every other failure, whose message goes to stderr.
//
// Usage: hyper build --app <directory> --output <directory> [--api <base path>] [--asset <name>=<path>]...
//          [--tailwind <source>=<name>]... [--static <path below public/>]... [--php-namespace <namespace>]
//        hyper check --app <directory>

import { runBuild } from '../lib/build.mjs';
import { checkApplication } from '../lib/check.mjs';
import { buildOptions, checkOptions, UsageError } from '../lib/options.mjs';

const USAGE = [
  'usage: hyper build --app <directory> --output <directory> [--api <base path>] [--asset <name>=<path>]...',
  '         [--tailwind <source>=<name>]... [--static <path below public/>]... [--php-namespace <namespace>]',
  '       hyper check --app <directory>',
].join('\n');

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'build') {
    for (const line of await runBuild(buildOptions(args))) process.stdout.write(`${line}\n`);
  } else if (command === 'check') {
    const { problems, templates } = checkApplication(checkOptions(args).app);
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    process.stdout.write(`${templates} templates, ${problems.length} problem(s)\n`);
    if (problems.length > 0) process.exitCode = 1;
  } else {
    throw new UsageError(command === undefined ? 'a subcommand is required' : `unknown subcommand ${command}`);
  }
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`hyper: ${error.message}\n${USAGE}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`hyper: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
