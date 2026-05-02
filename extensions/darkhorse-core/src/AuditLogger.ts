import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class AuditLogger {

  private logPath: string;

  constructor(context: vscode.ExtensionContext) {
    const logDir = path.join(context.globalStorageUri.fsPath, 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logPath = path.join(logDir, 'darkhorse-audit.log');
  }

  public log(category: string, action: string, detail?: string): void {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${category}] ${action}${detail ? ' | ' + detail : ''}\n`;
    try {
      fs.appendFileSync(this.logPath, entry, 'utf8');
    } catch (err) {
      // Fail silently — never crash the IDE due to logging
    }
  }

  public getLogPath(): string {
    return this.logPath;
  }
}