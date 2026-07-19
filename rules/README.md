# Rules documentation

The Pepper rules live in `rules.tex` (LaTeX source), with `rules.pdf` and `rules.md` generated from it.

## Building

```bash
pdflatex rules.tex        # generate the PDF
latexmk -pdf rules.tex    # compile with dependencies
pandoc -o rules.md rules.tex   # regenerate the Markdown
```
