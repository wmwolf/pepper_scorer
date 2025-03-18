# CLAUDE.md - Development Guidelines

## Build Commands
- `npm install` - Install dependencies
- `npm run dev` - Start dev server at localhost:4321
- `npm run build` - Build production site to ./dist/
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint checks
- `npm run typecheck` - Check TypeScript types

## LaTeX Commands (in rules directory)
- `pdflatex rules.tex` - Generate PDF from LaTeX
- `latexmk -pdf rules.tex` - Compile LaTeX with dependencies
- `pandoc -o rules.md rules.tex` - Convert LaTeX to Markdown

## Code Style Guidelines
- **TypeScript**: Use strict typing with interfaces/types for all data structures
- **Imports**: Group imports by external libs then local modules with blank line separator
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