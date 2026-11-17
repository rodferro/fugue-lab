// Minimal Node typings for the CLI, so the repo stays free of @types/node
// (tsconfig sets "types": []). Delete this file if @types/node is ever added.
declare const process: {
  argv: string[];
  exitCode: number | undefined;
  stdin: { setEncoding(encoding: 'utf8'): void; [Symbol.asyncIterator](): AsyncIterator<string> };
  stdout: { write(s: string): boolean };
  stderr: { write(s: string): boolean };
};

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
}
