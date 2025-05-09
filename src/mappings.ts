import * as vscode from 'vscode';
import { log } from './utils';
import { detectScript, getTokenRegex } from './translation';

export class MappingManager {
    private context: vscode.ExtensionContext;
    private compoundCounter: number;
    private isRebuilding: boolean = false; // Guard against concurrent rebuilds

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.compoundCounter = this.context.workspaceState.get('compoundCounter', 0) as number;
    }

    addTerm(originalTerm: string, translatedTerm: string, position: number, identifier: string): string {
        if (typeof position !== 'number') {
            log(`ERROR: Invalid position type for '${identifier}': ${typeof position}, value=${position}`);
            position = 0; // Fallback to 0
        }
        this.context.workspaceState.update(`original_${identifier}`, originalTerm);
        this.context.workspaceState.update(`translated_${identifier}`, translatedTerm);
        this.context.workspaceState.update(`position_${identifier}`, position);
        this.context.workspaceState.update(`compoundIds_${identifier}`, []);
        log(`Added term: '${identifier}' -> '${originalTerm}' at position ${position}`);
        return identifier;
    }

    addInsertionPictographic(originalTerm: string, translatedTerm: string, position: number, currentText: string): string {
        if (typeof position !== 'number') {
            log(`ERROR: Invalid position type for '${translatedTerm.toLowerCase()}_${position}': ${typeof position}, value=${position}`);
            position = 0; // Fallback to 0
        }
        const identifier = `${translatedTerm.toLowerCase()}_${position}`;
        log(`Adding insertion: '${translatedTerm}' -> '${originalTerm}' at position ${position}, identifier='${identifier}'`);

        this.context.workspaceState.update(`original_${identifier}`, originalTerm);
        this.context.workspaceState.update(`translated_${identifier}`, translatedTerm);
        this.context.workspaceState.update(`position_${identifier}`, position);
        this.context.workspaceState.update(`compoundIds_${identifier}`, []);
        return identifier;
    }

    addCompound(originalCompound: string, translatedCompound: string, partIds: string[], position: number): string {
        if (typeof position !== 'number') {
            log(`ERROR: Invalid position type for compound '${translatedCompound}': ${typeof position}, value=${position}`);
            position = 0; // Fallback to 0
        }
        this.compoundCounter++;
        const compoundId = `compound_${this.compoundCounter}`;
        this.context.workspaceState.update(`compound_${compoundId}_original`, originalCompound);
        this.context.workspaceState.update(`compound_${compoundId}_translated`, translatedCompound);
        this.context.workspaceState.update(`compound_${compoundId}_parts`, partIds);
        this.context.workspaceState.update(`compound_${compoundId}_position`, position);
        this.context.workspaceState.update(`translated_to_compound_${translatedCompound}`, compoundId);
        this.context.workspaceState.update('compoundCounter', this.compoundCounter);

        for (const partId of partIds) {
            const currentCompoundIds = (this.context.workspaceState.get(`compoundIds_${partId}`) as string[] | undefined) || [];
            if (!currentCompoundIds.includes(compoundId)) {
                currentCompoundIds.push(compoundId);
                this.context.workspaceState.update(`compoundIds_${partId}`, currentCompoundIds);
                log(`Linked '${partId}' to compound '${compoundId}'`);
            }
        }

        log(`Added compound: '${compoundId}' -> '${originalCompound}' with parts ${JSON.stringify(partIds)} at ${position}`);
        return compoundId;
    }

    removeTermPictographic(identifier: string, position: number): void {
        const allTerms = this.getAllTerms();
        const allCompounds = this.getAllCompounds();
        const [coreTerm] = identifier.split('_');

        const compoundIds = (this.context.workspaceState.get(`compoundIds_${identifier}`) as string[] | undefined) || [];
        for (const compoundId of compoundIds) {
            const compound = allCompounds[compoundId];
            if (compound) {
                const updatedParts = compound.parts.filter(part => part !== identifier);
                this.context.workspaceState.update(`compound_${compoundId}_parts`, updatedParts);
                log(`Updated compound '${compoundId}': removed part '${identifier}'`);
                if (updatedParts.length === 0) {
                    this.context.workspaceState.update(`compound_${compoundId}_original`, undefined);
                    this.context.workspaceState.update(`compound_${compoundId}_translated`, undefined);
                    this.context.workspaceState.update(`compound_${compoundId}_parts`, undefined);
                    this.context.workspaceState.update(`compound_${compoundId}_position`, undefined);
                    this.context.workspaceState.update(`translated_to_compound_${compound.translated}`, undefined);
                    log(`Removed empty compound '${compoundId}'`);
                }
            }
        }

        this.context.workspaceState.update(`original_${identifier}`, undefined);
        this.context.workspaceState.update(`translated_${identifier}`, undefined);
        this.context.workspaceState.update(`position_${identifier}`, undefined);
        this.context.workspaceState.update(`compoundIds_${identifier}`, undefined);
        log(`Removed term: ${identifier}`);
    }

    removeCompound(compoundId: string): void {
        const allCompounds = this.getAllCompounds();
        const compound = allCompounds[compoundId];
        if (!compound) return;

        for (const partId of compound.parts) {
            const compoundIds = (this.context.workspaceState.get(`compoundIds_${partId}`) as string[] | undefined) || [];
            const updatedCompoundIds = compoundIds.filter(id => id !== compoundId);
            this.context.workspaceState.update(`compoundIds_${partId}`, updatedCompoundIds);
            log(`Removed compound '${compoundId}' reference from part '${partId}'`);
        }

        this.context.workspaceState.update(`compound_${compoundId}_original`, undefined);
        this.context.workspaceState.update(`compound_${compoundId}_translated`, undefined);
        this.context.workspaceState.update(`compound_${compoundId}_parts`, undefined);
        this.context.workspaceState.update(`compound_${compoundId}_position`, undefined);
        this.context.workspaceState.update(`translated_to_compound_${compound.translated}`, undefined);
        log(`Removed compound '${compoundId}'`);
    }

    getTranslated(identifier: string): string | undefined {
        return this.context.workspaceState.get(`translated_${identifier}`) as string | undefined;
    }

    getAllTerms(): { [key: string]: string } {
        const allKeys = this.context.workspaceState.keys();
        const termKeys = allKeys.filter(key => key.startsWith('original_') && !key.includes('compound_'));
        const terms: { [key: string]: string } = {};
        for (const key of termKeys) {
            const identifier = key.replace('original_', '');
            const original = this.context.workspaceState.get(key) as string | undefined;
            if (original) terms[identifier] = original;
        }
        return terms;
    }

    getAllCompounds(): { [key: string]: { original: string; translated: string; parts: string[]; position: number } } {
        const allKeys = this.context.workspaceState.keys();
        const compoundKeys = allKeys.filter(key => key.startsWith('compound_') && key.endsWith('_original'));
        const compounds: { [key: string]: { original: string; translated: string; parts: string[]; position: number } } = {};
        for (const key of compoundKeys) {
            const id = key.replace('compound_', '').replace('_original', '');
            const original = this.context.workspaceState.get(`compound_${id}_original`) as string | undefined;
            if (original) {
                const position = this.context.workspaceState.get(`compound_${id}_position`);
                if (typeof position !== 'number') {
                    log(`ERROR: Invalid position type for compound_${id}: ${typeof position}, value=${position}`);
                    continue; // Skip invalid compounds
                }
                compounds[id] = {
                    original,
                    translated: this.context.workspaceState.get(`compound_${id}_translated`) as string,
                    parts: (this.context.workspaceState.get(`compound_${id}_parts`) as string[] | undefined) || [],
                    position,
                };
            }
        }
        return compounds;
    }

    getPosition(identifier: string): number {
        const position = this.context.workspaceState.get(`position_${identifier}`, 0);
        if (typeof position !== 'number') {
            log(`ERROR: Invalid position type for '${identifier}': ${typeof position}, value=${position}`);
            return 0; // Fallback to 0
        }
        return position as number;
    }

    getCompoundIds(identifier: string): string[] {
        const compoundIds = this.context.workspaceState.get(`compoundIds_${identifier}`, []);
        if (!Array.isArray(compoundIds)) {
            log(`ERROR: Invalid compoundIds type for '${identifier}': ${typeof compoundIds}, value=${compoundIds}`);
            return [];
        }
        return compoundIds as string[];
    }

    getCompoundByTranslated(translated: string, script: string): string | undefined {
        const allCompounds = this.getAllCompounds();
        for (const [id, compound] of Object.entries(allCompounds)) {
            if (script === 'latin') {
                if (compound.translated.toLowerCase() === translated.toLowerCase()) {
                    return id;
                }
            } else {
                if (compound.translated === translated) {
                    return id;
                }
            }
        }
        return undefined;
    }

    clearMap(): void {
        const allKeys = this.context.workspaceState.keys();
        for (const key of allKeys) {
            if (key.startsWith('original_') || key.startsWith('translated_') || key.startsWith('position_') ||
                key.startsWith('compound_') || key.startsWith('compoundIds_') || key.startsWith('translated_to_compound_')) {
                this.context.workspaceState.update(key, undefined);
            }
        }
        this.compoundCounter = 0;
        this.context.workspaceState.update('compoundCounter', 0);
        log('Cleared mapping state');
    }

    rebuildMap(lastTranslated: string, original: string, current: string): void {
        if (this.isRebuilding) {
            log('Skipping rebuildMap: Another rebuild is in progress');
            return;
        }
        this.isRebuilding = true;

        const script = detectScript(lastTranslated);
        const lastTokens = lastTranslated.match(getTokenRegex(script)) || [];
        const currTokens = current.match(getTokenRegex(script)) || [];
        const origTokens = original.match(getTokenRegex('latin')) || [];

        const lastPositions: { [token: string]: number[] } = {};
        const currPositions: { [token: string]: number[] } = {};
        const origPositions: { [token: string]: number[] } = {};

        const assignPositions = (tokens: string[], positions: { [token: string]: number[] }, label: string) => {
            let pos = 0;
            for (const token of tokens) {
                if (!token || typeof token !== 'string') {
                    log(`Skipping invalid token in ${label}: ${JSON.stringify(token)}`);
                    pos += 1; // Increment to avoid infinite loop
                    continue;
                }
                if (!positions[token] || !Array.isArray(positions[token])) {
                    positions[token] = [];
                    log(`Initialized positions array for '${token}' (${label})`);
                }
                log(`Before push: positions['${token}'] type=${typeof positions[token]}, value=${JSON.stringify(positions[token])}`);
                try {
                    positions[token].push(pos);
                    log(`${label} token: '${token}' at ${pos}`);
                } catch (error) {
                    log(`Error pushing position for '${token}' (${label}): ${error}`);
                    positions[token] = []; // Reset to avoid further errors
                }
                pos += token.length;
            }
        };

        try {
            log('Starting assignPositions for Last tokens');
            assignPositions(lastTokens, lastPositions, 'Last');
            log('Starting assignPositions for Current tokens');
            assignPositions(currTokens, currPositions, 'Current');
            log('Starting assignPositions for Original tokens');
            assignPositions(origTokens, origPositions, 'Original');
        } catch (error) {
            log(`Error in assignPositions: ${error}`);
            this.isRebuilding = false;
            return;
        }

        const allTerms = this.getAllTerms();
        const allCompounds = this.getAllCompounds();
        const newTerms: { [key: string]: { original: string; translated: string; position: number; compoundIds: string[] } } = {};
        const newCompounds: { [key: string]: { original: string; translated: string; parts: string[]; position: number } } = {};

        // Log workspace state for debugging
        const positionKeys = this.context.workspaceState.keys().filter(key => key.startsWith('position_'));
        log(`Position keys in workspaceState: ${JSON.stringify(positionKeys)}`);
        for (const key of positionKeys) {
            const value = this.context.workspaceState.get(key);
            log(`Workspace state ${key}: type=${typeof value}, value=${JSON.stringify(value)}`);
        }

        for (const [id, compound] of Object.entries(allCompounds)) {
            const translated = compound.translated;
            const currPosList = currPositions[translated] || [];
            if (currPosList.length > 0) {
                newCompounds[id] = compound;
                this.context.workspaceState.update(`translated_to_compound_${translated}`, id);
                log(`Kept compound: ${id} -> ${compound.original} at ${compound.position} (translated '${translated}' found at ${currPosList})`);
            } else {
                log(`Pruned compound: ${id} -> ${compound.original} (translated '${translated}' not found)`);
            }
        }

        for (const [id, original] of Object.entries(allTerms)) {
            const translated = this.context.workspaceState.get(`translated_${id}`) as string | undefined;
            if (!translated) {
                log(`Skipping term: ${id} -> ${original} (no translated term found)`);
                continue;
            }
            const position = this.getPosition(id);
            const compoundIds = this.getCompoundIds(id);
            const currPosList = currPositions[translated] || [];
            const lastPosList = lastPositions[translated] || [];

            const isPartOfCompound = compoundIds.some(cid => newCompounds[cid] !== undefined);
            if (isPartOfCompound && !currPosList.includes(position)) {
                log(`Skipped term: ${id} -> ${original} (part of compound, not standalone at ${position})`);
                continue;
            }

            if (currPosList.length > 0 || lastPosList.includes(position)) {
                newTerms[id] = { original, translated, position, compoundIds };
                log(`Kept term: ${id} -> ${original} at ${position}`);
            } else {
                log(`Pruned term: ${id} -> ${original} (not found in current or last text)`);
            }
        }

        this.clearMap();
        for (const [id, { original, translated, position, compoundIds }] of Object.entries(newTerms)) {
            this.context.workspaceState.update(`original_${id}`, original);
            this.context.workspaceState.update(`translated_${id}`, translated);
            this.context.workspaceState.update(`position_${id}`, position);
            this.context.workspaceState.update(`compoundIds_${id}`, compoundIds);
        }

        for (const [id, compound] of Object.entries(newCompounds)) {
            this.context.workspaceState.update(`compound_${id}_original`, compound.original);
            this.context.workspaceState.update(`compound_${id}_translated`, compound.translated);
            this.context.workspaceState.update(`compound_${id}_parts`, compound.parts);
            this.context.workspaceState.update(`compound_${id}_position`, compound.position);
            this.context.workspaceState.update(`translated_to_compound_${compound.translated}`, id);
        }

        this.context.workspaceState.update('compoundCounter', this.compoundCounter);
        log(`Map rebuilt: Terms=${Object.keys(newTerms).length}, Compounds=${Object.keys(newCompounds).length}`);
        this.isRebuilding = false;
    }

    private generateIdentifier(term: string): string {
        const allTerms = this.getAllTerms();
        let counter = 0;
        for (const key of Object.keys(allTerms)) {
            if (key.startsWith(term)) {
                const num = parseInt(key.split('_')[1] || '0', 10);
                if (num > counter) counter = num;
            }
        }
        return `${term}_${counter + 1}`;
    }
}