import { ChatCompletionRequestMessageRoleEnum } from "openai";
import { ItemResultsReplacement, PromptReplacementTransformer, PipelineItemConfigPrompt, PipelineItemPromptReplacement } from "./config";

export function literal(str: string) {
    return () => ({
        value: str
    });
}

export function prevResultNth(n: number, regexMatch?: string | RegExp, regexMatchIndex: number = 0) {
    return (prevPipelineItemIds: string[]) : ItemResultsReplacement => ({
        prevItemId: prevPipelineItemIds[n],
        ...regexMatch instanceof RegExp ? { 
            regexMatch: [regexMatch.source, regexMatch.flags] 
        } : typeof regexMatch === 'string' ? {
            regexMatch: [regexMatch, '']
        } : {},
        regexMatchIndex
    });
}

export function prevResult(regexMatch?: string | RegExp, regexMatchIndex: number = 0) {
    return prevResultNth(0, regexMatch, regexMatchIndex);
}

function prompt(roleName: ChatCompletionRequestMessageRoleEnum) {
    return (strings: TemplateStringsArray, ...values: Array<string | PromptReplacementTransformer>) => {
        return (prevPipelineItemIds: string[]) : PipelineItemConfigPrompt => {
            return {
                role: roleName,
                replacements: strings.reduce((replacements, str, i) => {
                    return [
                        ...replacements,
                        literal(str)(),
                        ...typeof values[i] === 'function' ? [ 
                            (values[i] as PromptReplacementTransformer)(prevPipelineItemIds) 
                        ] : typeof values[i] === 'string' ? [
                            literal(values[i] as string)()
                        ] : []
                    ]
                }, [] as PipelineItemPromptReplacement[])
            };
        };
    }
}

export const userPrompt = prompt('user');
export const systemPrompt = prompt('system');
export const assistantPrompt = prompt('assistant');