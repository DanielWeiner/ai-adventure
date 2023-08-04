type PipelineItemContentResultValue = {
    type:             'previousItemContent'
    regexMatch?:      [string, string];
    regexMatchIndex?: number;
} & ({
    prevItemIndex:    number;
} | {
    prevItemAlias:    string;
});

type HyrdatedDataTransformResultArray = { 
    type:  keyof DataTransformConfigTypes; 
    value: any;
}[];

interface LiteralResultValue {
    type:        'literal';
    literalType: keyof DataTransformConfigTypes;
    value:       DataTransformConfigTypes[keyof DataTransformConfigTypes];
}

interface ConfigItemResultValue {
    type: 'configItem';
    value: DataTransformConfigValue;
}

export type DataTransformResultArray = Array<PipelineItemContentResultValue | LiteralResultValue | ConfigItemResultValue>;

interface DataTransformConfigTypes {
    boolean: boolean;
    string: string;
    number: number;
    array:  DataTransformConfigValue[];
    object: {
        key: DataTransformConfigValues['string'];
        value: DataTransformConfigValue;
    }[];
    null: null;
}

export type DataTransformConfigValues = {
    [TypeName in keyof DataTransformConfigTypes]: {
        type: TypeName;
    } & ({ value: DataTransformConfigTypes[TypeName] } | { transform: DataTransformResultArray })
}

export type DataTransformConfigValue = DataTransformConfigValues[keyof DataTransformConfigValues];
type TransformConfigStringValue = DataTransformConfigValues['string'];

// FIXME: global var
const configItems = new WeakSet();

const addConfigItem = <T extends DataTransformConfigValue>(value: T) => {
    configItems.add(value);
    return value;
}

export const isConfigItem = (item: any) => configItems.has(item);

export function transform(value: any) : DataTransformConfigValue {
    if (value === null) {
        return addConfigItem({
            type: 'null',
            value: null
        });
    }

    if (typeof value === 'boolean') {
        return addConfigItem({
            type: 'boolean',
            value
        });
    }

    if (typeof value === 'string') {
        return addConfigItem({
            type: 'string',
            value
        });
    }
    
    if (typeof value === 'number') {
        return addConfigItem({
            type: 'number',
            value
        });
    }

    if (Array.isArray(value)) {
        return addConfigItem({
            type: 'array',
            value: value.map(transform)
        });
    }

    if (typeof value === 'object') {
        if (configItems.has(value)) {
            return value as DataTransformConfigValue;
        }

        return addConfigItem({
            type: 'object',
            value: [
                ...Object.getOwnPropertySymbols(value).map(propertySymbol => {
                    return {
                        key: {
                            type:      'string'                                     as const,
                            transform: JSON.parse(propertySymbol.description || '') as DataTransformResultArray
                        },
                        value: transform(value[propertySymbol])
                    }
                }),
                ...Object.getOwnPropertyNames(value).map(propertyName => {
                    return {
                        key: {
                            type:  'string'     as const,
                            value: propertyName
                        },
                        value: transform(value[propertyName])
                    }
                })
            ]
        });
    }

    throw new Error(`Value could not be converted to pipeline data config: ${value}`);
}

export function stringify(value: any) {
    return addConfigItem({
        type: 'string',
        transform: [
            {
                type: 'configItem',
                value: transform(value)
            }
        ]
    })
}

export function prevResult(regexMatch?: string | RegExp, regexMatchIndex: number = 0) {
    return prevResultNth(0, regexMatch, regexMatchIndex);
}

export function pipelined(strings: TemplateStringsArray, ...values: Array<any>) : TransformConfigStringValue & { transform: DataTransformResultArray } {
    return addConfigItem({
        type: 'string',
        transform: strings.reduce((transformItems, str, i) => {
            const itemsFromString : typeof transformItems = str ? [
                { 
                    type:        'literal',
                    literalType: 'string',
                    value:       str
                }
            ] : [];

            const resultItems = [...transformItems, ...itemsFromString];
            
            if (typeof values[i] === 'undefined') {
                return resultItems;
            }

            const valueConfig = transform(values[i]);

            if (valueConfig.type === 'string') {
                if ('transform' in valueConfig) {
                    return [...resultItems, ...valueConfig.transform];
                }

                return [
                    ...resultItems,
                    {
                        type:        'literal',
                        literalType: 'string',
                        value:       valueConfig.value
                    }
                ];
            }

            return [
                ...resultItems,
                {
                    type: 'configItem',
                    value: valueConfig
                }
            ];
        }, [] as DataTransformResultArray)
    });
}

export function pipelinedKey(strings: TemplateStringsArray, ...values: Array<any>) : symbol {
    return Symbol.for(JSON.stringify(pipelined(strings, ...values).transform));
}

function prevResultRegexes(regexMatch?: string | RegExp, regexMatchIndex: number = 0) {
    return {
        type: 'previousItemContent' as const,
        ...regexMatch instanceof RegExp ? { 
            regexMatch: [regexMatch.source, regexMatch.flags] as [string, string]
        } : typeof regexMatch === 'string' ? {
            regexMatch: [regexMatch, ''] as [string, string]
        } : {},
        regexMatchIndex
    }
}

export function prevResultNth(n: number, regexMatch?: string | RegExp, regexMatchIndex: number = 0) : TransformConfigStringValue {
    return addConfigItem({
        type: 'string',
        transform: [
            {
                ...prevResultRegexes(regexMatch, regexMatchIndex),
                prevItemIndex: n,
            }
        ]
    });
}

export function prevResultAlias(alias: string, regexMatch?: string | RegExp, regexMatchIndex: number = 0) : TransformConfigStringValue {
    return addConfigItem({
        type: 'string',
        transform: [
            {
                ...prevResultRegexes(regexMatch, regexMatchIndex),
                prevItemAlias: alias
            }
        ]
    })
}

export function findRequiredReferences(values: DataTransformConfigValue[], aliases: Set<string> = new Set(), idIndices: Set<number> = new Set()) {
    for (const data of values) {
        if ('transform' in data) {
            data.transform.forEach(item => {
                if (item.type === 'previousItemContent') {
                    if ('prevItemIndex' in item) {
                        idIndices.add(item.prevItemIndex);
                    } else {
                        aliases.add(item.prevItemAlias);
                    }
                } else if (item.type === 'configItem') {
                    findRequiredReferences([item.value], aliases, idIndices);
                }
            });
        } else {
            if (data.type === 'array') {
                data.value.forEach(item => {
                    findRequiredReferences([item], aliases, idIndices);
                });
            } else if (data.type === 'object') {
                data.value.forEach(({ key, value }) => {
                    findRequiredReferences([key], aliases, idIndices);
                    findRequiredReferences([value], aliases, idIndices);
                })
            }
        }
    }

    return {
        idIndices: [...idIndices],
        aliases: [...aliases]
    };
}

export function hydrate({
    idsByAlias,
    contentById,
    prevIds,
    data
} : {
    idsByAlias: Record<string, string>;
    contentById: Record<string, string>;
    prevIds: string[];
    data: DataTransformConfigValue
}) : any {
    const hydrateSubData = (data: DataTransformConfigValue) => hydrate({
        idsByAlias,
        contentById,
        prevIds,
        data
    });

    if ('value' in data) {
        switch (data.type) {
            case 'boolean':
            case 'null':
            case 'number':
            case 'string':
                return data.value;
            case 'object':
                return data.value.reduce((obj, { key, value }) => {
                    return {
                        ...obj,
                        [hydrateSubData(key)]: hydrateSubData(value)
                    }
                }, {} as Record<string, any>)
            case 'array':
                return data.value.map(hydrateSubData);
        }
    }
    
    const hydratedTransform = hydrateTransform({
        idsByAlias,
        contentById,
        prevIds,
        transform: data.transform
    });

    return joinHydratedTransform(data.type, hydratedTransform);
}

function hydrateTransform({
    idsByAlias,
    contentById,
    prevIds,
    transform
} : {
    idsByAlias: Record<string, string>;
    contentById: Record<string, string>;
    prevIds: string[];
    transform: DataTransformResultArray
}) : HyrdatedDataTransformResultArray {
    return transform.map(item => {
        if (item.type === 'literal' || item.type === 'configItem') {
            const type = item.type === 'literal' ? item.literalType : item.value.type;
            const value = item.type === 'literal' ? item.value : hydrate({ 
                contentById, 
                idsByAlias, 
                prevIds, 
                data: item.value 
            });
            
            return {
                type,
                value
            };
        }

        if (item.type === 'previousItemContent') {
            const id = 'prevItemIndex' in item ? prevIds[item.prevItemIndex] : idsByAlias[item.prevItemAlias];
            const content = contentById[id];

            if (item.regexMatch) {
                const regex = new RegExp(item.regexMatch[0], item.regexMatch[1]);
                const match = content.match(regex);

                return {
                    type: 'string',
                    value: match?.[item.regexMatchIndex ?? 0] || ''
                };
            }

            return {
                type: 'string',
                value: content
            };
        }

        throw new Error('Invalid data transform item: ' + item);
    });
}

function joinHydratedTransform(type: keyof DataTransformConfigTypes, transform: HyrdatedDataTransformResultArray) {
    if (type === 'null') {
        return null;
    }
    
    const stringValue = transform.map(({ type, value }) => {
        switch (type) {
            case "string":
                return value;
            case "number":
            case "boolean":
                return `${value}`;
            case "object":
            case "array":
                return JSON.stringify(value);
            case "null":
                return '';
        }
    }).join('');

    if (type === 'string') {
        return stringValue;
    }
    if (type === 'number') {
        return Number(stringValue);
    }
    if (type === 'boolean') {
        return stringValue && !['0', 'false'].map(str => str.toUpperCase()).includes(stringValue.toUpperCase());
    }
    
    let value: any;
    try {
        value = JSON.parse(stringValue);
    } catch {
        throw new Error(`Could not convert ${stringValue} into ${type}`);
    }
    
    if (type === 'array') {
        if (!Array.isArray(value)) {
            throw new Error(`Invalid array value: ${value}`);
        }
    }

    return value;
}