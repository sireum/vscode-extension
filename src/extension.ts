/*
 Copyright (c) 2017-2024, Robby, Kansas State University
 All rights reserved.

 Redistribution and use in source and binary forms, with or without
 modification, are permitted provided that the following conditions are met:

 1. Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
 2. Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation
    and/or other materials provided with the distribution.

 THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
import * as vscode from "vscode";
import * as ct from "./command_task";
import * as slangLl2 from "./slang_ll2";
import { LanguageClient, LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import * as path from "path";
import * as fs from "fs";

export async function activate(context: vscode.ExtensionContext) {
  const listener = (e: vscode.TextDocument) => {
    if (e.languageId == "slang") slangLl2.checkTextDocument(e);
  };
  vscode.workspace.onDidOpenTextDocument(listener);
  vscode.workspace.onDidSaveTextDocument(listener);
  for (const e of vscode.workspace.textDocuments) {
    if (e.languageId == "slang") slangLl2.checkTextDocument(e);
  }

  await ct.init(context);

  const workspaceFolders =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders
      : [];
  const workspaceRoots = workspaceFolders
    .map((f) => f.uri.fsPath)
    .join(ct.psep);
  for (const f of workspaceFolders) {
    const dotSireum = vscode.Uri.joinPath(f.uri, ".sireum");
    vscode.workspace.fs.stat(dotSireum).then(async (_) => {
      if (await ct.importBuild(f.uri.fsPath, false)) {
        await vscode.commands.executeCommand("metals.build-disconnect");
        vscode.tasks.executeTask(
          ct.getTask(
            ct.importProjectTask.type,
            ct.importProjectTask.taskLabel,
            ct.importProjectTask.command,
            ct.importProjectTask.focus,
          ),
        );
      }
    }, (_) => {});
  }

  const ctMap = new Map<string, ct.Task>();
  ct.sireumTasks.forEach((ct) => ctMap.set(ct.taskLabel, ct));
  ct.slangTasks.forEach((ct) => ctMap.set(ct.taskLabel, ct));
  ct.slangRefactorTasks.forEach((ct) => ctMap.set(ct.taskLabel, ct));
  ct.slangTemplateTasks.forEach((ct) => ctMap.set(ct.taskLabel, ct));
  ct.hamrTasks.forEach((ct) => ctMap.set(ct.taskLabel, ct));
  ct.logikaTasks.forEach((ct) => ctMap.set(ct.taskLabel, ct));
  vscode.tasks.onDidStartTaskProcess((e) =>
    ctMap.get(e.execution.task.name)?.start(context, e),
  );
  vscode.tasks.onDidEndTaskProcess((e) =>
    ctMap.get(e.execution.task.name)?.post(context, e),
  );
  // Start SysML LSP server if the JAR exists
  startSysmlLsp(context);

  ct.commands.forEach((c) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(c.commandId(), () =>
        c.run(context, workspaceRoots),
      ),
    );
  });
  let taskProvider = new ct.SireumTaskProvider();
  workspaceFolders.forEach((f) =>
    vscode.tasks.registerTaskProvider(ct.SireumTaskProvider.TYPE, taskProvider),
  );
  taskProvider = new ct.SireumSlangTaskProvider();
  workspaceFolders.forEach((f) =>
    vscode.tasks.registerTaskProvider(
      ct.SireumSlangTaskProvider.TYPE,
      taskProvider,
    ),
  );
  taskProvider = new ct.SireumSlangRefactorTaskProvider();
  workspaceFolders.forEach((f) =>
    vscode.tasks.registerTaskProvider(
      ct.SireumSlangRefactorTaskProvider.TYPE,
      taskProvider,
    ),
  );
  taskProvider = new ct.SireumSlangTemplateTaskProvider();
  workspaceFolders.forEach((f) =>
    vscode.tasks.registerTaskProvider(
      ct.SireumSlangTemplateTaskProvider.TYPE,
      taskProvider,
    ),
  );
  taskProvider = new ct.SireumHamrTaskProvider();
  workspaceFolders.forEach((f) =>
    vscode.tasks.registerTaskProvider(
      ct.SireumHamrTaskProvider.TYPE,
      taskProvider,
    ),
  );
  taskProvider = new ct.SireumLogikaTaskProvider();
  workspaceFolders.forEach((f) =>
    vscode.tasks.registerTaskProvider(
      ct.SireumLogikaTaskProvider.TYPE,
      taskProvider,
    ),
  );
}


let sysmlClient: LanguageClient | undefined;

function findAnnotationBodyRanges(document: vscode.TextDocument): vscode.Range[] {
  const text = document.getText();
  const ranges: vscode.Range[] = [];
  let idx = 0;
  while (idx < text.length) {
    const start = text.indexOf("/*{", idx);
    if (start === -1) break;
    const end = text.indexOf("}*/", start + 3);
    if (end === -1) break;
    ranges.push(new vscode.Range(
      document.positionAt(start),
      document.positionAt(end + 3),
    ));
    idx = end + 3;
  }
  return ranges;
}

function filterAnnotationBodyTokens(
  document: vscode.TextDocument,
  tokens: vscode.SemanticTokens,
): vscode.SemanticTokens {
  const ranges = findAnnotationBodyRanges(document);
  if (ranges.length === 0) return tokens;

  const data = tokens.data;
  const filtered: number[] = [];
  let prevLine = 0, prevChar = 0;
  let filtPrevLine = 0, filtPrevChar = 0;

  for (let i = 0; i < data.length; i += 5) {
    const dLine = data[i], dChar = data[i + 1], len = data[i + 2];
    const line = prevLine + dLine;
    const char = dLine === 0 ? prevChar + dChar : dChar;
    prevLine = line;
    prevChar = char;

    const pos = new vscode.Position(line, char);
    let skip = false;
    for (const r of ranges) {
      if (r.contains(pos)) { skip = true; break; }
    }
    if (skip) continue;

    const newDLine = line - filtPrevLine;
    const newDChar = newDLine === 0 ? char - filtPrevChar : char;
    filtered.push(newDLine, newDChar, len, data[i + 3], data[i + 4]);
    filtPrevLine = line;
    filtPrevChar = char;
  }

  return new vscode.SemanticTokens(new Uint32Array(filtered), tokens.resultId);
}

async function startSysmlLsp(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("SysML LSP");

  try {
    const sireumHome = vscode.workspace.getConfiguration("sireum").get<string>("home");
    if (!sireumHome) {
      outputChannel.appendLine("sireum.home not configured, SysML LSP not started.");
      return;
    }
    outputChannel.appendLine(`Sireum home: ${sireumHome}`);

    const lspJar = path.join(sireumHome, "lib", "sysml-lsp-server.jar");
    if (!fs.existsSync(lspJar)) {
      outputChannel.appendLine(`SysML LSP JAR not found: ${lspJar}`);
      return;
    }

    const platform = process.platform === "win32" ? "win" :
      process.platform === "darwin" ? "mac" : "linux";
    const javaCmd = path.join(sireumHome, "bin", platform, "java", "bin", "java");
    if (!fs.existsSync(javaCmd)) {
      outputChannel.appendLine(`Java not found: ${javaCmd}`);
      return;
    }

    const sysmlLib = path.join(sireumHome, "lib", "sysml.library");
    const hasLib = fs.existsSync(sysmlLib);
    outputChannel.appendLine(`SysML standard library: ${hasLib ? sysmlLib : "not found"}`);

    outputChannel.appendLine(`Starting SysML LSP: ${javaCmd} -jar ${lspJar}`);

    const serverOptions: ServerOptions = {
      command: javaCmd,
      args: hasLib ? ["-jar", lspJar, "--library", sysmlLib] : ["-jar", lspJar],
    };

    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: "file", language: "sysml" },
        { scheme: "file", language: "kerml" },
      ],
      outputChannel,
      middleware: {
        provideDocumentSemanticTokens: async (document, token, next) => {
          const result = await next(document, token);
          if (!result || result.data.length === 0) return null;
          return filterAnnotationBodyTokens(document, result);
        },
        provideDocumentSemanticTokensEdits: async (document, previousResultId, token, next) => {
          const result = await next(document, previousResultId, token);
          if (!result) return null;
          if ("data" in result) {
            const tokens = result as vscode.SemanticTokens;
            if (tokens.data.length === 0) return null;
            return filterAnnotationBodyTokens(document, tokens);
          }
          return null;
        },
      },
    };

    sysmlClient = new LanguageClient("sysml-lsp", "SysML LSP", serverOptions, clientOptions);
    await sysmlClient.start();
    outputChannel.appendLine("SysML LSP started successfully.");
  } catch (e) {
    outputChannel.appendLine(`SysML LSP failed to start: ${e}`);
  }
}

export async function deactivate() {
  ct.deinit();
  if (sysmlClient) {
    await sysmlClient.stop();
  }
}
