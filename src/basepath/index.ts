/**
 * @nuln/worker-kit/basepath
 *
 * 统一微服务 BasePath 与二级目录动态路由基准库
 * 遵循 Nuln 架构设计与工程规范：提供零配置、动态自适应的路径清洗、剥离与模板注入能力。
 */

/**
 * 规范化 BasePath
 * 无论输入 "mail", "/mail/", "///mail///", "", undefined，
 * 均统一转换为无尾斜杠、带单个前导斜杠的标准前缀（如 "/mail"），空或 "/" 则返回 ""。
 *
 * @param raw 原始 BASE_PATH 环境变量或配置字符串
 * @returns 规范化后的 BasePath，例如 "/mail", "/ops/v1", 或 ""
 */
export function normalizeBasePath(raw?: string | null): string {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === "/") return "";
  // 移除开头多余斜杠并移除末尾多余斜杠，统一规范为 /a/b/c 格式
  const clean = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
  return clean ? `/${clean}` : "";
}

/**
 * 安全剥离请求路径中的 BasePath 前缀
 *
 * @param pathname 完整的请求 URL pathname（如 "/mail/api/v1/user" 或 "/mail"）
 * @param basePath 当前服务配置的 BasePath（如 "/mail" 或 ""）
 * @returns 剥离 BasePath 后的内部路由路径（如 "/api/v1/user" 或 "/"）
 */
export function stripBasePath(pathname: string, basePath?: string | null): string {
  const base = normalizeBasePath(basePath);
  if (!base) return pathname || "/";
  if (pathname === base) return "/";
  if (pathname.startsWith(`${base}/`)) {
    const stripped = pathname.slice(base.length);
    return stripped || "/";
  }
  return pathname;
}

/**
 * 判断请求路径与 BasePath 的匹配状态，并返回自愈重定向信息
 *
 * @param pathname 请求的 URL pathname
 * @param basePath 当前服务配置的 BasePath
 */
export function matchBasePath(pathname: string, basePath?: string | null): {
  /** 请求路径是否与 basePath 完全一致（如 /mail，缺少尾斜杠） */
  isExact: boolean;
  /** 请求路径是否在 basePath 范围内（如 /mail/ 或 /mail/login） */
  isUnder: boolean;
  /** 是否需要重定向补全末尾斜杠（访问 /mail 时需重定向到 /mail/） */
  shouldRedirect: boolean;
  /** 补齐斜杠后的目标路径（如 /mail/） */
  targetPath: string;
  /** 剥离 BasePath 后的内部路径 */
  strippedPath: string;
} {
  const base = normalizeBasePath(basePath);
  if (!base) {
    return {
      isExact: pathname === "/",
      isUnder: true,
      shouldRedirect: false,
      targetPath: pathname,
      strippedPath: pathname || "/",
    };
  }

  const isExact = pathname === base;
  const isUnder = pathname === `${base}/` || pathname.startsWith(`${base}/`);
  const shouldRedirect = isExact;
  const targetPath = isExact ? `${base}/` : pathname;
  const strippedPath = stripBasePath(pathname, base);

  return {
    isExact,
    isUnder,
    shouldRedirect,
    targetPath,
    strippedPath,
  };
}

/**
 * 为内部子路径安全附加 BasePath 前缀
 *
 * @param subpath 内部路径（如 "/login" 或 "api/v1"）
 * @param basePath 当前服务配置的 BasePath（如 "/mail" 或 ""）
 * @returns 完整的带 BasePath 路由路径（如 "/mail/login"）
 */
export function withBasePath(subpath: string, basePath?: string | null): string {
  const base = normalizeBasePath(basePath);
  const cleanSub = subpath.startsWith("/") ? subpath : `/${subpath}`;
  if (!base) return cleanSub;
  if (cleanSub === "/") return `${base}/`;
  return `${base}${cleanSub}`;
}


/**
 * 渲染 HTML 模板中的 Base 标签与客户端 BasePath 动态注入脚本
 *
 * @param basePath 当前服务配置的 BasePath
 * @returns 可直接嵌入 HTML `<head>` 中的 `<base>` 标签与 `<script>` 注入
 */
export function renderBaseInjection(basePath?: string | null): string {
  const base = normalizeBasePath(basePath);
  const cleanBaseName = base ? base.replace(/^\/+/, "") : "";
  const baseHref = cleanBaseName ? `/${cleanBaseName}/` : "/";

  return `<base href="${baseHref}">
<script>
window.BASE_PATH = ${JSON.stringify(cleanBaseName)};
window.__CONFIG__ = window.__CONFIG__ || {};
window.__CONFIG__.basePath = ${JSON.stringify(cleanBaseName)};
</script>`;
}

// ── 去重：以下原语的权威实现位于其他模块，此处仅再导出 ──
//
// 此前 basepath 与 urls/ui 各自持有一份同名实现，语义还存在细微分叉
// （如 normalizeBasePath：http 版会把 "a//b" 规整为 "/a/b"，basepath 版不会），
// 调用方导入了"错误"的那份就会得到不一致的路由匹配结果。
export { isSafeNextUrl } from "../urls/origin.js";
export { isLocalhost } from "../urls/origin.js";
