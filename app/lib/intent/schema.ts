import { ChatCompletionFunctions } from "openai";
import { intent } from ".";
import { property, string, array, items, requiredObject, number, anyOf, option, describe } from "../../../ai-queue/jsonSchema";

const setName = (context: string) => intent('setName')(
    property('name')(
        string(
            describe(`the name of the ${context}`)
        ),
    ),
    describe(`The name of the ${context} has been set`)
);

const setProperties = (context: string) => intent('setProperties')(
    describe(`Properties have been set for the ${context}, excluding the name of the ${context}.`),
    property('properties')(
        array(
            items(
                requiredObject(
                    property('propertyName')(
                        string(
                            describe(`The name of the property. Must be plain English, as short as possible, without camel case. No special characters or numbers. Spaces are allowed. Cannot represent the name of the ${context}. Cannot represent a boolean value.`)
                        )
                    ),
                    property('propertyValue')(
                        string(
                            describe('The value of the property. Must be short but descriptive, without grammar or punctuation. Boolean values are not allowed. For multiple values, concatenate the values with commas, and space them.')
                        )
                    )
                )
            ),
            describe(`The properties of the ${context} to set`,)
        )
    )
);

const addTraits = (context: string) => intent('addTraits')(
    describe(`Miscellaneous traits have been added to the ${context}`),
    property('traits')(
        array(
            items(
                string(
                    describe(`The miscellaneous trait describing the ${context}. The trait must be short but descriptive. The trait must make sense on its own. Do not combine multiple traits into a single string.`)
                )
            )
        )
    )
);

const removeProperties = (context: string) => intent('removeProperties')(
    describe(`Remove properties from the ${context}`),
    property('propertyNames')(
        array(
            items(
                string(
                    describe( `The name of the property to remove. Refer to the up-to-date ${context} information to determine this.`)
                )
            )
        )
    )
);

const removeTraits = (context: string) => intent('removeTraits')(
    describe(`Remove miscellaneous traits from the ${context}`),
    property('traitIndices')(
        array(
            items(
                number(
                    describe(`Index of the trait to remove. Refer to the up-to-date ${context} information to determine this.`)
                )
            )
        )
    )
);
const replaceTraits = (context: string) => intent('replaceTraits')(
    describe(`Replace the values of the miscellaneous traits of the ${context} at the given indices`),
    property('traitReplacements')(
        array(
            items(
                requiredObject(
                    describe('Index of the trait to replace, and its new value'),
                    property('traitIndex')(
                        number(
                            describe(`Index of the trait. Refer to the up-to-date ${context} information to determine this.`)
                        )
                    ),
                    property('newValue')(
                        string(
                            describe('The value that the trait at the given index should be replaced with. Must shortened but descriptive, without grammar or punctuation. Must make sense on its own.')
                        )
                    )
                )
            ),
            describe(`The indices of the traits of the ${context} to replace, along with their replacement values`)
        )
    )
);

export const generateIntentsSchema = (context: string) : ChatCompletionFunctions => ({
    name: 'generateIntents',
    description: `Generate the intents inferred from statements regarding a ${context}`,
    parameters: requiredObject(
        property('intents')(
            array(
                describe(`All intents inferred from statements regarding a ${context}`),
                items(
                    anyOf(
                        option(setName(context)),
                        option(setProperties(context)),
                        option(addTraits(context)),
                        option(removeProperties(context)),
                        option(removeTraits(context)),
                        option(replaceTraits(context))
                    )
                )
            )
        )
    )
});
