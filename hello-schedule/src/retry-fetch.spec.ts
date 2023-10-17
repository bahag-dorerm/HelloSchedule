import * as constants from './retry-fetch';
import nock from 'nock';
import { Logger } from '@bahag/npm-structured-logger';
import { fetchRetry, Request } from './retry-fetch';

jest.mock('@bahag/npm-structured-logger');
const mockedLogger = Logger as jest.MockedClass<typeof Logger>;

describe('retry-fetch', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.resetAllMocks();
        jest.useFakeTimers();
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        Object.defineProperty(constants, 'DELAY', { value: 8000 });
        Object.defineProperty(constants, 'TIMEOUT', { value: 8000 });
    });

    it('should success execute request', async function () {
        jest.useRealTimers();
        nock('http://example.com')
            .persist()
            .get('/test/1')
            .reply(200, 'some body');
        const request: Request = { url: 'http://example.com/test/1', method: 'GET' };
        const response = fetchRetry(request, 'someTestFunction', mockedLogger.getInstance());
        await expect(response.then((res) => {
            return res.text();
        })).resolves.toEqual('some body');
    });

    it('should retry on request delay', async function () {
        jest.useRealTimers();
        Object.defineProperty(constants, 'DELAY', { value: 10 });
        Object.defineProperty(constants, 'TIMEOUT', { value: 10 });

        nock('http://example.com')
            .persist()
            .get('/test/2')
            .delay(20)
            .reply(200, 'some body');
        const request: Request = { url: 'http://example.com/test/2', method: 'GET' };
        await fetchRetry(request, 'someTestFunction', mockedLogger.getInstance());
        expect(mockedLogger.getInstance().logWarning).toHaveBeenCalledWith('Request failed attempt 1 in function: someTestFunction cause: FetchError: network timeout at: http://example.com/test/2 in resource: http://example.com/test/2');
        expect(mockedLogger.getInstance().logWarning).toHaveBeenCalledWith('Request failed attempt 2 in function: someTestFunction cause: FetchError: network timeout at: http://example.com/test/2 in resource: http://example.com/test/2');
        expect(mockedLogger.getInstance().logWarning).toHaveBeenCalledWith('Request failed attempt 3 in function: someTestFunction cause: FetchError: network timeout at: http://example.com/test/2 in resource: http://example.com/test/2');
        expect(mockedLogger.getInstance().logError).toHaveBeenCalledWith('Request finally failed after attempt 3 in function: someTestFunction cause: FetchError: network timeout at: http://example.com/test/2 in resource: http://example.com/test/2');
    });

    it('should retry on the 500', async function () {
        jest.useRealTimers();
        Object.defineProperty(constants, 'DELAY', { value: 10 });
        Object.defineProperty(constants, 'TIMEOUT', { value: 10 });
        nock('http://example.com')
            .persist()
            .get('/test/3')
            .reply(500, 'some error');

        const request: Request = { url: 'http://example.com/test/3', method: 'GET' };
        await fetchRetry(request, 'someTestFunction', mockedLogger.getInstance());
        expect(mockedLogger.getInstance().logWarning).toHaveBeenCalledWith('Warning occurred by response with status: 500 in function someTestFunction with details: Internal Server Error');
        expect(mockedLogger.getInstance().logWarning).toHaveBeenCalledWith('Request failed attempt 1 in function: someTestFunction cause: Error: Error occurred with response error: Internal Server Error in resource: http://example.com/test/3');
        expect(mockedLogger.getInstance().logWarning).toHaveBeenCalledWith('Warning occurred by response with status: 500 in function someTestFunction with details: Internal Server Error');
        expect(mockedLogger.getInstance().logWarning).toHaveBeenCalledWith('Request failed attempt 1 in function: someTestFunction cause: Error: Error occurred with response error: Internal Server Error in resource: http://example.com/test/3');
        expect(mockedLogger.getInstance().logWarning).toHaveBeenCalledWith('Warning occurred by response with status: 500 in function someTestFunction with details: Internal Server Error');
        expect(mockedLogger.getInstance().logWarning).toHaveBeenCalledWith('Request failed attempt 1 in function: someTestFunction cause: Error: Error occurred with response error: Internal Server Error in resource: http://example.com/test/3');
        expect(mockedLogger.getInstance().logError).toHaveBeenCalledWith('Request finally failed after attempt 3 in function: someTestFunction cause: Error: Internal Server Error with response code: 500 in resource: http://example.com/test/3');
    });
});
