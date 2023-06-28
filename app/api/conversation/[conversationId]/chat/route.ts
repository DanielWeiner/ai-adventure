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

type UserIntents = {
    [ConversationType in ConversationPurposeType]: {
        [Intent in string]: (context: string) => ({
            description: string,
            data: string[]
        })
    }
}

const intents : UserIntents = {
    create: {
        setName: context => ({
            description: `the name of the ${context} is provided`,
            data: [`the name of the ${context}`]
        }),
        setNamedAttributes: context => ({
            description: `new or changed named information is provided about the ${context}`,
            data: [`an attribute name for the new or changed named information in plain english, followed by its corresponding short but descriptive string value, without grammar or punctuation. Alternate between name and value for all new or changed named attributes, ensuring no string in this array is empty`]
        }),
        addAttributes: context => ({
            description: `new unnamed information is provided about the ${context}`,
            data: [`the new information as short but descriptive, unlabeled string values, without grammar or punctuation. Each attribute must make sense on its own without context from other attributes`]
        }),
        removeAttributes: context => ({
            description: `any unnamed attributes were requested to be removed from the ${context}`,
            data: [`zero-indexed indices as strings, for each of the existing unnamed attribute to be deleted`]
        }),
        removeNamedAttributes: context => ({
            description: `any named attributes were requested to be removed from the ${context}`,
            data: [`names of each named attribute to be removed`]
        }),
        replaceAttributes: context => ({
            description: `any unnamed attributes of the ${context} were requested to be replaced`,
            data: [`a zero-indexed index of an unnamed attribute as a string, followed by its replacement value, alternating between index and value for all unnamed attributes being replaced`]
        }),
    },
    adventure:{}
};

const systemPrompts : ContextPrompts = {
    create: (context: string, firstTime: boolean) => [
        `You are helpful worldbuilding assistant whose purpose is to assist in creating a ${contextDescriptions[context as NounType]}.`,
        ...firstTime ? [
            `You must start the conversation with "Hi! Let's create a ${context} together."`,
            `Your first and only prompt is for the name of the ${context}, adding some helpful pointers on creating a good name.`,
        ] : [
            `Always refrain from enumerating the attributes of the ${context} as a list unless specifically asked.`
        ],
    ].join(' '),
    adventure: () => ''
};

function calculateIntentList<T extends ConversationPurposeType>(conversationType: T, context: ConversationContext[T]) {
    return [...Object.entries(intents[conversationType])].map(([intentName, intentFn], i) => {
        const { data, description } = intentFn(context);        
        const suffix = data.map((str, i) => (i == 0 ? ' ' : '') + (i === data.length - 1 ? `and ${str}` : str)).join(', ');
        return `${i + 1}. If ${description}, output on a new line a JSON array containing only the string "${intentName}"${suffix}.`
    }).concat([
        `${Object.keys(intents[conversationType]).length + 1}. If no intent can be inferred, or if it was just a request for suggestions, simply output ["none"].`
    ]).join('\n')
}

function listRelevantInformation({ name, type, defaultName, attributesMap, attributes } : RelevantInformation) {
    return [
        `Name of the ${type}: ${name || 'unknown' }`,
        ...Object.keys(attributesMap).length ? [[
            `Named attributes for ${name || defaultName}:`,
            ...[...Object.entries(attributesMap)].map(([key, val]) => `${key}: ${val}`),
        ].join('\n') + '\n'] : [],
        ...attributes.length ? [[
            `Additional attributes for ${name || defaultName}:`,
            ...attributes.map((val, i) => `${i + 1}. ${val}`)
        ].join('\n') + '\n'] : []
    ].join('\n').trim()
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

async function* detectIntents<T extends ConversationPurposeType>(
    openai: OpenAIApi, 
    conversationType: T, 
    context: ConversationContext[T], 
    messages: ChatCompletionRequestMessage[], 
    relevantInfo: RelevantInformation
) : AsyncGenerator<string[]> {
    if (messages.length < 2) {
        yield ['none'];
        return;
    }

    const chatMessages = messages.filter(({ role }) => role !== 'system');
    const fullChatLog = chatMessages.slice(-4).map(({ content, role }) => (`${role.toUpperCase()}: ${content}`)).join('\n');
    const lastAssistantPrompt = chatMessages.slice(-2)[0].content!;
    const lastUserPrompt = chatMessages.slice(-1)[0].content!;
    const relevantInfoStr = listRelevantInformation(relevantInfo);
    const splitInformationPrompt = 
        `\n\nHere\'s the most recent up-to-date information about the ${relevantInfo.type}:` +
        '\n[START RELEVANT INFO]\n' +
        relevantInfoStr +
        '\n[END RELEVANT INFO]\n' +
    
        `\nHere\'s the most recent assistant prompt regarding the ${relevantInfo.type}. Do not generate results from it.` +
        '\n[START ASSISTANT PROMPT]\n' +
        lastAssistantPrompt +
        '\n[END ASSISTANT PROMPT]\n' +

        '\nWrite short but descriptive sentences for all of the information provided by the user\'s response to the assistant. ' + 
        'Each sentence must only contain one piece of information. ' +
        'Each sentence must make sense on its own without any external context. ' +
        'Write multiple sentences for compound information.\n' +
        `Here\'s the user\'s response to the assistant regarding the ${relevantInfo.type}.`+
        '\n[START USER RESPONSE]\n' +
        lastUserPrompt +
        '\n[END USER RESPONSE]';

    console.log(splitInformationPrompt);

    const splitInformationResult = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        temperature: 0,
        messages: [
            { 
                role: 'user',
                content: splitInformationPrompt
            }
        ]
    });

    const infoStatements = (splitInformationResult.data.choices[0].message?.content?.trim() ?? '');
    console.log(infoStatements);

    const messageContent = 'You are an intent classifier. ' + 
        'You analyze statements about a user\'s last message for intents. ' +
        'Each statement may have multiple intents. ' + 
        'Not every possible intent may be inferred. ' +
        'The output for a classified must be a valid JSON array of strings in its own line with nothing before or after. ' +
        'The first element of each array is the name of the classified intent, followed by strings representing the intent data. ' +
        'Two classified intents must not mean the same thing. ' +
        'Do not add any information that hasn\'t been specified. ' +
        'Do not add any information that is already present. ' +
        'Do not add unknown or incomplete information. ' +
        'The format is extremely important.' +

        '\nThe following are the possible intents:\n' +
        calculateIntentList(conversationType, context) +
        '\n' +
        '\nDo not remove any information unless specifically requested. ' +
        '\nDo not add any information that hasn\'t been explicitly specified. ' +
        '\n' +

        '\nHere is the previous chat log for context:' + 
        '\n[START CHAT LOG]\n' + 
        fullChatLog +
        '\n[END CHAT LOG]\n' +
        
        '\nHere is following relevant, up-to-date information for context. Do not infer intents from this.' + 
        '\n[START RELEVANT INFORMATION]\n' + 
        relevantInfoStr +
        '\n[END RELEVANT INFORMATION]\n' +

        '\nAnalyze the intents of just the following statements that describe the user\'s last message:' + 
        '\n[START STATEMENTS]\n' +
        infoStatements +
        '\n[END STATEMENTS]';

    console.log(messageContent);
    
    const result = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        temperature: 0,
        messages: [
            { 
                role: 'user',
                content: messageContent
            }
        ]
    });
    
    const intentText = result.data.choices[0].message?.content?.trim() || '';
    const intents = (intentText || '["none"]').split(/[\r\n]+/g);
    for (const intent of intents) {
        console.log(intent);
        try {
            yield JSON.parse(intent);
        } catch (e) {
            yield [ "none" ];
        }
    }
}

async function processChatIntents(mongoClient: MongoClient, conversationId: string, intentName: string, ...intentData: string[]) {
    if (intentName === 'setName') {
        return setName(mongoClient, conversationId, intentData[0]);
    }

    if (intentName === 'addAttributes') {
        return addAttributes(mongoClient, conversationId, intentData);
    }

    if (intentName === 'setNamedAttributes') {
        return setNamedAttributes(mongoClient, conversationId, intentData);
    }

    if (intentName === 'replaceAttributes') {
        return replaceAttributes(mongoClient, conversationId, intentData);
    }

    if (intentName === 'removeAttributes') {
        return removeAttributes(mongoClient, conversationId, intentData);
    }

    if (intentName === 'removeNamedAttributes') {
        return removeNamedAttributes(mongoClient, conversationId, intentData);
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

async function setNamedAttributes(mongoClient: MongoClient, conversationId: string, attributes: string[]) {
    const nouns = getNounCollection(mongoClient);
    
    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    const namedAttrs : { [key in string] : string } = {};
    const displayNamedAttributes  : { [key in string] : string } = {};
    for (let i = 0; i < attributes.length; i += 2) {
        if (attributes[i] && attributes[i+1]) {
            namedAttrs[`namedAttributes.${attributes[i]}`] = attributes[i+1];
            displayNamedAttributes[attributes[i]] = attributes[i+1];
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

async function replaceAttributes(mongoClient: MongoClient, conversationId: string, attributes: string[]) {
    const nouns = getNounCollection(mongoClient);
    
    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    const idxVals : { [key in string] : string } = {};
    const displayIdxVals : { [key in string]: string} = {};
    for (let i = 0; i < attributes.length; i += 2) {
        if (attributes[i] && attributes[i+1] && noun.attributes[+attributes[i]]) {
            idxVals[`attributes.${attributes[i]}`] = attributes[i+1];
            displayIdxVals[attributes[i]] = attributes[i+1];
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

async function removeNamedAttributes(mongoClient: MongoClient, conversationId: string, attributes: string[]) {
    const nouns = getNounCollection(mongoClient);
    
    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    const removedKeys : { [key in string]: 1 } = {};
    const displayRemovedKeys : string[] = [];
    for (let i = 0; i < attributes.length; i ++) {
        if (attributes[i] && noun.attributes[i]) {
            removedKeys[`namedAttributes.${attributes[i]}`] = 1;
            displayRemovedKeys.push(attributes[i]);
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

async function removeAttributes(mongoClient: MongoClient, conversationId: string, indices: string[]) {
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
    
        if (!conversation) {
            return NextResponse.json('Bad Request', { status: 400 });
        }
    
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
                    const intents = detectIntents(openai, purpose.type, purpose.context, [ ...openaiMessages ], relevantInfo);
                    const events : { name: string; description: string }[] = [];
    
                    for await (const intent of intents) {
                        events.push(...await processChatIntents(mongoClient, conversationId, ...intent as [string]));
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
                                { role: 'system', content: relevantInfoString } as const
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
            ]);
            await mongoClient.close();
            emitter.push(encodeEvent(JSON.stringify({ done: true })));
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