/** A part's shell words with their quotes and escapes taken off; `$NAME` and a command substitution stay whole, to be resolved. */
export function shellWords(part: string): string[] {
  const found: string[] = [];
  let word = "";
  let quote = "";
  let open = false;
  let depth = 0;
  let escaped = false;
  for (const char of part) {
    if (escaped) {
      escaped = false;
      if (quote === '"' && !/["\\$`]/.test(char)) word += "\\";
      if (char !== "\n") word += char;
      continue;
    }
    if (char === "\\" && depth === 0 && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote === "'" || (quote === '"' && depth === 0)) {
      if (char === quote) quote = "";
      else word += char;
      continue;
    }
    if (char === "(" && word.endsWith("$")) depth += 1;
    else if (char === ")" && depth > 0) depth -= 1;
    else if (char === "`") depth += word.split("`").length % 2 === 1 ? 1 : -1;
    if (depth > 0 || char === ")" || char === "`") word += char;
    else if (char === "'" || char === '"') {
      quote = char;
      open = true;
    } else if (/\s/.test(char)) {
      if (word || open) found.push(word);
      word = "";
      open = false;
    } else word += char;
  }
  if (escaped) word += "\\";
  if (word || open) found.push(word);
  return found;
}
