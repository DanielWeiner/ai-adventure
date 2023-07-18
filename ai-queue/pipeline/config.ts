import { ChatCompletionFunctions, ChatCompletionRequestMessage, ChatCompletionRequestMessageRoleEnum, CreateChatCompletionRequest } from "openai";
import { v4 as uuid } from 'uuid';

export interface PipelineItemConfigPrompt {
    role:         ChatCompletionRequestMessageRoleEnum;
    replacements: PipelineItemPromptReplacement[];
}

export interface ItemResultsReplacement {
    prevItemId: string;
    regexMatch?:      [string, string];
    regexMatchIndex?: number;
}

export interface StringLiteralReplacement {
    value: string;
}

export type PipelineItemPromptReplacement = ItemResultsReplacement | StringLiteralReplacement;
export type PromptReplacementTransformer = (prevPipelineItemIds: string[]) => PipelineItemPromptReplacement;
type PromptConfigTransformer = (prevPipelineItemIds: string[]) => PipelineItemConfigPrompt;

export interface PipelineItemRequestConfig {
    id:             string;
    alias:          string;
    kind:           'function' | 'message' | 'stream';
    messages:       (PipelineItemConfigPrompt | ChatCompletionRequestMessage)[];
    systemMessage?: PipelineItemConfigPrompt | string;
    functionName?:  string;
    functions?:     ChatCompletionFunctions[];
    configuration?: Partial<Omit<CreateChatCompletionRequest, 'messages' | 'stream'>>;    
}

type PipelineItemRequestInput = Omit<PipelineItemRequestConfig, 'messages' | 'systemMessage' | 'id'> & {
    messages:       (PromptConfigTransformer | ChatCompletionRequestMessage)[];
    systemMessage?: PromptConfigTransformer | ChatCompletionRequestMessage | string;
    alias?:         string;
}

interface PipelineItemSingleConfig {
    request: PipelineItemRequestInput;
}

interface PipelineItemParallelConfig {
    parallel: PipelineItemConfig[];
}

interface PipelineItemSequenceConfig {
    sequence: PipelineItemConfig[];
}

export type PipelineItemConfig = PipelineItemSequenceConfig | PipelineItemParallelConfig | PipelineItemSingleConfig;

type CollectionItemConfig = {
    [key in string]: {
        prevIds: string[];
        request: PipelineItemRequestConfig;
    }
}

interface PipelineConfigItem {
    getIds(): string[];
    toCollectionItemConfig(prevIds: string[]): CollectionItemConfig;
}

class PipelineItemSequence implements PipelineConfigItem {
    readonly #pipelineItems: PipelineConfigItem[];

    constructor(pipelineItems: PipelineConfigItem[]) {
        if (pipelineItems.length === 0) {
            throw new Error('Cannot create an empty pipeline sequence.');
        }
        this.#pipelineItems = pipelineItems;
    }

    getIds(): string[] {
        return this.#pipelineItems[this.#pipelineItems.length - 1].getIds();
    }

    toCollectionItemConfig(prevIds: string[]): CollectionItemConfig {
        return this.#pipelineItems.reduce((config, item, i) => {
            return {
                ...config,
                ...item.toCollectionItemConfig(i === 0 ? prevIds : this.#pipelineItems[i - 1].getIds())
            };
        }, {} as CollectionItemConfig);
    }
}

class PipelineItemParallel implements PipelineConfigItem {
    readonly #pipelineItems: PipelineConfigItem[];

    constructor(pipelineItems: PipelineConfigItem[]) {
        if (pipelineItems.length === 0) {
            throw new Error('Cannot create an empty parallel pipeline.');
        }
        this.#pipelineItems = pipelineItems;
    }

    getIds(): string[] {
        return this.#pipelineItems.reduce((ids, pipelineItem) => [
            ...ids,
            ...pipelineItem.getIds()
        ], [] as string[]);
    }

    toCollectionItemConfig(prevIds: string[]): CollectionItemConfig {
        return this.#pipelineItems.reduce((config, item) => {
            return {
                ...config,
                ...item.toCollectionItemConfig(prevIds)
            };
        }, {} as CollectionItemConfig);
    }
}

class PipelineItemSingle implements PipelineConfigItem {
    readonly #requestInput: PipelineItemRequestInput;
    readonly #id : string = uuid();

    constructor(requestInput: PipelineItemRequestInput) {
        this.#requestInput = requestInput;
    }

    getIds(): string[] {
        return [this.#id];
    }

    toCollectionItemConfig(prevIds: string[]): CollectionItemConfig {
        return {
            [this.#id]: {
                prevIds: prevIds,
                request: {
                    ...this.#requestInput,
                    id: this.#id,
                    alias: this.#requestInput.alias || this.#id,
                    messages: this.#requestInput.messages
                        .map(transformer => typeof transformer === 'function' ? transformer(prevIds) : transformer),
                    systemMessage: 
                        typeof this.#requestInput.systemMessage === 'function' ?
                            this.#requestInput.systemMessage(prevIds) :
                        typeof this.#requestInput.systemMessage === 'string' ? 
                            this.#requestInput.systemMessage :
                        typeof this.#requestInput.systemMessage === 'object' && this.#requestInput.systemMessage ? this.#requestInput.systemMessage.content!
                            : undefined
                }
            }
        }
    }
}

export function toConfigItem(config: PipelineItemConfig) : PipelineConfigItem {
    if ('sequence' in config) {
        return new PipelineItemSequence(config.sequence.map(item => toConfigItem(item)));
    } else if ('parallel' in config) {
        return new PipelineItemParallel(config.parallel.map(item => toConfigItem(item)));
    } else if ('request' in config) {
        return new PipelineItemSingle(config.request);
    } else {
        throw new Error('Invalid pipeline config');
    }
}