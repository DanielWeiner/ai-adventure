import { requiredObject, property, string, enumVals, object } from "ai-queue/jsonSchema";

export interface SetNameIntent {
    quote: string;
    intentName: 'setName';
    value: {
        name: string;
    }
}

export interface SetPropertiesIntent {
    quote: string;
    intentName: 'setProperties';
    value: {
        properties: Array<{
            propertyName: string;
            propertyValue: string;
        }>;
    }
}

export interface AddTraitsIntent {
    quote: string;
    intentName: 'addTraits';
    value: {
        traits: string[]
    }
}

export interface RemovePropertiesIntent {
    quote: string;
    intentName: 'removeProperties';
    value: {
        propertyNames: string[];
    }
}

export interface RemoveTraitsIntent {
    quote: string;
    intentName: 'removeTraits';
    value: {
        traitIndices: number[];
    }
}


export interface ReplaceTraitsIntent {
    quote: string;
    intentName: 'replaceTraits';
    value: {
        traitReplacements: Array<{
            traitIndex: number;
            newValue: string;
        }>
    }
}

export type Intent = SetNameIntent | SetPropertiesIntent | AddTraitsIntent | RemovePropertiesIntent | RemoveTraitsIntent | ReplaceTraitsIntent;

export function intent(name: string) : typeof object {
    return (...mappers) => (
        requiredObject(
            property('intentName')(
                string(
                    enumVals([name])
                )
            ),
            property('value')(
                requiredObject(...mappers)
            ),
        )
    );
}
