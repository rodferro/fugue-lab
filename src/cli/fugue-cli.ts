// fugue-cli: the engine as a JSON-in, JSON-out command line, for scripts and
// the research harness. Run with `npm run cli -- <command> [file] [--jsonl]`.
//
//   generate  {subject, settings?, midi?, bpm?, report?}   exposition + report summary
//   report    {voices, ticksPerBeat?, meter? | beatsPerBar?, strongEvery?, classify?, suspensions?, key? | keys?}
//   answer    {subject, key?, type?, mutation?}
//
// Notes are {pitch (MIDI), start, dur} in integer ticks; generate works on the
// 16th grid (4 ticks per quarter) unless settings.ticksPerQuarter says otherwise
// (8 for 32nds, 12 for 16th triplets, 24 for both). Meters are "4/4", "3/4",
// "6/8", ...; x/8 meters are compound, with strong beats on dotted quarters. Input comes from [file], or stdin when it is
// omitted or "-". With --jsonl every input line is one request and every
// output line one response ({"error": ...} for a failed line), so a whole
// corpus can go through one process.
import { readFileSync, writeFileSync } from 'node:fs';
import { COMMANDS, CommandResult } from './commands';

const USAGE = 'usage: fugue-cli <generate|report|answer> [file|-] [--jsonl] [--pretty]';

function run(cmd: (req: unknown) => CommandResult, text: string): unknown {
  const res = cmd(JSON.parse(text));
  for (const f of res.files) writeFileSync(f.path, f.data);
  return res.json;
}

// One synchronous read of a pipe can fail with EAGAIN or stop short on large
// inputs, so stdin is read as a stream.
async function readStdin(): Promise<string> {
  process.stdin.setEncoding('utf8');
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function main(argv: string[]): Promise<number> {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const [name, file] = argv.filter((a) => !a.startsWith('--'));
  const cmd = name ? COMMANDS[name] : undefined;
  if (!cmd) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const input = !file || file === '-' ? await readStdin() : readFileSync(file, 'utf8');
  if (flags.has('--jsonl')) {
    let failed = 0;
    for (const line of input.split('\n')) {
      if (!line.trim()) continue;
      try {
        process.stdout.write(`${JSON.stringify(run(cmd, line))}\n`);
      } catch (e) {
        failed++;
        process.stdout.write(`${JSON.stringify({ error: (e as Error).message })}\n`);
      }
    }
    return failed ? 1 : 0;
  }
  try {
    process.stdout.write(`${JSON.stringify(run(cmd, input), null, flags.has('--pretty') ? 2 : undefined)}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`fugue-cli ${name}: ${(e as Error).message}\n`);
    return 1;
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
