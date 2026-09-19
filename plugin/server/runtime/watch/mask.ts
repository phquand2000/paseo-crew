const SECRETS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[private key]"],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "[token]"],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "[key]"],
  [/\b(sk|rk|pk)[-_][\w-]{16,}/g, "[key]"],
  [/\b(ghp|gho|ghs|ghu|github_pat)_[\w]{16,}/g, "[token]"],
  [/\bxox[abpr]-[\w-]{10,}/g, "[token]"],
  [/\b(bearer|basic)\s+[\w.~+/=-]{8,}/gi, "$1 [redacted]"],
  [/(\/\/[^\s:/@]+:)[^\s@/]+@/g, "$1[redacted]@"],
  [/((?:api[_-]?key|token|secret|passw(?:or)?d|authorization|credential)\w*\\?["']?\s*[:=]\s*\\?["']?)[^\s"'\\,;]{8,}/gi, "$1[redacted]"],
];

export function mask(text: string): string {
  return SECRETS.reduce((kept, [pattern, stand]) => kept.replace(pattern, stand), text);
}
