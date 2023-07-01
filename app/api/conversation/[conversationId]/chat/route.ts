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
            data: string,
            notes?: string
        })
    }
}

const intents : UserIntents = {
    create: {
        setName: context => ({
            description: `The ${context} is given a name.`,
            data: '["setName","<name>"]'
        }),
        setNamedProperties: context => ({
            description: `Properties, aside from the name of the ${context}, have been set for this ${context}.`,
            data: '["setNamedProperties","<first property name>","<first property value>","<next property name>","<next property value>", ... ,"<last property name>","<last property value>"]',
            notes: `Property names must be plain English labels, as short as possible, without camel case, special characters or numbers. Spaces in property names are allowed. Property values should be short but descriptive, without grammar or punctuation. Avoid boolean values. If a property has multiple values, concatenate the values with commas, and space them. Named properties must not duplicate the information in any new or existing unnamed attributes.`
        }),
        addAttributes: context => ({
            description: `Miscellaneous details have been provided for this ${context}.`,
            data: '["addAttributes","<first attribute>","<second attribute>", ... ,"<last attribute>"]',
            notes: `Values should be shortened but descriptive, without grammar or punctuation. Each value must make sense on its own without context from other new or existing named properties or unnamed attributes. Unnamed attributes must not duplicate the information in any new or existing named properties. Do not combine multiple unnamed attributes into a single string.`
        }),
        removeNamedProperties: context => ({
            description: `Named properties of the ${context} have been removed.`,
            data: '["removeNamedProperties","<first property name>","<next property name>", ... ,"<last property name>"]'
        }),
        removeAttributes: context => ({
            description: `Unnamed attributes of the ${context} have been removed.`,
            data: '["removeAttributes","<first index>","<next index>", ... ,"<last index>"]',
            notes: 'Indices must be zero-indexed.'
        }),
        replaceAttributes: context => ({
            description: `Unnamed attributes of the ${context} have been replaced with new values.`,
            data: '["replaceAttributes","<first index>","<first attribute>","<next index>","<next attribute>", ... ,"<last index>","<last attribute>"]',
            notes: 'Indices must be zero-indexed. Values should be short but descriptive, unlabeled string values, without grammar or punctuation.'
        }),
    },
    adventure:{}
};

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

function calculateIntentList<T extends ConversationPurposeType>(conversationType: T, context: ConversationContext[T]) {
    return [...Object.values(intents[conversationType])].map((intentFn, i) => {
        const { description, data, notes } = intentFn(context);        
        return `${i + 1}. Intent: ${description}\nOutput: [...<other intents>...,${data},...<other intents>...]${notes ? `\nRules: ${notes}` : ''}\n`
    }).concat([
        `${Object.keys(intents[conversationType]).length + 1}. Intent: Unknown or a request for suggestions.\n` +
        'Output: [["none"]]'
    ]).join('\n')
}

function listRelevantInformation({ name, type, defaultName, attributesMap, attributes } : RelevantInformation) {
    return [
        `Name of the ${type}: ${name || 'unknown' }`,
        ...Object.keys(attributesMap).length ? [[
            `Named properties for ${name || defaultName}:`,
            ...[...Object.entries(attributesMap)].map(([key, val]) => `${key}: ${val}`),
        ].join('\n') + '\n'] : [],
        ...attributes.length ? [[
            `Unnamed attributes for ${name || defaultName}:`,
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
        - Do not omit any information about the ${relevantInfo.type} that has been specified by the user.
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
        'You analyze statements about a user\'s last message for intents. ' + 
        'Each statement may have multiple intents. ' + 
        'Not every possible intent may be inferred. ' + 
        'Try to infer as many intents as possible. ' + 
        'Two inferred intents must not mean the same thing. ' + 
        'Do not add any information that hasn\'t been specified. ' + 
        'Do not add any information that is already present. ' + 
        'Do not add unknown or incomplete information. ' + 
        'The syntax of the output is extremely important. ' + 
        'Make sure that the output is a valid two-dimensional JSON array of strings with no extra or missing characters. ' +
        'Do not add any extra output before or after that JSON.\n' +

        '\nThe following are the possible intents:\n' +
        calculateIntentList(conversationType, context) +
        '\n' +
        '\nDo not remove any information unless specifically requested. ' +
        '\nDo not add any information that hasn\'t been explicitly specified. ' +
        '\n' +

        '\nHere is following relevant, up-to-date information for context. Do not infer intents from this.' + 
        '\n[START RELEVANT INFORMATION]\n' + 
        relevantInfoStr +
        '\n[END RELEVANT INFORMATION]\n' +

        '\nAnalyze the intents of just the following statements that describe the user\'s last message:' + 
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
        ]
    });
    
    const intentText = (result.data.choices[0].message?.content?.trim() || '')
        // get rid of too many trailing close brackets
        .replace(/\]\]\]+$/, ']]')
        // add a missing final close bracket
        .replace(/(?<!\])]$/, ']]');
    console.log(intentText);
    try {
        const intents = JSON.parse(intentText);
        if (!Array.isArray(intents)) {
            yield ["none"];
            return;
        }
        for (const intent of intents) {
            if (Array.isArray(intent) && intent.every(val => typeof val === 'string')) {
                yield intent;
            }
        }
    } catch {
        yield ["none"];
    }
}

async function processChatIntents(mongoClient: MongoClient, conversationId: string, intentName: string, ...intentData: string[]) {
    if (intentName === 'setName') {
        return setName(mongoClient, conversationId, intentData[0]);
    }

    if (intentName === 'addAttributes') {
        return addAttributes(mongoClient, conversationId, intentData);
    }

    if (intentName === 'setNamedProperties') {
        return setNamedProperties(mongoClient, conversationId, intentData);
    }

    if (intentName === 'replaceAttributes') {
        return replaceAttributes(mongoClient, conversationId, intentData);
    }

    if (intentName === 'removeAttributes') {
        return removeAttributes(mongoClient, conversationId, intentData);
    }

    if (intentName === 'removeNamedProperties') {
        return removeNamedProperties(mongoClient, conversationId, intentData);
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

async function setNamedProperties(mongoClient: MongoClient, conversationId: string, attributes: string[]) {
    const nouns = getNounCollection(mongoClient);
    
    const noun = await nouns.findOne({ conversationId });
    if (!noun) {
        return [];
    }

    const namedAttrs : { [key in string] : string } = {};
    const displayNamedAttributes  : { [key in string] : string } = {};
    for (let i = 0; i < attributes.length; i += 2) {
        if (attributes[i] && attributes[i+1]) {
            const key = `namedAttributes.${attributes[i]}`;
            if (namedAttrs.hasOwnProperty(key)) {
                namedAttrs[key] += `, ${attributes[i+1]}`;
                displayNamedAttributes[attributes[i]] += `, ${attributes[i+1]}`;
            } else {
                namedAttrs[`namedAttributes.${attributes[i]}`] = attributes[i+1];
                displayNamedAttributes[attributes[i]] = attributes[i+1];
            }
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

async function removeNamedProperties(mongoClient: MongoClient, conversationId: string, attributes: string[]) {
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