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
import * as deflater from "./deflater";
import fs = require("fs");

const tmp = require("tmp");

export const isWindows = process.platform === "win32";
export const psep = isWindows ? ";" : ":";
const ext = isWindows ? ".bat" : "";
const sireumScript = `"\${env:SIREUM_HOME}\${pathSeparator}bin\${pathSeparator}sireum${ext}"`;
const taskLabelPrefix = "hamr sysml";
const feedbackPlaceHolder = "$feedback";
const workspaceRootsPlaceHolder = "$workspaceRoots";
const jvmTargetKey = "org.sireum.hamr.codegen.target.jvm";
const macOSTargetKey = "org.sireum.hamr.codegen.target.macos";
const linuxTargetKey = "org.sireum.hamr.codegen.target.linux";
const cygwinTargetKey = "org.sireum.hamr.codegen.target.cygwin";
const sel4TargetKey = "org.sireum.hamr.codegen.target.sel4";
const sel4OnlyTargetKey = "org.sireum.hamr.codegen.target.sel4_only";
const sel4TBTargetKey = "org.sireum.hamr.codegen.target.sel4_tb";

export abstract class Command<T> {
  public command!: string;
  public commandId(): string {
    return this.command.substring("${command:".length, this.command.length - 1);
  }
  public abstract run(workspaceRoots: string): T;
}

class PickCodeGenTarget extends Command<string> {
  static COMMAND = "${command:org.sireum.hamr.codegen.pickTarget}";
  command = PickCodeGenTarget.COMMAND;
  run(workspaceRoots: string): any {
    const pick = vscode.window.showQuickPick(
      ["JVM", "macOS", "Linux", "Cygwin", "seL4", "seL4_Only", "seL4_TB"],
      { title: "HAMR CodeGen Target", canPickMany: false }
    );
    return pick;
  }
}

class GetCodeGenTargetProperties extends Command<string> {
  static COMMAND = "${command:org.sireum.hamr.codegen.getTargetProperties}";
  command = GetCodeGenTargetProperties.COMMAND;
  run(workspaceRoots: string): any {
    const content = JSON.stringify({
      jvm: vscode.workspace.getConfiguration(jvmTargetKey),
      macos: vscode.workspace.getConfiguration(macOSTargetKey),
      linux: vscode.workspace.getConfiguration(linuxTargetKey),
      cygwin: vscode.workspace.getConfiguration(cygwinTargetKey),
      sel4: vscode.workspace.getConfiguration(sel4TargetKey),
      sel4Only: vscode.workspace.getConfiguration(sel4OnlyTargetKey),
      sel4TB: vscode.workspace.getConfiguration(sel4TBTargetKey),
    });
    const path = tmp.fileSync().name;
    fs.writeFileSync(path, deflater.deflate(JSON.parse(content)).join("\n"));
    return path;
  }
}

export abstract class Task extends Command<void> {
  public taskLabel!: string;
  public cliArgs!: string;
  public focus!: boolean;
  public abstract start(e: vscode.TaskProcessStartEvent): void;
  public abstract post(e: vscode.TaskProcessEndEvent): void;
  public run(workspaceRoots: string): void {
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

class TipeTask extends Task {
  taskLabel = `${taskLabelPrefix} tipe`;
  command = "${command:org.sireum.hamr.sysml.tipe}";
  cliArgs = `${sireumScript} hamr sysml tipe --parseable-messages --sourcepath "$workspaceRoots"`;
  focus = false;
  start(e: vscode.TaskProcessStartEvent): void {}
  post(e: vscode.TaskProcessEndEvent): void {}
}

class LogikaAllTask extends Task {
  taskLabel = `${taskLabelPrefix} logika all`;
  command = "${command:org.sireum.hamr.sysml.logika.all}";
  cliArgs = `${sireumScript} hamr sysml logika --parseable-messages ${feedbackPlaceHolder} --sourcepath "${workspaceRootsPlaceHolder}"`;
  focus = false;
  start(e: vscode.TaskProcessStartEvent): void {}
  post(e: vscode.TaskProcessEndEvent): void {}
}

class LogikaFileTask extends Task {
  taskLabel = `${taskLabelPrefix} logika file`;
  command = "${command:org.sireum.hamr.sysml.logika.file}";
  cliArgs = `${sireumScript} hamr sysml logika --parseable-messages ${feedbackPlaceHolder} --sourcepath "${workspaceRootsPlaceHolder}" "\${file}"`;
  focus = false;
  start(e: vscode.TaskProcessStartEvent): void {}
  post(e: vscode.TaskProcessEndEvent): void {}
}

class LogikaLineTask extends Task {
  taskLabel = `${taskLabelPrefix} logika line`;
  command = "${command:org.sireum.hamr.sysml.logika.line}";
  cliArgs = `${sireumScript} hamr sysml logika --parseable-messages ${feedbackPlaceHolder} --sourcepath "${workspaceRootsPlaceHolder}" --line \${lineNumber} "\${file}"`;
  focus = false;
  start(e: vscode.TaskProcessStartEvent): void {}
  post(e: vscode.TaskProcessEndEvent): void {}
}

class CodeGenTask extends Task {
  taskLabel = `${taskLabelPrefix} codegen`;
  command = "${command:org.sireum.hamr.sysml.codegen}";
  cliArgs = `${sireumScript} hamr sysml codegen --parseable-messages --sourcepath "$workspaceRoots" --line \${lineNumber} "\${file}"`;
  focus = true;
  start(e: vscode.TaskProcessStartEvent): void {}
  post(e: vscode.TaskProcessEndEvent): void {}
}

class CodeGenConfigTask extends Task {
  taskLabel = `${taskLabelPrefix} config`;
  command = "${command:org.sireum.hamr.sysml.config}";
  cliArgs = `${sireumScript} hamr sysml config --parseable-messages --target ${PickCodeGenTarget.COMMAND} --properties "${GetCodeGenTargetProperties.COMMAND}" "\${file}"`;
  focus = false;
  start(e: vscode.TaskProcessStartEvent): void {}
  post(e: vscode.TaskProcessEndEvent): void {}
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
  tasks: vscode.Task[] = tasks.map((ct) =>
    getTask(ct.taskLabel, ct.command, ct.focus)
  );
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
  new CodeGenTask()
];

export const commands: Command<any>[] = [
  new PickCodeGenTarget(),
  new GetCodeGenTargetProperties(),
  ...tasks
];