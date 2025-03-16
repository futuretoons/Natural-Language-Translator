import * as vscode from 'vscode';
import { log } from './utils';
import { detectScript, getTokenRegex } from './translation';

export class MappingManager 
{
    private context: vscode.ExtensionContext;
    private compoundCounter: number = 0;

    constructor(context: vscode.ExtensionContext) 
    {
        this.context = context;
        this.compoundCounter = this.context.workspaceState.get('compoundCounter', 0);
    }

    addTerm(originalTerm: string, translatedTerm: string, position: number): string {
        const identifier = this.generateIdentifier(translatedTerm);
        this.context.workspaceState.update(`original_${identifier}`, originalTerm);
        this.context.workspaceState.update(`translated_${identifier}`, translatedTerm);
        this.context.workspaceState.update(`position_${identifier}`, position);
        this.context.workspaceState.update(`compoundIds_${identifier}`, []);
        log(`Added term: '${identifier}' -> '${originalTerm}' at position ${position}`);
        return identifier;

    }

    addInsertionPictographic(originalTerm: string, translatedTerm: string, position: number, currentText: string): string {
        const allTerms = this.getAllTerms();
        const coreTerm = translatedTerm;
        const textBefore = currentText.substring(0, position);
        const occurrencesBefore = (textBefore.match(new RegExp(coreTerm, 'g')) || []).length + 1;
        const newIdentifier = `${coreTerm}_${occurrencesBefore}`;

        log(`Adding insertion: '${coreTerm}' at position ${position}, occurrencesBefore=${occurrencesBefore}, newIdentifier=${newIdentifier}`);

        const termsToShift = Object.keys(allTerms)
            .filter(key => key.startsWith(coreTerm) && parseInt(key.split('_')[1]) >= occurrencesBefore)
            .sort((a, b) => parseInt(b.split('_')[1]) - parseInt(a.split('_')[1]));
        for (const oldId of termsToShift) {
            const oldNum = parseInt(oldId.split('_')[1]);
            const newId = `${coreTerm}_${oldNum + 1}`;

            const original = this.context.workspaceState.get(`original_${oldId}`);
            const translated = this.context.workspaceState.get(`translated_${oldId}`);
            const pos = this.context.workspaceState.get(`position_${oldId}`);
            const compoundIds = this.context.workspaceState.get(`compoundIds_${oldId}`) as string[];

            this.context.workspaceState.update(`original_${newId}`, original);
            this.context.workspaceState.update(`translated_${newId}`, translated);
            this.context.workspaceState.update(`position_${newId}`, pos);
            this.context.workspaceState.update(`compoundIds_${newId}`, compoundIds);
            this.context.workspaceState.update(`original_${oldId}`, undefined);
            this.context.workspaceState.update(`translated_${oldId}`, undefined);
            this.context.workspaceState.update(`position_${oldId}`, undefined);
            this.context.workspaceState.update(`compoundIds_${oldId}`, undefined);
            log(`Shifted ${oldId} -> ${newId}`);
        }

        this.context.workspaceState.update(`original_${newIdentifier}`, originalTerm);
        this.context.workspaceState.update(`translated_${newIdentifier}`, translatedTerm);

        this.context.workspaceState.update(`position_${newIdentifier}`, position);
        this.context.workspaceState.update(`compoundIds_${newIdentifier}`, []);
        return newIdentifier;

    }

    addCompound(originalCompound: string, translatedCompound: string, partIds: string[], position: number): string {
        this.compoundCounter++;
        const compoundId = `compound_${this.compoundCounter}`;
        this.context.workspaceState.update(`compound_${compoundId}_original`, originalCompound);
        this.context.workspaceState.update(`compound_${compoundId}_translated`, translatedCompound);
        this.context.workspaceState.update(`compound_${compoundId}_parts`, partIds);
        this.context.workspaceState.update(`compound_${compoundId}_position`, position);
        this.context.workspaceState.update(`translated_to_compound_${translatedCompound}`, compoundId);
        this.context.workspaceState.update('compoundCounter', this.compoundCounter);

        for (const partId of partIds) 
            {
            const currentCompoundIds = this.context.workspaceState.get(`compoundIds_${partId}`) as string[] || [];
            if (!currentCompoundIds.includes(compoundId)) 
                {
                currentCompoundIds.push(compoundId);
                this.context.workspaceState.update(`compoundIds_${partId}`, currentCompoundIds);
                log(`Linked '${partId}' to compound '${compoundId}'`);
            }

        }

        log(`Added compound: '${compoundId}' -> '${originalCompound}' with parts ${JSON.stringify(partIds)} at position ${position}`);
        return compoundId;

    }

    removeTermPictographic(identifier: string, position: number): void {
        const allTerms = this.getAllTerms();
        const allCompounds = this.getAllCompounds();
        const [coreTerm, indexStr] = identifier.split('_');
        const index = parseInt(indexStr);

        const compoundIds = this.context.workspaceState.get(`compoundIds_${identifier}`) as string[] || [];
        for (const compoundId of compoundIds)
            {
            const compound = allCompounds[compoundId];
            if (compound) {
                const updatedParts = compound.parts.filter(part => part !== identifier);
                this.context.workspaceState.update(`compound_${compoundId}_parts`, updatedParts);
                log(`Updated compound '${compoundId}': removed part '${identifier}'`);
                if (updatedParts.length === 0) 
                    {
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

        const termsToShift = Object.keys(allTerms)
            .filter(key => key.startsWith(coreTerm) && parseInt(key.split('_')[1]) > index)
            .sort((a, b) => parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]));
        for (const oldId of termsToShift) 
            {
            const oldNum = parseInt(oldId.split('_')[1]);
            const newId = `${coreTerm}_${oldNum - 1}`;
            const original = this.context.workspaceState.get(`original_${oldId}`);
            const translated = this.context.workspaceState.get(`translated_${oldId}`);
            const pos = this.context.workspaceState.get(`position_${oldId}`);
            const compoundIds = this.context.workspaceState.get(`compoundIds_${oldId}`) as string[];
            this.context.workspaceState.update(`original_${newId}`, original);
            this.context.workspaceState.update(`translated_${newId}`, translated);
            this.context.workspaceState.update(`position_${newId}`, pos);
            this.context.workspaceState.update(`compoundIds_${newId}`, compoundIds);
            this.context.workspaceState.update(`original_${oldId}`, undefined);
            this.context.workspaceState.update(`translated_${oldId}`, undefined);
            this.context.workspaceState.update(`position_${oldId}`, undefined);
            this.context.workspaceState.update(`compoundIds_${oldId}`, undefined);
            log(`Shifted ${oldId} -> ${newId}`);
        }
        log(`Removed term: ${identifier}`);
    }

    removeCompound(compoundId: string): void 
    {
        const allCompounds = this.getAllCompounds();
        const compound = allCompounds[compoundId];
        if (!compound) return;

        for (const partId of compound.parts) 
            {
            const compoundIds = this.context.workspaceState.get(`compoundIds_${partId}`) as string[] || [];
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

    getTranslated(identifier: string): string | undefined
     {
        return this.context.workspaceState.get(`translated_${identifier}`) as string | undefined;
    }

    getAllTerms(): { [key: string]: string }
     {
        const allKeys = this.context.workspaceState.keys();
        const termKeys = allKeys.filter(key => key.startsWith('original_') && !key.includes('compound_'));
        const terms: { [key: string]: string } = {};
        for (const key of termKeys) {
            const identifier = key.replace('original_', '');
            const original = this.context.workspaceState.get(key) as string;
            if (original) terms[identifier] = original;
        }
        return terms;
    }

    getAllCompounds(): { [key: string]: { original: string; translated: string; parts: string[]; position: number } } 
    {
        const allKeys = this.context.workspaceState.keys();
        const compoundKeys = allKeys.filter(key => key.startsWith('compound_') && key.endsWith('_original'));
        const compounds: { [key: string]: { original: string; translated: string; parts: string[]; position: number } } = {};
        for (const key of compoundKeys) 
            {
            const id = key.replace('compound_', '').replace('_original', '');
            const original = this.context.workspaceState.get(`compound_${id}_original`) as string;
            if (original) {
                compounds[id] = {
                    original,
                    translated: this.context.workspaceState.get(`compound_${id}_translated`) as string,
                    parts: this.context.workspaceState.get(`compound_${id}_parts`) as string[],
                    position: this.context.workspaceState.get(`compound_${id}_position`) as number,
                };

            }

        }
        return compounds;
    }

    getPosition(identifier: string): number 
    {
        return this.context.workspaceState.get(`position_${identifier}`, 0) as number;
    }

    getCompoundIds(identifier: string): string[] 
    {
        return this.context.workspaceState.get(`compoundIds_${identifier}`, []) as string[];
    }

    getCompoundByTranslated(translated: string): string | undefined 
    {
        return this.context.workspaceState.get(`translated_to_compound_${translated}`) as string | undefined;
    }

    clearMap(): void {
        const allKeys = this.context.workspaceState.keys();
        for (const key of allKeys)
             {
            if (key.startsWith('original_') || key.startsWith('translated_') || key.startsWith('position_') || key.startsWith('compound_') || key.startsWith('compoundIds_') || key.startsWith('translated_to_compound_')) {
                this.context.workspaceState.update(key, undefined);
            }

        }
        this.compoundCounter = 0;
        this.context.workspaceState.update('compoundCounter', 0);
        log('Cleared mapping state');

    }

    rebuildMap(lastTranslated: string, original: string, current: string): void {
        const script = detectScript(lastTranslated);
        const lastTokens = lastTranslated.match(getTokenRegex(script)) || [];
        const currTokens = current.match(getTokenRegex(script)) || [];
        const origTokens = original.match(getTokenRegex('latin')) || [];
    
        const lastPositions: { [token: string]: number[] } = {};
        const currPositions: { [token: string]: number[] } = {};
        const origPositions: { [token: string]: number[] } = {};
    
        const assignPositions = (tokens: string[], positions: { [token: string]: number[] }, label: string) => {
            let pos = 0;
            for (const token of tokens) 
                {
                if (!(token in positions)) 
                    {
                    positions[token] = [];
                } else if (!Array.isArray(positions[token])) 
                    {
                    log(`ERROR: ${label} position for '${token}' is not an array: ${positions[token]}`);
                    positions[token] = [];
                }
                positions[token].push(pos);
                log(`${label} token: '${token}' at ${pos}`);
                pos += token.length;
            }

        };
    
        assignPositions(lastTokens, lastPositions, 'Last');
        assignPositions(currTokens, currPositions, 'Current');
        assignPositions(origTokens, origPositions, 'Original');
    
        const allTerms = this.getAllTerms();
        const allCompounds = this.getAllCompounds();
        const newTerms: { [key: string]: { original: string; translated: string; position: number; compoundIds: string[] } } = {};
        const newCompounds: { [key: string]: { original: string; translated: string; parts: string[]; position: number } } = {};
    
        for (const [id, compound] of Object.entries(allCompounds)) 
            {
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
    
        for (const [id, original] of Object.entries(allTerms)) 
            {
            const translated = this.context.workspaceState.get(`translated_${id}`) as string;
            const position = this.getPosition(id);
            const compoundIds = this.getCompoundIds(id);
            const currPosList = currPositions[translated] || [];
            const lastPosList = lastPositions[translated] || [];
    
            const isPartOfCompound = compoundIds.some(cid => newCompounds[cid]);
            if (isPartOfCompound && !currPosList.includes(position)) 
                {
                log(`Skipped term: ${id} -> ${original} (part of compound, not standalone at ${position})`);
                continue;
            }
    
            if (currPosList.length > 0 || lastPosList.includes(position)) 
                {
                newTerms[id] = { original, translated, position, compoundIds };
                log(`Kept term: ${id} -> ${original} at ${position}`);
            } else {
                log(`Pruned term: ${id} -> ${original} (not found in current or last text)`);
            }
        }
    
        this.clearMap();
        for (const [id, { original, translated, position, compoundIds }] of Object.entries(newTerms)) 
            {
            this.context.workspaceState.update(`original_${id}`, original);
            this.context.workspaceState.update(`translated_${id}`, translated);
            this.context.workspaceState.update(`position_${id}`, position);
            this.context.workspaceState.update(`compoundIds_${id}`, compoundIds);
        }

        for (const [id, compound] of Object.entries(newCompounds))
            {
            this.context.workspaceState.update(`compound_${id}_original`, compound.original);
            this.context.workspaceState.update(`compound_${id}_translated`, compound.translated);
            this.context.workspaceState.update(`compound_${id}_parts`, compound.parts);
            this.context.workspaceState.update(`compound_${id}_position`, compound.position);
            this.context.workspaceState.update(`translated_to_compound_${compound.translated}`, id);
        }

        this.context.workspaceState.update('compoundCounter', this.compoundCounter);
        log(`Map rebuilt: Terms=${Object.keys(newTerms).length}, Compounds=${Object.keys(newCompounds).length}`);

    }

    private generateIdentifier(term: string): string {
        const allTerms = this.getAllTerms();
        let counter = 0;
        for (const key of Object.keys(allTerms)) 
            {
            if (key.startsWith(term)) {
                const num = parseInt(key.split('_')[1]);
                if (num > counter) counter = num;
            }
        }
        return `${term}_${counter + 1}`;
    }

}