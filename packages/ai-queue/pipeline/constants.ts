export const PIPELINE_ITEMS_QUEUE = 'aiq:pipelineItems';
export const PIPELINE_ITEMS_CONSUMER_GROUP = 'aiq:pipelineItems:consumers';
export const PIPELINE_REQUESTS_QUEUE = 'aiq:pipelineRequests';
export const PIPELINE_REQUESTS_CONSUMER_GROUP = 'aiq:pipelineRequests:consumers';
export const PIPELINE_ITEM_EVENT_BEGIN = 'begin';
export const PIPELINE_ITEM_EVENT_CONTENT = 'content';
export const PIPELINE_ITEM_EVENT_END = 'end';

export type PipelineItemEvent = 
    typeof PIPELINE_ITEM_EVENT_BEGIN | 
    typeof PIPELINE_ITEM_EVENT_CONTENT | 
    typeof PIPELINE_ITEM_EVENT_END;