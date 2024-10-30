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

export function activate(context: vscode.ExtensionContext) {
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
    const stat = vscode.workspace.fs.stat(dotSireum);
    stat.then(value => { ct.importBuild(f.uri.fsPath, false); });
  }
  const ctMap = new Map<string, ct.Task>();
  ct.sireumTasks.forEach((ct) => ctMap.set(ct.taskLabel, ct));
  ct.slangTasks.forEach((ct) => ctMap.set(ct.taskLabel, ct));
  ct.slangRefactorTasks.forEach((ct) => ctMap.set(ct.taskLabel, ct));
  ct.slangTemplateTasks.forEach((ct) => ctMap.set(ct.taskLabel, ct));
  ct.hamrTasks.forEach((ct) => ctMap.set(ct.taskLabel, ct));
  ct.logikaTasks.forEach((ct) => ctMap.set(ct.taskLabel, ct));
  vscode.tasks.onDidStartTaskProcess((e) =>
    ctMap.get(e.execution.task.name)?.start(context, e)
  );
  vscode.tasks.onDidEndTaskProcess((e) =>
    ctMap.get(e.execution.task.name)?.post(context, e)
  );
  ct.commands.forEach((c) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(c.commandId(), () =>
        c.run(context, workspaceRoots)
      )
    );
  });
  let taskProvider = new ct.SireumTaskProvider();
  workspaceFolders.forEach((f) =>
    vscode.tasks.registerTaskProvider(ct.SireumTaskProvider.TYPE, taskProvider)
  );
  taskProvider = new ct.SireumSlangTaskProvider();
  workspaceFolders.forEach((f) =>
    vscode.tasks.registerTaskProvider(ct.SireumSlangTaskProvider.TYPE, taskProvider)
  );
  taskProvider = new ct.SireumSlangRefactorTaskProvider();
  workspaceFolders.forEach((f) =>
    vscode.tasks.registerTaskProvider(ct.SireumSlangRefactorTaskProvider.TYPE, taskProvider)
  );
  taskProvider = new ct.SireumSlangTemplateTaskProvider();
  workspaceFolders.forEach((f) =>
    vscode.tasks.registerTaskProvider(ct.SireumSlangTemplateTaskProvider.TYPE, taskProvider)
  );
  taskProvider = new ct.SireumHamrTaskProvider();
  workspaceFolders.forEach((f) =>
    vscode.tasks.registerTaskProvider(ct.SireumHamrTaskProvider.TYPE, taskProvider)
  );
  taskProvider = new ct.SireumLogikaTaskProvider();
  workspaceFolders.forEach((f) =>
    vscode.tasks.registerTaskProvider(ct.SireumLogikaTaskProvider.TYPE, taskProvider)
  );
}
