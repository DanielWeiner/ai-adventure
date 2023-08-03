import ChatCompleter from "../chatCompleter";
import { OpenAIApi } from "openai";
import { RedisClientType } from "redis";
import { PipelineItemRequestConfig } from "./config";
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
import { DataTransformConfigValue, findRequiredReferences, hydrate } from "./dataTransform";

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
        const pipeline = await Pipeline.fromId(pipelineId, this.#redisClient);
        
        if (!pipeline) {
            this.#logger.warn(`could not find pipeline ${pipelineId}.`);
            return;
        }

        const item = pipeline.getItem(itemId);
        if (!item) {
            this.#logger.warn(`pipeline item id ${itemId} not found in pipeline ${pipeline.getId()}`);
            return;
        }

        const refs = findRequiredReferences([
            ...request.systemMessage ? [request.systemMessage] : [],
            ...request.messages
        ]);

        const prevIds = item.getPrevIds();
        const idsFromIndices = refs.idIndices.map(index => prevIds[index]);
        const idsFromAliases = refs.aliases
            .map(alias => ({ 
                alias, 
                id: pipeline.getItemByRequestAlias(alias)?.getId()! 
            }))
            .filter(({ id }) => id);
        
        const idsByAlias = idsFromAliases.reduce((obj, { alias, id }) => ({ 
            ...obj,
            [alias]: id
        }), {} as Record<string, string>);

        const allIds = [...new Set([...idsFromIndices, ...idsFromAliases.map(({ id }) => id)])];
        
        const prevContents = allIds.length ? await this.#redisClient.mGet(allIds.map(PipelineItem.calculateContentKey)) : [];
        const contentById = allIds.reduce((obj, id, i) => ({
            ...obj,
            [id]: prevContents[i] || ''
        }), {} as { [key in string]: string });

        const hydratePrompt = (prompt: DataTransformConfigValue) => {
            const hydratedPrompt = hydrate({
                idsByAlias,
                contentById,
                data: prompt,
                prevIds
            });

            if (typeof hydratedPrompt.content === 'string') {
                return {
                    ...hydratedPrompt,
                    content: hydratedPrompt.content
                        .trim()
                        .replace(/[^\S\r\n]*([\r\n]+)[^\S\r\n]*/gm, '$1')
                        .replace(/[^\S\r\n]+/gm, ' ')
                };
            }

            return hydratedPrompt;
        };
        
        const completer = new ChatCompleter(this.#openAi, this.#logger)
            .configure(request.configuration || {})
            .addFunctions(...request.functions || [])
            .setSystemMessage(
                request.systemMessage ? hydratePrompt(request.systemMessage).content
                : ''
            );

        await this.#redisClient.xAdd(item.calculateStreamKey(), '*', { content: '', event: PIPELINE_ITEM_EVENT_BEGIN })
        if (request.kind === 'stream') {
            try {
                for await (const { content } of completer.generateChatCompletionDeltas(request.messages.map(hydratePrompt) as any)) {
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
                const content = JSON.stringify(await completer.createFunctionCallCompletion(request.messages.map(hydratePrompt) as any, request.functionName));
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
                const content = await completer.createChatCompletion(request.messages.map(hydratePrompt) as any);
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