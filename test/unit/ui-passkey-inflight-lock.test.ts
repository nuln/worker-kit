/**
 * Passkey 交互的 In-Flight 互斥锁（KIT-BUG-05）
 *
 * ## 真实的故障链
 *
 * 移动端 / 触摸屏上，用户点完"使用通行密钥登录"后，Touch ID / Face ID
 * 弹窗需要数秒准备。这期间若再次点击或按回车：
 *
 * 1. 发出第二个 `login/start` 请求
 * 2. 服务端把 challenge 刷新为新值
 * 3. 先发请求的硬件验签回来 → `Invalid Challenge`
 * 4. 用户看到"登录失败"—— 真实原因却是自己多点了一下
 *
 * `btn.disabled = true` 挡不住三件事：
 * - 按钮元素可能不存在（渲染差异 / 主题切换），此时完全没有防护
 * - `data-action` 事件委托**直接调函数**，不走按钮的 disabled 语义
 * - 表单回车提交同样绕过
 *
 * 故用显式标志位互斥，并在 `finally` 里释放 —— 漏释放会让用户一次失败后
 * 永久无法重试。
 *
 * ## 本文件怎么"测"注入的脚本
 *
 * 这些是**字符串模板**里的客户端 JS，无法直接 import。做法是把渲染出的
 * 脚本用 `new Function` 在沙箱里跑起来，配上 mock 的 DOM / fetch /
 * navigator.credentials，然后断言可观测行为（请求次数、按钮状态）。
 * 这比只断言"模板里含 isSubmitting 字符串"强得多 —— 后者对逻辑写错
 * 完全无感。
 */

import { describe, it, expect, vi } from "vitest";
import { renderAuthPage } from "../../src/ui/auth-pages.js";
import { renderModernLoginHtml, renderModernSetupHtml } from "../../src/ui/themes/modern/index.js";

/* ==================================================== 沙箱 */

/**
 * 从渲染结果里抽出**客户端脚本全集**。
 *
 * 一页里有多个 `<script>` 块，且它们**互相依赖**：
 * i18n 赋值块提供 `window.__I18N__`，Passkey 块靠它派生出 `__t(...)`。
 * 只取 Passkey 那一个块会在运行时抛 `__t is not defined` ——
 * 而这类错误表现为"锁不生效"，与真实原因相隔极远。
 *
 * 故按浏览器的真实执行顺序拼接全部块（页面内顺序即执行顺序）。
 */
function extractScript(html: string): string {
  const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
  const passkey = blocks.find((b) => /async function loginPasskey/.test(b));
  if (!passkey) throw new Error("渲染结果中没有含 loginPasskey 的 <script> 块");

  // 只取 Passkey 那一块（它自带 setMsg / b64urlToBuf / P / modal 转发），
  // 前面补一份最小 i18n 垫片。
  //
  // 为什么不用页面里的 i18n 块：它们与 Passkey 块在同一函数作用域里各自
  // `const B = ...`，拼起来会 `Identifier 'B' has already been declared`。
  // 垫片等价且更小 —— i18n 的真实行为由 src/ui/i18n.ts 的既有测试覆盖，
  // 本文件要验证的是锁。
  // 注意 `var __t` 而不是 `window.__t = ...`：在 `new Function` 里 window
  // 只是个形参，给它挂属性不会让脚本正文里的**裸** `__t` 解析到它
  // （表现为 `__t is not defined`，且只在错误分支里出现 —— 极易漏看）。
  const I18N_SHIM = `
window.__I18N__ = window.__I18N__ || {};
var __t = window.__t = function (key) { var d = window.__I18N__ || {}; return (key in d) ? d[key] : key; };
`;
  return I18N_SHIM + passkey;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 构造一个按钮替身，记录 disabled / class 变化 */
function makeBtn(id: string) {
  return {
    id,
    disabled: false,
    classList: {
      classes: new Set<string>(),
      add(c: string) {
        this.classes.add(c);
      },
      remove(c: string) {
        this.classes.delete(c);
      },
      contains(c: string) {
        return this.classes.has(c);
      },
    },
    textContent: "",
    setAttribute: () => {},
    getAttribute: () => null,
    addEventListener: () => {},
    querySelector: () => ({ textContent: "" }),
  };
}

/**
 * 按钮 id 在两个主题里不同（`main-passkey-btn` vs `main-btn`），
 * 且登录与注册用不同按钮。统一按"注册表"提供，避免把 id 写死在断言里 ——
 * 那样换个主题整套测试就会红，而被测的锁行为其实没变。
 */
function makeDomRegistry() {
  const registry = new Map<string, ReturnType<typeof makeBtn>>();
  const get = (id: string) => {
    let el = registry.get(id);
    if (!el) {
      el = makeBtn(id);
      registry.set(id, el);
    }
    return el;
  };
  return { registry, get };
}

interface Sandbox {
  loginPasskey: () => Promise<void>;
  setupPasskey: () => Promise<void>;
  optionsCalls: number;
  credentialsGetCalls: number;
  credentialsCreateCalls: number;
  setMsgCalls: string[];
  btn: ReturnType<typeof makeBtn>;
  setupBtn: ReturnType<typeof makeBtn>;
  /** classic 主题的登录按钮 id 是 main-btn，与 modern 不同 */
  altBtn: ReturnType<typeof makeBtn>;
  /** 成功路径的跳转目标（沙箱里不真跳，只记录） */
  navigations: string[];
}

/**
 * 在沙箱里跑注入脚本，驱动 Passkey 流程。
 *
 * @param opts.failOptions 令 `/options` 请求返回 500
 * @param opts.rejectCred  令 `navigator.credentials` 抛 NotAllowedError
 * @param opts.gate        控制 credentials 何时 resolve（用于测并发）
 */
function runScript(
  script: string,
  opts: { failOptions?: boolean; rejectCred?: boolean; gate?: Deferred<unknown> } = {},
): Sandbox {
  const optionsGate = opts.gate ?? null;
  let optionsCalls = 0;
  let credentialsGetCalls = 0;
  let credentialsCreateCalls = 0;
  const setMsgCalls: string[] = [];
  const navigations: string[] = [];
  const dom = makeDomRegistry();
  const btn = dom.get("main-passkey-btn");
  const setupBtn = dom.get("setup-btn");
  const altBtn = dom.get("main-btn");

  const fakeFetch = async (url: string) => {
    if (String(url).includes("/options")) {
      optionsCalls++;
      if (opts.failOptions) return new Response("{}", { status: 500 });
      return new Response(
        JSON.stringify({
          tmp: "tmp-1",
          options: {
            challenge: "Y2hhbGxlbmdl",
            allowCredentials: [],
            user: { id: "dXNlcg" },
          },
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ ok: true, redirect: "/done" }), { status: 200 });
  };

  const sandboxGlobals: Record<string, Record<string, unknown> | unknown> = {
    window: { isSecureContext: true, addEventListener: () => {}, alertDlg: () => {} },
    document: {
      getElementById: (id: string) => {
        if (id === "email") return { value: "admin@example.com" };
        if (id === "name") return { value: "Admin" };
        if (id === "pk-name") return { value: "Key" };
        if (id === "msg") return { set textContent(v: string) { setMsgCalls.push(v); } };
        // 任何含 passkey / main / setup 的 id 都给按钮替身
        if (/btn|passkey|main|setup/.test(id)) return dom.get(id);
        return null;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
      documentElement: { setAttribute: () => {}, getAttribute: () => null, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
      createElement: () => makeBtn("dynamic"),
      appendChild: () => {},
      removeChild: () => {},
      contains: () => false,
      readyState: "complete",
    },
    navigator: {
      credentials: {
        get: async () => {
          credentialsGetCalls++;
          if (opts.rejectCred) {
            const e = new Error("cancelled");
            e.name = "NotAllowedError";
            throw e;
          }
          if (optionsGate) await optionsGate.promise;
          return {
            id: "cred-1",
            rawId: new ArrayBuffer(8),
            type: "public-key",
            response: {
              clientDataJSON: new ArrayBuffer(4),
              authenticatorData: new ArrayBuffer(4),
              signature: new ArrayBuffer(4),
              userHandle: null,
            },
          };
        },
        create: async () => {
          credentialsCreateCalls++;
          if (opts.rejectCred) {
            const e = new Error("cancelled");
            e.name = "NotAllowedError";
            throw e;
          }
          if (optionsGate) await optionsGate.promise;
          return {
            id: "cred-1",
            rawId: new ArrayBuffer(8),
            type: "public-key",
            response: {
              clientDataJSON: new ArrayBuffer(4),
              attestationObject: new ArrayBuffer(4),
              transports: [],
            },
          };
        },
      },
    },
    fetch: fakeFetch,
    Response,
    ArrayBuffer,
    Uint8Array,
    atob: (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("binary"),
    btoa: (s: string) => Buffer.from(s, "binary").toString("base64"),
    setTimeout,
    clearTimeout,
    console: { warn: () => {}, error: () => {}, debug: () => {}, log: () => {} },
    // 成功路径靠跳转离开页面；沙箱里不真跳，只记下来。
    // 不设 href 的话 `location.href = ...` 在只读对象上会静默失败，
    // 断言"流程走完"就会误判。
    location: { get href() { return ""; }, set href(v: string) { navigations.push(v); } },
    // 主题脚本会读 localStorage（主题偏好）与 matchMedia（暗色偏好）
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, addListener: () => {} }),
    /** 给脚本一个确定的 origin，便于 alignWebAuthnRpId 之类逻辑 */
    origin: "https://s.example.com",
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    alertDlg: () => {},
    confirmDlg: () => {},
    toast: () => {},
  };
  // modal 脚本可能直接引用 document.body
  const doc = sandboxGlobals.document as Record<string, unknown>;
  doc.body = doc;

  type ScriptApi = {
    loginPasskey: (() => Promise<void>) | null;
    setupPasskey: (() => Promise<void>) | null;
  };
  /** `new Function` 返回的是 `Function`，需一次窄化才能安全调用 */
  let api: ScriptApi;
  try {
    const factory = new Function(
      "window",
      "document",
      "navigator",
      "fetch",
      "Response",
      "ArrayBuffer",
      "Uint8Array",
      "atob",
      "btoa",
      "location",
      "console",
      "localStorage",
      "sessionStorage",
      "matchMedia",
      "origin",
      "getComputedStyle",
      `${script}
;return { loginPasskey: typeof loginPasskey === 'function' ? loginPasskey : null,
          setupPasskey: typeof setupPasskey === 'function' ? setupPasskey : null };`,
    ) as (...args: unknown[]) => ScriptApi;
    api = factory(
      sandboxGlobals.window,
      sandboxGlobals.document,
      sandboxGlobals.navigator,
      sandboxGlobals.fetch,
      sandboxGlobals.Response,
      sandboxGlobals.ArrayBuffer,
      sandboxGlobals.Uint8Array,
      sandboxGlobals.atob,
      sandboxGlobals.btoa,
      sandboxGlobals.location,
      sandboxGlobals.console,
      sandboxGlobals.localStorage,
      sandboxGlobals.sessionStorage,
      sandboxGlobals.matchMedia,
      sandboxGlobals.origin,
      sandboxGlobals.getComputedStyle,
    );
  } catch (err) {
    // 脚本报错必须显式暴露：否则表现是"锁没生效"这种毫无线索的断言失败
    throw new Error(
      `注入脚本在沙箱中执行失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    loginPasskey: api.loginPasskey ?? (async () => {}),
    setupPasskey: api.setupPasskey ?? (async () => {}),
    get optionsCalls() {
      return optionsCalls;
    },
    get credentialsGetCalls() {
      return credentialsGetCalls;
    },
    get credentialsCreateCalls() {
      return credentialsCreateCalls;
    },
    setMsgCalls,
    btn,
    setupBtn,
    altBtn,
    navigations,
  };
}

/* ==================================================== 模板层面 */

const RENDERERS: Array<[string, (opts: never) => string]> = [
  ["classic login", (o) => renderAuthPage({ view: "login", serviceName: "S", ...(o as object) })],
  ["classic setup", (o) => renderAuthPage({ view: "setup", serviceName: "S", ...(o as object) })],
  ["modern login", (o) => renderModernLoginHtml(o)],
  ["modern setup", (o) => renderModernSetupHtml(o)],
];

describe("模板：四个入口都含互斥锁", () => {
  for (const [name, fn] of RENDERERS) {
    it(`${name}：含锁标志与 finally 释放`, () => {
      const html = fn({} as never);
      expect(html, `${name} 缺少 __pkInFlight`).toContain("__pkInFlight");
      expect(html, `${name} 缺少 __pkLock`).toContain("__pkLock");
      expect(html, `${name} 缺少 __pkUnlock`).toContain("__pkUnlock");
      // finally 保证异常路径也释放
      expect(html, `${name} 缺少 finally 释放`).toMatch(/finally\s*\{[\s\S]{0,200}__pkUnlock/);
    });

    it(`${name}：两个入口函数都在 try 之前占锁`, () => {
      const html = fn({} as never);
      // 锁必须占在**任何 await 之前** —— 否则第一次请求已发出才加锁，等于没加。
      // 窗口取到下一个 "async function" 或文件尾，避免用固定长度去猜。
      for (const fname of ["loginPasskey", "setupPasskey"]) {
        const at = html.indexOf(`async function ${fname}`);
        if (at < 0) continue;
        const rest = html.slice(at + fname.length + 16);
        const nextFn = rest.search(/async function /);
        const body = nextFn < 0 ? rest : rest.slice(0, nextFn);
        const lockAt = body.indexOf("__pkLock()");
        const firstAwait = body.indexOf("await ");
        expect(lockAt, `${fname} 应含占锁`).toBeGreaterThanOrEqual(0);
        expect(firstAwait, `${fname} 应至少有一个 await`).toBeGreaterThanOrEqual(0);
        expect(lockAt, `${fname} 的占锁必须早于第一个 await`).toBeLessThan(firstAwait);
        // 占锁后必须立刻 return，挡住重复调用
        expect(
          body.slice(lockAt, lockAt + 40),
          `${fname} 占锁失败时必须立即返回`,
        ).toMatch(/__pkLock\(\)\)\s*return/);
      }
    });
  }
});

/* ==================================================== 行为层面 */

describe("现代主题 loginPasskey：并发点击只发一次请求", () => {
  it("在途期间第二次点击被拦截，options 只请求一次", async () => {
    const gate = deferred<unknown>();
    const sb = runScript(extractScript(renderModernLoginHtml({ serviceName: "S" } as never)), {
      gate,
    });

    const first = sb.loginPasskey();
    // 让第一次走到 credentials 阶段（此时锁已持有）
    await vi.waitFor(() => expect(sb.credentialsGetCalls).toBe(1));

    // 快速连点：后续调用必须立即返回
    await sb.loginPasskey();
    await sb.loginPasskey();
    await sb.loginPasskey();

    expect(sb.optionsCalls, "重复点击不得发出额外请求").toBe(1);
    expect(sb.credentialsGetCalls, "不得重复唤起硬件").toBe(1);

    gate.resolve(undefined);
    await first;
  });

  it("按钮在流程期间保持 disabled + loading 态", async () => {
    const gate = deferred<unknown>();
    const sb = runScript(extractScript(renderModernLoginHtml({ serviceName: "S" } as never)), {
      gate,
    });
    const p = sb.loginPasskey();
    await vi.waitFor(() => expect(sb.btn.disabled).toBe(true));
    expect(sb.btn.classList.contains("authenticating"), "应带 loading 态类名").toBe(true);
    gate.resolve(undefined);
    await p;
  });

  it("正常路径走完三步（options → 硬件 → verify）并跳转到 redirect", async () => {
    // 这条是沙箱本身的自检：若它不过，上面所有"重复点击被拦截"的断言
    // 都可能只是在数"0 次请求" —— 看起来通过，实际什么都没跑。
    const sb = runScript(extractScript(renderModernLoginHtml({ serviceName: "S" } as never)));
    await sb.loginPasskey();
    expect(sb.optionsCalls).toBe(1);
    expect(sb.credentialsGetCalls).toBe(1);
    expect(sb.navigations, "成功应触发跳转").toEqual(["/done"]);
  });

  it("classic 主题同样走完三步（验证沙箱对另一主题同样有效）", async () => {
    const sb = runScript(extractScript(renderAuthPage({ view: "login", serviceName: "S" })));
    await sb.loginPasskey();
    expect(sb.optionsCalls).toBe(1);
    expect(sb.credentialsGetCalls).toBe(1);
    expect(sb.navigations).toEqual(["/done"]);
  });
});

describe("锁一定被释放：失败 / 取消 / options 报错", () => {
  it("NotAllowedError（用户取消）后可以重试", async () => {
    // 漏释放的后果：用户取消一次后按钮再也不响应，且没有任何报错。
    const sb = runScript(extractScript(renderModernLoginHtml({ serviceName: "S" } as never)), {
      rejectCred: true,
    });
    await sb.loginPasskey();
    expect(sb.credentialsGetCalls).toBe(1);

    await sb.loginPasskey();
    expect(sb.credentialsGetCalls, "取消后应能再次尝试").toBe(2);
  });

  it("options 请求 500 后可以重试", async () => {
    const sb = runScript(extractScript(renderModernLoginHtml({ serviceName: "S" } as never)), {
      failOptions: true,
    });
    await sb.loginPasskey();
    await sb.loginPasskey();
    expect(sb.optionsCalls, "失败后应能再次尝试").toBe(2);
  });

  it("失败后按钮恢复可用", async () => {
    const sb = runScript(extractScript(renderModernLoginHtml({ serviceName: "S" } as never)), {
      rejectCred: true,
    });
    await sb.loginPasskey();
    expect(sb.btn.disabled, "失败后按钮应恢复可用").toBe(false);
    expect(sb.btn.classList.contains("authenticating")).toBe(false);
  });

  it("取消时给出可重试文案", async () => {
    const sb = runScript(extractScript(renderModernLoginHtml({ serviceName: "S" } as never)), {
      rejectCred: true,
    });
    await sb.loginPasskey();
    expect(sb.setMsgCalls.length, "应提示用户").toBeGreaterThan(0);
  });
});

describe("现代主题 setupPasskey：并发点击只发一次请求", () => {
  it("在途期间重复点击被拦截", async () => {
    const gate = deferred<unknown>();
    const sb = runScript(extractScript(renderModernSetupHtml({ serviceName: "S" } as never)), {
      gate,
    });
    const first = sb.setupPasskey();
    await vi.waitFor(() => expect(sb.credentialsCreateCalls).toBe(1));
    await sb.setupPasskey();
    await sb.setupPasskey();
    expect(sb.optionsCalls).toBe(1);
    expect(sb.credentialsCreateCalls).toBe(1);
    gate.resolve(undefined);
    await first;
  });

  it("取消后可以重试", async () => {
    const sb = runScript(extractScript(renderModernSetupHtml({ serviceName: "S" } as never)), {
      rejectCred: true,
    });
    await sb.setupPasskey();
    await sb.setupPasskey();
    expect(sb.credentialsCreateCalls).toBe(2);
  });
});

describe("classic 主题：同一套锁语义", () => {
  it("loginPasskey 并发点击只发一次", async () => {
    const gate = deferred<unknown>();
    const sb = runScript(extractScript(renderAuthPage({ view: "login", serviceName: "S" })), {
      gate,
    });
    const first = sb.loginPasskey();
    await vi.waitFor(() => expect(sb.credentialsGetCalls).toBe(1));
    await sb.loginPasskey();
    expect(sb.optionsCalls).toBe(1);
    gate.resolve(undefined);
    await first;
  });

  it("setupPasskey 取消后可重试", async () => {
    const sb = runScript(extractScript(renderAuthPage({ view: "setup", serviceName: "S" })), {
      rejectCred: true,
    });
    await sb.setupPasskey();
    await sb.setupPasskey();
    expect(sb.credentialsCreateCalls).toBe(2);
  });
});

describe("锁的粒度：login 与 setup 共享同一把锁", () => {
  it("登录在途时点注册不会发出注册请求", async () => {
    // 共享锁意味着用户在登录弹窗期间误触"注册"，不会产生两套并行流程 ——
    // 两个流程会各自申请 challenge，互相把对方的 challenge 顶掉。
    const gate = deferred<unknown>();
    const sb = runScript(extractScript(renderAuthPage({ view: "login", serviceName: "S" })), {
      gate,
    });
    const first = sb.loginPasskey();
    await vi.waitFor(() => expect(sb.credentialsGetCalls).toBe(1));
    const before = sb.optionsCalls;
    await sb.setupPasskey();
    expect(sb.optionsCalls, "注册请求应被锁挡下").toBe(before);
    gate.resolve(undefined);
    await first;
  });
});
