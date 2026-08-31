import { NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { extractBearerToken } from "@/lib/api-tokens";
import { requireUser } from "@/lib/session";
import { buildMcpServer } from "@/services/mcp/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Endpoint MCP (Streamable HTTP, mode stateless). L'authentification est
 * identique au reste de l'API : session (cookie) ou token Bearer
 * (`Authorization: Bearer hai_...`). Un transport frais est créé par requête.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const user = await requireUser();
  const bearer = extractBearerToken(req.headers.get("authorization"));
  const tokenPrefix = bearer ? bearer.slice(0, 12) : null;
  const server = await buildMcpServer(user.id, { tokenPrefix });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close();
  }
}
