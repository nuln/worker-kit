/**
 * @nuln/worker-kit/test/setup — Vitest 全局 Setup / Teardown
 *
 * 依据 AGENTS §9 的测试套件分类规范设立。当前承担两件事：
 *
 * 1. **网络兜底**：任何未被 stub 的 `fetch` 一律拒绝并让用例失败。
 *    原因：Worker 代码里大量逻辑走 `fetch`，一旦某个用例忘了 stub，
 *    测试会静默发出真实网络请求 —— 在 CI 上表现为「偶尔变慢」或
 *    「依赖外网可用性」的玄学失败，而且失败原因与被测逻辑无关。
 *    显式兜底能让这类疏漏立刻暴露成清晰的错误信息。
 *
 * 2. **计时器泄漏检测**：未恢复的 fake timers 会让后续用例读到冻结的时间，
 *    表现为「单跑通过、全量跑失败」。这里不做拦截（成本高），但提供了
 *    `restoreFakeTimersIfNeeded()` 供需要时调用。
 */

/** 记录是否已安装兜底，避免重复包装。 */
let installed = false;

/** 允许真实出网的用例可通过该标记临时豁免（当前无用例需要）。 */
const ALLOW_FLAG = "__ALLOW_REAL_FETCH__";

export function setup(): void {
  if (installed) return;
  installed = true;

  const original = globalThis.fetch;

  globalThis.fetch = ((input: any, init?: any) => {
    const g = globalThis as unknown as Record<string, unknown>;
    if (g[ALLOW_FLAG]) return original(input, init);
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    return Promise.reject(
      new Error(
        `测试中出现未 stub 的真实网络请求：${url}\n` +
          `请在该用例中 stub globalThis.fetch（参考 test/integration/notify-drivers-branches.test.ts）。` +
          `如确实需要放行，请设置 globalThis.${ALLOW_FLAG} = true。`,
      ),
    );
  }) as unknown as typeof fetch;
}

export function teardown(): void {
  // 兜底安装在 setup 中，vitest 每个用例文件独立环境，无需还原；
  // 若将来改为共享环境，请在此处恢复 originalFetch。
}

/** 若某用例遗留了 fake timers，恢复真实计时器（供需要时显式调用）。 */
export function restoreFakeTimersIfNeeded(): void {
  const vi = (globalThis as any).vi;
  if (vi && typeof vi.isFakeTimers === "function" && vi.isFakeTimers()) {
    vi.useRealTimers();
  }
}
