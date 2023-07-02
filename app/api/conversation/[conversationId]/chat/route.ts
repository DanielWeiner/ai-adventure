import { authorize, Session } from "@/app/api/auth";
import { mongo } from "@/app/mongo";
import { IncomingMessage } from "http";
import { NextRequest, NextResponse } from "next/server";
import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
import { Readable } from "stream";
import { ConversationContext, ConversationPurposeType, getConversationCollection, Message } from "../../../conversation";
import { AxiosResponse } from "axios";
import { NounType, getConversationNoun, getNounCollection } from "@/app/api/noun";
import { MongoClient } from "mongodb";

const defaultHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Content-Encoding': 'none',
    'X-Accel-Buffering': 'no'
};

const contextDescriptions = {
    class: 'character class',
    character: 'character',
    location: 'location in a universe',
    world: 'world or universe or setting in which a narrative takes place',
    species: 'species or race',
    faction: 'faction or organization or government'
};

type ContextPrompts = {
    [ConversationType in ConversationPurposeType]: (context: string, firstTime: boolean) => string
};

type RelevantInformation = {
    type: string;
    name: string; 
    defaultName: string;
    attributesMap: { 
        [key in string]: string;
    }; 
    attributes: string[];
}

interface SetNameIntent {
    quote: string;
    intentName: 'setName';
    value: {
        name: string;
    }
}

interface SetNamedPropertiesIntent {
    quote: string;
    intentName: 'setNamedProperties';
    value: {
        namedProperties: Array<{
            propertyName: string;
            propertyValue: string;
        }>;
    }
}

interface AddAttributesIntent {
    quote: string;
    intentName: 'addAttributes';
    value: {
        attributes: string[]
    }
}

interface RemoveNamedPropertiesIntent {
    quote: string;
    intentName: 'removeNamedProperties';
    value: {
        propertyNames: string[];
    }
}

interface RemoveAttributesIntent {
    quote: string;
    intentName: 'removeAttributes';
    value: {
        attributeIndices: number[];
    }
}


interface ReplaceAttributesIntent {
    quote: string;
    intentName: 'replaceAttributes';
    value: {
        attributeReplacements: Array<{
            attributeIndex: number;
            newValue: string;
        }>
    }
}

type Intent = SetNameIntent | SetNamedPropertiesIntent | AddAttributesIntent | RemoveNamedPropertiesIntent | RemoveAttributesIntent | ReplaceAttributesIntent;

const systemPrompts : ContextPrompts = {
    create: (context: string, firstTime: boolean) => [
        `You are a helpful worldbuilding assistant whose purpose is to assist in creating a ${contextDescriptions[context as NounType]}.`,
        ...firstTime ? [
            `You must start the conversation with "Hi! Let's create a ${context} together."`,
            `Your first and only prompt is for the name of the ${context}, adding some helpful pointers on creating a good name.`,
        ] : [
            `Always refrain from enumerating the properties and attributes of the ${context} as a list unless specifically asked. ` +
            'Unless prompted, limit the number suggestions or questions to at most three or four. ' + 
            'The user should be able to provide small, focused answers to your prompts, so don\'t overwhelm the user with questions or suggestions. ' +
            `Your prompt should always elicit more information from the user unless they're satisfied with the ${context} as a whole and have nothing more to add. ` +
            `Keep the questions focused on the ${context}, but leave room for the user to explore aspects of the ${context} that you haven\'t asked about.`
        ],
    ].join(' '),
    adventure: () => ''
};

function listRelevantInformation({ name, type, defaultName, attributesMap, attributes } : RelevantInformation) {
    return [
        `\nName of the ${type}: ${name || 'unknown' }`,
        ...Object.keys(attributesMap).length ? [[
            `\nNamed properties for ${name || defaultName}:`,
            ...[...Object.entries(attributesMap)].map(([key, val]) => `${key}: ${val}`),
        ].join('\n') ] : [],
        ...attributes.length ? [[
            `\nMiscellaneous attributes for ${name || defaultName}:`,
            ...attributes.map((val, i) => `${i + 1}. ${val}`)
        ].join('\n') ] : []
    ].join('\n').trim() + '\n';
}

async function findRelevantInformation<T extends ConversationPurposeType>(conversationId: string, conversationType: T, context: ConversationContext[T]) : Promise<RelevantInformation> {
    if (conversationType === 'adventure') {
        return { name: '', attributesMap: {}, attributes: [], defaultName: '', type: '' };
    }
    const noun = await getConversationNoun(conversationId);

    if (!noun) {
        return { name: '', attributesMap: {}, attributes: [], defaultName: '', type: '' };
    }

    return {
        defaultName: `The ${context} being created`,
        type: context,
        name: noun.name,
        attributes: noun.attributes || [],
        attributesMap: noun.namedAttributes || {}
    };
}

async function* detectIntents(
    openai: OpenAIApi,
    messages: ChatCompletionRequestMessage[], 
    relevantInfo: RelevantInformation
) : AsyncGenerator<Intent> {
    if (messages.length < 2) {
        return;
    }

    const chatMessages = messages.filter(({ role }) => role !== 'system');
    const lastAssistantPrompt = chatMessages.slice(-2)[0].content!;
    const lastUserPrompt = chatMessages.slice(-1)[0].content!;
    const relevantInfoStr = listRelevantInformation(relevantInfo);
    const splitToken = 'SECOND STAGE';
    const splitInformationPrompt = 
        `You will analyze a user prompt regarding a ${relevantInfo.type}, split the information up, output multiple statements about it, then further break down those statements.
        
        Here's the existing information about the ${relevantInfo.type} prior to the prompt. Do not generate results from it.
        [START ${relevantInfo.type.toUpperCase()} INFO]
        ${relevantInfoStr}
        [END ${relevantInfo.type.toUpperCase()} INFO]
    
        Here's the most recent assistant prompt regarding the ${relevantInfo.type}. Do not generate results from it. 
        [START ASSISTANT PROMPT]
        ${lastAssistantPrompt}
        [END ASSISTANT PROMPT]

        Here's the user's response to the assistant regarding the ${relevantInfo.type}:
        [START USER RESPONSE]
        ${lastUserPrompt}
        [END USER RESPONSE] 

        First, write the words "FIRST STAGE".

        Next, write short but descriptive sentences for all of the information about the ${relevantInfo.type} provided by the user's response to the assistant, following these rules:

        Formatting and structure:
        - Each sentence must only contain one piece of information.
        - Write multiple sentences for compound information.
        - If no new information about the ${relevantInfo.type} was provided, output the word NONE and nothing before or after. This is very important.
        - Make the ${relevantInfo.type} the subject of each sentence, if possible.
        - Each sentence must be written on a new line.
        - Do not embellish the sentences.
        - Keep the sentences as simple as possible.
        - Each sentence must make sense on its own, without any external context or reference to other sentences.

        Conditions for output:
        - Only include information that is new.
        - A request for suggestions does not count as new information about the ${relevantInfo.type}.
        - Any information referenced indirectly by the user should be written explicitly in the output.
        - Write sentences for all assistant suggestions that are approved by the user.

        Avoiding bad output:
        - Only mention new information about the ${relevantInfo.type}.
        - Do not mention any information about the prompt itself.
        - Do not mention any information that hasn't been mentioned by the user.
        - Do not mention any uncertain information.
        - Do not omit any information about the ${relevantInfo.type} that has been provided by the user.
        - Do not provide your own suggestions.

        When you are done creating sentences, write ${splitToken} on a new line.

        Finally, on a new line, split the results of the FIRST STAGE further into even smaller pieces of information, paying special attention to compound information. Combine the results of the ${splitToken} back into the FIRST STAGE results to ensure they match.
    `.trim()
    .replace(/[^\S\r\n]*([\r\n])[^\S\r\n]*/g, '$1')
    .replace(/[^\S\r\n]+/g, ' ');

    console.log(splitInformationPrompt);

    const splitInformationResult = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        temperature: 0,
        messages: [
            { 
                role: 'system',
                content: splitInformationPrompt
            }
        ]
    });

    const infoStatements = (splitInformationResult.data.choices[0].message?.content?.trim() ?? '');

    const brokenDownStatements = infoStatements.includes(splitToken) ? 
        infoStatements.slice(infoStatements.indexOf(splitToken) + splitToken.length).trim()
        : infoStatements;

    console.log(infoStatements);

    const messageContent = 'You are an intent classifier. ' +
        `You analyze statements about a ${relevantInfo.type} for intents. ` + 
        'Each statement may have multiple intents. ' + 
        'Not every possible intent may be inferred. ' + 
        'Try to infer as many intents as possible. ' + 
        'Two inferred intents must not mean the same thing. ' + 
        'Do not add any information that hasn\'t been specified. ' + 
        'Do not add any information that is already present. ' + 
        'The intent name and value are required. ' +
        'Do not add unknown or incomplete information.\n' +

        `\nHere is the current up-to-date information about the ${relevantInfo.type} for context. Do not infer intents from this.` + 
        `\n[START ${relevantInfo.type.toUpperCase()} INFORMATION]\n` + 
        relevantInfoStr +
        `\n[END ${relevantInfo.type.toUpperCase()} INFORMATION]\n` +

        '\nAnalyze the intents of just the following statements:' + 
        '\n[START STATEMENTS]\n' +
        brokenDownStatements +
        '\n[END STATEMENTS]';

    console.log(messageContent);
    
    const result = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        temperature: 0,
        messages: [
            { 
                role: 'system',
                content: messageContent
            }
        ],
        functions: [
            {
                name: 'generateIntents',
                description: `Generate the intents inferred from statements about a user\'s interaction regarding a ${relevantInfo.type}`,
                parameters: {
                    type: 'object',
                    properties: {
                        intents: {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'object',
                                        description: `Set the name of the ${relevantInfo.type}`,
                                        properties: {
                                            quote: {
                                                type: 'string',
                                                description: 'Portion of the statements that this intent was inferred from.'
                                            },
                                            intentName: {
                                                type: 'string',
                                                enum: ['setName']
                                            },
                                            value: {
                                                type: 'object',
                                                properties: {
                                                    name: {
                                                        type: 'string',
                                                        description: `the name of the ${relevantInfo.type}`
                                                    },
                                                },
                                                required: ['name']
                                            },
                                        },
                                        required: ['quote', 'intentName', 'value']
                                    },
                                    {
                                        type: 'object',
                                        description: `Set named properties of the ${relevantInfo.type}, other than the name of the ${relevantInfo.type} itself.`,
                                        properties: {
                                            quote: {
                                                type: 'string',
                                                description: 'Portion of the statements that this intent was inferred from.'
                                            },
                                            intentName: {
                                                type: 'string',
                                                enum: ['setNamedProperties'],
                                            },
                                            value: {
                                                type: 'object',
                                                properties: {
                                                    namedProperties: {
                                                        type: 'array',
                                                        items: {
                                                            type: 'object',
                                                            properties: {
                                                                propertyName: {
                                                                    type: 'string',
                                                                    description: `The name of the property. Must be plain English, as short as possible, without camel case. No special characters or numbers. Spaces are allowed. Cannot represent the name or the ${relevantInfo.type} itself.`
                                                                },
                                                                propertyValue: {
                                                                    type: 'string',
                                                                    description: 'The value of the property. Must be short but descriptive, without grammar or punctuation. Avoid boolean values. For multiple values, concatenate the values with commas, and space them.'
                                                                }
                                                            },
                                                            required: ['propertyName', 'propertyValue']
                                                        },
                                                        description: `The named properties of the ${relevantInfo.type} to set.`,
                                                    }
                                                },
                                                required: ['namedProperties']
                                            }
                                        },
                                        required: ['quote', 'intentName', 'value']
                                    },
                                    {
                                        type: 'object',
                                        description: `Add miscellaneous, unnamed attributes to the ${relevantInfo.type}`,
                                        properties: {
                                            quote: {
                                                type: 'string',
                                                description: 'Portion of the statements that this intent was inferred from.'
                                            },
                                            intentName: {
                                                type: 'string',
                                                enum: ['addAttributes']
                                            },
                                            value: {
                                                type: 'object',
                                                properties: {
                                                    attributes: {
                                                        type: 'array',
                                                        items: {
                                                            type: 'string',
                                                            description: `The miscellaneous attribute about the ${relevantInfo.type}. Must shortened but descriptive, without grammar or punctuation. Must make sense on its own without context from other new or existing named properties or miscellaneous attributes. Do not combine multiple miscellaneous attributes into a single string.`
                                                        },
                                                        description: `The miscellaneous attributes of the ${relevantInfo.type} to add. Each attribute should contain one piece of information. Split compound information into multiple attributes.`
                                                    }
                                                },
                                                required: ['attributes']
                                            }
                                        },
                                        required: ['quote', 'intentName', 'value']
                                    },
                                    {
                                        type: 'object',
                                        description: `Remove named properties from the ${relevantInfo.type}`,
                                        properties: {
                                            quote: {
                                                type: 'string',
                                                description: 'Portion of the statements that this intent was inferred from.'
                                            },
                                            intentName: {
                                                type: 'string',
                                                enum: ['removeNamedProperties']
                                            },
                                            value: {
                                                type: 'object',
                                                properties: {
                                                    propertyNames: {
                                                        type: 'array',
                                                        items: {
                                                            type: 'string',
                                                            description: 'The name of the property to remove'
                                                        },
                                                        description: `The names of the properties to remove from the ${relevantInfo.type}`
                                                    }
                                                },
                                                required: ['propertyNames']
                                            }
                                        },
                                        required: ['quote', 'intentName', 'value']
                                    },
                                    {
                                        type: 'object',
                                        description: `Remove miscellaneous attributes from the ${relevantInfo.type}`,
                                        properties: {
                                            quote: {
                                                type: 'string',
                                                description: 'Portion of the statements that this intent was inferred from.'
                                            },
                                            intentName: {
                                                type: 'string',
                                                enum: ['removeAttributes']
                                            },
                                            value: {
                                                type: 'object',
                                                properties: {
                                                    attributeIndices: {
                                                        type: 'array',
                                                        items: {
                                                            type: 'number',
                                                            description: 'The zero-indexed index of the attribute to remove'
                                                        },
                                                        description: `The zero-indexed indices of the attributes to remove from the ${relevantInfo.type}`
                                                    }
                                                },
                                                required: ['attributeIndices']
                                            }
                                        },
                                        required: ['quote', 'intentName', 'value']
                                    },
                                    {
                                        type: 'object',
                                        description: `Replace the values of the miscellaneous attributes of the ${relevantInfo.type} at the given indices`,
                                        properties: {
                                            quote: {
                                                type: 'string',
                                                description: 'Portion of the statements that this intent was inferred from.'
                                            },
                                            intentName: {
                                                type: 'string',
                                                enum: ['replaceAttributes']
                                            },
                                            value: {
                                                type: 'object',
                                                properties: {
                                                    attributeReplacements: {
                                                        type: 'array',
                                                        items: {
                                                            type: 'object', 
                                                            properties: {
                                                                attributeIndex: {
                                                                    type: 'number',
                                                                    description: 'The zero-indexed index of the attribute'
                                                                },
                                                                newValue: {
                                                                    type: 'string',
                                                                    description: 'The value that the attribute at the given index should be replaced with. Must shortened but descriptive, without grammar or punctuation. Must make sense on its own without context from other new or existing named properties or miscellaneous attributes.'
                                                                }
                                                            },
                                                            required: ['attributeIndex', 'newValue'],
                                                            description: 'The zero-indexed index of the attribute to replace, and its new value'
                                                        },
                                                        description: `The miscellaneous attributes of the ${relevantInfo.type} to replace`
                                                    }
                                                },
                                                required: ['attributeReplacements'],
                                            }
                                        },
                                        required: ['quote', 'intentName', 'value']
                                    }
                                ]
                            }
                        }
                    }
                }
            },
        ]
    });

    try {
        const intentsObj = result.data.choices[0].message?.function_call?.arguments || '{}';
        console.log(intentsObj);
        const { intents } = JSON.parse(intentsObj) as { intents: Intent[] };
        if (!Array.isArray(intents)) {
            return;
        }
        for (const intent of intents) {
            yield intent;
        }
    } catch {
        return;
    }
}

async function processChatIntents(mongoClient: MongoClient, conversationId: string, intent: Intent) {
    if (intent.intentName === 'setName') {
        return setName(mongoClient, conversationId, intent.value.name);
    }

    if (intent.intentName === 'addAttributes') {
        return addAttributes(mongoClient, conversationId, intent.value.attributes);
    }

    if (intent.intentName === 'setNamedProperties') {
        return setNamedProperties(mongoClient, conversationId, intent.value.namedProperties);
    }

    if (intent.intentName === 'replaceAttributes') {
        return replaceAttributes(mongoClient, conversationId, intent.value.attributeReplacements);
    }

    if (intent.intentName === 'removeAttributes') {
        return removeAttributes(mongoClient, conversationId, intent.value.attributeIndices);
    }

    if (intent.intentName === 'removeNamedProperties') {
        return removeNamedProperties(mongoClient, conversationId, intent.value.propertyNames);
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

async function addAttributes(mongoClient: MongoClient, conversationId: string, attributes: string[]) {
    const nouns = getNounCollection(mongoClient);

    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    await nouns.updateOne({ conversationId }, { $addToSet: { attributes: { $each: attributes } } });

    return [{
        name: 'noun.update',
        description: `Added [${attributes.map(attr => JSON.stringify(attr)).join(',')}].`
    }];
}

async function setNamedProperties(mongoClient: MongoClient, conversationId: string, namedProperties: SetNamedPropertiesIntent['value']['namedProperties']) {
    const nouns = getNounCollection(mongoClient);
    
    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    const namedAttrs : { [key in string] : string } = {};
    const displayNamedAttributes  : { [key in string] : string } = {};
    for (let i = 0; i < namedProperties.length; i ++) {
        const key = `namedAttributes.${namedProperties[i].propertyName}`;
        if (namedAttrs.hasOwnProperty(key)) {
            namedAttrs[key] += `, ${namedProperties[i].propertyValue}`;
            displayNamedAttributes[namedProperties[i].propertyName] += `, ${namedProperties[i].propertyValue}`;
        } else {
            namedAttrs[key] = namedProperties[i].propertyValue;
            displayNamedAttributes[namedProperties[i].propertyName] = namedProperties[i].propertyValue;
        }
    }

    if (Object.keys(namedAttrs).length === 0) {
        return [];
    }

    await nouns.updateOne({ conversationId }, { $set: namedAttrs });

    return [{
        name: 'noun.update',
        description: `Set [${[...Object.entries(displayNamedAttributes)].map(([key, val]) => JSON.stringify({ [key]: val})).join(',')}].`
    }];
}

async function replaceAttributes(mongoClient: MongoClient, conversationId: string, attributeReplacements: ReplaceAttributesIntent['value']['attributeReplacements']) {
    const nouns = getNounCollection(mongoClient);
    
    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    const idxVals : { [key in string] : string } = {};
    const displayIdxVals : { [key in string]: string} = {};
    for (let i = 0; i < attributeReplacements.length; i ++) {
        if (noun.attributes[attributeReplacements[i].attributeIndex]) {
            idxVals[`attributes.${attributeReplacements[i].attributeIndex}`] = attributeReplacements[i].newValue;
            displayIdxVals[attributeReplacements[i].attributeIndex] = attributeReplacements[i].newValue;
        }
    }

    if (Object.keys(idxVals).length === 0) {
        return [];
    }

    await nouns.updateOne({ conversationId }, { $set: idxVals });

    return [{
        name: 'noun.update',
        description: `Replaced [${[...Object.entries(displayIdxVals)].map(([key, val]) => JSON.stringify([ noun.attributes[+key], val ])).join(',')}].`
    }];
}

async function removeNamedProperties(mongoClient: MongoClient, conversationId: string, namedProperties: string[]) {
    const nouns = getNounCollection(mongoClient);
    
    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    const removedKeys : { [key in string]: 1 } = {};
    const displayRemovedKeys : string[] = [];
    for (let i = 0; i < namedProperties.length; i ++) {
        if (namedProperties[i] && noun.attributes[i]) {
            removedKeys[`namedAttributes.${namedProperties[i]}`] = 1;
            displayRemovedKeys.push(namedProperties[i]);
        }
    }

    if (Object.keys(removedKeys).length === 0) {
        return [];
    }

    await nouns.updateOne({ conversationId }, { $unset: removedKeys });

    return [{
        name: 'noun.update',
        description: `Removed [${displayRemovedKeys.map(key => JSON.stringify({ [key]: noun.namedAttributes[key] })).join(',')}].`
    }];
}

async function removeAttributes(mongoClient: MongoClient, conversationId: string, indices: number[]) {
    const nouns = getNounCollection(mongoClient);

    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    const attrs = indices.reduce((attrs, index) => {
        return {
            ...attrs,
            [`attributes.${index}`]: 1
        }
    }, {});

    await nouns.updateOne({ conversationId }, { $unset: { ...attrs } });
    await nouns.updateOne({ conversationId }, { $pull: { attributes: null as any } });

    return [ 
        {
            name: 'noun.update',
            description: `Removed [${indices.map(index => JSON.stringify(noun.attributes[+index])).join(',')}].`
        } 
    ];
}

function encodeEvent(payload: string) {
    return new TextEncoder().encode(`data: ${payload}\n\n`);
}

class SSEEmitter<T> implements AsyncIterable<T> {
    #done = false;
    #updatePromise : Promise<void>;
    #resolve : ({ done } : { done: boolean }) => void = ({ done }) => {
        this.#done = done;
    };
    #queue : T[] = [];
    
    #promiseCallback = (resolve: () => void) => {
        this.#resolve = ({ done } : { done: boolean }) => {
            this.#done = done;
            this.#resolve = ({ done }) => {
                this.#done = done;
            };
            resolve(); 
        };
    }

    constructor() {
        this.#updatePromise = new Promise(this.#promiseCallback);
    }

    push(data: T) {
        this.#queue.unshift(data);
        this.#resolve({ done: false });
    }

    async process(cb: () => Promise<void>) {
        await cb();
        this.#resolve({ done: true });
    }
    
    async *[Symbol.asyncIterator](): AsyncIterator<T, any, undefined> {
        while (!this.#done) {
            await this.#updatePromise;
            this.#updatePromise = new Promise(this.#promiseCallback);
            let value : T | undefined;
            while(value = this.#queue.pop(), value !== undefined) {
                yield value;
            }
        }
    }
}

class Route {
    @authorize
    @mongo
    async GET(_: NextRequest, { params: { conversationId, session, mongoClient, mongoKeepOpen } } : { params: { session: Session, conversationId: string, userMessageId: string, mongoClient: MongoClient, mongoKeepOpen: () => {} } }) {
        const conversations = getConversationCollection(mongoClient);
        const conversation = await conversations.findOne({ '_id': conversationId, userId: session.user.id });
    
        if (!conversation || conversation.locked) {
            return NextResponse.json('Bad Request', { status: 400 });
        }

        await conversations.updateOne({ _id: conversationId },  { $set: { locked: true } });
    
        const { messages, purpose } = conversation;
    
        const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
        const openai = new OpenAIApi(configuration);

        const openaiMessages = messages.map(({ role, content }) => ({ role, content }));
    
        const relevantInfo = await findRelevantInformation(conversationId, purpose.type, purpose.context);
        const relevantInfoString = listRelevantInformation(relevantInfo);

        const emitter = new SSEEmitter<Uint8Array>();
        
        emitter.process(async () => {
            await Promise.all([
                (async () => {
                    const intents = detectIntents(openai, [ ...openaiMessages ], relevantInfo);
                    const events : { name: string; description: string }[] = [];
    
                    for await (const intent of intents) {
                        events.push(...await processChatIntents(mongoClient, conversationId, intent));
                    }
    
                    if (events.length) {
                        await conversations.updateOne({ _id: conversationId }, { 
                            $push: { 
                                messages: { 
                                    $each: events.map(({ description }) => ({
                                        content: `EVENT LOG: ${description}`,
                                        role: 'system'
                                    }))
                                } 
                            } 
                        });
                    }
                    emitter.push(encodeEvent(JSON.stringify({ events })));
                })(),
                (async () => {
                    const { data: stream } = await openai.createChatCompletion({
                        model: "gpt-3.5-turbo",
                        temperature: 0,
                        stream: true,
                        messages: [
                            { role: 'system', content: systemPrompts[purpose.type](purpose.context, openaiMessages.length === 0) },
                            ...openaiMessages.slice(-16),
                            ...openaiMessages.length > 0 ? [
                                { role: 'system', content: `Current known information about the ${purpose.context}:\n${relevantInfoString}\n\nDo not echo this to the user.` } as const
                            ] : [],
                        ]
                    }, { responseType: 'stream' }) as any as AxiosResponse<IncomingMessage>;
    
                    const newMessage = { role: 'assistant', content: '' } as Message;
                    let cachedChunk = '';
                    for await (const chunk of stream) {
                        const chunkStr = cachedChunk + new TextDecoder().decode(chunk);
                        if (!chunkStr.match(/^(data: .*\n\n)+$/)) {
                            cachedChunk = chunkStr;
                            continue;
                        }
                        
                        cachedChunk = '';
                        const events = chunkStr.match(/data: .*\n\n/g)?.map(str => str.slice(6, -2)) || [];
    
                        for (const event of events) {
                            if (!event) continue;
    
                            if (event === '[DONE]') {
                                await conversations.updateOne({ _id: conversationId }, { $push: { messages: newMessage } });
                                break;
                            }
    
                            emitter.push(encodeEvent(event));
                            
                            const data = JSON.parse(event);
                            newMessage.content += data.choices[0].delta.content || '';
                        }
                    }
                })()
            ]).then(() => {
                emitter.push(encodeEvent(JSON.stringify({ done: true })));
            }).catch(async e => {
                console.error(e);
                emitter.push(encodeEvent(JSON.stringify({ done: true, error: e.toString() })));
            }).finally(async () => {
                await conversations.updateOne({ _id: conversationId }, { $set: { locked: false } });
                await mongoClient.close();
            });
        });

        const outStream = Readable.toWeb(Readable.from(emitter)) as ReadableStream<any>;

        mongoKeepOpen();

        return new NextResponse(outStream, {
            headers: {
                ...defaultHeaders
            }
        });
    }
}

export const { GET } = new Route();