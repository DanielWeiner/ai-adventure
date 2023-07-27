import { PipelineItemConfig } from "@/ai-queue/pipeline/config";
import { userPrompt, prevResult, assistantPrompt } from "@/ai-queue/pipeline/prompt";
import { generateIntentsSchema } from "./schema";
import { RELEVANT_INFO_FUNCTION_NAME, RelevantInformation, generateRelevantInfoJson, getRelevantInfoSchema } from "../relevant-info/schema";

const splitSentencePrefix = 'SECOND STAGE';

export function createIntentDetectionPrompt(relevantInfo: RelevantInformation) : PipelineItemConfig {
    return {
        request: {
            alias: 'intentDetection',
            kind: 'function',
            functionName: 'generateIntents',
            functions: [
                generateIntentsSchema(relevantInfo.type),
                getRelevantInfoSchema(relevantInfo.type)
            ],
            systemMessage: `
                You are an intent classifier.

                General rules:
                - Do not generate redundant intents. 
                - Try to infer intents for all user-provided information, no matter how minor.
                - Only use the information provided by the user.
                - The intent content must closely match the information provided by the user.

                Definitions:
                - Properties are named qualities of a ${relevantInfo.type}, expressed as name-value pairs.
                - Properties cannot have empty names or empty values.
                - Traits are miscellaneous qualities of a ${relevantInfo.type} that can't be expressed as name-value pairs.
                - Traits cannot be empty.

                Rules for the "setProperties" intent:
                - Output the "setProperties" intent if the user intends to set any named qualities of the ${relevantInfo.type}.
                - Property names must be plain English, as short as possible.
                - Property names must not use camel case.
                - Property names must not have special characters or numbers. 
                - Property names may have spaces. 
                - Properties must not represent the name of the ${relevantInfo.type}; instead, use the "setName" intent.
                - Properties must be short but descriptive.
                - Properties may not be boolean.
                - Property names must not be duplicated. 
                - If a single property has multiple values, concatenate the values with commas and space them.

                Rules for the "addTraits" intent:
                - Output the "addTraits" intent if the user intends to add any unnamed, miscellaneous qualities to the ${relevantInfo.type}.
                - Each trait must be short but descriptive. 
                - Each trait must make sense on its own without context from other traits.
                - Do not combine multiple traits into a single string.

                Rules for the "setName" intent:
                - Output the "setName" intent if the user intends to set the name of the ${relevantInfo.type}.

                Rules for the "replaceTraits" intent:
                - Output the "replaceTraits" intent if the user intends to replace an unnamed, miscellaneous trait of the ${relevantInfo.type}.
                - Replaced traits should follow the same formatting rules as "addTraits".
            `,
            messages: [
                { role: 'assistant', function_call: { name: RELEVANT_INFO_FUNCTION_NAME, arguments: generateRelevantInfoJson(relevantInfo)  } },
                userPrompt`${prevResult(new RegExp(`^(?:(?:.|[\\r\\n])*(?=${splitSentencePrefix})${splitSentencePrefix})?((?:.|[\\r\\n])*)$`), 1)}`
            ],
            autoConfirm: false
        }
    }
}
