import { Plugin } from "obsidian";
import { StreamLanguage, LanguageSupport } from "@codemirror/language";
import { StringStream } from "@codemirror/language";

const ASN1_KEYWORDS = new Set([
  "BEGIN", "END", "DEFINITIONS", "IMPLICIT", "EXPLICIT",
  "OPTIONAL", "DEFAULT", "CHOICE", "SEQUENCE", "SET", "OF",
  "TAGS", "AUTOMATIC", "IMPORTS", "EXPORTS", "FROM", "TRUE",
  "FALSE", "NULL", "SIZE", "MIN", "MAX", "ABSENT", "PRESENT",
  "PLUS-INFINITY", "MINUS-INFINITY", "ALL", "EXCEPT", "UNION",
  "INTERSECTION", "CLASS", "TYPE-IDENTIFIER", "ABSTRACT-SYNTAX",
  "UNIVERSAL", "APPLICATION", "PRIVATE", "ENCODED", "CONSTRAINED",
  "INCLUDES", "PATTERN",
]);

const ASN1_BUILTIN_TYPES = new Set([
  "INTEGER", "BOOLEAN", "ENUMERATED", "REAL", "NULL",
  "OCTET", "BIT", "IA5String", "UTF8String", "VisibleString",
  "NumericString", "PrintableString", "TeletexString",
  "VideotexString", "GraphicString", "GeneralString",
  "BMPString", "UniversalString",
  "OBJECT", "ObjectDescriptor",
  "UTCTime", "GeneralizedTime",
  "CHARACTER", "EMBEDDED", "EXTERNAL",
]);

function isBuiltinType(word: string): boolean {
  return ASN1_BUILTIN_TYPES.has(word);
}

function isKeyword(word: string): boolean {
  return ASN1_KEYWORDS.has(word);
}

// ---- CodeMirror StreamLanguage for .asn1 files ----

const asn1Language = StreamLanguage.define({
  name: "asn1",

  startState: () => ({
    inBlockComment: false,
  }),

  token: (stream: StringStream, state: Record<string, unknown>) => {
    if (state.inBlockComment) {
      const next = stream.skipTo("*/");
      if (next !== false) {
        stream.next(); stream.next();
        state.inBlockComment = false;
      } else {
        stream.skipToEnd();
      }
      return "comment";
    }

    if (stream.eatSpace()) return null;

    if (stream.match("--")) { stream.skipToEnd(); return "comment"; }

    if (stream.match("/*")) {
      state.inBlockComment = true;
      const next = stream.skipTo("*/");
      if (next !== false) { stream.next(); stream.next(); state.inBlockComment = false; }
      else { stream.skipToEnd(); }
      return "comment";
    }

    if (stream.match("::=")) return "keyword";

    if (stream.match("..")) {
      if (stream.peek() === ".") { stream.match("."); }
      return "keyword";
    }

    if (stream.match(/^\[[0-9.]+]/)) return "meta";
    if (stream.match(/^"[^"]*"/)) return "string";
    if (stream.match(/^\b[0-9]+\b/)) return "number";

    if (stream.match(/^[a-zA-Z][a-zA-Z0-9]*/)) {
      const word = stream.current();
      const upper = word.toUpperCase();
      if (upper === "OCTET" && stream.match(/^\s+STRING/)) return "typeName";
      if (upper === "BIT" && stream.match(/^\s+STRING/)) return "typeName";
      if (upper === "OBJECT" && stream.match(/^\s+IDENTIFIER/)) return "typeName";
      if (upper === "CHARACTER" && stream.match(/^\s+STRING/)) return "typeName";
      if (upper === "EMBEDDED" && stream.match(/^\s+PDV/)) return "typeName";
      if (isKeyword(upper)) return "keyword";
      if (isBuiltinType(upper)) return "typeName";
      if (/^[A-Z]/.test(word)) return "typeName";
      return "variableName";
    }

    if (stream.match(/^[,;]/)) return "punctuation";
    stream.next();
    return null;
  },

  blankLine: (state: Record<string, unknown>) => {
    state.inBlockComment = false;
  },
});

// ---- DOM-based syntax highlighter for code blocks (reading view / live preview) ----

const HIGHLIGHT_RULES: Array<{
  name: string;
  test: (line: string, i: number) => [number, string] | null;
}> = [
  // line comment
  {
    name: "cm-comment",
    test: (line, i) => {
      if (line[i] === "-" && line[i + 1] === "-") {
        return [line.length - i, line.slice(i)];
      }
      return null;
    },
  },
  // block comment
  {
    name: "cm-comment",
    test: (line, i) => {
      if (line[i] === "/" && line[i + 1] === "*") {
        const end = line.indexOf("*/", i + 2);
        if (end !== -1) {
          return [end + 2 - i, line.slice(i, end + 2)];
        }
        return [line.length - i, line.slice(i)];
      }
      return null;
    },
  },
  // tag [0], [1.2]
  {
    name: "cm-meta",
    test: (line, i) => {
      const m = line.slice(i).match(/^\[[0-9.]+]/);
      return m ? [m[0].length, m[0]] : null;
    },
  },
  // quoted string
  {
    name: "cm-string",
    test: (line, i) => {
      if (line[i] === '"') {
        const end = line.indexOf('"', i + 1);
        if (end !== -1) return [end + 1 - i, line.slice(i, end + 1)];
        return [line.length - i, line.slice(i)];
      }
      return null;
    },
  },
  // assignment ::=
  {
    name: "cm-keyword",
    test: (line, i) => {
      if (line.slice(i, i + 3) === "::=") return [3, "::="];
      return null;
    },
  },
  // range .. or ellipsis ...
  {
    name: "cm-keyword",
    test: (line, i) => {
      if (line[i] === "." && line[i + 1] === ".") {
        if (line[i + 2] === ".") return [3, "..."];
        return [2, ".."];
      }
      return null;
    },
  },
  // number
  {
    name: "cm-number",
    test: (line, i) => {
      if (/[0-9]/.test(line[i])) {
        const m = line.slice(i).match(/^[0-9]+/);
        return m ? [m[0].length, m[0]] : null;
      }
      return null;
    },
  },
  // word (keyword, type, field name)
  {
    name: "cm-word",
    test: (line, i) => {
      if (!/[a-zA-Z]/.test(line[i])) return null;
      const w = line.slice(i).match(/^[a-zA-Z][a-zA-Z0-9]*/);
      if (!w) return null;
      const word = w[0];
      const upper = word.toUpperCase();
      const rest = line.slice(i + word.length);

      // multi-word builtin types
      if (upper === "OCTET" && /^\s+STRING/i.test(rest)) {
        const m = rest.match(/^(\s+STRING)/i);
        return [word.length + m![1].length, `OCTET${m![1]}`];
      }
      if (upper === "BIT" && /^\s+STRING/i.test(rest)) {
        const m = rest.match(/^(\s+STRING)/i);
        return [word.length + m![1].length, `BIT${m![1]}`];
      }
      if (upper === "OBJECT" && /^\s+IDENTIFIER/i.test(rest)) {
        const m = rest.match(/^(\s+IDENTIFIER)/i);
        return [word.length + m![1].length, `OBJECT${m![1]}`];
      }
      if (upper === "CHARACTER" && /^\s+STRING/i.test(rest)) {
        const m = rest.match(/^(\s+STRING)/i);
        return [word.length + m![1].length, `CHARACTER${m![1]}`];
      }
      if (upper === "EMBEDDED" && /^\s+PDV/i.test(rest)) {
        const m = rest.match(/^(\s+PDV)/i);
        return [word.length + m![1].length, `EMBEDDED${m![1]}`];
      }

      // single-word classification
      if (isKeyword(upper)) return [word.length, word];
      if (isBuiltinType(upper)) return [word.length, word];
      if (/^[A-Z]/.test(word)) return [word.length, word]; // type reference
      return [word.length, word]; // field name
    },
  },
  // punctuation
  {
    name: "cm-punctuation",
    test: (line, i) => {
      if (line[i] === "," || line[i] === ";") return [1, line[i]];
      return null;
    },
  },
];

/** Resolve the semantic type name for a word token. */
function classifyWord(word: string): string {
  const upper = word.toUpperCase();
  if (isKeyword(upper)) return "keyword";
  if (isBuiltinType(upper)) return "typeName";
  if (/^[A-Z]/.test(word)) return "typeName";
  return "variableName";
}

/** Map semantic type → concrete color value (resolved from Obsidian theme). */
function resolveColors(): Record<string, string> {
  const s = getComputedStyle(document.documentElement);
  const isDark = document.body.classList.contains("theme-dark");
  const g = (v: string, dark: string, light: string) => {
    const resolved = s.getPropertyValue(v).trim();
    return resolved || (isDark ? dark : light);
  };
  return {
    comment: g("--text-faint", "#888", "#888"),
    keyword: g("--text-accent", "#7cb7ff", "#4761c9"),
    typeName: g("--color-cyan", "#5eb8e6", "#1a6e8a"),
    number: g("--color-orange", "#e6a85e", "#b06d1a"),
    string: g("--color-green", "#6bb86b", "#3d8b3d"),
    meta: g("--text-muted", "#999", "#666"),
    variableName: g("--text-normal", "#ddd", "#333"),
    punctuation: g("--text-muted", "#999", "#666"),
  };
}

let COLORS: Record<string, string> = {};

/** Render highlighted ASN.1 code into a DOM element using inline styles. */
function renderHighlightedCode(code: string, codeEl: HTMLElement): void {
  const lines = code.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let i = 0;

    while (i < line.length) {
      // whitespace → text node
      if (line[i] === " " || line[i] === "\t") {
        let ws = "";
        while (i < line.length && (line[i] === " " || line[i] === "\t")) {
          ws += line[i++];
        }
        codeEl.appendText(ws);
        continue;
      }

      // try each rule
      let matched = false;
      for (const rule of HIGHLIGHT_RULES) {
        const result = rule.test(line, i);
        if (result) {
          const [len, text] = result;
          // resolve the semantic type name
          const type = rule.name === "cm-word" ? classifyWord(text) : rule.name.replace("cm-", "");
          const span = codeEl.createSpan();
          span.style.setProperty("color", COLORS[type] || "inherit", "important");
          span.appendText(text);
          i += len;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // fallback: plain char
      codeEl.appendText(line[i]);
      i++;
    }

    // newline (except last line)
    if (li < lines.length - 1) {
      codeEl.appendText("\n");
    }
  }
}

// ---- Plugin entry ----

export default class Asn1HighlightPlugin extends Plugin {
  async onload() {
    // Resolve theme colors once at load time
    COLORS = resolveColors();

    // 1) Syntax highlighting for .asn1 / .asn file editors
    this.registerEditorExtension(new LanguageSupport(asn1Language));

    // 2) MutationObserver: highlight asn1 code blocks whenever they appear in DOM
    const observer = new MutationObserver(() => {
      const all = document.querySelectorAll<HTMLElement>("code[class*='asn1']");
      for (let i = 0; i < all.length; i++) {
        const codeEl = all[i];
        if (codeEl.getAttribute("data-asn1-done")) continue;
        codeEl.setAttribute("data-asn1-done", "true");
        const source = codeEl.textContent || "";
        codeEl.empty();
        renderHighlightedCode(source, codeEl);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    this.register(() => observer.disconnect());
  }
}
