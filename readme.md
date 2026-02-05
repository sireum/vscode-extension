# Sireum VSCode Extension

[![License](https://img.shields.io/badge/License-BSD_2--Clause-brightgreen.svg)](https://github.com/sireum/vscode-extension/blob/master/license.txt)


Integrated tools:

* HAMR SysMLv2 front-end and code generator
* Logika Slang script verifier


## Development Setup

Requirements: `npm`, `tsc`, `eslint` and `vsce`

Install dependencies:

```
npm install
```

## Packaging

```sh
bin/build.cmd package
```

This creates a vsix file versioned as: `4.<last-commit-date>.<last-commit-sha>`