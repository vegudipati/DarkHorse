import * as vscode from 'vscode';
export declare class WelcomePanel {
    private static currentPanel;
    private readonly panel;
    static show(context: vscode.ExtensionContext): void;
    private constructor();
    private getHtml;
}
