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
import fs = require("fs");

const tmp = require("tmp");

export const isWindows = process.platform === "win32";
export const psep = isWindows ? ";" : ":";
export const fsep = isWindows ? "\\" : "/";
const ext = isWindows ? ".bat" : "";
const sireumScript = `"\${env:SIREUM_HOME}\${pathSeparator}bin\${pathSeparator}sireum${ext}"`;
const taskLabelPrefix = "hamr sysml";
const feedbackPlaceHolder = "$feedback";
const workspaceRootsPlaceHolder = "$workspaceRoots";

export abstract class Command<T> {
  public command!: string;
  public commandId(): string {
    return this.command.substring("${command:".length, this.command.length - 1);
  }
  public abstract run(
    context: vscode.ExtensionContext,
    workspaceRoots: string
  ): T;
}

class PickCodeGenTarget extends Command<string> {
  static COMMAND = "${command:org.sireum.hamr.codegen.pickTarget}";
  command = PickCodeGenTarget.COMMAND;
  run(context: vscode.ExtensionContext, workspaceRoots: string): any {
    const pick = vscode.window.showQuickPick(
      ["JVM", "Linux", "Cygwin", "macOS", "seL4", "seL4_Only", "seL4_TB", "Microkit", "ros2"],
      { title: "HAMR CodeGen Target", canPickMany: false }
    );
    return pick;
  }
}

export abstract class Task extends Command<void> {
  public taskLabel!: string;
  public cliArgs!: string;
  public focus!: boolean;
  public fileExtension: undefined | string;
  public abstract start(
    context: vscode.ExtensionContext,
    e: vscode.TaskProcessStartEvent
  ): void;
  public abstract post(
    context: vscode.ExtensionContext,
    e: vscode.TaskProcessEndEvent
  ): void;
  public run(context: vscode.ExtensionContext, workspaceRoots: string): void {
    if (this.fileExtension) {
      const b = vscode.window.activeTextEditor?.document.fileName.endsWith(`.${this.fileExtension}`);
      if (b == undefined || !b) {
        vscode.window.showInformationMessage(`Task "sireum ${this.taskLabel}" can only be used for a .sysml file`);
        return;
      }
    }
    let command = this.cliArgs.replaceAll(
      workspaceRootsPlaceHolder,
      workspaceRoots
    );
    if (command.indexOf(feedbackPlaceHolder)) {
      const path = tmp.dirSync().name;
      command = command.replaceAll(feedbackPlaceHolder, `--feedback "${path}"`);
    }
    vscode.tasks.executeTask(getTask(this.taskLabel, command, this.focus));
  }
}

abstract class SysMLTask extends Task {
  fileExtension = "sysml"
}

class TipeTask extends SysMLTask {
  taskLabel = `${taskLabelPrefix} tipe`;
  command = "${command:org.sireum.hamr.sysml.tipe}";
  cliArgs = `${sireumScript} hamr sysml tipe --parseable-messages --sourcepath "$workspaceRoots"`;
  focus = false;
  start(
    context: vscode.ExtensionContext,
    e: vscode.TaskProcessStartEvent
  ): void {}
  post(context: vscode.ExtensionContext, e: vscode.TaskProcessEndEvent): void {}
}

let decorations: Map<
  string,
  [vscode.TextEditorDecorationType, vscode.DecorationOptions[]]
>;
let linesMap: Map<string, Set<number>>;

function decorate(
  isCoverage: boolean,
  kind: string,
  e: vscode.TextEditor,
  lightIcon: string | undefined,
  darkIcon: string | undefined,
  hoverText: string | undefined,
  beginLine: number,
  beginColumn: number,
  endLine: number,
  endColumn: number
) {
  if (!decorations) {
    decorations = new Map();
  }
  let p = decorations.get(kind);
  if (!p) {
    const orColor = `rgba(129, 62, 200, 0.2)`
    const bgColor =  isCoverage ? orColor : undefined;
    const iconSize = darkIcon ? "75%" : undefined;
    const documentDecorationType = vscode.window.createTextEditorDecorationType(
      {
        isWholeLine: true,
        light: {
          gutterIconPath: lightIcon,
          gutterIconSize: iconSize,
          backgroundColor: bgColor,
          overviewRulerColor: bgColor,
        },
        dark: {
          gutterIconPath: darkIcon,
          gutterIconSize: iconSize,
          backgroundColor: bgColor,
          overviewRulerColor: bgColor,
        },
      }
    );
    p = [documentDecorationType, []];
  }
  p![1].push({
    range: new vscode.Range(
      new vscode.Position(beginLine, beginColumn),
      new vscode.Position(endLine, endColumn)
    ),
    hoverMessage: new vscode.MarkdownString(`~~~raw~~~ ${hoverText}`),
  });
  decorations.set(kind, p);
  e.setDecorations(p![0], p![1]);
}

function clearDecorations() {
  if (decorations) {
    vscode.window.visibleTextEditors.forEach((e) => {
      decorations.forEach((p) => {
        e.setDecorations(p[0], []);
      });
      decorations.forEach((p) => p[0].dispose);
      decorations.clear();
    });
  }
  linesMap?.clear();
}

class LogikaClearCommand extends Command<void> {
  static COMMAND = "${command:org.sireum.hamr.sysml.logika.clear}";
  command = LogikaClearCommand.COMMAND;
  public run(context: vscode.ExtensionContext, workspaceRoots: string): void {
    clearDecorations();
  }
}

abstract class LogikaTask extends SysMLTask {
  ac = new AbortController();
  feedback: string | undefined = undefined;
  processSmt2Query(
    context: vscode.ExtensionContext,
    e: vscode.TextEditor,
    o: any
  ): void {
    const imagesPath = context.asAbsolutePath("images");
    const lightIcon = `${imagesPath}${fsep}gutter-summoning@2x.png`;
    const darkIcon = `${imagesPath}${fsep}gutter-summoning@2x_dark.png`;
    decorate(
      false,
      o.type,
      e,
      lightIcon,
      darkIcon,
      `${o.info}\n${o.query}`,
      o.pos.beginLine - 1,
      o.pos.beginColumn - 1,
      o.pos.endLine - 1,
      o.pos.endColumn - 1
    );
  }
  processInfo(
    context: vscode.ExtensionContext,
    e: vscode.TextEditor,
    o: any
  ): void {
    const imagesPath = context.asAbsolutePath("images");
    const lightIcon = `${imagesPath}${fsep}gutter-logika-verified@2x.png`;
    const darkIcon = `${imagesPath}${fsep}gutter-logika-verified@2x_dark.png`;
    decorate(
      false,
      o.type,
      e,
      lightIcon,
      darkIcon,
      `${o.info}\n${o.query}`,
      o.pos.beginLine,
      o.pos.beginColumn,
      o.pos.endLine,
      o.pos.endColumn
    );
  }
  processCoverage(e: vscode.TextEditor, o: any) {
    if (!linesMap) {
      linesMap = new Map();
    }
    let lines = linesMap.get(e.document.fileName);
    if (!lines) {
      lines = new Set();
    }
    for (let line = o.pos.beginLine; line <= o.pos.endLine; line += 1) {
      if (!lines.has(line)) {
        lines.add(line);
        decorate(
          true,
          o.type,
          e,
          undefined,
          undefined,
          undefined,
          line - 1,
          0,
          line - 1,
          0
        );
      }
    }
    linesMap.set(e.document.fileName, lines);
  }
  start(
    context: vscode.ExtensionContext,
    e: vscode.TaskProcessStartEvent
  ): void {
    clearDecorations();
    const cliArgs = (e.execution.task.execution! as vscode.ShellExecution)
      .commandLine!;
    if (cliArgs.indexOf("--feedback") < 0) return;
    const i = cliArgs.indexOf('"', cliArgs.indexOf("--feedback"));
    const j = cliArgs.indexOf('"', i + 1);
    this.feedback = cliArgs.substring(i + 1, j);
    const watcher = fs.promises.watch(this.feedback!, {
      recursive: true,
      signal: this.ac.signal,
    });
    (async () => {
      for await (const e of watcher) {
        if (e.filename) {
          const o = JSON.parse(
            fs.readFileSync(`${this.feedback}${fsep}${e.filename!}`, "utf8")
          );
          vscode.window.visibleTextEditors.forEach((e) => {
            if (e.document.uri == o.pos.uriOpt.value) {
              switch (o.type) {
                case "Logika.Verify.Smt2Query":
                  this.processSmt2Query(context, e, o);
                  break;
                case "Logika.Verify.Info":
                  this.processInfo(context, e, o);
                  break;
                case "Analysis.Coverage":
                  this.processCoverage(e, o);
                  break;
                default:
                  console.log(o);
              }
            }
          });
        }
      }
    })().catch((e) => {});
  }
  post(context: vscode.ExtensionContext, e: vscode.TaskProcessEndEvent): void {
    this.ac.abort();
    if (this.feedback)
      fs.promises
        .rm(this.feedback!, { recursive: true, force: true })
        .catch((e) => {});
    this.ac = new AbortController();
  }
}

class LogikaAllTask extends LogikaTask {
  taskLabel = `${taskLabelPrefix} logika all`;
  command = "${command:org.sireum.hamr.sysml.logika.all}";
  cliArgs = `${sireumScript} hamr sysml logika --parseable-messages ${feedbackPlaceHolder} --sourcepath "${workspaceRootsPlaceHolder}"`;
  focus = false;
}

class LogikaFileTask extends LogikaTask {
  taskLabel = `${taskLabelPrefix} logika file`;
  command = "${command:org.sireum.hamr.sysml.logika.file}";
  cliArgs = `${sireumScript} hamr sysml logika --parseable-messages ${feedbackPlaceHolder} --sourcepath "${workspaceRootsPlaceHolder}" "\${file}"`;
  focus = false;
}

class LogikaLineTask extends LogikaTask {
  taskLabel = `${taskLabelPrefix} logika line`;
  command = "${command:org.sireum.hamr.sysml.logika.line}";
  cliArgs = `${sireumScript} hamr sysml logika --parseable-messages ${feedbackPlaceHolder} --sourcepath "${workspaceRootsPlaceHolder}" --line \${lineNumber} "\${file}"`;
  focus = false;
}

class CodeGenTask extends SysMLTask {
  taskLabel = `${taskLabelPrefix} codegen`;
  command = "${command:org.sireum.hamr.sysml.codegen}";
  cliArgs = `${sireumScript} hamr sysml codegen --parseable-messages --sourcepath "$workspaceRoots" --line \${lineNumber} --platform ${PickCodeGenTarget.COMMAND} "\${file}"`;
  focus = true;
  start(
    context: vscode.ExtensionContext,
    e: vscode.TaskProcessStartEvent
  ): void {}
  post(context: vscode.ExtensionContext, e: vscode.TaskProcessEndEvent): void {}
}

class CodeGenConfigTask extends SysMLTask {
  taskLabel = `${taskLabelPrefix} config`;
  command = "${command:org.sireum.hamr.sysml.config}";
  cliArgs = `${sireumScript} hamr sysml config --parseable-messages "\${file}"`;
  focus = false;
  start(
    context: vscode.ExtensionContext,
    e: vscode.TaskProcessStartEvent
  ): void {}
  post(context: vscode.ExtensionContext, e: vscode.TaskProcessEndEvent): void {}
}

export function getTask(
  kind: string,
  args: string,
  focus: boolean
): vscode.Task {
  const t = new vscode.Task(
    { type: SireumTaskProvider.TYPE, kind: kind },
    vscode.TaskScope.Workspace,
    kind,
    SireumTaskProvider.TYPE,
    new vscode.ShellExecution(args),
    ["$sireumProblemMatcher"]
  );
  t.presentationOptions = {
    echo: true,
    focus: focus,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: true,
    showReuseMessage: false,
    reveal: focus ? vscode.TaskRevealKind.Always : vscode.TaskRevealKind.Never,
  };
  return t;
}

export class SireumTaskProvider implements vscode.TaskProvider {
  static TYPE = "sireum";
  tasks: vscode.Task[] = this.getTasks();

  getTasks(): vscode.Task[] {
    const ts = tasks.map((ct) => getTask(ct.taskLabel, ct.command, ct.focus));
    ts.push(
      getTask("hamr sysml logika clear", LogikaClearCommand.COMMAND, false)
    );
    return ts;
  }

  async provideTasks(): Promise<vscode.Task[]> {
    return this.tasks;
  }
  resolveTask(_task: vscode.Task): vscode.Task | undefined {
    return undefined;
  }
}

export const tasks: Task[] = [
  new TipeTask(),
  new LogikaLineTask(),
  new LogikaFileTask(),
  new LogikaAllTask(),
  new CodeGenConfigTask(),
  new CodeGenTask(),
];

export const commands: Command<any>[] = [
  new PickCodeGenTarget(),
  new LogikaClearCommand(),
  ...tasks,
];
