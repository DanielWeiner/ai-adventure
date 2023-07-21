import { NounRevision, calculateRevisionProjection, getNounCollection } from "@/app/api/noun";
import { MongoClient } from "mongodb";
import { Intent, SetPropertiesIntent, ReplaceTraitsIntent } from ".";
import { getConversationCollection } from "@/app/api/conversation";

export async function* processChatIntents(mongoClient: MongoClient, conversationId: string, intents: Intent[], startRevision: number, endRevision: number) {
    await resetNounRevision(mongoClient, conversationId, startRevision);

    for (const intent of intents) {
        if (intent.intentName === 'setName') {
            yield* await setName(mongoClient, conversationId, intent.value.name);
        } else if (intent.intentName === 'addTraits') {
            yield* await addTraits(mongoClient, conversationId, intent.value.traits);
        } else if (intent.intentName === 'setProperties') {
            yield* await setProperties(mongoClient, conversationId, intent.value.properties);
        } else if (intent.intentName === 'replaceTraits') {
            yield* await replaceTraits(mongoClient, conversationId, intent.value.traitReplacements);
        } else if (intent.intentName === 'removeTraits') {
            yield* await removeTraits(mongoClient, conversationId, intent.value.traitIndices);
        } else if (intent.intentName === 'removeProperties') {
            yield* await removeProperties(mongoClient, conversationId, intent.value.propertyNames);
        }
    }

    await updateConversationRevision(mongoClient, conversationId, endRevision);
    await updateNounRevision(mongoClient, conversationId, endRevision);
}

async function resetNounRevision(mongoClient: MongoClient, conversationId: string, revision: number) {
    const nouns = getNounCollection(mongoClient);
    const noun = (await nouns.findOne({ conversationId }, {
        projection: {
            ...calculateRevisionProjection(revision),
            revisions: {
                $ifNull: [
                    {
                        $filter: {
                            input: '$revisions',
                            as:    'revision',
                            cond: {
                                $lte: ['$$revision.revision', revision]
                            }
                        }
                    },
                    []
                ]
            }
        }
    }))!;

    await nouns.updateOne({ _id: noun._id }, {
        $set: {
            properties: noun.properties,
            traits:     noun.traits,
            revisions:  noun.revisions,
            revision:   revision
        }
    });
}

async function updateConversationRevision(mongoClient: MongoClient, conversationId: string, revision: number) {
    const conversations = getConversationCollection(mongoClient);
    await conversations.updateOne({ _id: conversationId }, {
        $set: {
            revision
        }
    });
}

async function getNounRevision(mongoClient: MongoClient, conversationId: string, revision: number) : Promise<NounRevision | null> {
    const nouns = getNounCollection(mongoClient);
    const noun = await nouns.findOne({ conversationId }, calculateRevisionProjection(revision));
    return noun;
}

async function updateNounRevision(mongoClient: MongoClient, conversationId: string, revision: number) {
    const nouns = getNounCollection(mongoClient);
    const { _id, name = '', properties = {}, traits = [] } = await nouns.findOne({ conversationId }) ?? {};

    if (!_id) {
        return;
    }

    await nouns.updateOne({ _id },{
        $set: {
            revision
        },
        $push: {
            revisions: {
                name,
                properties,
                traits,
                revision
            }
        }
    });
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
