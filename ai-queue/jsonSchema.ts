export interface JSONSchemaNumberValue {
    type:         'number';
    description?: string;
    enum?:        number[];
}

export interface JSONSchemaStringValue {
    type:         'string';
    description?: string;
    enum?:        string[];
}

type JSONSchemaObjectProperties = {
    [key in string]: JSONSchemaValue;
}

export interface JSONSchemaObjectValue {
    type:         'object';
    description?: string;
    required?:    string[];
    properties:   JSONSchemaObjectProperties;
}

export interface JSONSchemaArrayValue {
    type:        'array';
    description?: string;
    items:        JSONSchemaValue;
}

export interface JSONSchemaAnyOfValue {
    anyOf:        JSONSchemaValue[];
    description?: string;
}

type JSONSchemaType = JSONSchemaNumberValue | JSONSchemaStringValue | JSONSchemaObjectValue | JSONSchemaArrayValue;
type JSONSchemaMappers<T extends JSONSchemaValue> = ((obj: T) => T)[];

export type JSONSchemaValue = JSONSchemaType | JSONSchemaAnyOfValue;


export function property(name: string) : (value: JSONSchemaValue) => (obj: JSONSchemaObjectValue) => JSONSchemaObjectValue {
    return (value: JSONSchemaValue) => (obj: JSONSchemaObjectValue) => ({
        ...obj,
        properties: {
            ...obj.properties,
            [name]: value
        }
    });
}

export function describe<T extends JSONSchemaValue>(description: string) {
    return (value: T) : T => ({
        ...value,
        description
    });
}

export function required(keys: string[]) {
    return (obj: JSONSchemaObjectValue) : JSONSchemaObjectValue => ({
        ...obj,
        required: [...keys]
    });
}

type TypesFromName = {
    [key in JSONSchemaType['type']]: Extract<JSONSchemaType, { type: key }>
};

function typeFn<K extends JSONSchemaType['type']>(name: K) : (...mappers: JSONSchemaMappers<TypesFromName[K]>) => TypesFromName[K] {
    return (...mappers: JSONSchemaMappers<TypesFromName[K]>) => mappers.reduce((obj, mapper) => mapper(obj), { type: name } as TypesFromName[K]);
}

export const object = typeFn('object');
export const array = typeFn('array');
export const number = typeFn('number');
export const string = typeFn('string');

export function anyOf(...mappers: JSONSchemaMappers<JSONSchemaAnyOfValue>) {
    return mappers.reduce((obj, mapper) => mapper(obj), { anyOf: [] } as JSONSchemaAnyOfValue);
}

export function requiredObject(...mappers: JSONSchemaMappers<JSONSchemaObjectValue>) {
    const obj = object(...mappers);

    return required(Object.keys(obj.properties))(obj);
}

export function items(value: JSONSchemaValue) {
    return (arr: JSONSchemaArrayValue) : JSONSchemaArrayValue => ({
        ...arr,
        items: value
    })
}


export function enumVals<T extends JSONSchemaStringValue | JSONSchemaNumberValue>(values: T['enum']) {
    return (val: T) : T => ({
        ...val,
        enum: values
    });
}

export function option(val: JSONSchemaValue) {
    return (anyOfVal: JSONSchemaAnyOfValue) : JSONSchemaAnyOfValue => ({
        ...anyOfVal,
        anyOf: [
            ...anyOfVal.anyOf,
            val
        ]
    });
}
