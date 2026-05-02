import * as vscode from 'vscode';

export interface SyntaxError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * SyntaxChecker calls the SAP ADT checkruns API via the
 * darkhorse-sap extension's shared ADT client.
 * Falls back to basic offline checks if not connected.
 */
export class SyntaxChecker {

  private diagnosticCollection: vscode.DiagnosticCollection;

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('abap');
  }

  public getDiagnosticCollection(): vscode.DiagnosticCollection {
    return this.diagnosticCollection;
  }

  /**
   * Run syntax check on an ABAP document.
   * Tries ADT check first, falls back to offline checks.
   */
  public async check(document: vscode.TextDocument): Promise<void> {
    if (document.languageId !== 'abap') {
      return;
    }

    const source = document.getText();
    const programName = this.getProgramName(document);
    let errors: SyntaxError[] = [];

    // Try to get ADT client from darkhorse-sap extension
    const sapExt = vscode.extensions.getExtension('deloitte-darkhorse.darkhorse-sap');
    if (sapExt && sapExt.isActive && sapExt.exports?.getActiveClient) {
      try {
        const client = sapExt.exports.getActiveClient();
        if (client) {
          errors = await client.checkSyntax(programName, source);
        } else {
          errors = this.offlineCheck(source);
        }
      } catch {
        errors = this.offlineCheck(source);
      }
    } else {
      errors = this.offlineCheck(source);
    }

    this.applyDiagnostics(document, errors);
  }

  /**
   * Basic offline syntax checks when not connected to SAP.
   * Catches common structural errors.
   */
  private offlineCheck(source: string): SyntaxError[] {
    const errors: SyntaxError[] = [];
    const lines = source.split('\n');

    // Track open/close keyword pairs
    const stack: Array<{ keyword: string; line: number }> = [];
    const openKeywords: Record<string, string> = {
      'IF': 'ENDIF',
      'LOOP': 'ENDLOOP',
      'DO': 'ENDDO',
      'WHILE': 'ENDWHILE',
      'SELECT': 'ENDSELECT',
      'CASE': 'ENDCASE',
      'TRY': 'ENDTRY',
      'CLASS': 'ENDCLASS',
      'METHOD': 'ENDMETHOD',
      'FORM': 'ENDFORM',
      'FUNCTION': 'ENDFUNCTION',
      'MODULE': 'ENDMODULE',
      'INTERFACE': 'ENDINTERFACE'
    };

    lines.forEach((line, idx) => {
      const trimmed = line.trim().toUpperCase();
      if (trimmed.startsWith('*') || trimmed.startsWith('"')) {
        return; // skip comments
      }

      // Check for unclosed string literals
      const singleQuotes = (line.match(/'/g) || []).length;
      if (singleQuotes % 2 !== 0) {
        errors.push({
          line: idx + 1,
          column: 0,
          message: 'Possible unclosed string literal',
          severity: 'warning'
        });
      }

      // Track block openers
      for (const [open, close] of Object.entries(openKeywords)) {
        if (new RegExp(`^${open}\\b`).test(trimmed)) {
          stack.push({ keyword: open, line: idx + 1 });
        }
        if (new RegExp(`^${close}\\b`).test(trimmed)) {
          if (stack.length === 0 || stack[stack.length - 1].keyword !== open) {
            errors.push({
              line: idx + 1,
              column: 0,
              message: `Unexpected ${close} — no matching ${open}`,
              severity: 'error'
            });
          } else {
            stack.pop();
          }
        }
      }
    });

    // Report unclosed blocks
    stack.forEach(item => {
      errors.push({
        line: item.line,
        column: 0,
        message: `Unclosed ${item.keyword} — missing ${openKeywords[item.keyword]}`,
        severity: 'error'
      });
    });

    return errors;
  }

  private applyDiagnostics(document: vscode.TextDocument, errors: SyntaxError[]): void {
    const diagnostics: vscode.Diagnostic[] = errors.map(err => {
      const lineIndex = Math.max(0, err.line - 1);
      const line = document.lineAt(Math.min(lineIndex, document.lineCount - 1));
      const range = new vscode.Range(
        lineIndex,
        err.column,
        lineIndex,
        line.text.length
      );
      const severity = err.severity === 'error'
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning;

      const diag = new vscode.Diagnostic(range, err.message, severity);
      diag.source = 'DarkHorse ABAP';
      return diag;
    });

    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  private getProgramName(document: vscode.TextDocument): string {
    const fileName = document.fileName.split(/[\\/]/).pop() ?? '';
    return fileName.replace('.abap', '').toUpperCase();
  }

  public clear(document: vscode.TextDocument): void {
    this.diagnosticCollection.delete(document.uri);
  }

  public dispose(): void {
    this.diagnosticCollection.dispose();
  }
}