import { stripCommentsAndStrings } from "../src/config/strip.ts";

const cases = [
  ["plain", "const a = 1;"],
  ["line comment", "const a = 1; // env.X\nconst b = 2;"],
  ["block comment", "const a = /* env.X */ 1;"],
  ["unterminated block comment", "const a = 1; /* never ends\nconst SECRET = 2;"],
  ["regex with quotes", "const R = /[\"'`]/g;\nconst B = 2;"],
  ["division after ident", "const x = a / b;\nconst SECRET = 2;"],
  ["template nested", "const s = `a ${`b ${env.X} c`} d`;\nconst SECRET = 2;"],
  ["template obj literal", "const s = `${ {a: 1} }`;\nconst SECRET = 2;"],
  ["class private", "class A { #x = 1; get x(){ return this.#x; } }\nconst SECRET = 2;"],
  ["private in obj", "const o = { #p: 1, read(){ return this.#p } };\nconst SECRET = 2;"],
  ["decorator", "@dec()\nclass A {}\nconst SECRET = 2;"],
  ["jsx", "const a = <div className=\"env.IN_JSX_ATTR\">{env.FOO}</div>;\nconst SECRET = 2;"],
  ["comment with quotes", "// don't touch \"env.IN_COMMENT\nconst SECRET = 2;"],
  ["block comment with quotes", "/* don't \"env.IN_COMMENT2 */\nconst SECRET = 2;"],
  ["unterminated string", "const a = \"oops\nconst SECRET = 2;"],
  ["regex flags", "const R = /abc/gi; const SECRET = 2;"],
  ["regex after keyword", "return /env\\s+/.test(x); const SECRET = 2;"],
  ["regex in interpolation w/ brace", "const s = `${/}/.test(x)}`; const SECRET = 2;"],
  ["ts generic arrow", "const f = <T,>(x: T) => x; const SECRET = 2;"],
  ["unicode astral", "const s = \"\u{1F600}\";\nconst SECRET = 2;"],
  ["line cont in string", "const s = \"a\\\nb\";\nconst SECRET = 2;"],
];

for (const [name, src] of cases) {
  let out;
  try { out = stripCommentsAndStrings(src); }
  catch (e) { console.log("THROW " + name + ": " + e.message); continue; }
  const sameLen = out.length === src.length;
  const sameLines = out.split("\n").length === src.split("\n").length;
  let flags = "";
  if (!sameLen) flags += " LEN-MISMATCH(" + src.length + "->" + out.length + ")";
  if (!sameLines) flags += " LINE-MISMATCH";
  console.log((flags ? "FAIL" : "ok  ") + " " + name + flags);
  if (flags) {
    console.log("   src: " + JSON.stringify(src));
    console.log("   out: " + JSON.stringify(out));
  }
}
