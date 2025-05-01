import * as vscode from 'vscode';
import { log } from './utils';
import { TranslatorState } from './extension';
import { detectScript } from './translation';

export function registerHoverProvider(context: vscode.ExtensionContext, state: TranslatorState) 
{
    const hoverProvider = vscode.languages.registerHoverProvider('*', 
        {
        provideHover(document: vscode.TextDocument, position: vscode.Position) 
        {
            const range = document.getWordRangeAtPosition(position, /[@%$&#\[\{]?[\p{L}\p{M}\p{N}]+[\]_,}*]?/u);
            if (!range) {
                log(`No word range found at position ${position.line}:${position.character}`);
                return undefined;
            }

            const word = document.getText(range);
            const offset = document.offsetAt(range.start);
            const isTargetLanguage = context.workspaceState.get('isTargetLanguage', false);
            const script = detectScript(word);

            log(`Hover requested for '${word}' at offset ${offset}, isTargetLanguage=${isTargetLanguage}`);

            const mappingManager = state.currentMap();
            const allTerms = mappingManager.getAllTerms();
            const allCompounds = mappingManager.getAllCompounds();

            if (isTargetLanguage) 
                {
                // Check compound term first
                const compoundId = mappingManager.getCompoundByTranslated(word, script);
                if (compoundId && allCompounds[compoundId]) 
                    {
                    const compound = allCompounds[compoundId];
                    log(`Compound parts: ${JSON.stringify(compound.parts)}`);
                    log(`All terms: ${JSON.stringify(allTerms)}`);
                    const parts = compound.parts.map((part: string) => {
                        let original = allTerms[part];
                        if (!original) {
                            // Try lowercase identifier
                            const lowerPart = part.toLowerCase();
                            original = allTerms[lowerPart] || allTerms[lowerPart.replace(/_\d+$/, '')];
                            log(`Fallback lookup for '${part}' -> '${lowerPart}': ${original || 'unknown'}`);
                        }
                        return `${part}: ${original || 'unknown'}`;
                    }).join(', ');
                    log(`Hover: Compound '${compoundId}' maps to '${compound.original}' with parts ${parts}`);
                    const hoverText = new vscode.MarkdownString(
                        `**${word}**: ${compound.original} (Compound)\n\nParts: ${parts}`
                    );
                    hoverText.isTrusted = true;
                    return new vscode.Hover(hoverText, range);
                }

                // Look up individual term
                const textBefore = document.getText().substring(0, offset);
                const coreWord = word.replace(/^[@%$&#\[\{]+|[\]_,}*]+$/, '');
                const isTypeAnnotation = checkIfTypeAnnotation(document, position, textBefore);
                const idBase = script === 'latin' ? coreWord.toLowerCase() : coreWord;
                const escapedIdBase = idBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const occurrences = (textBefore.match(new RegExp(escapedIdBase, 'gi')) || []).length;
                const identifier = `${idBase}_${occurrences + 1}${isTypeAnnotation ? '_type' : ''}`;
                let mappedValue = allTerms[identifier];

                if (!mappedValue) 
                    {
                    // Try lowercase identifier
                    const lowerIdentifier = identifier.toLowerCase();
                    mappedValue = allTerms[lowerIdentifier] || allTerms[lowerIdentifier.replace(/_\d+$/, '')];
                    log(`Fallback lookup for '${identifier}' -> '${lowerIdentifier}': ${mappedValue || 'unknown'}`);
                }

                if (mappedValue) 
                    {
                    log(`Hover: '${identifier}' maps to '${mappedValue}' at occurrence ${occurrences + 1}, isTypeAnnotation=${isTypeAnnotation}`);
                    const hoverText = new vscode.MarkdownString(`**${word}**: ${mappedValue}`);
                    hoverText.isTrusted = true;
                    return new vscode.Hover(hoverText, range);
                }

                // Fallback to dictionary
                const currentDict = state.currentDictionary();
                const possibleTranslations = getOriginalTerms(coreWord.toLowerCase(), currentDict);
                if (possibleTranslations && possibleTranslations.length > 0) {
                    const meanings = isTypeAnnotation && possibleTranslations.includes('for')
                        ? 'for'
                        : possibleTranslations.join(', ');
                    log(`Hover: '${word}' maps to '${meanings}' via dictionary fallback`);
                    const hoverText = new vscode.MarkdownString(`**${word}**: ${meanings}`);
                    hoverText.isTrusted = true;
                    return new vscode.Hover(hoverText, range);
                }

                log(`No mapping or dictionary entry for '${word}' at offset ${offset}`);
                return undefined;
            } else {
                // English mode
                const currentDict = state.currentDictionary();
                const selectedLanguage = state.selectedLanguage();
                const translations = currentDict[word.toLowerCase()];
                if (translations && translations.length > 0) {
                    const translatedText = translations.join(', ');
                    log(`Hover: English '${word}' translates to '${translatedText}' in ${selectedLanguage}`);
                    const hoverText = new vscode.MarkdownString(
                        `**${word}**: ${translatedText} (${selectedLanguage})`
                    );
                    hoverText.isTrusted = true;
                    return new vscode.Hover(hoverText, range);
                }

                log(`No translation found for '${word}' in English mode`);
                return undefined;
            }
        }
    });

    context.subscriptions.push(hoverProvider);
    log('Hover provider registered successfully');
}

function checkIfTypeAnnotation(document: vscode.TextDocument, position: vscode.Position, textBefore: string): boolean 
{
    const lineText = document.lineAt(position.line).text;
    const textBeforePosition = lineText.substring(0, position.character);
    const typeAnnotationRegex = /:\s*\w+$|->\s*\w+$/;
    const isType = typeAnnotationRegex.test(textBeforePosition);
    log(`Checking type annotation for '${textBeforePosition}': ${isType}`);
    return isType;
}

function getOriginalTerms(targetTerm: string, dictionary: { [key: string]: string[] }): string[] 
{
    for (const [dictTerm, enTerms] of Object.entries(dictionary)) {
        if (dictTerm.toLowerCase() === targetTerm.toLowerCase()) {
            return enTerms;
        }
    }
    return [];
}