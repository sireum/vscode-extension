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

const isWindows = process.platform === "win32";
const ext = isWindows ? ".bat" : "";
const sireum = "\"${env:SIREUM_HOME}${pathSeparator}bin${pathSeparator}sireum" + ext + "\" "
const po: vscode.TaskPresentationOptions = {
  echo: false,
  focus: false,
  panel: vscode.TaskPanelKind.Dedicated,
  clear: true,
  showReuseMessage: false,
  reveal: vscode.TaskRevealKind.Never,
};

export function activate(context: vscode.ExtensionContext) {
  const workspaceFolders =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders
      : undefined;
  if (workspaceFolders) {
    workspaceFolders.forEach((f) =>
      vscode.tasks.registerTaskProvider(
        SireumTaskProvider.SireumType,
        new SireumTaskProvider(f.uri.fsPath)
      )
    );
  }
}

export class SireumTaskProvider implements vscode.TaskProvider {
  static SireumType = "sireum";
  private tasks: vscode.Task[] | undefined;

  constructor(private workspaceRoot: string) {}

  public async provideTasks(): Promise<vscode.Task[]> {
    return this.getTasks();
  }

  public resolveTask(_task: vscode.Task): vscode.Task | undefined {
    return undefined;
  }

  private getTask(kind: string, args: string, focus: boolean): vscode.Task {
    const t = new vscode.Task(
      { type: SireumTaskProvider.SireumType, kind: kind },
      vscode.TaskScope.Workspace,
      kind,
      SireumTaskProvider.SireumType,
      new vscode.ShellExecution(
        sireum + args
      ),
      ["$sireumProblemMatcher"]
    );
    t.presentationOptions = {
      echo: false,
      focus: focus,
      panel: vscode.TaskPanelKind.Dedicated,
      clear: true,
      showReuseMessage: false,
      reveal: focus? vscode.TaskRevealKind.Always : vscode.TaskRevealKind.Never,
    };
    return t;
  }

  private getTasks(): vscode.Task[] {
    if (this.tasks !== undefined) {
      return this.tasks;
    }
    this.tasks = [];
    const workspaceFolders =
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders
        : undefined;
    if (workspaceFolders) {
      const workspaceRoot = workspaceFolders
        .map((f) => f.uri.fsPath)
        .join(isWindows ? ";" : ":");
      this.tasks!.push(this.getTask("hamr sysml tipe", "hamr sysml tipe --parseable-messages --sourcepath \"${workspaceRoot}\"", false));
      this.tasks!.push(this.getTask("hamr sysml codegen", "hamr sysml codegen --parseable-messages --sourcepath \"${workspaceRoot}\" --line ${lineNumber} \"${file}\"", true));
      this.tasks!.push(this.getTask("hamr sysml logika line", "hamr sysml logika --parseable-messages --sourcepath \"${workspaceRoot}\" --line ${lineNumber} \"${file}\"", false));
      this.tasks!.push(this.getTask("hamr sysml logika file", "hamr sysml logika --parseable-messages --sourcepath \"${workspaceRoot}\" \"${file}\"", false));
      this.tasks!.push(this.getTask("hamr sysml logika all", "hamr sysml logika --parseable-messages --sourcepath \"${workspaceRoot}\"", false));
    }
    return this.tasks;
  }
}
