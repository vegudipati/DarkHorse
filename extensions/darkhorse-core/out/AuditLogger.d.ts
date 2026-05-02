import * as vscode from 'vscode';
export declare class AuditLogger {
    private logPath;
    constructor(context: vscode.ExtensionContext);
    log(category: string, action: string, detail?: string): void;
    getLogPath(): string;
}
