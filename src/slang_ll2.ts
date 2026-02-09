import * as vscode from "vscode";
import * as antlr4 from "antlr4";
// @ts-ignore
import SlangLl2Lexer from "../include/SlangLl2Lexer.js";
// @ts-ignore
import SlangLl2Parser from "../include/SlangLl2Parser.js";

const problems = vscode.languages.createDiagnosticCollection("Slang LL(2) Parser");

class SlangErrorListener implements antlr4.ErrorListener<antlr4.Token> {
  uri: vscode.Uri;
  hasError: boolean;

  constructor(uri: vscode.Uri) {
    this.uri = uri;
    this.hasError = false;
  }

  syntaxError(
    recognizer: any,
    offendingSymbol: any,
    line: number,
    charPositionInLine: number,
    msg: string,
    e: antlr4.RecognitionException | undefined,
  ): void {
    if (this.hasError) return;
    this.hasError = true;
    var text = offendingSymbol.text;
    if (!text) {
      text = String(offendingSymbol);
    }
    const lines = String(text).split("\n");
    const eline = line + lines.length - 1;
    var ecolumn = lines[lines.length - 1].length;
    if (eline == line) {
      ecolumn = ecolumn + charPositionInLine;
    }
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(line - 1, charPositionInLine, eline - 1, ecolumn),
      msg,
      vscode.DiagnosticSeverity.Error,
    );
    problems.set(this.uri, [diagnostic]);
  }
}

export function checkTextDocument(e: vscode.TextDocument) {
  problems.delete(e.uri);
  const chars = new antlr4.InputStream(e.getText());
  const lexer: antlr4.Lexer = new SlangLl2Lexer(chars);
  const errorListener = new SlangErrorListener(e.uri);
  lexer.addErrorListener(errorListener);
  const tokens = new antlr4.CommonTokenStream(lexer);
  const parser: antlr4.Parser = new SlangLl2Parser(tokens);
  parser.addErrorListener(errorListener);
  (parser as SlangLl2Parser).file();
}
