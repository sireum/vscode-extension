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
const sysmlTaskLabelPrefix = "sysml";
const logikaTaskLabelPrefix = "verifier";
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
  public type!: string;
  public taskLabel!: string;
  public cliArgs!: string;
  public focus!: boolean;
  public fileExtensions: undefined | string[];
  public abstract start(
    context: vscode.ExtensionContext,
    e: vscode.TaskProcessStartEvent
  ): void;
  public abstract post(
    context: vscode.ExtensionContext,
    e: vscode.TaskProcessEndEvent
  ): void;
  public run(context: vscode.ExtensionContext, workspaceRoots: string): void {
    if (this.fileExtensions) {
      let found = false;
      for (const ext in this.fileExtensions) {
        const b = vscode.window.activeTextEditor?.document.fileName.endsWith(`.${this.fileExtensions}`);
        if (b) {
          found = true;
        }
      }
      if (!found) {
        let exts = `.${this.fileExtensions[0]}`;
        const size = this.fileExtensions.length;
        for (let i = 1; i < size; i++) {
          if (i == size - 1) {
            exts = `${exts}, or a .${this.fileExtensions[i]}`
          } else {
            exts = `${exts}, a .${this.fileExtensions[i]}`
          }
        }
        vscode.window.showInformationMessage(`Task "${this.type} ${this.taskLabel}" can only be used for a ${exts} file`);
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
    vscode.tasks.executeTask(getTask(this.type!, this.taskLabel, command, this.focus));
  }
}

abstract class InstallTask extends Task {
  type = SireumTaskProvider.TYPE;
  fileExtensions = undefined;
  start(
    context: vscode.ExtensionContext,
    e: vscode.TaskProcessStartEvent
  ): void {}
  post(context: vscode.ExtensionContext, e: vscode.TaskProcessEndEvent): void {}
}

class InstallFonts extends InstallTask { 
  taskLabel = "--install-fonts";
  command = "${command:org.sireum.install.fonts}";
  cliArgs = `${sireumScript} --install-fonts`;
  focus = true;
}

class InstallDeps extends InstallTask {
  taskLabel = "--init";
  command = "${command:org.sireum.install.deps}";
  cliArgs = `${sireumScript} --init`;
  focus = true;
}

class InstallIve extends InstallTask {
  taskLabel = "--setup";
  command = "${command:org.sireum.install.ive}";
  cliArgs = `${sireumScript} --setup`;
  focus = true;
}

abstract class SysMLTask extends Task {
  type = SireumHamrTaskProvider.TYPE;
  fileExtensions = ["sysml"];
  start(
    context: vscode.ExtensionContext,
    e: vscode.TaskProcessStartEvent
  ): void {}
  post(context: vscode.ExtensionContext, e: vscode.TaskProcessEndEvent): void {}
}

class TipeSysmlTask extends SysMLTask {
  taskLabel = `${sysmlTaskLabelPrefix} tipe`;
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
    hoverMessage: hoverText? new vscode.MarkdownString(`~~~raw~~~\n${hoverText}`) : undefined,
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
  static COMMAND = "${command:org.sireum.logika.clear}";
  command = LogikaClearCommand.COMMAND;
  public run(context: vscode.ExtensionContext, workspaceRoots: string): void {
    clearDecorations();
  }
}

abstract class LogikaTask extends Task {
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
      0,
      o.pos.beginLine - 1,
      0
    );
  }
  processState(
    context: vscode.ExtensionContext,
    e: vscode.TextEditor,
    o: any
  ): void {
    const imagesPath = context.asAbsolutePath("images");
    const lightIcon = `${imagesPath}${fsep}gutter-hint@2x.png`;
    const darkIcon = `${imagesPath}${fsep}gutter-hint@2x_dark.png`;
    decorate(
      false,
      o.type,
      e,
      lightIcon,
      darkIcon,
      `${o.claims}`,
      o.pos.beginLine - 1,
      0,
      o.pos.beginLine - 1,
      0
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
      `${o.message}`,
      o.pos.beginLine - 1,
      0,
      o.pos.beginLine - 1,
      0
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
          if (!o.pos) {
            o.pos = o.posOpt.value;
          }
          vscode.window.visibleTextEditors.forEach((e) => {
            if (e.document.uri == o.pos.uriOpt.value) {
              switch (o.type) {
                case "Logika.Verify.Smt2Query":
                  this.processSmt2Query(context, e, o);
                  break;
                case "Logika.Verify.Info":
                  this.processInfo(context, e, o);
                  break;
                case "Logika.Verify.State":
                  this.processState(context, e, o);
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

abstract class LogikaSysmlTask extends LogikaTask {
  type = SireumHamrTaskProvider.TYPE;
  fileExtensions = ["sysml"];
}

class LogikaSysmlAllTask extends LogikaSysmlTask {
  taskLabel = `${sysmlTaskLabelPrefix} logika (all)`;
  command = "${command:org.sireum.hamr.sysml.logika.all}";
  cliArgs = `${sireumScript} hamr sysml logika --parseable-messages ${feedbackPlaceHolder} --sourcepath "${workspaceRootsPlaceHolder}"`;
  focus = false;
}

class LogikaSysmlFileTask extends LogikaSysmlTask {
  taskLabel = `${sysmlTaskLabelPrefix} logika (file)`;
  command = "${command:org.sireum.hamr.sysml.logika.file}";
  cliArgs = `${sireumScript} hamr sysml logika --parseable-messages ${feedbackPlaceHolder} --sourcepath "${workspaceRootsPlaceHolder}" "\${file}"`;
  focus = false;
}

class LogikaSysmlLineTask extends LogikaSysmlTask {
  taskLabel = `${sysmlTaskLabelPrefix} logika (line)`;
  command = "${command:org.sireum.hamr.sysml.logika.line}";
  cliArgs = `${sireumScript} hamr sysml logika --parseable-messages ${feedbackPlaceHolder} --sourcepath "${workspaceRootsPlaceHolder}" --line \${lineNumber} "\${file}"`;
  focus = false;
}

class CodeGenTask extends SysMLTask {
  type = SireumHamrTaskProvider.TYPE;
  taskLabel = `${sysmlTaskLabelPrefix} codegen`;
  command = "${command:org.sireum.hamr.sysml.codegen}";
  cliArgs = `${sireumScript} hamr sysml codegen --parseable-messages --sourcepath "$workspaceRoots" --line \${lineNumber} --platform ${PickCodeGenTarget.COMMAND} "\${file}"`;
  focus = true;
}

class CodeGenConfigTask extends SysMLTask {
  type = SireumHamrTaskProvider.TYPE;
  taskLabel = `${sysmlTaskLabelPrefix} config`;
  command = "${command:org.sireum.hamr.sysml.config}";
  cliArgs = `${sireumScript} hamr sysml config --parseable-messages "\${file}"`;
  focus = false;
}

abstract class SlangScTask extends Task {
  type = SireumSlangTaskProvider.TYPE;
  fileExtensions = ["sc"];
  start(
    context: vscode.ExtensionContext,
    e: vscode.TaskProcessStartEvent
  ): void {}
  post(context: vscode.ExtensionContext, e: vscode.TaskProcessEndEvent): void {}
}

class RunScTask extends SlangScTask {
  taskLabel = `run`;
  command = "${command:org.sireum.slang.run}";
  cliArgs = `${sireumScript} slang run "\${file}"`;
  focus = true;
}

class TipeScTask extends SlangScTask {
  taskLabel = `tipe`;
  command = "${command:org.sireum.slang.tipe}";
  cliArgs = `${sireumScript} slang tipe --parseable-messages "\${file}"`;
  focus = false;
}

abstract class LogikaScTask extends LogikaTask {
  type = SireumLogikaTaskProvider.TYPE;
  fileExtensions = ["sc"];
  post(context: vscode.ExtensionContext, e: vscode.TaskProcessEndEvent): void {
    super.post(context, e);
    vscode.window.showInformationMessage(e.exitCode == 0? "Logika verified" : "Ill-formed program");
  }
}

class LogikaScFileTask extends LogikaScTask {
  fileExtensions = ["sc", "logika"];
  taskLabel = `${logikaTaskLabelPrefix} (file)`;
  command = "${command:org.sireum.logika.verifier.file}";
  cliArgs = `${sireumScript} logika verifier --parseable-messages --log-detailed-info ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class LogikaScLineTask extends LogikaScTask {
  taskLabel = `${logikaTaskLabelPrefix} (line)`;
  command = "${command:org.sireum.logika.verifier.line}";
  cliArgs = `${sireumScript} logika verifier --parseable-messages --log-detailed-info ${feedbackPlaceHolder} --line \${lineNumber} "\${file}"`;
  focus = false;
}

export function getTask(
  type: string,
  kind: string,
  args: string,
  focus: boolean
): vscode.Task {
  const t = new vscode.Task(
    { type: type, kind: kind },
    vscode.TaskScope.Workspace,
    kind,
    type,
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
    const ts = sireumTasks.map((ct) => getTask(SireumTaskProvider.TYPE, ct.taskLabel, ct.command, ct.focus));
    return ts;
  }

  async provideTasks(): Promise<vscode.Task[]> {
    return this.tasks;
  }
  resolveTask(_task: vscode.Task): vscode.Task | undefined {
    return undefined;
  }
}

export class SireumSlangTaskProvider implements vscode.TaskProvider {
  static TYPE = "sireum slang";
  tasks: vscode.Task[] = this.getTasks();

  getTasks(): vscode.Task[] {
    const ts = slangTasks.map((ct) => getTask(SireumSlangTaskProvider.TYPE, ct.taskLabel, ct.command, ct.focus));
    return ts;
  }

  async provideTasks(): Promise<vscode.Task[]> {
    return this.tasks;
  }
  resolveTask(_task: vscode.Task): vscode.Task | undefined {
    return undefined;
  }
}

export class SireumHamrTaskProvider implements vscode.TaskProvider {
  static TYPE = "sireum hamr";
  tasks: vscode.Task[] = this.getTasks();

  getTasks(): vscode.Task[] {
    const ts = hamrTasks.map((ct) => getTask(SireumHamrTaskProvider.TYPE, ct.taskLabel, ct.command, ct.focus));
    ts.push(
      getTask(SireumHamrTaskProvider.TYPE, "logika clear", LogikaClearCommand.COMMAND, false)
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

export class SireumLogikaTaskProvider implements vscode.TaskProvider {
  static TYPE = "sireum logika";
  tasks: vscode.Task[] = this.getTasks();

  getTasks(): vscode.Task[] {
    const ts = logikaTasks.map((ct) => getTask(SireumLogikaTaskProvider.TYPE, ct.taskLabel, ct.command, ct.focus));
    ts.push(
      getTask(SireumLogikaTaskProvider.TYPE, "clear", LogikaClearCommand.COMMAND, false)
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

export const sireumTasks: Task[] = [
  new InstallFonts(),
  new InstallDeps(),
  new InstallIve(),
];

export const hamrTasks: Task[] = [
  new TipeSysmlTask(),
  new LogikaSysmlLineTask(),
  new LogikaSysmlFileTask(),
  new LogikaSysmlAllTask(),
  new CodeGenConfigTask(),
  new CodeGenTask()
];

export const slangTasks: Task[] = [
  new TipeScTask(),
  new RunScTask()
];

export const logikaTasks: Task[] = [
  new LogikaScFileTask(),
  new LogikaScLineTask()
];

export const commands: Command<any>[] = [
  new PickCodeGenTarget(),
  new LogikaClearCommand(),
  ...sireumTasks,
  ...hamrTasks,
  ...slangTasks,
  ...logikaTasks,
];
