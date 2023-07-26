import { getMongoDatabase } from "@/app/mongo";
import { Collection, MongoClient } from "mongodb";
import { ChatCompletionRequestMessage, ChatCompletionRequestMessageRoleEnum } from "openai";
import { apiUrl } from "./api";
import { cookies } from "next/headers";
import { NounType, getConversationNoun, getConversationNounRevision } from "./noun";
import { assistantPrompt, prevResult, systemPrompt, userPrompt } from "../../ai-queue/pipeline/prompt";
import { v4 as uuid } from 'uuid';
import { Intent } from "../lib/intent";
import { generateIntentsSchema } from "../lib/intent/schema";
import { Pipeline } from "@/ai-queue/pipeline/pipeline";
import { PipelineItemConfig } from "@/ai-queue/pipeline/config";

export interface Message {
    id:           string;
    content:      string;
    role:         ChatCompletionRequestMessageRoleEnum;
    aiPipelineId: string;
    pending:      boolean;
    revision:     number;
}

export type ConversationPurposeType = 'create' | 'adventure';

export interface ConversationContext {
    create: NounType;
    adventure: 'adventure';
}

export type ConversationPurpose = {
    [key in keyof ConversationContext]: {
        type: key;
        context: ConversationContext[key];
    }
}[ConversationPurposeType];

export interface Conversation {
    _id: string;
    userId: string;
    messages: Message[];
    purpose: ConversationPurpose;
    locked: boolean;
    events: {
        after: string;
        description: string;
        id: string;
    }[];
    revision: number;
}

const splitSentencePrefix = 'SECOND STAGE';

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

const systemPrompts : ContextPrompts = {
    create: (context: string, firstTime: boolean) => [
        `You are a helpful worldbuilding assistant whose purpose is to assist in creating a ${contextDescriptions[context as NounType]}.`,
        ...firstTime ? [
            `You must start the conversation with "Hi! Let's create a ${context} together."`,
            `Your first and only prompt is for the name of the ${context}, adding some helpful pointers on creating a good name.`,
        ] : [
            `Always refrain from enumerating the properties and traits of the ${context} as a list unless specifically asked. ` +
            'Unless prompted, limit the number suggestions or questions to at most three or four. ' + 
            'The user should be able to provide small, focused answers to your prompts, so don\'t overwhelm the user with questions or suggestions. ' +
            `Your prompt should always elicit more information from the user unless they're satisfied with the ${context} as a whole and have nothing more to add. ` +
            `Keep the questions focused on the ${context}, but leave room for the user to explore aspects of the ${context} that you haven\'t asked about.`
        ],
    ].join(' '),
    adventure: () => ''
};

export async function findRelevantInformation<T extends ConversationPurposeType>(conversationId: string, conversationType: T, context: ConversationContext[T], revision: number) : Promise<RelevantInformation> {
    if (conversationType === 'adventure') {
        return { name: '', properties: {}, traits: [], type: '' };
    }
    const noun = await getConversationNounRevision(conversationId, revision);

    if (!noun) {
        return { name: '', properties: {}, traits: [], type: '' };
    }

    return {
        type: context,
        name: noun.name,
        traits: noun.traits || [],
        properties: noun.properties || {}
    };
}

type RelevantInformation = {
    type: string;
    name: string; 
    properties: { 
        [key in string]: string;
    }; 
    traits: string[];
}

export function listRelevantInformation({ name, properties, traits } : RelevantInformation) {
    return [
        `name: ${name || 'unknown' }`,
        '\n',
        'properties:',
        ...[...Object.entries(properties)].map(([key, val]) => `${key}: ${val}`),
        '\n',
        'traits:',
        ...traits.map((val) => `- ${val}`)
    ].join('\n').trim();
}

function createSentenceSplittingPrompt(messages: ChatCompletionRequestMessage[], relevantInfo: RelevantInformation) : PipelineItemConfig {
    const chatMessages = messages.filter(({ role }) => role !== 'system');
    const lastAssistantPrompt = chatMessages.slice(-2)[0].content!;
    const lastUserPrompt = chatMessages.slice(-1)[0].content!;
    const relevantInfoStr = listRelevantInformation(relevantInfo);

    return {
        request: {
            kind: 'message',
            alias: 'splitSentences',
            systemMessage: `            
                First, you will enter information mode. You will enumerate the current information about a ${relevantInfo.type}. Then you will enter chat mode. You will produce a worldbuilding prompt in chat mode. The user will respond to that in chat mode. Then you will exit chat mode and enter sentence breakdown mode.

                You will then follow these instructions:
                
                Output "FIRST STAGE".
                - Summarize the user's response as short, simple sentences on individual lines.
                - If the user provided no new information about the ${relevantInfo.type}, just output NONE.
                - Each sentence must contain one piece of information.
                - Compound information must be split into multiple sentences.
                - References to the assistant prompt should be written as sentences containing that information.
                - Ignore requests for suggestions.
                - Sentences should only be about the ${relevantInfo.type} itself.
                - Do not add novel information that hasn't been added by the user.
                - Do not leave out any information mentioned by the user.

                Then, output "${splitSentencePrefix}".
                - Process each sentence from the FIRST STAGE further a second time to split them into even smaller pieces of information.
                - Output those smaller sentences.
                - Merge the sentences together to verify that they match the first stage.
            `,
            messages: [
                assistantPrompt`Entering information mode. The following is the current ${relevantInfo.type} information.`,
                assistantPrompt`${relevantInfoStr}`,
                assistantPrompt`Exiting information mode. Entering chat mode.`, 
                assistantPrompt`${lastAssistantPrompt}`,
                userPrompt`${lastUserPrompt}`,
                assistantPrompt`Exiting chat mode. Entering sentence breakdown mode.`
            ]
        }
    };
}

export function getConversationCollection(mongoClient: MongoClient) : Collection<Conversation> {
    return getMongoDatabase(mongoClient).collection<Conversation>('conversations');
}

export async function getMessages(conversationId: string) {
    const response = await fetch(apiUrl(`conversation/${conversationId}/message`), {
        headers: {
            Cookie: cookies().toString()
        },
        cache: 'no-cache'
    });

    return response.json();
}

export async function startAssistantPrompt(mongoClient: MongoClient, conversationId: string, intentDetection: boolean, relevantInfo: RelevantInformation, pipelineId: string, revision: number) {
    const conversations = getConversationCollection(mongoClient);
    const responseMessage : Message = {
        role:         'assistant',
        content:      '',
        id:           uuid(),
        aiPipelineId: pipelineId,
        pending:      true,
        revision
    };

    const conversation = await conversations.findOne({ _id: conversationId });
    if (!conversation) {
        throw new Error('Conversation not found');
    }
    const { messages, purpose } = conversation;

    await conversations.updateOne({ _id: conversationId }, { $push: { messages: responseMessage } });
    const openaiMessages = messages.map(({ role, content }) => ({ role, content }));
    const relevantInfoString = listRelevantInformation(relevantInfo);

    const chatPipelineItem : PipelineItemConfig = {
        request: {
            alias: 'chat',
            kind: 'stream',
            systemMessage: systemPrompt`
                ${systemPrompts[purpose.type](purpose.context, openaiMessages.length === 0)}
                ${openaiMessages.length > 0 ? `
                    Current known information about the ${purpose.context}:
                    ${relevantInfoString}
                    Do not echo this to the user.
                ` : ''}
            `,
            messages: [
                ...openaiMessages.slice(-16)
            ],
            autoConfirm: false
        }
    };
    
    if (!intentDetection) {
        return Pipeline.fromItems(chatPipelineItem, pipelineId).saveToQueue();
    }

    return Pipeline.fromItems({
        parallel: [
            {
                sequence: [
                    createSentenceSplittingPrompt(openaiMessages, relevantInfo),
                    createIntentDetectionPrompt(relevantInfo)
                ]
            },
            chatPipelineItem
        ]
    }, responseMessage.aiPipelineId).saveToQueue();
}

export function processSplitSentences(message: string) {
    return message.includes(splitSentencePrefix) ? 
        message.slice(message.indexOf(splitSentencePrefix) + splitSentencePrefix.length).trim()
        : message;
}

function createIntentDetectionPrompt(relevantInfo: RelevantInformation) : PipelineItemConfig {
    const relevantInfoStr = listRelevantInformation(relevantInfo);

    return {
        request: {
            alias: 'intentDetection',
            kind: 'function',
            functionName: 'generateIntents',
            functions: [generateIntentsSchema(relevantInfo.type)],
            systemMessage: `
                You are an intent classifier.

                General rules:
                - Do not generate redundant intents. 
                - Try to infer intents for all user-provided information, no matter how minor.
                - Only use the information provided by the user.
                - The intent content must closely match the information provided by the user.

                Rules for the "setProperties" intent:
                - Output the "setProperties" intent if the user intends to set a named property of the ${relevantInfo.type}.
                - Property names must be plain English, as short as possible.
                - Property names must not use camel case.
                - Property names must not have special characters or numbers. 
                - Property names may have spaces. 
                - Properties must not represent the name of the ${relevantInfo.type}; instead, use the "setName" intent.
                - Properties must be short but descriptive.
                - Properties may not be boolean.
                - Property names must not be duplicated. 
                - If a single property has multiple values, concatenate the values with commas and space them.

                Rules for the "setName" intent:
                - Output the "setName" intent if the user intends to set the name of the ${relevantInfo.type}.

                Rules for the "addTraits" intent:
                - Output the "addTraits" intent if the user intends to add an unnamed, miscellaneous trait to the ${relevantInfo.type}.
                - Each trait must be short but descriptive. 
                - Each trait must make sense on its own without context from other traits.
                - Do not combine multiple traits into a single string.

                Rules for the "replaceTraits" intent:
                - Output the "replaceTraits" intent if the user intends to replace an unnamed, miscellaneous trait of the ${relevantInfo.type}.
                - Replaced traits should follow the same formatting rules as "addTraits".

                Current up-to-date information about the ${relevantInfo.type}:
                ${relevantInfoStr}
            `,
            messages: [
                userPrompt`${prevResult(new RegExp(`^(?:(?:.|[\\r\\n])*(?=${splitSentencePrefix})${splitSentencePrefix})?((?:.|[\\r\\n])*)$`), 1)}`
            ],
            autoConfirm: false
        }
    }
}

export function* processIntentDetectionResults({ intents }: { intents: Intent[] }) : Generator<Intent> {
    if (!Array.isArray(intents)) {
        return;
    }
    for (const intent of intents) {
        yield intent;
    }
}

export async function updateConversationRevision(mongoClient: MongoClient, conversationId: string, revision: number) {
    const conversations = getConversationCollection(mongoClient);
    await conversations.updateOne({ _id: conversationId }, {
        $set: {
            revision
        }
    });
}

export async function rollbackConversationRevision(mongoClient: MongoClient, conversationId: string, revision: number) {
    const conversations = getConversationCollection(mongoClient);
    const conversation = await conversations.findOne({ _id: conversationId }, {
        projection: {
            messages: {
                $filter: {
                    input: '$messages',
                    as: 'message',
                    cond: {
                        $or: [
                            { 
                                $eq: ['$$message.revision', null]
                            },
                            {
                                $lt: [ '$$message.revision', revision ]
                            }
                        ]
                    }
                }
            }
        }
    });

    if (!conversation) {
        return;
    }
    await conversations.updateOne({ _id: conversationId }, {
        $set: {
            messages: conversation.messages
        }
    });
}

