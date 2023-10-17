import { Logger } from '@bahag/npm-structured-logger';
import fetch, { HeadersInit, Response } from 'node-fetch';

export interface Request {
    url: string;
    method?: string;
    headers?: HeadersInit | undefined;
    body?: string;
    timeout?: number;
}

interface RetryConfig {
    delay: number;
    attempts: number;
}

interface Config {
    request: Request;
    retryConfig: RetryConfig;
    functionName?: string;
}

/*eslint no-magic-numbers: ["error", { "ignore": [ 0, 1, 3, 8000 ] }]*/
export const DELAY = 8000;
export const TIMEOUT = 8000;
const ATTEMPTS = 3;
const ZERO_ATTEMPTS = 0;
let errorResponse: Response;
let moduleLogger: Logger;

export async function fetchRetry(request: Request, functionName: string, logger: Logger): Promise<Response> {
    moduleLogger = logger;
    return await retry({
        request: request,
        retryConfig: { delay: DELAY, attempts: ATTEMPTS },
        functionName: functionName
    });
}

async function retry(config: Config): Promise<Response> {
    const remainingAttempts = config.retryConfig.attempts;
    const isMoreThanZeroAttempts = remainingAttempts > ZERO_ATTEMPTS;
    const isLessThanMaxAttempts = remainingAttempts < ATTEMPTS;
    if (isMoreThanZeroAttempts && isLessThanMaxAttempts) {
        await wait(config.retryConfig.delay);
    }
    try {
        return await fetchTimeout(config.request, config.retryConfig.attempts, config.functionName);
    }
    catch (err) {
        if (remainingAttempts > ZERO_ATTEMPTS) {
            moduleLogger.logWarning(`Request failed attempt ${ATTEMPTS - remainingAttempts + 1} in function: ${config.functionName} cause: ${err} in resource: ${config.request.url}`);
            --config.retryConfig.attempts;
            return retry(config);
        }
        else {
            moduleLogger.logError(`Request finally failed after attempt ${ATTEMPTS} in function: ${config.functionName} cause: ${err} in resource: ${config.request.url}`);
            return errorResponse;
        }
    }
}

async function fetchTimeout(request: Request, attempts: number, functionName?: string): Promise<Response> {
    return fetch(
        request.url,
        {
            method: request.method,
            headers: request.headers,
            body: request.body,
            timeout: TIMEOUT
        })
        .then(async (response) => {
            if (attempts <= ATTEMPTS && attempts > ZERO_ATTEMPTS) {
                if (!response.ok) {
                    errorResponse = response;
                    moduleLogger.logWarning(`Warning occurred by response with status: ${response.status} in function ${functionName} with details: ${response.statusText}`);
                    throw new Error(`Error occurred with response error: ${response.statusText}`);
                }
                return response;
            }
            else {
                moduleLogger.logWarning('Count of the retries is over');
                throw new Error(`${response.statusText} with response code: ${response.status}`);
            }
        });
}

async function wait(ms: number): Promise<unknown> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
