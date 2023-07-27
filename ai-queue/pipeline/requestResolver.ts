import ChatCompleter from "../chatCompleter";
import { ChatCompletionRequestMessage, OpenAIApi } from "openai";
import { RedisClientType } from "redis";
import { ItemResultsReplacement, PipelineItemConfigPrompt, PipelineItemRequestConfig } from "./config";
import { PipelineItem } from "./pipelineItem";
import { Logger } from "winston";
import { Pipeline } from "./pipeline";
import { 
    PIPELINE_ITEM_EVENT_BEGIN, 
    PIPELINE_ITEM_EVENT_END,
    PIPELINE_ITEM_EVENT_CONTENT, 
    PIPELINE_REQUESTS_CONSUMER_GROUP, 
    PIPELINE_REQUESTS_QUEUE 
} from "./constants";
import { buildPrompt } from "./prompt";


export class RequestResolver {
    readonly #redisClient : RedisClientType;
    readonly #openAi : OpenAIApi;
    readonly #logger : Logger;

    constructor(redisClient: RedisClientType, openAi: OpenAIApi, logger: Logger) {
        this.#redisClient = redisClient;
        this.#openAi = openAi;
        this.#logger = logger;
    }

    async resolveRequest(messageId: string, pipelineId: string, itemId: string, request: PipelineItemRequestConfig) {
        const autoConfirm = request.autoConfirm ?? true;
        const replacements = typeof request.systemMessage === 'object' && request.systemMessage ? [...request.systemMessage?.replacements || []] : [];
        for (const message of request.messages) {
            if ('replacements' in message) {
                replacements.push(...message.replacements);
            }
        }
        const prevIds = [...new Set(
            replacements
                .filter(item => (item as ItemResultsReplacement).prevItemId)
                .map(item => (item as ItemResultsReplacement).prevItemId)
        )];

        const prevContents = prevIds.length ? await this.#redisClient.mGet(prevIds.map(PipelineItem.calculateContentKey)) : [];
        const idsContents = prevIds.reduce((obj, id, i) => ({
            ...obj,
            [id]: prevContents[i] || ''
        }), {} as { [key in string]: string });

        const pipelineKey = Pipeline.calculateRedisKey(pipelineId);
        const pipelineStr = await this.#redisClient.get(pipelineKey);

        if (!pipelineStr) {
            this.#logger.warn(`could not find pipeline ${pipelineKey}.`);
            return;
        }

        const pipeline = Pipeline.fromString(pipelineStr);
        const item = pipeline.getItem(itemId);
        if (!item) {
            this.#logger.warn(`pipeline item id ${itemId} not found in pipeline ${pipeline.getId()}`);
            return;
        }

        const toPrompt = buildPrompt.bind(null, idsContents);
        
        const completer = new ChatCompleter(this.#openAi, this.#logger)
            .configure(request.configuration || {})
            .addFunctions(...request.functions || [])
            .setSystemMessage(
                typeof request.systemMessage === 'string' ? toPrompt({ role: 'user', content: request.systemMessage }).content : 
                request.systemMessage ? toPrompt(request.systemMessage).content 
                : ''
            );

        await this.#redisClient.xAdd(item.calculateStreamKey(), '*', { content: '', event: PIPELINE_ITEM_EVENT_BEGIN })
        if (request.kind === 'stream') {
            try {
                for await (const { content } of completer.generateChatCompletionDeltas(request.messages.map(toPrompt) as any)) {
                    await this.#redisClient
                        .multi()
                            .append(item.calculateContentKey(), content)
                            .xAdd(item.calculateStreamKey(), '*', { content, event: PIPELINE_ITEM_EVENT_CONTENT })
                        .exec();
                }
                await this.#finishRequest(messageId, item, autoConfirm);
            } catch (e:any) {
                this.#logger.warn(`error while executing request: ${e.stack}`);
            }
        } else if (request.kind === 'function') {
            try {
                const content = JSON.stringify(await completer.createFunctionCallCompletion(request.messages.map(toPrompt) as any, request.functionName));
                await this.#redisClient
                    .multi()
                        .append(item.calculateContentKey(), content)
                        .xAdd(item.calculateStreamKey(), '*', { content, event: PIPELINE_ITEM_EVENT_CONTENT })
                    .exec();
                await this.#finishRequest(messageId, item, autoConfirm);
            } catch(e: any) {
                this.#logger.warn(`error while executing request: ${e.stack}`);

            }
        } else {
            try {
                const content = await completer.createChatCompletion(request.messages.map(toPrompt) as any);
                await this.#redisClient
                    .multi()
                        .append(item.calculateContentKey(), content)
                        .xAdd(item.calculateStreamKey(), '*', { content, event: PIPELINE_ITEM_EVENT_CONTENT })
                    .exec();
                await this.#finishRequest(messageId, item, autoConfirm);
            } catch (e: any) {
                this.#logger.warn(`error while executing request: ${e.stack}`);
            }
        }
    }

    async #finishRequest(messageId: string, item: PipelineItem, autoConfirm: boolean) {
        this.#logger.info(`request ${item.getAlias()} of pipeline ${item.getPipelineId()} finished with content: ${JSON.stringify(await item.getContent())}`)

        await this.#redisClient.multi()
            .xAdd(item.calculateStreamKey(), '*', { content: '', event: PIPELINE_ITEM_EVENT_END })
            .xAck(PIPELINE_REQUESTS_QUEUE, PIPELINE_REQUESTS_CONSUMER_GROUP, messageId)
        .exec();

        if (autoConfirm) {
            await item.confirmCompleted(this.#redisClient);
        }
    }
}