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
import { createIntentDetectionPrompt } from "../lib/intent/intentPrompt";
import { RELEVANT_INFO_FUNCTION_NAME, generateRelevantInfoJson, getRelevantInfoSchema } from "../lib/relevant-info/schema";

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
        `You are a helpful worldbuilding assistant whose purpose is to assist in creating a ${contextDescriptions[context as NounType]}.
        `,
        ...firstTime ? [
            `- You must start the conversation with "Hi! Let's create a ${context} together." 
             - Your first and only prompt is for the name of the ${context}, adding some helpful pointers on creating a good name`
        ] : [`
            - Always refrain from enumerating the properties and traits of the ${context} as a list unless specifically asked.
            - Unless prompted, limit the number suggestions or questions to at most three or four.
            - The user should be able to provide small, focused answers to your prompts, so don't overwhelm the user with questions or suggestions.
            - Your prompt should always elicit more information from the user, unless they're satisfied with the ${context} as a whole and have nothing more to add.
            - Keep the questions focused on the ${context}, but leave room for the user to explore aspects of the ${context} that you haven't asked about.`
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

function createSentenceSplittingPrompt(messages: ChatCompletionRequestMessage[], relevantInfo: RelevantInformation) : PipelineItemConfig {
    const chatMessages = messages.filter(({ role }) => role !== 'system');
    const lastAssistantPrompt = chatMessages.slice(-2)[0].content!;
    const lastUserPrompt = chatMessages.slice(-1)[0].content!;

    return {
        request: {
            kind: 'message',
            alias: 'splitSentences',
            systemMessage: `            
                First, you will enter chat mode. You will produce a worldbuilding prompt in chat mode. The user will respond to that in chat mode. Then you will exit chat mode and enter sentence breakdown mode.

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
                { role: 'assistant', function_call: { name: RELEVANT_INFO_FUNCTION_NAME, arguments: generateRelevantInfoJson(relevantInfo) }},
                assistantPrompt`Entering chat mode.`,
                assistantPrompt`${lastAssistantPrompt}`,
                userPrompt`${lastUserPrompt}`,
                assistantPrompt`Exiting chat mode. Entering sentence breakdown mode.`
            ],
            functions: [
                getRelevantInfoSchema(relevantInfo.type)
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

    const chatPipelineItem : PipelineItemConfig = {
        request: {
            alias: 'chat',
            kind: 'stream',
            systemMessage: systemPrompt`
                ${systemPrompts[purpose.type](purpose.context, openaiMessages.length === 0)}
            `,
            messages: [
                ...openaiMessages.slice(-16, -1),
                { role: 'assistant', function_call: { name: RELEVANT_INFO_FUNCTION_NAME, arguments: generateRelevantInfoJson(relevantInfo)} },
                ...openaiMessages.slice(-1)
            ],
            functions: [
                getRelevantInfoSchema(relevantInfo.type)
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

