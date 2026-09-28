/**
 * Example 03: Passkey 首访初始化与 WebAuthn 认证
 *
 * 演示：
 * 1. 检查站点是否已初始化（单管理员锁定）
 * 2. 签发 WebAuthn 注册 challenge（硬件 Passkey）
 * 3. 校验注册响应并把凭据写入 D1
 * 4. 处理 WebAuthn 登录并签发会话 Cookie
 *
 * ## 与历史版本的差异
 *
 * 本示例此前引用了 `handleSetupOptions` / `handleSetupVerify` /
 * `handleLoginOptions` / `handleLoginVerify` 四个函数 —— **它们从未存在过**。
 * 因为 `examples/` 不在 tsconfig 的 `include` 里，`npm run typecheck`
 * （其文档承诺「检查全库与示例代码 100% 静态强类型规范」）从未覆盖到本文件，
 * 于是这份文档空转了很久。现已纳入类型检查，并改用真实 API。
 *
 * 真实的组织方式是：页面用 `authPageResponse`（或 `renderAuthPage`）渲染，
 * API 层由调用方自己路由到 {@link PasskeyService} 的方法。
 */

import {
  authPageResponse,
  PasskeyService,
  formatSessionCookie,
  signHmacSha256,
  randomToken,
  type WebAuthnConfig,
} from "@nuln/worker-kit";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

/**
 * 构造本服务的 Passkey 服务。
 *
 * ## 为什么 rpID / origin 必须来自**配置**而不是请求
 *
 * 两者都是 WebAuthn 反钓鱼能力的服务端锚点。若从请求的 `Host` / `Origin`
 * 头推导，客户端自己提供的值就必然满足校验，绑定形同虚设。
 * kit 的 `resolveExpectedRPIDs` / `resolveExpectedOrigins` 因此都按
 * **fail-closed** 实现：未配置即拒绝，而不是采信请求值。
 *
 * @param env Worker 环境变量（需含 ORIGIN / RP_ID / COOKIE_SECRET）
 * @param reqHost 当前请求的 Host（仅用于多子域解析，不作为信任根）
 * @param reqOrigin 当前请求的 Origin（同上）
 */
function makeService(env: any, reqHost?: string, reqOrigin?: string): PasskeyService {
  const config: WebAuthnConfig = {
    rpName: env.SITE_NAME || "Tower",
    // rpID 支持数组（多子域部署）；未配置时 resolveRpID 会回退到 reqHost，
    // 因此生产**必须**显式配置 RP_ID
    rpID: (env.RP_ID || "").split(",").map((s: string) => s.trim()).filter(Boolean),
    // origin 同样必须显式配置：未配置时 resolveExpectedOrigins 返回空数组，
    // 验签会 fail-closed 拒绝（这是刻意的）
    origin: (env.ORIGIN || "").split(",").map((s: string) => s.trim()).filter(Boolean),
  };
  void reqHost;
  void reqOrigin;
  return new PasskeyService(config);
}

/** 统一 JSON 响应（AGENTS §7.1 契约）。 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handleAuthRouting(request: Request, env: any) {
  const url = new URL(request.url);
  const basePath = env.BASE_PATH || "";
  const service = makeService(env, request.headers.get("host") || undefined, request.headers.get("origin") || undefined);

  // ── 1. SSR Setup / Login 页面 ──
  // 传 request 让 kit 自动探测语言与本地/生产环境（AGENTS §1.2）：
  // 本地开发自动填充 admin 邮箱与名称，生产环境严格留空（§10.1 Step 5）
  if (url.pathname === `${basePath}/setup` && request.method === "GET") {
    return authPageResponse({
      view: "setup",
      serviceName: "Tower",
      request,
      basePath,
    });
  }
  if (url.pathname === `${basePath}/login` && request.method === "GET") {
    return authPageResponse({
      view: "login",
      serviceName: "Tower",
      request,
      basePath,
    });
  }

  // ── 2. 是否已初始化（决定首屏展示 setup 还是 login）──
  if (url.pathname === `${basePath}/api/auth/state` && request.method === "GET") {
    const initialized = await service.isInitialized(env.DB);
    return json(200, { ok: true, data: { initialized } });
  }

  // ── 3. 注册 challenge ──
  if (url.pathname === `${basePath}/api/auth/webauthn/register/options` && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { email?: string };
    const email = (body.email || "").trim();
    if (!email) return json(400, { ok: false, error: "email_required", code: "BAD_REQUEST" });

    const { tmp, options } = await service.generateSetupOptions(
      env.DB,
      email,
      request.headers.get("host") || undefined,
      "tower",
    );
    return json(200, { ok: true, data: { tmp, options } });
  }

  // ── 4. 校验注册响应并落库 ──
  if (url.pathname === `${basePath}/api/auth/webauthn/register/verify` && request.method === "POST") {
    const body = (await request.json()) as {
      tmp?: string;
      response?: RegistrationResponseJSON;
      pkName?: string;
    };
    if (!body.tmp || !body.response) {
      return json(400, { ok: false, error: "missing_fields", code: "BAD_REQUEST" });
    }
    try {
      // setup 流程的管理员身份由 buildPasskeyUserId(serviceId, email) 派生
      const record = await service.verifySetupResponse(
        env.DB,
        body.tmp,
        body.response,
        request.headers.get("host") || undefined,
        request.headers.get("origin") || undefined,
      );
      // 已完成初始化，/setup 应被封锁（由调用方实现，本示例不展开）
      return json(200, { ok: true, data: { credentialId: record.credentialId } });
    } catch (err) {
      // 生产环境不得回吐底层异常细节（AGENTS §7.3）
      console.error("[auth] register verify failed:", err);
      return json(400, { ok: false, error: "passkey_verification_failed", code: "VERIFY_FAILED" });
    }
  }

  // ── 5. 登录 challenge ──
  if (url.pathname === `${basePath}/api/auth/webauthn/login/options` && request.method === "POST") {
    const { tmp, options } = await service.generateLoginOptions(
      env.DB,
      request.headers.get("host") || undefined,
    );
    return json(200, { ok: true, data: { tmp, options } });
  }

  // ── 6. 校验登录并签发会话 Cookie ──
  if (url.pathname === `${basePath}/api/auth/webauthn/login/verify` && request.method === "POST") {
    const body = (await request.json()) as {
      tmp?: string;
      response?: AuthenticationResponseJSON;
    };
    if (!body.tmp || !body.response) {
      return json(400, { ok: false, error: "missing_fields", code: "BAD_REQUEST" });
    }
    try {
      const result = await service.verifyLoginResponse(
        env.DB,
        body.tmp,
        body.response,
        request.headers.get("host") || undefined,
        request.headers.get("origin") || undefined,
      );

      // 签发会话：HMAC 签名 + HttpOnly Cookie（AGENTS §6.1）
      const sessionId = randomToken(32);
      const expiresAt = String(Date.now() + 8 * 3600 * 1000);
      const payload = `${sessionId}.${expiresAt}`;
      const sig = await signHmacSha256(env.COOKIE_SECRET, payload);

      const headers = new Headers({ "content-type": "application/json" });
      headers.append(
        "Set-Cookie",
        formatSessionCookie("__Host-session", `${payload}.${sig}`, request, basePath),
      );
      // verifyLoginResponse 返回 { userId, credentialId }；邮箱需由调用方
      // 自行查询（kit 不持有用户表），这里只回传可用于后续查询的 userId。
      return new Response(
        JSON.stringify({ ok: true, data: { userId: result.userId, credentialId: result.credentialId } }),
        { status: 200, headers },
      );
    } catch (err) {
      console.error("[auth] login verify failed:", err);
      return json(401, { ok: false, error: "passkey_verification_failed", code: "VERIFY_FAILED" });
    }
  }

  return json(404, { ok: false, error: "Not Found", code: "NOT_FOUND" });
}
