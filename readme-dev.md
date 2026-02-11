# Sireum VSCode Extension Development Setup

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