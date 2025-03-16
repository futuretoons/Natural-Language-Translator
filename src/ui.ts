import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { log } from './utils';

export class LanguageSelector 
{
    private statusBarItem: vscode.StatusBarItem;
    private extensionContext: vscode.ExtensionContext;
    private currentLanguage: string = 'en'; // Default to English
    private languageFolder: string;

    constructor(context: vscode.ExtensionContext) 
    {
        this.extensionContext = context;
        this.languageFolder = path.join(context.extensionPath, 'out', 'languages', 'languages');
        log(`Language folder path: ${this.languageFolder}`);
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.text = `Language: ${this.currentLanguage}`;
        this.statusBarItem.command = 'vscode-translator.selectDictionary';
        this.statusBarItem.tooltip = 'Select Dictionary';
        this.statusBarItem.show();
        context.subscriptions.push(this.statusBarItem);
    }

    registerCommand() 
    {
        const disposable = vscode.commands.registerCommand('vscode-translator.selectDictionary', async () => {
            const dictionaries = this.getAvailableDictionaries();
            log(`Dropdown dictionaries: ${dictionaries}`);
            if (dictionaries.length === 1) {
                vscode.window.showWarningMessage('No dictionaries found in out/languages/languages/. Check build output.');

            }
            const selected = await vscode.window.showQuickPick(dictionaries, {
                placeHolder: 'Select a dictionary to load (en for default English)',
                ignoreFocusOut: true

            });

            if (selected) {
                this.currentLanguage = selected === 'en' ? 'en' : selected.split('.')[0];
                this.statusBarItem.text = `Language: ${this.currentLanguage}`;
                log(`Selected language: ${this.currentLanguage}`);
                vscode.window.showInformationMessage(`Language set to ${this.currentLanguage}`);

            }
        });

        this.extensionContext.subscriptions.push(disposable);
    }

    private getAvailableDictionaries(): string[] 
    {
        try 
        {
            const files = fs.readdirSync(this.languageFolder);
            const jsonFiles = files.filter(file => file.endsWith('.json'));
            log(`Files in ${this.languageFolder}: ${files}`);
            return ['en', ...jsonFiles];
        } catch (error) {
            log(`Error reading ${this.languageFolder}: ${error}`);
            return ['en'];
        }

    }

    getCurrentLanguage(): string 
    {
        return this.currentLanguage;
    }
}