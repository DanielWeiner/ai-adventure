import { ChatCompletionFunctions } from "openai";
import { property, string, array, items, requiredObject, anyOf, option, describe, nullType } from "../../../ai-queue/jsonSchema";

export type RelevantInformation = {
    type: string;
    name: string | null; 
    properties: { 
        [key in string]: string;
    }; 
    traits: string[];
}

export const RELEVANT_INFO_FUNCTION_NAME = 'establishRelevantInfo';

const relevantInfoSchema = (context: string) => requiredObject(
    describe(`the relevant info about the ${context}`),
    property('name')(
        anyOf(
            describe(`the name of the ${context}`),
            option(string()),
            option(nullType())
        )
    ),
    property('properties')(
        array(
            describe(`named qualities or characteristics of the ${context}`),
            items(
                requiredObject(
                    describe(`A key-value pair representing the name and value of a property of the ${context}`),
                    property('propertyName')(
                        string(
                            describe('name of the property')
                        )
                    ),
                    property('propertyValue')(
                        string(
                            describe('value of the property')
                        )
                    )
                )
            )
        )
    ),
    property('traits')(
        array(
            items(
                string(
                    describe(`unnamed, miscellaneous qualities or characteristics of the ${context}`),
                )
            )
        )
    ),
);



export const getRelevantInfoSchema = (context: string) : ChatCompletionFunctions => ({
    name:        RELEVANT_INFO_FUNCTION_NAME,
    description: `Establish the current relevant information regarding the ${context}.`,
    parameters:  relevantInfoSchema(context)
});

export function generateRelevantInfoJson({ name, properties, traits } : RelevantInformation) {
    return JSON.stringify({
        name: name || null,
        properties: [...Object.entries(properties)].map(([ key, value ]) => ({
            propertyName: key,
            propertyValue: value
        })),
        traits
    });
}