import { getNounCollection } from "@/app/api/noun";
import { MongoClient } from "mongodb";
import { Intent, SetPropertiesIntent, ReplaceTraitsIntent } from ".";

export async function processChatIntents(mongoClient: MongoClient, conversationId: string, intent: Intent) {
    if (intent.intentName === 'setName') {
        return setName(mongoClient, conversationId, intent.value.name);
    }

    if (intent.intentName === 'addTraits') {
        return addTraits(mongoClient, conversationId, intent.value.traits);
    }

    if (intent.intentName === 'setProperties') {
        return setProperties(mongoClient, conversationId, intent.value.properties);
    }

    if (intent.intentName === 'replaceTraits') {
        return replaceTraits(mongoClient, conversationId, intent.value.traitReplacements);
    }

    if (intent.intentName === 'removeTraits') {
        return removeTraits(mongoClient, conversationId, intent.value.traitIndices);
    }

    if (intent.intentName === 'removeProperties') {
        return removeProperties(mongoClient, conversationId, intent.value.propertyNames);
    }

    return [];
}

async function setName(mongoClient: MongoClient, conversationId: string, name: string) {
    const nouns = getNounCollection(mongoClient);

    const noun = await nouns.findOne({ conversationId });

    if (!noun) {
        return [];
    }

    await nouns.updateOne({ conversationId }, { $set: { name } });

    return [{
        name: 'noun.update',
        description: `Set name to ${JSON.stringify(name)}.`
    }];
}

async function addTraits(mongoClient: MongoClient, conversationId: string, traits: string[]) {
    const nouns = getNounCollection(mongoClient);

    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    await nouns.updateOne({ conversationId }, { $addToSet: { traits: { $each: traits } } });

    return [{
        name: 'noun.update',
        description: `Added [${traits.map(trait => JSON.stringify(trait)).join(',')}].`
    }];
}

async function setProperties(mongoClient: MongoClient, conversationId: string, properties: SetPropertiesIntent['value']['properties']) {
    const nouns = getNounCollection(mongoClient);
    
    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    const savedProps : { [key in string] : string } = {};
    const displayProperties  : { [key in string] : string } = {};
    for (let i = 0; i < properties.length; i ++) {
        const key = `properties.${properties[i].propertyName}`;
        if (savedProps.hasOwnProperty(key)) {
            savedProps[key] += `, ${properties[i].propertyValue}`;
            displayProperties[properties[i].propertyName] += `, ${properties[i].propertyValue}`;
        } else {
            savedProps[key] = properties[i].propertyValue;
            displayProperties[properties[i].propertyName] = properties[i].propertyValue;
        }
    }

    if (Object.keys(savedProps).length === 0) {
        return [];
    }

    await nouns.updateOne({ conversationId }, { $set: savedProps });

    return [{
        name: 'noun.update',
        description: `Set [${[...Object.entries(displayProperties)].map(([key, val]) => JSON.stringify({ [key]: val})).join(',')}].`
    }];
}

async function replaceTraits(mongoClient: MongoClient, conversationId: string, traitReplacements: ReplaceTraitsIntent['value']['traitReplacements']) {
    const nouns = getNounCollection(mongoClient);
    
    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    const idxVals : { [key in string] : string } = {};
    const displayIdxVals : { [key in string]: string} = {};
    for (let i = 0; i < traitReplacements.length; i ++) {
        if (noun.traits[traitReplacements[i].traitIndex]) {
            idxVals[`traits.${traitReplacements[i].traitIndex}`] = traitReplacements[i].newValue;
            displayIdxVals[traitReplacements[i].traitIndex] = traitReplacements[i].newValue;
        }
    }

    if (Object.keys(idxVals).length === 0) {
        return [];
    }

    await nouns.updateOne({ conversationId }, { $set: idxVals });

    return [{
        name: 'noun.update',
        description: `Replaced [${[...Object.entries(displayIdxVals)].map(([key, val]) => JSON.stringify([ noun.traits[+key], val ])).join(',')}].`
    }];
}

async function removeProperties(mongoClient: MongoClient, conversationId: string, properties: string[]) {
    const nouns = getNounCollection(mongoClient);
    
    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    const removedKeys : { [key in string]: 1 } = {};
    const displayRemovedKeys : string[] = [];
    for (let i = 0; i < properties.length; i ++) {
        if (properties[i] && noun.properties.hasOwnProperty(properties[i])) {
            removedKeys[`properties.${properties[i]}`] = 1;
            displayRemovedKeys.push(properties[i]);
        }
    }

    if (Object.keys(removedKeys).length === 0) {
        return [];
    }

    await nouns.updateOne({ conversationId }, { $unset: removedKeys });

    return [{
        name: 'noun.update',
        description: `Removed [${displayRemovedKeys.map(key => JSON.stringify({ [key]: noun.properties[key] })).join(',')}].`
    }];
}

async function removeTraits(mongoClient: MongoClient, conversationId: string, indices: number[]) {
    const nouns = getNounCollection(mongoClient);

    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    const traits = indices.reduce((traits, index) => {
        return {
            ...traits,
            [`traits.${index}`]: 1
        }
    }, {});

    await nouns.updateOne({ conversationId }, { $unset: { ...traits } });
    await nouns.updateOne({ conversationId }, { $pull: { traits: null as any } });

    return [ 
        {
            name: 'noun.update',
            description: `Removed [${indices.map(index => JSON.stringify(noun.traits[+index])).join(',')}].`
        } 
    ];
}
