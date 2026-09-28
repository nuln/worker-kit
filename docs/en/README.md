# @nuln/worker-kit Documentation (English)

Developer documentation for `@nuln/worker-kit`.

[English](./README.md) | [简体中文](../zh/README.md)

---

## 📑 Guides & References

> Only modules that **have** a document are listed. For the rest, read the
> source: every exported symbol carries complete TSDoc (`@param` / `@returns` /
> `@throws` / security semantics), and the 21 compilable files under
> `examples/` serve as worked references — `npm run typecheck` checks the
> examples too, so they cannot drift from the implementation.

1. **[S3 Multi-Cloud Object Storage](./s3.md)**: Native SigV4 client for AWS, Cloudflare R2, MinIO, Wasabi, B2, OSS, COS.
2. **[Passkey & WebAuthn Authentication](./auth.md)**: Hardware biometric authentication, setup locking, and session lifecycle.
3. **[Database & Cold S3 Backup](./backup.md)**: D1 snapshots, SHA-256 validation, and scheduled S3 rotation.
4. **[Deployment Preflight & Setup Gate](./config.md)**: Missing secrets/bindings fail closed; `/setup` shows *what needs configuring* instead of the init form. Requirements are pure data — adding an env var requires no code change.

### Modules without a dedicated document

TSDoc in source is complete for: `crypto`, `middleware`, `ratelimit`, `ui`,
`sync`, `db`, `dns`, `email`, `flags`, `http`, `observability`, `pwa`, `rbac`,
`urls`, `webauthn`, `notify`, `basepath`, `conventions`.

When adding docs, do **not** list a file in this index before creating it —
an index that disagrees with the filesystem is exactly the kind of documentation
drift this repo works to eliminate.
