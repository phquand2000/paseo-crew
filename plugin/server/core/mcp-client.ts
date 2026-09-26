import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { errorText } from "./errors.ts";

/** One exchange with an MCP server over HTTP, handshake first and closed after: what the desk asks of a code index is brief. */
async function withServer<T>(url: string, timeoutMs: number, use: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "seatworks-desk", version: "3" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url)), { timeout: timeoutMs });
    return await use(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/** A tool's answer as text, and whether it went through; a server that cannot be reached is a failed call that says why. */
export async function callTool(
  url: string,
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ ok: boolean; text: string }> {
  try {
    return await withServer(url, timeoutMs, async (client) => {
      const result = await client.callTool({ name, arguments: args }, { timeout: timeoutMs });
      const text = (result.content as { text?: string }[] | undefined)?.map((part) => part.text ?? "").join("\n") ?? "";
      return { ok: !result.isError, text };
    });
  } catch (error) {
    return { ok: false, text: errorText(error) };
  }
}

/** The names of the tools a server offers, or why it could not say. */
export async function toolNames(url: string, timeoutMs: number): Promise<{ names?: string[]; error?: string }> {
  try {
    return {
      names: await withServer(url, timeoutMs, async (client) =>
        (await client.listTools(undefined, { timeout: timeoutMs })).tools.map((tool) => tool.name),
      ),
    };
  } catch (error) {
    return { error: errorText(error) };
  }
}

/** Whether an MCP server answers its handshake, or why not. */
export async function reaches(url: string, timeoutMs: number): Promise<{ ok: boolean; error?: string }> {
  try {
    await withServer(url, timeoutMs, async () => undefined);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}
