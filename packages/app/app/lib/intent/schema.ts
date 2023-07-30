import { ChatCompletionFunctions } from "openai";
import { intent } from ".";
import { property, string, array, items, requiredObject, number, anyOf, option, describe } from "ai-queue/jsonSchema";

const setName = (context: string) => intent('setName')(
    describe(`The name of the ${context} has been set.`),
    property('name')(
        string(
            describe(`The new name of the ${context}`)
        ),
    )
);

const setProperties = (context: string) => intent('setProperties')(
    describe(`Properties have been set for the ${context}, excluding the name of the ${context}.`),
    property('properties')(
        array(
            items(
                requiredObject(
                    property('propertyName')(
                        string(
                            describe(`The name of the property`)
                        )
                    ),
                    property('propertyValue')(
                        string(
                            describe('The non-empty value of the property')
                        )
                    )
                )
            )
        )
    )
);

const addTraits = (context: string) => intent('addTraits')(
    describe(`Miscellaneous traits have been added to the ${context}`),
    property('traits')(
        array(
            items(
                string(
                    describe(`The added trait`)
                )
            )
        )
    )
);

const removeProperties = (context: string) => intent('removeProperties')(
    describe(`Properties have been removed from the ${context}`),
    property('propertyNames')(
        array(
            items(
                string(
                    describe(`The name of the property to remove. Refer to the up-to-date ${context} information to determine this.`)
                )
            )
        )
    )
);

const removeTraits = (context: string) => intent('removeTraits')(
    describe(`Traits have been removed from the ${context}`),
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
                            describe('The value that the trait at the given index should be replaced with')
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
