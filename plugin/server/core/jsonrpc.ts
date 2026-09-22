import { errorText } from "./errors.ts";
export type RpcAnswer = { ok: boolean; json?: any; error?: string };

export async function postJsonRpc(url: string, body: unknown, timeoutMs: number): Promise<RpcAnswer> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    const start = text.indexOf("{");
    const json = start >= 0 ? JSON.parse(text.slice(start, text.lastIndexOf("}") + 1)) : undefined;
    return { ok: response.ok, json };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

export async function callTool(url: string, name: string, args: Record<string, unknown>, timeoutMs: number): Promise<{ ok: boolean; text: string }> {
  const answer = await postJsonRpc(url, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, timeoutMs);
  if (!answer.json) return { ok: false, text: answer.error ?? "no JSON-RPC answer" };
  const result = answer.json.result as { isError?: boolean; content?: { text?: string }[] } | undefined;
  const text = (result?.content ?? []).map((part) => part.text ?? "").join("\n") || answer.json.error?.message || "";
  // Check the status first: an error body containing `{` was once read as a successful answer.
  if (!answer.ok) return { ok: false, text: text || `the server answered with an error status` };
  return { ok: !answer.json.error && !result?.isError, text };
}
