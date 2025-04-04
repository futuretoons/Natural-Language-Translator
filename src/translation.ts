import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MappingManager } from './mappings';
import { log } from './utils';

export interface Dictionary 
{
    [key: string]: string[];
}

export let currentDictionary: Dictionary = {};
export let lastDictionary: Dictionary = {};
export let lastTranslatedText: string | null = null;
export let lastOriginalText: string | null = null;
export let lastLanguage: string | null = null;

const PROTECTED_KEYWORDS = new Set(['long', 'bool', 'const', 'char', 'int', 'void', 'for', 'if', 'true', 'false', 'break']);

export function getTokenRegex(script: string): RegExp 
{
    return /[\p{L}\p{M}\p{N}]+|[^\s\p{L}\p{M}\p{N}]+|\s+/gu; // Unified for all scripts
}

export function detectScript(text: string): 'latin' | 'cyrillic' | 'devanagari' | 'logographic' 
{
    if (/[\u4E00-\u9FFF]/.test(text)) return 'logographic';
    if (/[\u0900-\u097F]/.test(text)) return 'devanagari';
    if (/[а-яА-ЯёЁ]/.test(text)) return 'cyrillic';
    return 'latin';

}

export async function toggleTranslation(
    text: string,
    language: string,
    editor: vscode.TextEditor,
    mappingManager: MappingManager,
    context: vscode.ExtensionContext
): Promise<void> 
{
    if (language !== 'en' && language !== lastLanguage) 
        {
        const dictionaryPath = path.join(context.extensionPath, 'out', 'languages', 'languages', `${language}.json`);
        currentDictionary = JSON.parse(fs.readFileSync(dictionaryPath, 'utf8'));
        lastDictionary = { ...currentDictionary };

        lastLanguage = language;
        mappingManager.clearMap();
        log(`Loaded dictionary for ${language} and cleared map`);
    }

    let newText: string;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Translating to ${language === 'en' ? 'English' : language.toUpperCase()}...`,
        cancellable: false
    }, async (progress) => {
        const tokens = text.match(getTokenRegex(detectScript(text))) || [];
        const totalSteps = tokens.length;
        let completedSteps = 0;

        const updateProgress = () => {
            completedSteps++;
            const increment = (completedSteps / totalSteps) * 100;

            progress.report({ message: `processing ${totalSteps} terms` });
        };

        if (language !== 'en')
            {
            newText = await translateToTarget(text, currentDictionary, mappingManager, context, language, updateProgress);
            lastTranslatedText = newText;

            lastOriginalText = text;
        } else {
            if (lastTranslatedText && lastOriginalText && text !== lastTranslatedText) {
                mappingManager.rebuildMap(lastTranslatedText, lastOriginalText, text);
            }
            newText = await translateToOriginal(text, mappingManager, lastDictionary, updateProgress);
            lastTranslatedText = null;

            lastOriginalText = null;
            currentDictionary = {};

        }

        await editor.edit((editBuilder: vscode.TextEditorEdit) => {
            const fullRange = new vscode.Range(
                editor.document.positionAt(0),
                editor.document.positionAt(text.length)
            );
            editBuilder.replace(fullRange, newText);
        });

    });
}

export function getOriginalTerms(targetTerm: string): string[] 
{
    const terms = currentDictionary[targetTerm] || [];
    log(`getOriginalTerms for '${targetTerm}': ${JSON.stringify(terms)}`);
    return terms;
}

export async function translateToTarget(
    text: string,
    dictionary: Dictionary,
    mappingManager: MappingManager,
    context: vscode.ExtensionContext,

    targetLanguage: string,
    updateProgress: () => void
): Promise<string> {
    const script = detectScript(text);
    const tokens = text.match(getTokenRegex(script)) || [];
    const translatedTokens: string[] = [];

    const dictPath = path.join(context.extensionPath, 'out', 'languages', 'languages', `${targetLanguage}.json`);
    let position = 0;
    let updated = false;

    log(`Translating to '${targetLanguage}' (script: ${script})`);
    log(`Tokens: ${JSON.stringify(tokens)}`);

    for (let i = 0; i < tokens.length; i++) 
        {
        const token = tokens[i];
        if (/[^\p{L}\p{M}\p{N}]+|\s+/u.test(token))
             {
            translatedTokens.push(token);
            position += token.length;
            log(`Kept '${token}' at ${position - token.length} (punctuation)`);
            updateProgress();
            continue;

        }

        let translated = '';
        const core = token;
        let foundFull = false;

        for (const [dictTerm, enTerms] of Object.entries(dictionary))
             {
            if (enTerms.some(t => t.toLowerCase() === core.toLowerCase())) 
                {
                translated = dictTerm;
                foundFull = true;
                const originalCase = enTerms.find(t => t === core) || enTerms[0];
                const identifier = mappingManager.addTerm(originalCase, translated, position);

                log(`Translated '${core}' to '${translated}' at ${position}, mapped as '${identifier}'`);
                break;
            }

        }

        if (!foundFull) 
            {
            const parts = splitCompound(core);
            if (parts.length > 1) {
                const translatedParts: string[] = [];
                const partIds: string[] = [];

                let partPosition = position;

                for (const part of parts) {
                    let partTarget = '';
                    for (const [dictTerm, enTerms] of Object.entries(dictionary)) {
                        if (enTerms.some(t => t.toLowerCase() === part.toLowerCase())) {
                            partTarget = dictTerm;
                            if (!enTerms.includes(part)) {
                                enTerms.push(part);
                                updated = true;

                            }
                            break;
                        }

                    }
                    if (!partTarget) partTarget = part;
                    translatedParts.push(partTarget);
                    const identifier = mappingManager.addTerm(part, partTarget, partPosition);
                    partIds.push(identifier);
                    partPosition += part.length;

                }

                translated = translatedParts.join(script === 'devanagari' ? '' : '');
                const compoundOriginal = parts.join('');
                const compoundId = mappingManager.addCompound(compoundOriginal, translated, partIds, position);
                log(`Mapped compound '${compoundId}' to '${compoundOriginal}' -> '${translated}' at ${position}`);
            } else {
                translated = core;
                const identifier = mappingManager.addTerm(core, core, position);
                log(`Untranslated '${core}' kept as '${translated}' at ${position}, mapped as '${identifier}'`);
            }
        }

        translatedTokens.push(translated);
        position += token.length;
        updateProgress();

    }

    if (updated)
       {
        fs.writeFileSync(dictPath, JSON.stringify(dictionary, null, 2), 'utf8');
        log(`Updated dictionary with new variants`);
    }

    return translatedTokens.join('');

}

export async function translateToOriginal(
    text: string,
    mappingManager: MappingManager,
    dictionary: Dictionary,
    updateProgress: () => void,
    script: string = detectScript(text)
): Promise<string> {
    const allTerms = mappingManager.getAllTerms();
    const allCompounds = mappingManager.getAllCompounds();
    const tokens = text.match(getTokenRegex(script)) || [];
    const translatedTokens: string[] = [];
    let position = 0;

    log(`Translating back: '${text}' with script '${script}'`);
    log(`Compounds: ${JSON.stringify(allCompounds)}`);
    log(`Terms: ${JSON.stringify(allTerms)}`);

    for (let i = 0; i < tokens.length; i++) 
        {
        const token = tokens[i];
        if (/[^\p{L}\p{M}\p{N}]+|\s+/u.test(token) || PROTECTED_KEYWORDS.has(token)) {
            translatedTokens.push(token);
            position += token.length;
            log(`Kept '${token}' at ${position - token.length} (protected or punctuation)`);
            updateProgress();
            continue;
        }

        let translated = '';
        const core = token;

        const compoundId = mappingManager.getCompoundByTranslated(core);
        if (compoundId && allCompounds[compoundId]) {
            translated = allCompounds[compoundId].original;
            log(`Matched compound '${core}' to '${translated}' at ${position} via compoundId '${compoundId}'`);
            translatedTokens.push(translated);
            position += core.length;
            updateProgress();
            continue;

        }

        const candidates = Object.entries(allTerms)
            .filter(([id, orig]) => {
                const trans = mappingManager.getTranslated(id);
                const pos = mappingManager.getPosition(id);
                return trans === core && Math.abs(pos - position) < core.length + 1;
            })
            .sort((a, b) => Math.abs(mappingManager.getPosition(a[0]) - position) - Math.abs(mappingManager.getPosition(b[0]) - position));

        if (candidates.length > 0) 
            {
            translated = candidates[0][1];
            log(`Matched term '${core}' to '${translated}' at ${position} via proximity (identifier '${candidates[0][0]}')`);
        } else {
            for (const [dictTerm, enTerms] of Object.entries(dictionary)) 
                {
                if (dictTerm.toLowerCase() === core.toLowerCase()) 
                    {
                    translated = enTerms[0];
                    log(`Dictionary fallback '${core}' to '${translated}' at ${position}`);
                    break;
                }

            }
            if (!translated)
                 {
                translated = core;
                log(`No match for '${core}' at ${position}, keeping as '${translated}'`);

            }


        }

        translatedTokens.push(translated);
        position += token.length;
        updateProgress();
    }

    return translatedTokens.join('');


}


/**
 * Split a compound word based on capital letters in latin script..
 */
export function splitCompound(term: string): string[] {
    const parts = term.match(/[A-Z][a-z]*|[a-z]+/g) || [term];
    return parts.filter(Boolean);
}

/**
 * Splits a compound word based on script transitions and dictionary terms for non Latin languages..
 */
export function splitNonLatinCompound(term: string): string[] {
    const parts: string[] = [];
    let currentPart = '';
    let lastScript = detectScript(term[0]);

    for (let i = 0; i < term.length; i++) {
        const char = term[i];
        const currentScript = detectScript(char);

        if (i === 0) {
            currentPart = char;
            continue;
        }

        if (currentScript !== lastScript) {
            if (lastScript === 'logographic') {
                parts.push(...segmentLogographic(currentPart));
            } else if (lastScript === 'devanagari') {
                parts.push(...segmentDevanagari(currentPart));
            } else if (lastScript === 'cyrillic') {
                parts.push(...segmentCyrillic(currentPart));
            } else if (lastScript === 'latin') {
                parts.push(...splitCompound(currentPart)); // Use splitCompound for Latin with diacritics
            }
            currentPart = char;
            lastScript = currentScript;
        } else {
            currentPart += char;
        }
    }

    // Handle the last part
    if (currentPart) {
        if (lastScript === 'logographic') {
            parts.push(...segmentLogographic(currentPart));
        } else if (lastScript === 'devanagari') {
            parts.push(...segmentDevanagari(currentPart));
        } else if (lastScript === 'cyrillic') {
            parts.push(...segmentCyrillic(currentPart));
        } else if (lastScript === 'latin') {
            parts.push(...splitCompound(currentPart));
        }
    }

    return parts.filter(Boolean);
}

function segmentLogographic(text: string): string[] {
    const segments: string[] = [];
    let pos = 0;

    while (pos < text.length) {
        let longestMatch = '';
        for (let len = Math.min(text.length - pos, 4); len > 0; len--) { // Max 4 chars for Chinese
            const substring = text.substring(pos, pos + len);
            if (currentDictionary[substring]) {
                longestMatch = substring;
                break;
            }
        }
        if (longestMatch) {
            segments.push(longestMatch);
            pos += longestMatch.length;
        } else {
            segments.push(text[pos]);
            pos++;
        }
    }

    return segments;
}

function segmentDevanagari(text: string): string[] {
    const segments: string[] = [];
    let pos = 0;

    while (pos < text.length) {
        let longestMatch = '';
        for (let len = text.length - pos; len > 0; len--) {
            const substring = text.substring(pos, pos + len);
            if (currentDictionary[substring]) {
                longestMatch = substring;
                break;
            }
        }
        if (longestMatch) {
            segments.push(longestMatch);
            pos += longestMatch.length;
        } else {
            segments.push(text[pos]);
            pos++;
        }
    }

    return segments;
}


function segmentCyrillic(text: string): string[] {
    const segments: string[] = [];
    let pos = 0;

    while (pos < text.length) {
        let longestMatch = '';
        for (let len = text.length - pos; len > 0; len--) {
            const substring = text.substring(pos, pos + len);
            if (currentDictionary[substring]) {
                longestMatch = substring;
                break;
            }
        }
        if (longestMatch) {
            segments.push(longestMatch);
            pos += longestMatch.length;
        } else {
            segments.push(text[pos]);
            pos++;
        }
    }

    return segments;
}