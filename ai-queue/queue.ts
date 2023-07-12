import 'dotenv/config';
import { ChatCompletionFunctions, ChatCompletionRequestMessage, Configuration, CreateChatCompletionRequest, OpenAIApi } from 'openai';
import ChatCompleter from './chatCompleter';
import { Logger, createLogger, format, transports } from 'winston';
import { RedisClientType, commandOptions, createClient } from 'redis';
import { v4 as uuid } from 'uuid';

const { REDIS_URL, AI_QUEUE_LOG } = process.env;

interface ChatCompletionRequestQueueMessage {
    messageGroupId: string;
    label:          string;
    kind:           'function' | 'message' | 'stream';
    messages:       ChatCompletionRequestMessage[];
    systemMessage?: string;
    functionName?:  string;
    functions?:     ChatCompletionFunctions[];
    configuration?: Partial<Omit<CreateChatCompletionRequest, 'messages' | 'stream'>>;    
}

interface ChatCompletionResponseQueueMessage {
    label:          string;
    content:        string;
};

const STREAM_BATCH_SIZE = 10;
const STREAM_BLOCK_TIME = 2000;

export const REDIS_REQUEST_QUEUE = 'AiqRequests';
export const REDIS_REQUEST_CONSUMER_GROUP = 'RequestConsumerGroup';
export const REDIS_COMPLETION_QUEUE = 'AiqCompletions';

const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);
export const logger = createLogger({
    transports: [
        new transports.Console({
            format: format.combine(
                format.timestamp(),
                format.simple()
            ),
            silent: AI_QUEUE_LOG !== '1'
        })
    ],
});

async function ensureStreamExists(redisClient: RedisClientType, key: string) {
    const group = uuid();
    await redisClient.xGroupCreate(key, group, '$', { MKSTREAM: true });
    await redisClient.xGroupDestroy(key, group);
}

export async function getLastCompletionId() {
    const redisClient = await createRedisClient();
    await ensureStreamExists(redisClient, REDIS_COMPLETION_QUEUE);
    const [{ id }] = await redisClient.xRevRange(REDIS_COMPLETION_QUEUE, '+', '-', { COUNT: 1 });
    return id;
}

export async function* watchStream({
    redisClient, 
    key, 
    consumerGroupId,
    messageGroupId,
    lastSeenMessageId,
    mutuallyExclusiveConsumerGroup,
    timeout,
} : {
    redisClient: RedisClientType, 
    key: string, 
    consumerGroupId: string,
    messageGroupId: string,
    lastSeenMessageId: string | null,
    mutuallyExclusiveConsumerGroup: boolean,
    timeout?: number,
}) : AsyncGenerator<{ message: string, timeout: boolean, done: boolean, id: string | null }> {
    const now = Number(new Date());
    await ensureStreamExists(redisClient, key);
    const groupInfo = await redisClient.xInfoGroups(key);

    if (!groupInfo.some(({ name }) => name === consumerGroupId)) {
        await redisClient.xGroupCreate(key, consumerGroupId, lastSeenMessageId || '0');
    } else if (mutuallyExclusiveConsumerGroup) {
        return;
    }

    while (true) {
        try {
            const response = await redisClient.xReadGroup(commandOptions({ isolated: true }), consumerGroupId, consumerGroupId, [
                {
                    key,
                    id: '>',
                }
            ], {
                COUNT: STREAM_BATCH_SIZE,
                BLOCK: STREAM_BLOCK_TIME
            });

            if (timeout !== undefined && Number(new Date()) > now + timeout) {
                yield {
                    done: true,
                    message: 'null',
                    timeout: true,
                    id: null
                };
                break;
            }

            if (!response?.[0]?.messages?.length) {
                continue;
            }

            const messages = response[0].messages.filter(({ message }) => message.messageGroupId === messageGroupId);
            if (!messages.length) continue;

            for (const message of messages) {
                logger.info(`received ${JSON.stringify(message)} from ${key}.`);
            }

            const messageIds = messages.map(({ id }) => id);
            await redisClient.xAck(key, consumerGroupId, messageIds);

            let done = false;
            for (const { id, message } of messages) {
                done = message.done === 'true';

                if (id !== messages[messages.length - 1].id) {
                    yield {
                        done,
                        message: message.content,
                        id,
                        timeout: false
                    }
                } else {
                    if (timeout !== undefined && Number(new Date()) > now + timeout) {
                        yield {
                            done,
                            message: message.content,
                            id,
                            timeout: true
                        }

                        return;
                    }

                    yield {
                        done,
                        message: message.content,
                        id,
                        timeout: false
                    };
                }
            }
        } catch(e: any) {
            break;
        }
    }
}

export async function sendMessage(redisClient: RedisClientType, key: string, content: string, messageGroupId: string, done: boolean) {
    await redisClient.xAdd(key, '*', { content, messageGroupId, done: (!!done).toString() });
    logger.info(`sent ${JSON.stringify({ content, messageGroupId })} to ${key}.`);
};

async function processCompletionRequest(openai: OpenAIApi, redisClient: RedisClientType, completionRequest : ChatCompletionRequestQueueMessage) {
    const completer = new ChatCompleter(openai)
        .configure(completionRequest.configuration || {})
        .addFunctions(...completionRequest.functions || [])
        .setSystemMessage(completionRequest.systemMessage || '');
    
    if (completionRequest.kind === 'stream') {
        for await (const { content, done } of completer.generateChatCompletionDeltas(completionRequest.messages)) {
            await sendMessage(redisClient, REDIS_COMPLETION_QUEUE, JSON.stringify({ 
                label: completionRequest.label, 
                content
            }), completionRequest.messageGroupId, done);
        }
        await sendMessage(redisClient, REDIS_COMPLETION_QUEUE, JSON.stringify({
            label: completionRequest.label,
            content: ''
        }), completionRequest.messageGroupId, true);
    } else if (completionRequest.kind === 'function') {
        const message = await completer.createFunctionCallCompletion(completionRequest.messages, completionRequest.functionName);
        await sendMessage(redisClient, REDIS_COMPLETION_QUEUE, JSON.stringify({
            label: completionRequest.label,
            content: JSON.stringify(message)
        }), completionRequest.messageGroupId, true);
    } else {
        const message = await completer.createChatCompletion(completionRequest.messages);
        await sendMessage(redisClient, REDIS_COMPLETION_QUEUE, JSON.stringify({ 
            label: completionRequest.label,
            content: message
        }), completionRequest.messageGroupId, true);
    }
}

async function startRequestReceiver(requestReaderClient: RedisClientType, completionSenderClient: RedisClientType, openai: OpenAIApi, logger: Logger) {
    logger.info(`AI queue processor listening to ${REDIS_REQUEST_QUEUE}.`);

    for await (const { message } of watchStream({
        redisClient: requestReaderClient,
        consumerGroupId: REDIS_REQUEST_CONSUMER_GROUP,
        key: REDIS_REQUEST_QUEUE,
        messageGroupId: REDIS_REQUEST_CONSUMER_GROUP,
        lastSeenMessageId: null,
        mutuallyExclusiveConsumerGroup: false
    })) {
        try {
            const completionRequest : ChatCompletionRequestQueueMessage = JSON.parse(message);
            
            processCompletionRequest(openai, completionSenderClient, completionRequest).catch(e => logger.error(e));
        } catch(e : any) {
            logger.error(e);
            break;
        }
    }
}

export const createRedisClient = async () => {
    const client : RedisClientType = createClient({
        url: REDIS_URL
    })
    await client.connect();

    return client;
};

export async function* watchCompletionStream(consumerGroupId: string, messageGroupId: string, lastSeenMessageId: string | null, timeout?: number) {
    const redisClient = await createRedisClient();

    for await (const { message, done, timeout: timeoutReached, id } of watchStream({
        redisClient,
        key: REDIS_COMPLETION_QUEUE,
        consumerGroupId,
        messageGroupId,
        lastSeenMessageId,
        mutuallyExclusiveConsumerGroup: true,
        timeout
    })) {
        const response : ChatCompletionResponseQueueMessage | null = JSON.parse(message);
        yield {
            message: response,
            done,
            timeout: timeoutReached,
            id
        };
    }

    await redisClient.disconnect();
}

export async function destroyConsumerGroup(consumerGroupId: string) {
    const redisClient = await createRedisClient();
    await redisClient.xGroupDestroy(REDIS_COMPLETION_QUEUE, consumerGroupId);
    await redisClient.disconnect();
}

export async function sendCompletionRequest(message: ChatCompletionRequestQueueMessage) {
    const redisClient = await createRedisClient();
    await sendMessage(redisClient, REDIS_REQUEST_QUEUE, JSON.stringify(message), REDIS_REQUEST_CONSUMER_GROUP, false);
    await redisClient.disconnect();
}

export async function startServer() {
    const [requestReaderClient, completionSenderClient] = await Promise.all([createRedisClient(),createRedisClient()] as const);
    startRequestReceiver(requestReaderClient, completionSenderClient, openai, logger);
}