import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MappingManager } from './mappings';
import { log } from './utils';

export interface Dictionary {
    [key: string]: string[];
}

export let currentDictionary: Dictionary = {};
export let lastDictionary: Dictionary = {};
export let lastTranslatedText: string | null = null;
export let lastOriginalText: string | null = null;
export let lastLanguage: string | null = null;

export function getTokenRegex(script: string): RegExp {
    return /[\p{L}\p{M}\p{N}]+|[^\s\p{L}\p{M}\p{N}]+|\s+/gu;
}

export function detectScript(text: string): 'latin' | 'cyrillic' | 'devanagari' | 'logographic' {
    if (/[\u4E00-\u9FFF]/.test(text)) return 'logographic';
    if (/[\u0900-\u097F]/.test(text)) return 'devanagari';
    if (/[а-яА-ЯёЁ]/.test(text)) return 'cyrillic';
    return 'latin';
}

export function matchCase(source: string, target: string): string {
    if (/^[A-Z]/.test(source) && /^[a-z]/.test(target)) {
        return target.charAt(0).toUpperCase() + target.slice(1);
    }
    if (/^[a-z]/.test(source) && /^[A-Z]/.test(target)) {
        return target.charAt(0).toLowerCase() + target.slice(1);
    }
    return target;
}

export async function translateToTarget(
    text: string,
    dictionary: Dictionary,
    mappingManager: MappingManager,
    context: vscode.ExtensionContext,
    targetLanguage: string,
    updateProgress: () => void
): Promise<string> {
    mappingManager.clearMap();
    const script = detectScript(text);
    const tokens = text.match(getTokenRegex(script)) || [];
    const translatedTokens: string[] = [];
    const dictPath = path.join(context.extensionPath, 'out', 'languages', 'languages', `${targetLanguage}.json`);
    let position = 0;
    let updated = false;

    log(`Translating to '${targetLanguage}' (script: ${script})`);
    log(`Tokens: ${JSON.stringify(tokens)}`);

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const tokenStartPosition = position;

        if (/[^\p{L}\p{M}\p{N}]+|\s+/u.test(token)) {
            translatedTokens.push(token);
            position += token.length;
            log(`Kept '${token}' at ${tokenStartPosition} (punctuation)`);
            updateProgress();
            continue;
        }

        let translated = '';
        const original = token;
        let foundFull = false;

        for (const [dictTerm, enTerms] of Object.entries(dictionary)) {
            if (enTerms.some(t => t.toLowerCase() === original.toLowerCase())) {
                translated = matchCase(original, dictTerm);
                foundFull = true;
                const originalCase = enTerms.find(t => t === original) || enTerms[0];
                const isTypeAnnotation = i > 0 && (tokens[i - 1].trim() === ':' || tokens[i - 1].trim() === '->');
                const idBase = script === 'latin' ? translated.toLowerCase() : translated;
                const textSoFar = translatedTokens.join('');
                const escapedIdBase = idBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const occurrences = (textSoFar.match(new RegExp(escapedIdBase, 'gi')) || []).length;
                const identifier = `${idBase}_${occurrences + 1}${isTypeAnnotation ? '_type' : ''}`;
                mappingManager.addTerm(originalCase, translated, tokenStartPosition, identifier);
                log(`Translated '${original}' to '${translated}' at ${tokenStartPosition}, mapped as '${identifier}'`);
                if (translated.toLowerCase() === 'zeichenkette') {
                    log(`DEBUG: Mapped zeichenkette: original='${originalCase}', translated='${translated}', id='${identifier}', prevToken='${i > 0 ? tokens[i - 1] : ''}', position=${tokenStartPosition}`);
                }
                break;
            }
        }

        if (!foundFull) {
            const parts = splitCompound(original);
            if (parts.length > 1) {
                const translatedParts: string[] = [];
                const partIds: string[] = [];
                let partPosition = tokenStartPosition;

                for (const part of parts) {
                    let partTarget = '';
                    for (const [dictTerm, enTerms] of Object.entries(dictionary)) {
                        if (enTerms.some(t => t.toLowerCase() === part.toLowerCase())) {
                            partTarget = matchCase(part, dictTerm);
                            if (!enTerms.includes(part)) {
                                enTerms.push(part);
                                updated = true;
                            }
                            break;
                        }
                    }
                    if (!partTarget) partTarget = part;
                    translatedParts.push(partTarget);
                    const idBase = script === 'latin' ? partTarget.toLowerCase() : partTarget;
                    const textSoFar = translatedTokens.join('') + translatedParts.slice(0, -1).join('');
                    const escapedIdBase = idBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const occurrences = (textSoFar.match(new RegExp(escapedIdBase, 'gi')) || []).length;
                    const identifier = `${idBase}_${occurrences + 1}`;
                    mappingManager.addTerm(part, partTarget, partPosition, identifier);
                    partIds.push(identifier);
                    partPosition += part.length;
                }

                translated = translatedParts.join(script === 'devanagari' ? '' : '');
                const compoundOriginal = original;
                const compoundId = mappingManager.addCompound(compoundOriginal, translated, partIds, tokenStartPosition);
                log(`Mapped compound '${compoundId}' to '${compoundOriginal}' -> '${translated}' at ${tokenStartPosition}`);
            } else {
                translated = original;
                const idBase = script === 'latin' ? translated.toLowerCase() : translated;
                const textSoFar = translatedTokens.join('');
                const escapedIdBase = idBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const occurrences = (textSoFar.match(new RegExp(escapedIdBase, 'gi')) || []).length;
                const identifier = `${idBase}_${occurrences + 1}`;
                mappingManager.addTerm(original, translated, tokenStartPosition, identifier);
                log(`Untranslated '${original}' kept as '${translated}' at ${tokenStartPosition}, mapped as '${identifier}'`);
            }
        }

        translatedTokens.push(translated);
        position += token.length;
        updateProgress();
    }

    if (updated) {
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
    const isLatin = script === 'latin';

    log(`Translating back: '${text}' with script '${script}'`);
    log(`Compounds: ${JSON.stringify(allCompounds)}`);
    log(`Terms: ${JSON.stringify(allTerms)}`);

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const tokenStartPosition = position;

        if (/[^\p{L}\p{M}\p{N}]+|\s+/u.test(token)) {
            translatedTokens.push(token);
            position += token.length;
            log(`Kept '${token}' at ${tokenStartPosition} (punctuation)`);
            updateProgress();
            continue;
        }

        let translated = '';
        const targetTerm = token;

        // Check compound first
        const compoundId = mappingManager.getCompoundByTranslated(targetTerm, script);
        if (compoundId && allCompounds[compoundId]) {
            translated = allCompounds[compoundId].original;
            log(`Matched compound '${targetTerm}' to '${translated}' at ${tokenStartPosition} via compoundId '${compoundId}'`);
            translatedTokens.push(translated);
            position += targetTerm.length;
            updateProgress();
            continue;
        }

        // Determine if this is a type annotation
        let isTypeAnnotation = false;
        if (i > 0) {
            const prevText = text.substring(0, tokenStartPosition).slice(-10);
            isTypeAnnotation = /:\s*$|->\s*$/.test(prevText);
            log(`Type annotation check for '${targetTerm}' at ${tokenStartPosition}: isTypeAnnotation=${isTypeAnnotation}, prevToken='${i > 0 ? tokens[i - 1] : ''}', prevText='${prevText}'`);
        }

        // Use original text for occurrence counting
        const idBase = isLatin ? targetTerm.toLowerCase() : targetTerm;
        const textUpToPosition = text.substring(0, tokenStartPosition);
        const escapedIdBase = idBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const occurrences = (textUpToPosition.match(new RegExp(escapedIdBase, 'gi')) || []).length;
        const typeIdentifier = `${idBase}_${occurrences + 1}_type`;
        const regularIdentifier = `${idBase}_${occurrences + 1}`;
        let mappedOriginal = isTypeAnnotation ? allTerms[typeIdentifier] : allTerms[regularIdentifier];

        if (mappedOriginal) {
            translated = isLatin ? matchCase(targetTerm, mappedOriginal) : mappedOriginal;
            log(`Matched term '${targetTerm}' to '${translated}' at ${tokenStartPosition} (identifier '${isTypeAnnotation ? typeIdentifier : regularIdentifier}')`);
        } else {
            // Secondary lookup: try the other identifier
            mappedOriginal = isTypeAnnotation ? allTerms[regularIdentifier] : allTerms[typeIdentifier];
            if (mappedOriginal) {
                translated = isLatin ? matchCase(targetTerm, mappedOriginal) : mappedOriginal;
                log(`Secondary match '${targetTerm}' to '${translated}' at ${tokenStartPosition} (identifier '${isTypeAnnotation ? regularIdentifier : typeIdentifier}')`);
            } else {
                // Fallback: check dictionary with type annotation preference
                for (const [dictTerm, enTerms] of Object.entries(dictionary)) {
                    if ((isLatin && dictTerm.toLowerCase() === targetTerm.toLowerCase()) || (!isLatin && dictTerm === targetTerm)) {
                        if (targetTerm.toLowerCase() === 'zeichenkette' && isTypeAnnotation) {
                            translated = isLatin ? matchCase(targetTerm, 'str') : 'str';
                            log(`Type annotation fallback '${targetTerm}' to 'str' at ${tokenStartPosition}`);
                        } else {
                            const mappedTerm = Object.entries(allTerms).find(([id, orig]) => {
                                const trans = mappingManager.getTranslated(id);
                                return trans && (isLatin ? trans.toLowerCase() === dictTerm.toLowerCase() : trans === dictTerm);
                            });
                            if (mappedTerm) {
                                translated = isLatin ? matchCase(targetTerm, mappedTerm[1]) : mappedTerm[1];
                                log(`Dictionary fallback using mapped term '${targetTerm}' to '${translated}' at ${tokenStartPosition}`);
                            } else {
                                translated = isLatin ? matchCase(targetTerm, enTerms[0]) : enTerms[0];
                                log(`Dictionary fallback default '${targetTerm}' to '${translated}' at ${tokenStartPosition}`);
                            }
                        }
                        break;
                    }
                }
                if (!translated) {
                    translated = targetTerm;
                    log(`No match for '${targetTerm}' at ${tokenStartPosition}, keeping as '${translated}'`);
                }
            }
        }

        translatedTokens.push(translated);
        position += targetTerm.length;
        updateProgress();
    }

    return translatedTokens.join('');
}

export function getOriginalTerms(targetTerm: string): string[] {
    const terms = currentDictionary[targetTerm] || [];
    log(`getOriginalTerms for '${targetTerm}': ${JSON.stringify(terms)}`);
    return terms;
}

export async function toggleTranslation(
    text: string,
    language: string,
    editor: vscode.TextEditor,
    mappingManager: MappingManager,
    context: vscode.ExtensionContext
): Promise<void> {
    const updateProgress = () => {};
    if (language !== 'en') {
        const dictionaryPath = path.join(context.extensionPath, 'out', 'languages', 'languages', `${language}.json`);
        currentDictionary = JSON.parse(fs.readFileSync(dictionaryPath, 'utf8'));
        lastDictionary = { ...currentDictionary };
        lastLanguage = language;
        log(`Loaded dictionary for ${language}`);
    }

    let newText: string;
    if (language !== 'en') {
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
}

export function splitCompound(term: string): string[] {
    const parts = term.match(/[A-Z][a-z]*|[a-z]+/g) || [term];
    return parts.filter(Boolean);
}

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
                parts.push(...splitCompound(currentPart));
            }
            currentPart = char;
            lastScript = currentScript;
        } else {
            currentPart += char;
        }
    }

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

function segmentLogographic(text: string): string[] 
{
    const segments: string[] = [];
    let pos = 0;

    while (pos < text.length) 
        {
        let longestMatch = '';
        for (let len = Math.min(text.length - pos, 4); len > 0; len--) 
            {
            const substring = text.substring(pos, pos + len);
            if (currentDictionary[substring]) 
                {
                longestMatch = substring;
                break;
            }
        }
        if (longestMatch) 
            {
            segments.push(longestMatch);
            pos += longestMatch.length;
        } else 
        {
            segments.push(text[pos]);
            pos++;
        }

    }

    return segments;
}

function segmentDevanagari(text: string): string[] 
{
    const segments: string[] = [];
    let pos = 0;

    while (pos < text.length) 
        {
        let longestMatch = '';
        for (let len = text.length - pos; len > 0; len--) 
            {
            const substring = text.substring(pos, pos + len);
            if (currentDictionary[substring]) {
                longestMatch = substring;

                break;

            }
        }
        if (longestMatch) 
            {
            segments.push(longestMatch);
            pos += longestMatch.length;
        } else {
            segments.push(text[pos]);
            pos++;
        }
    }

    return segments;
}

function segmentCyrillic(text: string): string[] 
{
    const segments: string[] = [];
    let pos = 0;

    while (pos < text.length) {
        let longestMatch = '';
        for (let len = text.length - pos; len > 0; len--) 
            {
            const substring = text.substring(pos, pos + len);
            if (currentDictionary[substring]) 
                {
                longestMatch = substring;
                break;
            }
        }
        if (longestMatch) 
            {
            segments.push(longestMatch);
            pos += longestMatch.length;
        } else {
            segments.push(text[pos]);
            pos++;
        }

    }

    return segments;
}