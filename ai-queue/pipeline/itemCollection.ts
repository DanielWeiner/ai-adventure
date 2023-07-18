import { PipelineItemConfig, PipelineItemRequestConfig, toConfigItem } from "./config";

export interface PipelineItemCollectionItem {
    prevIds: string[];
    nextIds: string[];
    isBegin: boolean;
    isEnd:   boolean;
    request: PipelineItemRequestConfig;
}

export type PipelineItemCollection = {
    [key in string]: PipelineItemCollectionItem;
}

export function buildItemCollection(itemConfig: PipelineItemConfig, beginId: string, endId: string) {
    const pipelineItem = toConfigItem(itemConfig);
    const config = pipelineItem.toCollectionItemConfig([]);

    const collection : PipelineItemCollection = {
        [beginId]: {
            isBegin: true,
            isEnd:   false,
            nextIds: [],
            prevIds: [],
            request: {
                id:       beginId,
                alias:    beginId,
                kind:     'message',
                messages: [],
            }
        }
    };

    for (const [ key, item ] of Object.entries(config)) {
        collection[key] = {
            isBegin: false,
            isEnd:   false,
            prevIds: item.prevIds,
            nextIds: [],
            request: item.request
        };
    }

    for (const [ key, item ] of Object.entries(config)) {
        if (item.prevIds.length === 0) {
            item.prevIds.push(beginId);
        }

        item.prevIds.forEach(prevId => {
            collection[prevId].nextIds.push(key)
        });
    }

    collection[endId] = {
        isBegin: false,
        isEnd:   true,
        nextIds: [],
        prevIds: [],
        request: {
            alias:    endId,
            id:       endId,
            kind:     'message',
            messages: [],
        }
    };

    for (const [ key, item ] of Object.entries(collection)) {
        if (!item.isEnd && item.nextIds.length === 0) {
            item.nextIds.push(endId);
            collection[endId].prevIds.push(key);
        }
    }

    return collection;
}