import { ChatCompletionRequestMessageRoleEnum } from "openai";
import { transform, pipelined, stringify } from "./dataTransform";

export function prompt(role: ChatCompletionRequestMessageRoleEnum) {
    return (strings: TemplateStringsArray, ...values: any) => {
        return transform({
            role,
            content: pipelined(strings, ...values)
        });
    }
}

export function functionCallPrompt(functionName: string, args: any) {
    return transform({
        role:          'assistant',
        content:       null,
        function_call: {
            name:      functionName,
            arguments: stringify(args)
        }
    });
}

export const userPrompt = prompt('user');
export const systemPrompt = prompt('system');
export const assistantPrompt = prompt('assistant');