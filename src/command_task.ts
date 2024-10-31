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
import fsJs = require("fs");
import spawnJs = require("child_process");
import osJs = require("os");
import pathJs = require("path");

const tmp = require("tmp");

export const isWindows = process.platform === "win32";
export const psep = isWindows ? ";" : ":";
export const fsep = isWindows ? "\\" : "/";
const ext = isWindows ? ".bat" : "";
const sysmlTaskLabelPrefix = "sysml";
const logikaTaskLabelPrefix = "verifier";
const feedbackPlaceHolder = "$feedback";
const workspaceRootsPlaceHolder = "$workspaceRoots";
const sireumKey = "sireum";
const sireumScriptSuffix = isWindows? `\\bin\\sireum.bat` : `/bin/sireum`;

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

class SireumScriptCommand extends Command<Promise<string | undefined>> {
  static COMMAND = "${command:org.sireum.script}";
  command = SireumScriptCommand.COMMAND;
  async run(context: vscode.ExtensionContext, workspaceRoots: string): Promise<string | undefined> {
    return getSireum();
  }
}

class SireumImportCommand extends Command<Promise<undefined | string>> {
  static COMMAND = "${command:org.sireum.import}";
  command = SireumImportCommand.COMMAND;
  async run(context: vscode.ExtensionContext, workspaceRoots: string): Promise<undefined | string> {
    const workspaceFolders =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders
      : [];
    for (const f of workspaceFolders) {
      const r = await importBuild(f.uri.fsPath, true);
      if (r) {
        return r;
      }
    } 
    return undefined;
  }
}

class InsertSlangSymbolCommand extends Command<void> {
  static COMMAND = "${command:org.sireum.editor.symbol}";
  command = InsertSlangSymbolCommand.COMMAND;
  async run(context: vscode.ExtensionContext, workspaceRoots: string): Promise<void> {
    const pick = await vscode.window.showQuickPick(
      [ "__>:  (implication)", 
        "___>:  (short-circuit implication)", 
        "∀  (forall/universal quantifier)", 
        "∃  (existensial quantifier)", 
        "⊢  (sequent)", 
        "≡  (equivalent)", 
        "≢  (inequivalent)", 
        "␣  (path space)"
      ],
      { title: "Slang Symbol", canPickMany: false }
    );
    if (!pick) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage(`No active text editor to insert ${pick} into`)
      return;
    }
    const selection = editor.selection;
    editor!.edit(editBuilder => {
      editBuilder.replace(selection, pick.toString());
    }); 
  }
}

class GetColumnCommand extends Command<string> {
  static COMMAND = "${command:org.sireum.editor.column}";
  command = GetColumnCommand.COMMAND;
  run(context: vscode.ExtensionContext, workspaceRoots: string): string {
    return (vscode.window.activeTextEditor?.selection.end.character! + 1).toString();
  }
}

class PickCodeGenTargetCommand extends Command<string> {
  static COMMAND = "${command:org.sireum.hamr.codegen.pickTarget}";
  command = PickCodeGenTargetCommand.COMMAND;
  run(context: vscode.ExtensionContext, workspaceRoots: string): any {
    const pick = vscode.window.showQuickPick(
      ["JVM", "Linux", "Cygwin", "MacOS", "seL4", "seL4_Only", "seL4_TB", "Microkit", "ros2"],
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
      for (const i in this.fileExtensions) {
        const b = vscode.window.activeTextEditor?.document.fileName.endsWith(`.${this.fileExtensions[i]}`);
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
  cliArgs = `${SireumScriptCommand.COMMAND} --install-fonts`;
  focus = true;
}

class ImportProject extends InstallTask {
  taskLabel = "import project";
  command = "${command:org.sireum.import.project}";
  cliArgs = `${SireumImportCommand.COMMAND}`;
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
  cliArgs = `${SireumScriptCommand.COMMAND} hamr sysml tipe --parseable-messages --sourcepath "$workspaceRoots"`;
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

abstract class FeedbackTask extends Task {
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
  processReport(
    e: vscode.TextEditor,
    o: any
  ): void {
    if (o.message.posOpt.type == "None") throw new Error("Expecting no position info");
    const msg = o.message as string;
    switch (o.message.level as number) {
      case 2:
        vscode.window.showWarningMessage(msg);
        break;
      case 3:
        vscode.window.showInformationMessage(msg);
        break;
      default:
        vscode.window.showErrorMessage(msg);
        break;
    }
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
    const watcher = fsJs.promises.watch(this.feedback!, {
      recursive: true,
      signal: this.ac.signal,
    });
    (async () => {
      for await (const e of watcher) {
        if (e.filename) {
          const o = JSON.parse(
            fsJs.readFileSync(`${this.feedback}${fsep}${e.filename!}`, "utf8")
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
                case "Report":
                  this.processReport(e, o);
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
      fsJs.promises
        .rm(this.feedback!, { recursive: true, force: true })
        .catch((e) => {});
    this.ac = new AbortController();
  }
}

abstract class LogikaSysmlTask extends FeedbackTask {
  type = SireumHamrTaskProvider.TYPE;
  fileExtensions = ["sysml"];
}

class LogikaSysmlAllTask extends LogikaSysmlTask {
  taskLabel = `${sysmlTaskLabelPrefix} logika (all)`;
  command = "${command:org.sireum.hamr.sysml.logika.all}";
  cliArgs = `${SireumScriptCommand.COMMAND} hamr sysml logika --parseable-messages ${feedbackPlaceHolder} --sourcepath "${workspaceRootsPlaceHolder}"`;
  focus = false;
}

class LogikaSysmlFileTask extends LogikaSysmlTask {
  taskLabel = `${sysmlTaskLabelPrefix} logika (file)`;
  command = "${command:org.sireum.hamr.sysml.logika.file}";
  cliArgs = `${SireumScriptCommand.COMMAND} hamr sysml logika --parseable-messages ${feedbackPlaceHolder} --sourcepath "${workspaceRootsPlaceHolder}" "\${file}"`;
  focus = false;
}

class LogikaSysmlLineTask extends LogikaSysmlTask {
  taskLabel = `${sysmlTaskLabelPrefix} logika (line)`;
  command = "${command:org.sireum.hamr.sysml.logika.line}";
  cliArgs = `${SireumScriptCommand.COMMAND} hamr sysml logika --parseable-messages ${feedbackPlaceHolder} --sourcepath "${workspaceRootsPlaceHolder}" --line \${lineNumber} "\${file}"`;
  focus = false;
}

class CodeGenTask extends SysMLTask {
  type = SireumHamrTaskProvider.TYPE;
  taskLabel = `${sysmlTaskLabelPrefix} codegen`;
  command = "${command:org.sireum.hamr.sysml.codegen}";
  cliArgs = `${SireumScriptCommand.COMMAND} hamr sysml codegen --parseable-messages --sourcepath "$workspaceRoots" --line \${lineNumber} --platform ${PickCodeGenTargetCommand.COMMAND} "\${file}"`;
  focus = true;
}

class CodeGenConfigTask extends SysMLTask {
  type = SireumHamrTaskProvider.TYPE;
  taskLabel = `${sysmlTaskLabelPrefix} config`;
  command = "${command:org.sireum.hamr.sysml.config}";
  cliArgs = `${SireumScriptCommand.COMMAND} hamr sysml config "\${file}"`;
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
  cliArgs = `${SireumScriptCommand.COMMAND} slang run "\${file}"`;
  focus = true;
}

class TipeScTask extends SlangScTask {
  taskLabel = `tipe`;
  command = "${command:org.sireum.slang.tipe}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang tipe --parseable-messages "\${file}"`;
  focus = false;
}

abstract class SlangRefactorTask extends SlangScTask {
  type = SireumSlangRefactorTaskProvider.TYPE;
}

class SlangRefactorEnumSymbolTask extends SlangRefactorTask {
  taskLabel = `enum symbols`;
  command = "${command:org.sireum.slang.refactor.enumSymbol}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang refactor --mode enumSymbol ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class SlangRefactorInsertValTask extends SlangRefactorTask {
  taskLabel = `insert class field val modifiers`;
  command = "${command:org.sireum.slang.refactor.insertVal}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang refactor --mode insertVal ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class SlangRefactorRenumberProofTask extends SlangRefactorTask {
  taskLabel = `renumber proofs`;
  command = "${command:org.sireum.slang.refactor.renumberProof}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang refactor --mode renumberProof ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class SlangRefactorReformatProofTask extends SlangRefactorTask {
  taskLabel = `reformat proofs`;
  command = "${command:org.sireum.slang.refactor.reformatProof}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang refactor --mode reformatProof ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class SlangRefactorExpandInductTask extends SlangRefactorTask {
  taskLabel = `expand @induct`;
  command = "${command:org.sireum.slang.refactor.expandInduct}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang refactor --mode expandInduct ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

abstract class SlangTemplateTask extends SlangScTask {
  type = SireumSlangTemplateTaskProvider.TYPE;
}

class SlangTemplateStepTask extends SlangTemplateTask {
  taskLabel = `insert a regular proof step`;
  command = "${command:org.sireum.slang.template.step}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang template --mode step --line \${lineNumber} ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class SlangTemplateAssumeTask extends SlangTemplateTask {
  taskLabel = `insert an assume proof step`;
  command = "${command:org.sireum.slang.template.assume}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang template --mode assume --line \${lineNumber} ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class SlangTemplateAssertTask extends SlangTemplateTask {
  taskLabel = `insert an assert proof step`;
  command = "${command:org.sireum.slang.template.assert}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang template --mode assert --line \${lineNumber} ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class SlangTemplateSubProofTask extends SlangTemplateTask {
  taskLabel = `insert a subproof`;
  command = "${command:org.sireum.slang.template.subproof}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang template --mode subproof --line \${lineNumber} ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class SlangTemplateSubProofFreshTask extends SlangTemplateTask {
  taskLabel = `insert a let-subproof`;
  command = "${command:org.sireum.slang.template.subproofFresh}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang template --mode subproofFresh --line \${lineNumber} ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class SlangTemplateForallTask extends SlangTemplateTask {
  taskLabel = `insert a forall quantification`;
  command = "${command:org.sireum.slang.template.forall}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang template --mode forall --line \${lineNumber} --column ${GetColumnCommand.COMMAND} ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class SlangTemplateExistsTask extends SlangTemplateTask {
  taskLabel = `insert an existensial quantification`;
  command = "${command:org.sireum.slang.template.exists}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang template --mode exists --line \${lineNumber} --column ${GetColumnCommand.COMMAND} ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class SlangTemplateForallRangeTask extends SlangTemplateTask {
  taskLabel = `insert a forall-range quantification`;
  command = "${command:org.sireum.slang.template.forallRange}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang template --mode forallRange --line \${lineNumber} --column ${GetColumnCommand.COMMAND} ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class SlangTemplateExistsRangeTask extends SlangTemplateTask {
  taskLabel = `insert an existensial-in-range quantification`;
  command = "${command:org.sireum.slang.template.existsRange}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang template --mode existsRange --line \${lineNumber} --column ${GetColumnCommand.COMMAND} ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class SlangTemplateForallElementsTask extends SlangTemplateTask {
  taskLabel = `insert a forall-elements quantification`;
  command = "${command:org.sireum.slang.template.forallElements}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang template --mode forallElements --line \${lineNumber} --column ${GetColumnCommand.COMMAND} ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class SlangTemplateExistsElementsTask extends SlangTemplateTask {
  taskLabel = `insert an existensial-element quantification`;
  command = "${command:org.sireum.slang.template.existsElements}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang template --mode existsElements --line \${lineNumber} --column ${GetColumnCommand.COMMAND} ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class SlangTemplateForallIndicesTask extends SlangTemplateTask {
  taskLabel = `insert a forall-indices quantification`;
  command = "${command:org.sireum.slang.template.forallIndices}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang template --mode forallIndices --line \${lineNumber} --column ${GetColumnCommand.COMMAND} ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class SlangTemplateExistsIndicesTask extends SlangTemplateTask {
  taskLabel = `insert an existensial-index quantification`;
  command = "${command:org.sireum.slang.template.existsIndices}";
  cliArgs = `${SireumScriptCommand.COMMAND} slang template --mode existsIndices --line \${lineNumber} --column ${GetColumnCommand.COMMAND} ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

abstract class LogikaScTask extends FeedbackTask {
  type = SireumLogikaTaskProvider.TYPE;
  fileExtensions = ["sc"];
  post(context: vscode.ExtensionContext, e: vscode.TaskProcessEndEvent): void {
    super.post(context, e);
    vscode.window.showInformationMessage(e.exitCode == 0? "Logika verified" : "Ill-formed program");
  }
}

class LogikaConfigScTask extends LogikaScTask {
  type = SireumHamrTaskProvider.TYPE;
  taskLabel = `config`;
  command = "${command:org.sireum.logika.config}";
  cliArgs = `${SireumScriptCommand.COMMAND} logika config "\${file}"`;
  focus = false;
}

class LogikaScFileTask extends LogikaScTask {
  fileExtensions = ["sc", "logika"];
  taskLabel = `${logikaTaskLabelPrefix} (file)`;
  command = "${command:org.sireum.logika.verifier.file}";
  cliArgs = `${SireumScriptCommand.COMMAND} logika verifier --parseable-messages --log-detailed-info ${feedbackPlaceHolder} "\${file}"`;
  focus = false;
}

class LogikaScLineTask extends LogikaScTask {
  taskLabel = `${logikaTaskLabelPrefix} (line)`;
  command = "${command:org.sireum.logika.verifier.line}";
  cliArgs = `${SireumScriptCommand.COMMAND} logika verifier --parseable-messages --log-detailed-info ${feedbackPlaceHolder} --line \${lineNumber} "\${file}"`;
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
    ts.push(
      getTask(SireumTaskProvider.TYPE, "insert Slang symbol", InsertSlangSymbolCommand.COMMAND, false)
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

export class SireumSlangRefactorTaskProvider implements vscode.TaskProvider {
  static TYPE = "sireum slang refactor";
  tasks: vscode.Task[] = this.getTasks();

  getTasks(): vscode.Task[] {
    const ts = slangRefactorTasks.map((ct) => getTask(SireumSlangRefactorTaskProvider.TYPE, ct.taskLabel, ct.command, ct.focus));
    return ts;
  }

  async provideTasks(): Promise<vscode.Task[]> {
    return this.tasks;
  }
  resolveTask(_task: vscode.Task): vscode.Task | undefined {
    return undefined;
  }
}


export class SireumSlangTemplateTaskProvider implements vscode.TaskProvider {
  static TYPE = "sireum slang template";
  tasks: vscode.Task[] = this.getTasks();

  getTasks(): vscode.Task[] {
    const ts = slangTemplateTasks.map((ct) => getTask(SireumSlangTemplateTaskProvider.TYPE, ct.taskLabel, ct.command, ct.focus));
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

export const importProjectTask: Task =  new ImportProject();

export const sireumTasks: Task[] = [
  new InstallFonts(),
  importProjectTask
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

export const slangRefactorTasks: Task[] = [
  new SlangRefactorEnumSymbolTask(),
  new SlangRefactorInsertValTask(),
  new SlangRefactorRenumberProofTask(),
  new SlangRefactorReformatProofTask(),
  new SlangRefactorExpandInductTask()
];

export const slangTemplateTasks: Task[] = [
  new SlangTemplateStepTask(),
  new SlangTemplateAssumeTask(),
  new SlangTemplateAssertTask(),
  new SlangTemplateSubProofTask(),
  new SlangTemplateSubProofFreshTask(),
  new SlangTemplateForallTask(),
  new SlangTemplateExistsTask(),
  new SlangTemplateForallRangeTask(),
  new SlangTemplateExistsRangeTask(),
  new SlangTemplateForallElementsTask(),
  new SlangTemplateExistsElementsTask(),
  new SlangTemplateForallIndicesTask(),
  new SlangTemplateExistsIndicesTask()
];

export const logikaTasks: Task[] = [
  new LogikaConfigScTask(),
  new LogikaScFileTask(),
  new LogikaScLineTask()
];

export const commands: Command<any>[] = [
  new SireumImportCommand(),
  new SireumScriptCommand(),
  new InsertSlangSymbolCommand(),
  new GetColumnCommand(),
  new PickCodeGenTargetCommand(),
  new LogikaClearCommand(),
  ...sireumTasks,
  ...slangTasks,
  ...slangRefactorTasks,
  ...slangTemplateTasks,
  ...hamrTasks,
  ...logikaTasks,
];

async function getSireum(): Promise<string | undefined> {
  let sireumHome = process.env.SIREUM_HOME;
  let update = false;
  if (!sireumHome) {
    update = true;
    sireumHome = vscode.workspace.getConfiguration(sireumKey).get("home");
  }
  let r = `${sireumHome}${sireumScriptSuffix}`
  while (!fsJs.existsSync(r)) {
    update = true;
    vscode.window.showInformationMessage("Please select Sireum's home folder path");
    const uris = await vscode.window.showOpenDialog({
      title: "Select Sireum home directory",
      openLabel: "Select",
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    });
    if (uris) {
      sireumHome = uris[0].fsPath
      r = `${sireumHome}${sireumScriptSuffix}`;
    } else {
      return undefined;
    }
  }
  if (update) {
    vscode.workspace.getConfiguration(sireumKey).update("home", sireumHome, vscode.ConfigurationTarget.Global);
  }
  return `"${r}"`;
}


export async function importBuild(path: string, force: boolean): Promise<string | undefined> {
  const sireum = await getSireum();
  if (!sireum) {
    return undefined;
  }
  const sireumHome = pathJs.dirname(pathJs.dirname(sireum.slice(1, -1)));
  const dotSireum = `${path}${fsep}.sireum`
  const binProject = `${path}${fsep}bin${fsep}project.cmd`

  if (!force && fsJs.existsSync(dotSireum)) {
    const dotSireumVer = `${dotSireum}.ver`
    if (!fsJs.existsSync(dotSireumVer)) {
      fsJs.writeFileSync(dotSireumVer, "");
    }
    spawnJs.exec(`${sireum} --sha`, async (error, stdout, stderr) => {
      if (!error) {
        const ver = fsJs.readFileSync(dotSireumVer, "utf-8");
        if (stdout == ver) {
          return undefined;
        }
        const reimport = "Yes" == await vscode.window.showInformationMessage("Sireum version has changed. Reimport?", "Yes", "No");
        if (!reimport) {
          return undefined;
        }
        const versionsProp = `${sireumHome}${fsep}versions.properties`;
        const versions = fsJs.readFileSync(versionsProp, "utf-8");
        const scalaLibraryVersionPrefix = "org.scala-lang%scala-library%=";
        const i = versions.indexOf(scalaLibraryVersionPrefix);
        const scalaVersion = versions.substring(i + scalaLibraryVersionPrefix.length, versions.indexOf('\n', i + 1)).trim();
        const buildMill = `${path}${fsep}build.mill`;
        const m2 = `${osJs.homedir}${fsep}.m2${fsep}repository`;
        const buildMillContent =
`package build

import mill._, scalalib._

object build extends ScalaModule {
  def scalaVersion = "${scalaVersion}"
  def ivyDeps = Agg(
    ivy"org.sireum.kekinian::library:${stdout.substring(0, 10)}"
  )
  def repositoriesTask = T.task { super.repositoriesTask() :+ 
    coursier.maven.MavenRepository("${vscode.Uri.file(m2).toString()}") :+
    coursier.maven.MavenRepository("https://jitpack.io")
  }
}`;

        fsJs.writeFileSync(buildMill, buildMillContent);
  
        vscode.commands.executeCommand("metals.build-import").then(
          () => {
            fsJs.unlinkSync(buildMill);
            fsJs.writeFileSync(dotSireumVer, stdout);
          }
        );
      }
    });
  } else if (force && fsJs.existsSync(binProject)) {
    const r = `${sireum} proyek export "${path}"`;
    return r;
  } else {
    vscode.window.showErrorMessage(`Requires ${binProject}`);
  }
  return undefined;
}
