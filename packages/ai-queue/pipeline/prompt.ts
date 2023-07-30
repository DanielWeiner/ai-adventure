import { ChatCompletionRequestMessage, ChatCompletionRequestMessageRoleEnum } from "openai";
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

export const buildPrompt = (contentById: { [key in string]: string; }, prompt: PipelineItemConfigPrompt | ChatCompletionRequestMessage) => {
    return {
        role: prompt.role,
        ...'function_call' in prompt ? { function_call: prompt.function_call } : {},
        ...(('content' in prompt && typeof prompt.content === 'string') || 'replacements' in prompt) ? {
            content: (
                'replacements' in prompt ? 
                    (prompt as PipelineItemConfigPrompt).replacements.map(replacement => {
                        if ('value' in replacement) return replacement.value;
                        if (replacement.regexMatch) {
                            const regex = new RegExp(replacement.regexMatch[0], replacement.regexMatch[1]);
                            const match = contentById[replacement.prevItemId].match(regex)
                            if (match === null) return '';
                            return match[replacement.regexMatchIndex ?? 0] || '';
                        }
                        return contentById[replacement.prevItemId];
                    }).join('')
                : prompt.content || '' 
            )
            .trim()
            .replace(/[^\S\r\n]*([\r\n]+)[^\S\r\n]*/gm, '$1')
            .replace(/[^\S\r\n]+/gm, ' ')
        } : { content: null }
    };
}

export const userPrompt = prompt('user');
export const systemPrompt = prompt('system');
export const assistantPrompt = prompt('assistant');