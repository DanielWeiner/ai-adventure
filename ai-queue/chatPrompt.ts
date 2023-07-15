import { ChatCompletionRequestMessage, ChatCompletionRequestMessageRoleEnum } from "openai";

export function prompt(role: ChatCompletionRequestMessageRoleEnum){
    return function(strings: TemplateStringsArray, ...values: Array<string>) : ChatCompletionRequestMessage {
        let content = '';
        for (let i = 0; i < strings.length; i++) {
            content += strings[i];
            if (values[i]) {
                content += values[i];
            }
        }

        content = content
            .trim()
            .replace(/[^\S\r\n]*([\r\n])[^\S\r\n]*/g, '$1')
            .replace(/[^\S\r\n]+/g, ' ');

        return {
            role,
            content
        };
    }
}

export const systemPrompt = prompt('system');
export const userPrompt = prompt('user');
export const assistantPrompt = prompt('assistant');
export const functionPrompt = prompt('function');