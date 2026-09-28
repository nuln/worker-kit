/**
 * @nuln/worker-kit/ui/dev-defaults
 *
 * 本地开发时的管理员预填默认值。
 *
 * ## 为什么单独成文件
 *
 * `ui/auth-pages.ts` 依赖 `ui/themes/modern/auth-pages.ts`（取各主题渲染器），
 * 而后者又需要本文件里的开发默认值 —— 同处 `auth-pages.ts` 时构成运行时
 * 循环依赖：模块可能拿到未初始化的导出（TDZ），且打包器无法摇掉环上代码。
 *
 * 抽到两者共同的下游后，依赖方向变成
 * `auth-pages → themes/modern → dev-defaults`，无环。
 */

import { isLocalhost } from "../urls/origin.js";

export const DEV_ADMIN_DEFAULTS = {
  email: "admin@nuln.net",
  localPart: "admin",
  name: "admin",
  pkName: "Passkey",
} as const;

/**
 * 获取环境自适应的初始化表单预填值：本地开发环境返回默认值，生产环境返回空字符串
 */
export function getDevSetupDefaults(reqOrHost?: Request | string | null): {
  email: string;
  localPart: string;
  name: string;
  pkName: string;
  isDev: boolean;
} {
  const isDev = isLocalhost(reqOrHost);
  return {
    email: isDev ? DEV_ADMIN_DEFAULTS.email : "",
    localPart: isDev ? DEV_ADMIN_DEFAULTS.localPart : "",
    name: isDev ? DEV_ADMIN_DEFAULTS.name : "",
    pkName: isDev ? DEV_ADMIN_DEFAULTS.pkName : "",
    isDev,
  };
}

/**
 * 通用 PWA Head 标签
 */
export const PWA_HEAD_TAGS = `
  <meta name="theme-color" content="#18181b">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
`;
