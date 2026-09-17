/**
 * Example 16: RFC 7807 Problem Details & Standard HTTP Responses
 *
 * Demonstrates:
 * 1. Standardized JSON success responses and error responses
 * 2. RFC 7807 Problem Details for API contracts
 * 3. Client IP and geo metadata extraction
 * 4. Safe pagination parsing
 */

import {
  jsonResponse,
  jsonError,
  problemDetailsResponse,
  NulnErrorCode,
  extractClientMeta,
  parsePaginationParams,
  formatBytes,
} from "@nuln/worker-kit";

export function handleHttpRequest(request: Request) {
  console.log("=== [Example 16] Standard HTTP Utilities ===");

  // 1. Client Metadata
  const meta = extractClientMeta(request);
  console.log(`Incoming request from IP: ${meta.ip}, Country: ${meta.country || "N/A"}, IsMobile: ${meta.isMobile}`);

  // 2. Pagination parsing
  const url = new URL(request.url);
  const pagination = parsePaginationParams({ page: url.searchParams.get("page") || "1", limit: "20" });
  console.log(`Pagination: Page ${pagination.page}, Limit ${pagination.limit}, Offset ${pagination.offset}`);

  // 3. RFC 7807 Error Response
  const notFoundResponse = problemDetailsResponse({
    status: 404,
    title: "Resource Not Found",
    detail: "The requested user ID does not exist in this realm.",
    code: NulnErrorCode.NOT_FOUND,
  });

  return notFoundResponse;
}
