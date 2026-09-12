/**
 * @nuln/worker-kit/dns
 *
 * Cloudflare 域名与 DNS / DoH (DNS over HTTPS) 多源自动诊断套件
 */

const CF_API = "https://api.cloudflare.com/client/v4";

export interface DnsRecordRequirement {
  type: string;
  name: string;
  content: string;
  priority?: number;
}

export interface DnsAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

export interface DnsVerificationResult {
  configured: boolean;
  records: Array<DnsRecordRequirement & { current: string | boolean; correct: boolean }>;
  method: "doh" | "mock";
}

export const DEFAULT_EMAIL_ROUTING_RECORDS: DnsRecordRequirement[] = [
  { type: "MX", name: "@", content: "mx.cloudflare.net", priority: 10 },
  { type: "TXT", name: "@", content: "v=spf1 include:_spf.mx.cloudflare.net ~all" },
];

/** 多源并发查询公共 DoH (Cloudflare DoH / DNSPod DoH / AliDNS DoH) */
export async function queryPublicDns(hostname: string, type: string): Promise<DnsAnswer[]> {
  const providers = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
    `https://doh.pub/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
    `https://dns.alidns.com/resolve?name=${encodeURIComponent(hostname)}&type=${type}`,
  ];
  for (const url of providers) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const json = (await res.json()) as any;
        if (json && Array.isArray(json.Answer)) return json.Answer;
      }
    } catch {
      // 容错重试下一通道
    }
  }
  return [];
}

/** 查询 Cloudflare Zone 详情 */
export async function lookupZone(
  cfToken: string,
  hostname: string,
  mock = false,
): Promise<{ id: string; name: string; status: string }> {
  if (mock || !cfToken) {
    return { id: "mock_zone_id", name: hostname, status: "active" };
  }
  const res = await fetch(`${CF_API}/zones?name=${encodeURIComponent(hostname)}`, {
    headers: {
      Authorization: `Bearer ${cfToken}`,
      "Content-Type": "application/json",
    },
  });
  const data = (await res.json()) as any;
  if (!data.success || !data.result || data.result.length === 0) {
    throw new Error(`Domain ${hostname} not found in Cloudflare. Add it as a zone first.`);
  }
  return data.result[0];
}

/** 获取 Zone 的 Email Routing DNS 列表 */
export async function getRoutingDNS(
  cfToken: string,
  zoneId: string,
): Promise<any> {
  const res = await fetch(`${CF_API}/zones/${zoneId}/email/routing/dns`, {
    headers: {
      Authorization: `Bearer ${cfToken}`,
      "Content-Type": "application/json",
    },
  });
  const data = (await res.json()) as any;
  return data.success ? data.result : null;
}

/** 生成 DNS 解析配置说明文本 */
export function getDnsSetupInstructions(
  hostname: string,
  requiredRecords = DEFAULT_EMAIL_ROUTING_RECORDS,
): string {
  return [
    `To receive emails at ${hostname}, add these DNS records in your Cloudflare dashboard:`,
    "",
    ...requiredRecords.map((r) => {
      const parts = [`Type: ${r.type}`, `Name: ${r.name}`, `Value: ${r.content}`];
      if (r.priority) parts.push(`Priority: ${r.priority}`);
      return parts.join(" | ");
    }),
    "",
    'After adding, click "Check DNS" to verify.',
  ].join("\n");
}

/** 通过公共 DoH 实时检测 DNS 记录配置是否生效 */
export async function verifyDnsViaDoH(
  hostname: string,
  requiredRecords = DEFAULT_EMAIL_ROUTING_RECORDS,
  mock = false,
): Promise<DnsVerificationResult> {
  if (
    mock ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".local")
  ) {
    const records = requiredRecords.map((expected) => ({
      ...expected,
      current: expected.content,
      correct: true,
    }));
    return { configured: true, records, method: "mock" };
  }

  const [mxAnswers, txtAnswers] = await Promise.all([
    queryPublicDns(hostname, "MX").catch(() => []),
    queryPublicDns(hostname, "TXT").catch(() => []),
  ]);

  const mxMatch = mxAnswers.find(
    (a) => typeof a.data === "string" && a.data.toLowerCase().includes("cloudflare.net"),
  );

  const txtMatch = txtAnswers.find(
    (a) =>
      typeof a.data === "string" &&
      a.data.toLowerCase().includes("v=spf1") &&
      a.data.toLowerCase().includes("_spf.mx.cloudflare.net"),
  );

  const records = requiredRecords.map((expected) => {
    if (expected.type === "MX") {
      return {
        ...expected,
        current: mxMatch ? mxMatch.data.replace(/^[0-9]+\s+/, "").replace(/\.$/, "") : false,
        correct: !!mxMatch,
      };
    }
    if (expected.type === "TXT") {
      return {
        ...expected,
        current: txtMatch ? txtMatch.data.replace(/^"|"$/g, "") : false,
        correct: !!txtMatch,
      };
    }
    return { ...expected, current: false, correct: false };
  });

  const configured = records.every((r) => r.correct);
  return { configured, records, method: "doh" };
}
