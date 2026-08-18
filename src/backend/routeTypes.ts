import type {IncomingMessage, ServerResponse} from 'node:http';

export type ApiRouteHandler = (request: IncomingMessage, response: ServerResponse, requestUrl: URL) => Promise<boolean>;

