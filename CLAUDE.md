# CLAUDE.md - Development Guidelines

## Build Commands
- `npm install` - Install dependencies
- `npm run dev` - Start dev server at localhost:4321 (DO NOT run this as dev server is always running)
- `npm run build` - Build production site to ./dist/
- `npm run preview` - Preview production build locally

## Code Quality Checks
- `npx eslint src/**/*.ts` - Run ESLint checks on TypeScript files
- `npx tsc --noEmit` - Check TypeScript types

## Pre-Commit Quality Assurance
To prevent accumulation of linting issues and type errors, run these commands before committing changes:
```bash
# Check for TypeScript errors
npx tsc --noEmit

# Lint TypeScript files
npx eslint src/**/*.ts

# Auto-fix simple linting issues (optional)
npx eslint src/**/*.ts --fix
```

Common type issues to watch for:
- Unused variables (add ESLint disable comments only when the variable will be used in future development)
- Possible undefined values when accessing object properties or array indices
- Missing type annotations, especially for function parameters and return values

## LaTeX Commands (in rules directory)
- `pdflatex rules.tex` - Generate PDF from LaTeX
- `latexmk -pdf rules.tex` - Compile LaTeX with dependencies
- `pandoc -o rules.md rules.tex` - Convert LaTeX to Markdown

## Code Style Guidelines
- **TypeScript**: Use strict typing with interfaces/types for all data structures
- **Imports**: Group imports by external libs then local modules with blank line separator
- **Path Aliases**: Use `@/` path alias for imports from the src directory
- **File Structure**: Group related functionality in same file, use meaningful exports
- **Naming**: 
  - camelCase for variables/functions
  - PascalCase for classes/interfaces/types
  - Function names should be descriptive verbs (e.g., `calculateScore`, `updateUI`)
- **Error Handling**: Use null checks before accessing properties
- **Components**: Prefer functional over class components
- **State Management**: Use localStorage for persistent data, pass state via props
- **Comments**: Add comments for complex logic or non-obvious implementation details

## Project Organization
- `/src/lib/` - Core application logic and utility functions
- `/src/components/` - Reusable UI components
- `/src/layouts/` - Page layout templates 
- `/src/pages/` - Page routes and components
- `/rules/` - Game rules documentation in LaTeX and Markdown