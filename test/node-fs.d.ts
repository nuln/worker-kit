/**
 * 测试期的最小 Node 内置模块声明。
 *
 * 本项目 tsconfig 只引入 `@cloudflare/workers-types`（不含 node 类型），
 * 这是刻意的：Worker 运行时的类型面不应被 Node 全局污染。
 *
 * 但测试需要在**测试进程**中读取源码、遍历目录树 —— 用于校验 `exports` map
 * 与环境变量访问扫描结果。此处只声明实际用到的那几个函数，避免为一个测试
 * 引入 `@types/node`，也避免使用 `@ts-ignore` / `@ts-expect-error` 掩盖
 * 类型错误（AGENTS §4.3）。
 */
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean };
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  /** 取路径的父目录（解析相对 import 目标时需要） */
  export function dirname(p: string): string;
  /** 规范化路径片段（消除 `..`） */
  export function normalize(p: string): string;
}

declare module "node:module" {
  /**
   * 同步创建 require。
   *
   * 存在的原因：`node:sqlite` 没有可用的 ambient 声明，而 `import` 形式必须
   * 在编译期解析模块 —— 只能退回运行时加载。用于同步读取真实 SQLite 的
   * 类型比较语义（LWW 守卫回归测试）。
   */
  export function createRequire(path: string | URL): (id: string) => unknown;
}

declare module "node:sqlite" {
  /** 同步执行的预处理语句结果。 */
  export interface StatementSync {
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    all(...args: unknown[]): unknown[];
  }
  /** 同步 SQLite 句柄；仅声明测试实际用到的成员。 */
  export class DatabaseSync {
    constructor(location: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
