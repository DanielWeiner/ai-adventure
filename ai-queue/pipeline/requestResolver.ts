import ChatCompleter from "../chatCompleter";
import { ChatCompletionRequestMessage, OpenAIApi } from "openai";
import { RedisClientType } from "redis";
import { ItemResultsReplacement, PipelineItemConfigPrompt, PipelineItemRequestConfig } from "./config";
import { PipelineItem } from "./pipelineItem";
import { Logger } from "winston";
import { Pipeline } from "./pipeline";
import { 
    PIPELINE_ITEMS_QUEUE, 
    PIPELINE_ITEM_EVENT_BEGIN, 
    PIPELINE_ITEM_EVENT_END,
    PIPELINE_ITEM_EVENT_CONTENT, 
    PIPELINE_REQUESTS_CONSUMER_GROUP, 
    PIPELINE_REQUESTS_QUEUE 
} from "./constants";


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

        const toPrompt = (prompt: PipelineItemConfigPrompt | ChatCompletionRequestMessage) => ({
            role: prompt.role,
            content: 'content' in prompt ? prompt.content || '' : (prompt as PipelineItemConfigPrompt).replacements.map(replacement => {
                if ('value' in replacement) return replacement.value;
                if (replacement.regexMatch) {
                    const regex = new RegExp(replacement.regexMatch[0], replacement.regexMatch[1]);
                    const match = idsContents[replacement.prevItemId].match(regex)
                    if (match === null) return '';
                    return match[replacement.regexMatchIndex ?? 0] || '';
                }
                return idsContents[replacement.prevItemId];
            }).join('')
        });

        const completer = new ChatCompleter(this.#openAi, this.#logger)
            .configure(request.configuration || {})
            .addFunctions(...request.functions || [])
            .setSystemMessage(
                typeof request.systemMessage === 'string' ? request.systemMessage : 
                request.systemMessage ? toPrompt(request.systemMessage).content 
                : ''
            );
    
        await this.#redisClient.xAdd(item.calculateStreamKey(), '*', { content: '', event: PIPELINE_ITEM_EVENT_BEGIN })
        if (request.kind === 'stream') {
            for await (const { content } of completer.generateChatCompletionDeltas(request.messages.map(toPrompt))) {
                await this.#redisClient
                    .multi()
                        .append(item.calculateContentKey(), content)
                        .xAdd(item.calculateStreamKey(), '*', { content, event: PIPELINE_ITEM_EVENT_CONTENT })
                    .exec();
            }
            await this.#finishRequest(messageId, pipeline, item);
        } else if (request.kind === 'function') {
            const content = JSON.stringify(await completer.createFunctionCallCompletion(request.messages.map(toPrompt), request.functionName));
            await this.#redisClient
                .multi()
                    .append(item.calculateContentKey(), content)
                    .xAdd(item.calculateStreamKey(), '*', { content, event: PIPELINE_ITEM_EVENT_CONTENT })
                .exec();
            await this.#finishRequest(messageId, pipeline, item);
        } else {
            const content = await completer.createChatCompletion(request.messages.map(toPrompt));
            await this.#redisClient
                .multi()
                    .append(item.calculateContentKey(), content)
                    .xAdd(item.calculateStreamKey(), '*', { content, event: PIPELINE_ITEM_EVENT_CONTENT })
                .exec();
            await this.#finishRequest(messageId, pipeline, item);
        }
    }

    async #finishRequest(messageId: string, pipeline: Pipeline, item: PipelineItem) {
       
        this.#logger.info(`request ${item.getAlias()} of pipeline ${item.getPipelineId()} finished with content: ${await item.getContent()}`)
        
        await this.#redisClient.multi()
                .set(item.calculateDoneKey(), '1')
                .xAdd(item.calculateStreamKey(), '*', { content: '', event: PIPELINE_ITEM_EVENT_END })
                .publish(item.calculateDoneChannel(), '1')
            .exec();

        const nextItems = item.getNextIds().map(id => pipeline.getItem(id)!);

        if (nextItems.length) {
            const multi = this.#redisClient.multi();
            for (const item of nextItems) {
                multi.decr(item.calculatePrevIdsKey());
            }

            const results = await multi.exec() as number[];
            const requestsToTrigger = nextItems.filter((_, i) => !results[i]);
            
            if (requestsToTrigger.length) {
                const multi = this.#redisClient.multi();
                await new Promise(resolve => setTimeout(resolve, 10));
                for (const item of requestsToTrigger) {
                    multi.xAdd(PIPELINE_ITEMS_QUEUE, '*', {
                        pipelineId: item.getPipelineId(),
                        itemId:     item.getId()
                    });
                }
                await multi.exec();
            }
        }

        await this.#redisClient.xAck(PIPELINE_REQUESTS_QUEUE, PIPELINE_REQUESTS_CONSUMER_GROUP, messageId);
    }
}