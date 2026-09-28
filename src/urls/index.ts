/**
 * @nuln/worker-kit/urls
 *
 * 多域名 / 多环境 URL 与 Origin 解析：动态 OIDC issuer 推导、RP ID 选择、
 * 回调地址校验与开放重定向防护。
 *
 * ## 与 `@nuln/worker-kit/sso` 的关系
 *
 * 本模块此前持有 14 个与 `sso` **逐字相同**的重复实现。现统一收敛到
 * `urls/origin.ts`，`sso` 与 `urls` 均从此处再导出同一份实现 ——
 * 安全修复只需改一处。
 *
 * @packageDocumentation
 */

export * from "./origin.js";
