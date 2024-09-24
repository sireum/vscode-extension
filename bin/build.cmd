::/*#! 2> /dev/null                                 #
@ 2>/dev/null # 2>nul & echo off & goto BOF         #
if [ -z ${SIREUM_HOME} ]; then                      #
  echo "Please set SIREUM_HOME env var"             #
  exit -1                                           #
fi                                                  #
exec ${SIREUM_HOME}/bin/sireum slang run "$0" "$@"  #
:BOF
setlocal
if not defined SIREUM_HOME (
  echo Please set SIREUM_HOME env var
  exit /B -1
)
%SIREUM_HOME%\bin\sireum.bat slang run "%0" %*
exit /B %errorlevel%
::!#*/
// #Sireum

import org.sireum._

val home = Os.slashDir.up.canon

def pkg(): Unit = {
  (home / "out").removeAll()
  (home / "node_modules").removeAll()
  (home / "package-lock.json").removeAll()
  for (p <- home.list if p.ext == "vsix") {
    p.removeAll()
  }
  proc"npm install".at(home).echo.console.runCheck()
  val packageJson = home / "package.json"
  val content = packageJson.read
  val version = ops.StringOps(proc"git log -n 1 --date=format:%Y%m%d --pretty=format:4.%cd.%h".at(home).runCheck().out).trim
  val vs = ops.StringOps(version).split((c: C) => c == '.')
  val lastV = Z(s"0x${vs(2)}").get.string
  packageJson.writeOver(ops.StringOps(ops.StringOps(content).
    replaceAllLiterally("v0.0.0", vs(2))).
    replaceAllLiterally("0.0.0", st"${(vs(2 ~> lastV), ".")}".render))
  proc"vsce package".at(home).echo.console.runCheck()
  packageJson.writeOver(content)
  for (p <- home.list if p.ext == "vsix" && !ops.StringOps(p.name).startsWith("sireum-")) {
    p.moveOverTo(p.up / "sireum-vscode-extension.vsix")
  }
  println()
  println(s"Packaged version: $version (.$lastV)")
  println()
}

if (Os.cliArgs.isEmpty) {
  println("Usage: [ package ]")
  Os.exit(0)
}

for (arg <- Os.cliArgs) {
  arg match {
    case string"package" => pkg()
    case _ =>
      eprintln(s"Invalid task: $arg")
      Os.exit(-1)
  }
}