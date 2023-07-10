import 'dotenv/config';
import { ChatCompletionFunctions, ChatCompletionRequestMessage, Configuration, CreateChatCompletionRequest, OpenAIApi } from 'openai';
import ChatCompleter from './chatCompleter';
import { Logger, createLogger, format, transports } from 'winston';
import { RedisClientType, commandOptions, createClient } from 'redis';

const { REDIS_URL } = process.env;

interface ChatCompletionRequestQueueMessage {
    completionId:  string;
    kind:          'function' | 'message' | 'stream';
    messages:      ChatCompletionRequestMessage[];
    systemMessage?: string;
    functionName?: string;
    functions?:     ChatCompletionFunctions[];
    configuration?: Partial<Omit<CreateChatCompletionRequest, 'messages' | 'stream'>>
}

interface ChatCompletionResponseQueueMessage {
    content:       string;
    done:          boolean;
};

const STREAM_BATCH_SIZE = 10;
const STREAM_BLOCK_TIME = 2000;

export const REDIS_REQUEST_QUEUE = 'AiqRequests';
export const REDIS_REQUEST_CONSUMER_GROUP = 'RequestConsumerGroup';
export const REDIS_COMPLETION_QUEUE = 'AiqCompletions';

const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);
const logger = createLogger({
    transports: [
        new transports.Console({
            format: format.combine(
                format.timestamp(),
                format.simple()
            )
        })
    ],
});


export async function* watchStream(redisClient: RedisClientType, key: string, group: string, isDone: () => boolean = () => false) {
    type CommandPromiseInput = string[] | null;

    let resolveFn: (val: CommandPromiseInput) => void = () => {};
    let promise : Promise<CommandPromiseInput>;
    const resetPromise = () => {
        promise = new Promise<CommandPromiseInput>(resolve => { 
            resolveFn = resolve;
        });
    };

    resetPromise();
    
    async function* iteratePromises() : AsyncGenerator<string> {
        while (!isDone()) {
            const messages = await promise;
            if (messages === null) return;

            resetPromise();

            for (const message of messages) {
                yield message;
            }
        }
    }

    let iterable = iteratePromises();

    (async () => {
        const groupInfo = await redisClient.xInfoGroups(key);
        if (!groupInfo.some(({ name }) => name === group)) {
            await redisClient.xGroupCreate(key, group, '0', { MKSTREAM: true });
        }
        
        while (!isDone()) {
            try {
                const response = await redisClient.xReadGroup(commandOptions({ isolated: true }), group, group, [
                    {
                        key,
                        id: '>',
                    }
                ], {
                    COUNT: STREAM_BATCH_SIZE,
                    BLOCK: STREAM_BLOCK_TIME
                });

                if (!response?.[0]?.messages?.length) {
                    continue;
                }

                const messages = response[0].messages.filter(({ message }) => message.group === group);
                if (!messages.length) return;
                for (const message of messages) {
                    logger.info(`recieved ${JSON.stringify(message)} from ${key}.`);
                }

                const messageIds = messages.map(({ id }) => id);
                await redisClient.xAck(key, group, messageIds);

                resolveFn(messages.map(({ message }) => message.content ));
            } catch(e: any) {
                logger.error(e, e.stack);
                resolveFn(null);
                return;
            }
        }
    })();
    
    yield* iterable;
}


export async function sendMessage(redisClient: RedisClientType, key: string, content: string, group: string) {
    await redisClient.xAdd(key, '*', { content, group });
    logger.info(`sent ${JSON.stringify({ content, group })} to ${key}.`);
};

async function processCompletionRequest(openai: OpenAIApi, redisClient: RedisClientType, completionRequest : ChatCompletionRequestQueueMessage) {
    const completer = new ChatCompleter(openai)
        .configure(completionRequest.configuration || {})
        .addFunctions(...completionRequest.functions || [])
        .setSystemMessage(completionRequest.systemMessage || '');
    
    if (completionRequest.kind === 'stream') {
        for await (const delta of completer.generateChatCompletionDeltas(completionRequest.messages)) {
            await sendMessage(redisClient, REDIS_COMPLETION_QUEUE, JSON.stringify({ content: delta, done: false }), completionRequest.completionId);
        }
        await sendMessage(redisClient, REDIS_COMPLETION_QUEUE, JSON.stringify({ content: '', done: true }), completionRequest.completionId);
    } else if (completionRequest.kind === 'function') {
        const message = await completer.createFunctionCallCompletion(completionRequest.messages, completionRequest.functionName);
        await sendMessage(redisClient, REDIS_COMPLETION_QUEUE, JSON.stringify({ content: message, done: true }), completionRequest.completionId);
    } else {
        const message = await completer.createChatCompletion(completionRequest.messages);
        await sendMessage(redisClient, REDIS_COMPLETION_QUEUE, JSON.stringify({ content: message, done: true }), completionRequest.completionId);
    }
}

async function startRequestReceiver(requestReaderClient: RedisClientType, completionSenderClient: RedisClientType, openai: OpenAIApi, logger: Logger) {
    logger.info(`AI queue processor listening to ${REDIS_REQUEST_QUEUE}.`);

    for await (const message of watchStream(requestReaderClient, REDIS_REQUEST_QUEUE, REDIS_REQUEST_CONSUMER_GROUP)) {
        try {
            const completionRequest : ChatCompletionRequestQueueMessage = JSON.parse(message);
            
            processCompletionRequest(openai, completionSenderClient, completionRequest).catch(e => logger.error(e));
        } catch(e : any) {
            logger.error(e);
            break;
        }
    }
}

const createRedisClient = async () => {
    const client : RedisClientType = createClient({
        url: REDIS_URL
    })
    await client.connect();

    return client;
}

export async function* watchCompletionStream(group: string) {
    const redisClient = await createRedisClient();
    let done = false;
    const isDone = () => done;
    for await (const message of watchStream(redisClient, REDIS_COMPLETION_QUEUE, group, isDone)) {
        const response : ChatCompletionResponseQueueMessage = JSON.parse(message);
        if (response.done) {
            done = true;
        }
        if (response.content) yield response.content;
    }
    await redisClient.xGroupDestroy(REDIS_COMPLETION_QUEUE, group);
    await redisClient.disconnect();
}

export async function sendCompletionRequest(message: ChatCompletionRequestQueueMessage) {
    const redisClient = await createRedisClient();
    await sendMessage(redisClient, REDIS_REQUEST_QUEUE, JSON.stringify(message), REDIS_REQUEST_CONSUMER_GROUP);
    await redisClient.disconnect();
}

export async function startServer() {
    const [requestReaderClient, completionSenderClient] = await Promise.all([
        createRedisClient(),
        createRedisClient()
    ] as const);
    startRequestReceiver(requestReaderClient, completionSenderClient, openai, logger);
}