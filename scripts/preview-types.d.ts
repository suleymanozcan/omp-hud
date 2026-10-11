// Node module typings for the preview scripts (written by hand because tsconfig has types: []).
declare module "node:fs" {
  export function writeFileSync(path: string, data: string): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}
declare module "node:path" {
  export function dirname(path: string): string;
  export function resolve(...paths: string[]): string;
}
