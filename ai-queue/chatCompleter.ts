import { IncomingMessage } from "http";
import { AxiosResponse } from "axios";
import { 
    ChatCompletionFunctions, 
    ChatCompletionRequestMessage, 
    ChatCompletionRequestMessageRoleEnum, 
    Configuration, 
    CreateChatCompletionRequest, 
    CreateChatCompletionResponse, 
    CreateChatCompletionResponseChoicesInner, 
    OpenAIApi 
} from "openai";
const { OPENAI_API_KEY } = process.env;

interface ChatCompletionStreamResponseDelta {
    content?: string;
    role?: ChatCompletionRequestMessageRoleEnum;
}

interface ChatCompletionStreamResponseChoices extends Omit<CreateChatCompletionResponseChoicesInner, 'message'> {
    delta: ChatCompletionStreamResponseDelta;
}

interface ChatCompletionStreamResponse extends Omit<CreateChatCompletionResponse, 'choices' | 'usage'> {
    choices: Array<ChatCompletionStreamResponseChoices>;
}

export default class ChatCompleter {
    #openAi : OpenAIApi;
    #systemMessage : string = "";
    #config : Omit<CreateChatCompletionRequest, 'messages' | 'stream'> = {
        model: 'gpt-3.5-turbo',
        temperature: 0
    };
    #functions : ChatCompletionFunctions[] = [];

    constructor(openAi: OpenAIApi = new OpenAIApi(new Configuration({ 
        apiKey: OPENAI_API_KEY 
    }))) {
        this.#openAi = openAi;
    }

    configure(config: Partial<Omit<CreateChatCompletionRequest, 'messages' | 'stream'>>) {
        this.#config = {
            ...this.#config,
            ...config
        };

        return this;
    }

    addFunctions(...functions: ChatCompletionFunctions[]) {
        this.#functions.push(...functions);

        return this;
    }

    setSystemMessage(systemMessage: string) {
        this.#systemMessage = systemMessage;

        return this;
    }

    async createFunctionCallCompletion(messages: ChatCompletionRequestMessage[], functionName?: string) : Promise<string> {
        const response = await this.#openAi.createChatCompletion({
            ...this.#createCompletionConfig(messages),
            ...functionName ? {
                function_call: {
                    name: functionName
                }
            } : null,
            functions: this.#functions
        });

        return response.data.choices[0].message?.function_call?.arguments || 'null';
    }

    async createChatCompletion(messages: ChatCompletionRequestMessage[]) : Promise<string> {
        const response = await this.#openAi.createChatCompletion(this.#createCompletionConfig(messages));

        return response.data.choices[0].message?.content || '';
    }

    async *generateChatCompletionDeltas(messages: ChatCompletionRequestMessage[]) : AsyncIterable<string> {
        const { data: stream } = await this.#openAi.createChatCompletion({
            ...this.#createCompletionConfig(messages),
            stream: true
        }, { responseType: 'stream' }) as unknown as AxiosResponse<IncomingMessage>;

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
                    break;
                }

                const eventJSON : ChatCompletionStreamResponse = JSON.parse(event);
                yield eventJSON.choices[0].delta.content || '';
            }
        }
    }

    #createCompletionConfig(messages: ChatCompletionRequestMessage[]) : CreateChatCompletionRequest {
        return {
            ...this.#config,
            messages: [
                ...this.#systemMessage ? [{ role: 'system', content: this.#systemMessage } as const] : [],
                ...messages
            ]
        };
    }
}