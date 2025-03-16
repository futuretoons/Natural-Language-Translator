import * as vscode from 'vscode';
import { log } from './utils';
import { TranslatorState } from './extension';

export function registerHoverProvider(context: vscode.ExtensionContext, state: TranslatorState) 
{
    const hoverProvider = vscode.languages.registerHoverProvider('*', {
        provideHover(document: vscode.TextDocument, position: vscode.Position) {
            const range = document.getWordRangeAtPosition(position, /[@%$&#\[\{]?[\p{L}\p{M}\p{N}]+[\]_,}*]?/u);
            if (!range) 
                {
                log(`No word range found at position ${position.line}:${position.character}`);
                return undefined;
            }

            const word = document.getText(range);
            const offset = document.offsetAt(range.start);
            const isTargetLanguage = context.workspaceState.get('isTargetLanguage', false);

            log(`Hover requested for word '${word}' at offset ${offset}, isTargetLanguage=${isTargetLanguage}`);

            const mappingManager = state.currentMap();
            const allTerms = mappingManager.getAllTerms();
            const allCompounds = mappingManager.getAllCompounds();

            if (isTargetLanguage)
                 {
                // Check compound term map first
                const compoundId = mappingManager.getCompoundByTranslated(word);
                if (compoundId && allCompounds[compoundId]) {
                    const compound = allCompounds[compoundId];
                    const parts = compound.parts.map((part: string) => `${part}: ${allTerms[part] || 'unknown'}`).join(', ');
                    log(`Hover: Compound '${compoundId}' maps to '${compound.original}' with parts ${parts}`);
                    const hoverText = new vscode.MarkdownString(`**${word}**: ${compound.original} (Compound)\n\nParts: ${parts}`);
                    hoverText.isTrusted = true;
                    return new vscode.Hover(hoverText, range);
                }

                // Fallback to term lookup
                const textBefore = document.getText().substring(0, offset);
                const core = word.replace(/^[@%$&#\[\{]+|[\]_,}*]+$/, '');
                const occurrencesBefore = (textBefore.match(new RegExp(core, 'g')) || []).length + 1;
                const identifier = `${core}_${occurrencesBefore}`;
                const mappedValue = allTerms[identifier];

                if (mappedValue) 
                    {
                    log(`Hover: '${identifier}' maps to '${mappedValue}' at occurrence ${occurrencesBefore}`);
                    const hoverText = new vscode.MarkdownString(`**${word}**: ${mappedValue}`);
                    hoverText.isTrusted = true;
                    return new vscode.Hover(hoverText, range);
                }

                // Fallback 2 dictionary when there is no mapping. 
                const currentDict = state.currentDictionary();
                const reverseDict: { [key: string]: string[] } = {};
                for (const [engWord, targetTerms] of Object.entries(currentDict)) {
                    targetTerms.forEach((target: string) => {
                        reverseDict[target] = reverseDict[target] || [];
                        reverseDict[target].push(engWord);
                    });
                }
                if (reverseDict[core])
                     {
                    const meanings = reverseDict[core].join(', ');
                    log(`Hover: '${word}' maps to '${meanings}' via dictionary`);
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
                if (currentDict[word])
                     {
                    const translated = currentDict[word].join(', ');
                    log(`Hover: English '${word}' translates to '${translated}' in ${selectedLanguage}`);
                    const hoverText = new vscode.MarkdownString(`**${word}**: ${translated} (${selectedLanguage})`);
                    hoverText.isTrusted = true;
                    return new vscode.Hover(hoverText, range);
                }

                log(`No translation found for '${word}' in English mode`);
                return undefined;
            }
            
        }
    });

    context.subscriptions.push(hoverProvider);
    log('Hover provider registered');
}