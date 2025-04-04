import * as vscode from 'vscode';
import { toggleTranslation, getOriginalTerms, translateToOriginal, detectScript, splitNonLatinCompound } from './translation';
import { MappingManager } from './mappings';
import { LanguageSelector } from './ui';
import { log } from './utils';
import { registerHoverProvider } from './hoverProvider';
import * as fs from 'fs';
import * as path from 'path';


// GLOBAL VARS 
let isTargetLanguage = false;
let mappingManager: MappingManager;
let extensionContext: vscode.ExtensionContext;
let isProcessingEdit = false;
let lastDocumentText: string | null = null;
let preDeletionWindow: string = '';
let translatorStatusBarItem: vscode.StatusBarItem; // Already in your globals, keeping it

let lastCursorOffset: number | null = null;
let languageSelector: LanguageSelector;
let insertionBuffer: string = '';
let bufferStartOffset: number | null = null;
let deletionContext: string = '';
let deletedTextBuffer: string = '';
let lastDeletedIdentifier: string | null = null;

//Activate the extension 
export function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
    log('Activating VSCode Translator extension');

    mappingManager = new MappingManager(context);
    languageSelector = new LanguageSelector(context);
    languageSelector.registerCommand();

    // Initialize status bar translation status
    translatorStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    translatorStatusBarItem.text = 'Translator Disabled';
    translatorStatusBarItem.show();
    context.subscriptions.push(translatorStatusBarItem);

    context.workspaceState.update('isTargetLanguage', isTargetLanguage);

    let toggleDisposable = vscode.commands.registerCommand('vscode-translator.toggleTranslation', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) 
            {
            vscode.window.showErrorMessage('No active editor found!');
            return;
        }

        isProcessingEdit = true;
        const text = editor.document.getText();
        isTargetLanguage = !isTargetLanguage;
        context.workspaceState.update('isTargetLanguage', isTargetLanguage);
        const targetLanguage = isTargetLanguage ? languageSelector.getCurrentLanguage() : 'en';

        // Update translation status on status bar
        translatorStatusBarItem.text = isTargetLanguage ? 'Translator Enabled' : 'Translator Disabled';
        log(`Toggling to ${targetLanguage} with text: '${text}'`);

        if (isTargetLanguage) 
            {
            const dictPath = path.join(__dirname, 'languages', 'languages', `${targetLanguage}.json`);
            const currentDictionary: { [key: string]: string[] } = fs.existsSync(dictPath) ? JSON.parse(fs.readFileSync(dictPath, 'utf8')) : {};
            require('./translation').currentDictionary = currentDictionary;
            let updated = false;
            const script = detectScript(text);
            const tokens = text.match(require('./translation').getTokenRegex(script)) || [];
            for (const token of tokens) 
                {
                if (!token.trim() || /[^\p{L}\p{M}\p{N}]+|\s+/u.test(token)) continue;
                const lowerToken = token.toLowerCase();
                for (const [targetTerm, enTerms] of Object.entries(currentDictionary)) 
                    {
                    if (enTerms.some((en: string) => en.toLowerCase() === lowerToken) && !enTerms.includes(token)) 
                        {
                        enTerms.push(token);
                        updated = true;
                        log(`Auto-added capitalization variant '${token}' to '${targetTerm}' in ${targetLanguage}.json`);

                        const textBefore = text.substring(0, text.indexOf(token));
                        const occurrencesBefore = (textBefore.match(new RegExp(targetTerm, 'g')) || []).length + 1;
                        const identifier = `${targetTerm}_${occurrencesBefore}`;

                        context.workspaceState.update(`original_${identifier}`, token);
                        context.workspaceState.update(`translated_${identifier}`, targetTerm);
                        context.workspaceState.update(`position_${identifier}`, text.indexOf(token));
                        context.workspaceState.update(`compoundIds_${identifier}`, []);

                        log(`Added '${identifier}' -> '${token}' to mappings for ${targetLanguage}`);
                    }
                }
            }
            if (updated) 
                {
                fs.writeFileSync(dictPath, JSON.stringify(currentDictionary, null, 2), 'utf8');
                log(`Refreshed dictionary with new capitalization variants for ${targetLanguage}`);
            }
        }

        // Show progress bar for translation
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Translating to ${targetLanguage}`,
            cancellable: false
        }, async (progress) => {
            // show progress when translating..
            const totalSteps = Math.min(Math.max(text.length / 1000, 1), 100); // 1 step per 1000 chars, capped at 100
            const increment = 100 / totalSteps;
            let currentStep = 0;

            // progress updates
            const updateProgress = () => {
                currentStep += 1;
                progress.report({ increment, message: `${Math.round(currentStep * increment)}%` });
            };

            // processing translation progress bar
            for (let i = 0; i < totalSteps; i++) 
                {
                // delay for visualizing progress
                await new Promise(resolve => setTimeout(resolve, 50));
                updateProgress();
            }

            // TRANSLATE THE DOCUMENT
            await toggleTranslation(text, targetLanguage, editor, mappingManager, context);

            // progress hits 100%
            progress.report({ increment: 100 - (currentStep * increment), message: '100% - Complete!' });
            await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause to show 100%
        });

        // Show completion message with green checkmark
        vscode.window.showInformationMessage(`Translation to ${targetLanguage} complete!`, { detail: '✔ Done' });

        lastDocumentText = editor.document.getText();
        isProcessingEdit = false;
    });

    const refreshDictionaryAndMappings = async (targetLanguage: string, addedTerm?: { term: string, meaning: string }, removedTerm?: string, removedMeaning?: string) => {
        const dictPath = path.join(__dirname, 'languages', 'languages', `${targetLanguage}.json`);
        const newDict: { [key: string]: string[] } = fs.existsSync(dictPath) ? JSON.parse(fs.readFileSync(dictPath, 'utf8')) : {};
        require('./translation').currentDictionary = newDict;
        log(`Refreshed dictionary for ${targetLanguage} in memory`);

        const allTerms = mappingManager.getAllTerms();
        const editor = vscode.window.activeTextEditor;

        if (addedTerm) 
            {
            const { term, meaning } = addedTerm;
            if (!newDict[term]) newDict[term] = [];
            if (!newDict[term].includes(meaning)) newDict[term].push(meaning);
            fs.writeFileSync(dictPath, JSON.stringify(newDict, null, 2), 'utf8');
            const text = editor ? editor.document.getText() : '';
            const offset = editor ? editor.document.offsetAt(editor.selection.start) : 0;
            const textBefore = text.substring(0, offset);
            const occurrencesBefore = (textBefore.match(new RegExp(term, 'g')) || []).length + 1;
            const identifier = `${term}_${occurrencesBefore}`;
            context.workspaceState.update(`original_${identifier}`, meaning);
            context.workspaceState.update(`translated_${identifier}`, term);
            context.workspaceState.update(`position_${identifier}`, offset);
            context.workspaceState.update(`compoundIds_${identifier}`, []);
            log(`Added '${identifier}' -> '${meaning}' to mappings for ${targetLanguage}`);
        }

        if (removedTerm && removedMeaning && editor)
             {
            const text = editor.document.getText();
            const targetTerm = removedTerm;
            const meaningToRemove = removedMeaning;
            const defaultMeaning = newDict[targetTerm]?.[0] || '';

            const termsToUpdate = Object.entries(allTerms)
                .filter(([key, value]) => key.startsWith(`${targetTerm}_`) && value === meaningToRemove)
                .map(([key]) => key);

            if (termsToUpdate.length > 0 && defaultMeaning) 
                {
                for (const key of termsToUpdate) {
                    context.workspaceState.update(`original_${key}`, defaultMeaning);
                    log(`Updated '${key}' from '${meaningToRemove}' to default '${defaultMeaning}'`);
                }

                await editor.edit((editBuilder) => 
                    {
                    termsToUpdate.forEach((key) => 
                        {
                        const position = mappingManager.getPosition(key);
                        const translatedTerm = context.workspaceState.get(`translated_${key}`) as string;
                        const startPos = editor.document.positionAt(position);
                        const endPos = editor.document.positionAt(position + translatedTerm.length);
                        const range = new vscode.Range(startPos, endPos);
                        editBuilder.replace(range, defaultMeaning);
                    });
                });
                lastDocumentText = editor.document.getText();
                log(`Updated specific instances of '${targetTerm}' mapped to '${meaningToRemove}' to '${defaultMeaning}'`);
            } else if (termsToUpdate.length > 0 && !defaultMeaning) 
                {
                for (const key of termsToUpdate) 
                    {
                    mappingManager.removeTermPictographic(key, mappingManager.getPosition(key));
                    log(`Removed mapping '${key}' as no meanings remain for '${targetTerm}'`);
                }
            } else {
                log(`No mappings found for '${targetTerm}' with meaning '${meaningToRemove}'`);
            }

        }
    };

    let addToDictDisposable = vscode.commands.registerCommand('vscode-translator.addToDictionary', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) 
            {
            vscode.window.showErrorMessage('No active editor found!');
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection).trim();
        if (!selectedText) 
            {
            vscode.window.showErrorMessage('Please highlight a word to add to the dictionary.');
            return;
        }

        const targetLanguage = languageSelector.getCurrentLanguage();
        if (!targetLanguage || targetLanguage === 'en') 
            {
            vscode.window.showErrorMessage('Please select a target language first.');
            return;
        }

        const englishMeaning = await vscode.window.showInputBox({
            prompt: `Enter the English meaning for "${selectedText}" in ${targetLanguage}`,
            placeHolder: 'e.g., new',
        });

        if (!englishMeaning) return;

        await refreshDictionaryAndMappings(targetLanguage, { term: selectedText, meaning: englishMeaning });
        vscode.window.showInformationMessage(`Added "${selectedText}" -> "${englishMeaning}" to ${targetLanguage} dictionary!`);
    });

    let removeFromDictDisposable = vscode.commands.registerCommand('vscode-translator.removeFromDictionary', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found!');
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection).trim();
        if (!selectedText) 
            {
            vscode.window.showErrorMessage('Please highlight a word to remove from the dictionary.');
            return;
        }

        const targetLanguage = languageSelector.getCurrentLanguage();
        if (!targetLanguage || targetLanguage === 'en') 
            {
            vscode.window.showErrorMessage('Please select a target language first.');
            return;
        }

        const dictPath = path.join(__dirname, 'languages', 'languages', `${targetLanguage}.json`);
        if (!fs.existsSync(dictPath)) 
            {
            vscode.window.showErrorMessage(`No dictionary found for ${targetLanguage}.`);
            return;
        }

        const dict: { [key: string]: string[] } = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
        if (!dict[selectedText] || dict[selectedText].length === 0) 
            {
            vscode.window.showErrorMessage(`"${selectedText}" not found in ${targetLanguage} dictionary.`);
            return;
        }

        const meaningToRemove = await vscode.window.showQuickPick(dict[selectedText], {
            placeHolder: `Select an English meaning to remove for "${selectedText}"`,
            canPickMany: false,
        });

        if (!meaningToRemove) return;

        dict[selectedText] = dict[selectedText].filter(m => m !== meaningToRemove);
        if (dict[selectedText].length === 0) delete dict[selectedText];
        fs.writeFileSync(dictPath, JSON.stringify(dict, null, 2), 'utf8');
        await refreshDictionaryAndMappings(targetLanguage, undefined, selectedText, meaningToRemove);
        vscode.window.showInformationMessage(`Removed "${meaningToRemove}" from "${selectedText}" in ${targetLanguage} dictionary!`);
    });

    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((e) => {
        const editor = e.textEditor;
        const cursorPos = editor.selection.active;
        if (lastCursorPosition && cursorPos.line === lastCursorPosition.line && cursorPos.character !== lastCursorPosition.character) {
            lastCursorOffset = editor.document.offsetAt(cursorPos);
            const windowStart = Math.max(0, lastCursorOffset - 25);
            const windowEnd = Math.min(editor.document.getText().length, lastCursorOffset + 25);
            preDeletionWindow = editor.document.getText().substring(windowStart, windowEnd);
            log(`Pre-deletion window updated: '${preDeletionWindow}', cursor offset=${lastCursorOffset}`);
            deletionContext = preDeletionWindow;
            log(`Deletion context updated on cursor move: '${deletionContext}'`);
        }
        lastCursorPosition = cursorPos;
    }));

    async function handleCompoundDetection(
        currentWord: string,
        wordStartOffset: number,
        cursorOffset: number,
        currentText: string,
        currentLanguage: string,
        script: string,
        currentDictionary: { [key: string]: string[] },
        mappingManager: MappingManager
    ) {
        const allTerms = mappingManager.getAllTerms();
        const allCompounds = mappingManager.getAllCompounds();
        const dictPath = path.join(__dirname, 'languages', 'languages', `${currentLanguage}.json`);
        const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
    
        let compoundParts: string[] = [];
        let compoundTranslated = '';
        let compoundOriginal = '';
        let compoundStart = wordStartOffset;
    
        log(`Processing word '${currentWord}' at offset ${wordStartOffset}, cursorOffset=${cursorOffset}, script=${script}`);
    
        let parts: string[];
        if (script === 'latin' && /[\p{Lu}]/u.test(currentWord)) {
            parts = currentWord.match(/[\p{Lu}][\p{Ll}]*|[\p{Ll}]+/gu) || [currentWord];
            log(`Latin split '${currentWord}' into parts: ${JSON.stringify(parts)}`);
        } else if (script === 'logographic' || script === 'devanagari' || script === 'cyrillic') {
            parts = splitNonLatinCompound(currentWord);
            log(`Non-Latin split '${currentWord}' into parts: ${JSON.stringify(parts)}`);
        } else {
            parts = splitNonLatinCompound(currentWord);
            log(`Mixed split '${currentWord}' into parts: ${JSON.stringify(parts)}`);
        }
    
        for (const substring of parts) {
            const substringStartOffset = wordStartOffset + compoundTranslated.length;
            const substringScript = detectScript(substring);
            const lookupSubstring = substringScript === 'latin' && substring.length > 1
                ? substring.charAt(0).toLowerCase() + substring.slice(1)
                : substring;
    
            const originalPart = await processPart(substring, lookupSubstring, substringStartOffset, currentText, currentDictionary, mappingManager, compoundParts, compoundTranslated, compoundOriginal, allTerms);
            compoundTranslated += substring;
            compoundOriginal += originalPart;
        }
    
        // Check before & after for compound extension
        const textBeforeWord = currentText.substring(0, wordStartOffset);
        const prevMatch = textBeforeWord.match(/[^\s().]+$/);
        if (prevMatch) {
            const prevWord = prevMatch[0];
            const prevStart = wordStartOffset - prevWord.length;
            const prevCompound = Object.values(allCompounds).find(c => c.translated === prevWord && c.position === prevStart);
            if (prevCompound) {
                compoundTranslated = prevCompound.translated + (script === 'logographic' ? '' : '') + compoundTranslated;
                compoundOriginal = prevCompound.original + (script === 'logographic' ? '' : '') + compoundOriginal;
                compoundParts = [...prevCompound.parts, ...compoundParts];
                compoundStart = prevCompound.position;
                const oldCompoundId = Object.keys(allCompounds).find(id => allCompounds[id] === prevCompound);
                if (oldCompoundId) {
                    mappingManager.removeCompound(oldCompoundId);
                    log(`Removed old compound '${oldCompoundId}' to extend it`);
                }
            }
        }
    
        const textAfterWord = currentText.substring(wordStartOffset + currentWord.length);
        const nextMatch = textAfterWord.match(/^[^\s().]+/);
        if (nextMatch) {
            const nextWord = nextMatch[0];
            const nextOccurrences = (currentText.substring(0, wordStartOffset).match(new RegExp(nextWord, 'g')) || []).length + 1;
            const nextId = `${nextWord}_${nextOccurrences}`;
            const originalAfter = allTerms[nextId];
            if (originalAfter && dict[nextWord]) {
                compoundTranslated += (script === 'logographic' ? '' : '') + nextWord;
                compoundOriginal += (script === 'logographic' ? '' : '') + originalAfter;
                compoundParts.push(nextId);
            }
        }
    
        if (compoundParts.length > 1) {
            const compoundId = mappingManager.addCompound(compoundOriginal, compoundTranslated, compoundParts, compoundStart);
            log(`Added/Updated compound: '${compoundTranslated}' -> '${compoundOriginal}' (${compoundId}) with parts ${JSON.stringify(compoundParts)}`);
            if (!dict[compoundTranslated]) {
                dict[compoundTranslated] = [compoundOriginal];
                fs.writeFileSync(dictPath, JSON.stringify(dict, null, 2), 'utf8');
                log(`Added compound '${compoundTranslated}' -> '${compoundOriginal}' to dictionary`);
            }
        } else {
            log(`No compound formed for '${currentWord}'`);
        }
    }
    
    /**
 * Processe a single part of a compound word & updates map if necessary..
 * @returns The original term used for the substring (either newly mapped or existing).
 */
async function processPart(
    substring: string,
    lookupSubstring: string,
    substringStartOffset: number,
    currentText: string,
    currentDictionary: { [key: string]: string[] },
    mappingManager: MappingManager,
    compoundParts: string[],
    compoundTranslated: string,
    compoundOriginal: string,
    allTerms: { [key: string]: string }
): Promise<string> {
    const textBefore = currentText.substring(0, substringStartOffset);
    const occurrencesBefore = (textBefore.match(new RegExp(substring, 'g')) || []).length + 1;
    const identifier = `${substring}_${occurrencesBefore}`;
    const isAlreadyMapped = allTerms[identifier] && mappingManager.getPosition(identifier) === substringStartOffset;

    if (!isAlreadyMapped) {
        let options = currentDictionary[substring] ? getOriginalTerms(substring) : [];
        if (options.length === 0) {
            const lowerSubstring = substring.toLowerCase();
            options = currentDictionary[lowerSubstring] ? getOriginalTerms(lowerSubstring) : [];
        }

        let selected: string | undefined;
        if (options.length > 1) {
            log(`Ambiguous term '${substring}' detected, showing popup`);
            selected = await vscode.window.showQuickPick(options, {
                placeHolder: `Select meaning for "${substring}"`,
                ignoreFocusOut: true,
            });
        } else if (options.length === 1) {
            selected = options[0];
            log(`Single option '${selected}' selected for '${substring}'`);
        }

        if (selected) {
            mappingManager.addInsertionPictographic(selected, substring, substringStartOffset, currentText);
            log(`Mapped '${substring}' to '${selected}' with identifier '${identifier}'`);
            compoundParts.push(identifier);
            return selected;
        } else {
            mappingManager.addInsertionPictographic(substring, substring, substringStartOffset, currentText);
            log(`Mapped untranslated '${substring}' to itself with identifier '${identifier}'`);
            compoundParts.push(identifier);
            return substring;
        }
    } else {
        const existingMeaning = allTerms[identifier];
        log(`Reusing existing mapping '${existingMeaning}' for '${substring}' at position ${substringStartOffset}`);
        compoundParts.push(identifier);
        return existingMeaning;
    }
}

    


context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(async (event: vscode.TextDocumentChangeEvent) => {
    const isTargetLang = context.workspaceState.get('isTargetLanguage', false);
    log(`Text document changed: isTargetLanguage=${isTargetLang}, isProcessingEdit=${isProcessingEdit}`);
    if (isProcessingEdit) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== event.document) {
        log('Skipping: No active editor or document mismatch');
        return;
    }
    if (lastDocumentText === null) {
        lastDocumentText = editor.document.getText();
        log(`Initialized lastDocumentText on first change: '${lastDocumentText}'`);
    }

    isProcessingEdit = true;
    const currentText = editor.document.getText();
    const currentLanguage = languageSelector.getCurrentLanguage();
    const script = detectScript(currentText);
    const currentDictionary = require('./translation').currentDictionary;

    for (const change of event.contentChanges) {
        const startOffset = editor.document.offsetAt(change.range.start);
        const endOffset = editor.document.offsetAt(change.range.end);

        if (!isTargetLang) {
            log('Skipping change processing: Not in target language mode');
            continue;
        }

        const checkOffset = change.text ? startOffset + change.text.length : startOffset;
        const wordRange = editor.document.getWordRangeAtPosition(
            editor.document.positionAt(checkOffset),
            /[\p{L}\p{M}\p{N}]+/u // Match only letters and numbers
        );

        const currentWord = wordRange ? editor.document.getText(wordRange) : '';
        const wordStartOffset = wordRange ? editor.document.offsetAt(wordRange.start) : startOffset;
        log(`Processing change at offset ${checkOffset}, current word: '${currentWord}', word start offset: ${wordStartOffset}`);

        if (change.text === '' && change.rangeLength > 0) {
            const actualDeletedText = lastDocumentText.substring(startOffset, endOffset);
            log(`Deletion detected: text='${actualDeletedText}', startOffset=${startOffset}, endOffset=${endOffset}`);

            const windowStart = Math.max(0, startOffset - 25);
            const windowEnd = Math.min(currentText.length, startOffset + 25);
            preDeletionWindow = currentText.substring(windowStart, windowEnd);
            deletionContext = preDeletionWindow;
            deletedTextBuffer += actualDeletedText;
            log(`Deletion context updated: '${deletionContext}', deletedTextBuffer: '${deletedTextBuffer}'`);

            if (currentWord) {
                await handleCompoundDetection(currentWord, wordStartOffset, checkOffset, currentText, currentLanguage, script, currentDictionary, mappingManager);
            } else {
                const textBeforeDeletion = lastDocumentText.substring(0, startOffset);
                const allTerms = mappingManager.getAllTerms();
                for (const [term, _] of Object.entries(currentDictionary)) {
                    const termStart = startOffset - term.length;
                    if (termStart >= 0 && lastDocumentText.substring(termStart, startOffset + actualDeletedText.length).includes(term)) {
                        const occurrencesBefore = (textBeforeDeletion.match(new RegExp(term, 'g')) || []).length + 1;
                        const identifier = `${term}_${occurrencesBefore}`;
                        if (allTerms[identifier]) {
                            mappingManager.removeTermPictographic(identifier, termStart);
                            log(`Removed mapping '${identifier}' for '${term}' due to deletion`);
                            lastDeletedIdentifier = identifier;
                            break;
                        }
                    }
                }
            }
        } else if (change.text) {
            log(`Insertion detected: text='${change.text}', current word: '${currentWord}'`);

            const windowStart = Math.max(0, startOffset - 25);
            const windowEnd = Math.min(currentText.length, startOffset + change.text.length + 25);
            preDeletionWindow = currentText.substring(windowStart, windowEnd);
            lastCursorOffset = startOffset + change.text.length;
            deletionContext = '';

            if (currentWord) {
                await handleCompoundDetection(currentWord, wordStartOffset, checkOffset, currentText, currentLanguage, script, currentDictionary, mappingManager);
            }

            if (/[\s+$_) (*&^%$#@!}{]['";:.,></?\|-]+/.test(change.text)) { // Treat special chars as delimiters
                insertionBuffer = '';
                bufferStartOffset = null;
                lastDeletedIdentifier = null;
                deletedTextBuffer = '';
                log('Delimiter detected (space or special char), buffers reset');
            } else {
                insertionBuffer = currentWord;
                bufferStartOffset = wordRange ? editor.document.offsetAt(wordRange.start) : startOffset;
            }
        }
    }

    isProcessingEdit = false;
    lastDocumentText = currentText;
    log(`Document updated, post-update text='${lastDocumentText}'`);
}));

    registerHoverProvider(context, {
        selectedLanguage: () => languageSelector.getCurrentLanguage(),
        currentDictionary: () => require('./translation').currentDictionary,
        currentMap: () => mappingManager,
        lastOriginalText: () => require('./translation').lastOriginalText || '',
        lastTranslatedText: () => require('./translation').lastTranslatedText || '',
    });

    context.subscriptions.push(toggleDisposable, addToDictDisposable, removeFromDictDisposable);
    log('Extension activated successfully');
}

export function deactivate() 
{
    log('Deactivating VSCode Translator extension');
}

export interface TranslatorState 
{
    selectedLanguage: () => string;
    currentDictionary: () => { [key: string]: string[] };
    currentMap: () => MappingManager;
    lastOriginalText: () => string;
    lastTranslatedText: () => string;

}



let lastCursorPosition: vscode.Position | null = null;