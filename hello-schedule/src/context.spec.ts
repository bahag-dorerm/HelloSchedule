import * as constants from './retry-fetch';
import * as retry from './retry-fetch';
import SftpClient, { FileInfo, FileStats } from 'ssh2-sftp-client';
import fetch, { Response } from 'node-fetch';
import { CollectionReference, Firestore } from '@google-cloud/firestore';
import { Context } from './context';
import { Logger, Reporter } from '@bahag/npm-structured-logger';
import { Publisher } from './publisher';
import { Repository } from './repository';
import { SFTPWrapper } from 'ssh2';
import { Writable } from 'stream';
import { createWritable } from '@bahag/npm-cloud-storage-wrapper';
import { DEFAULT_MAIL_PROPERTIES, MailPubSubData, Status } from './interface/interfaces';

jest.mock('@bahag/npm-cloud-storage-wrapper');
jest.mock('@bahag/npm-structured-logger');
jest.mock('ssh2-sftp-client');
jest.mock('./repository');
jest.mock('node-fetch');

const mockCreateWritable = createWritable as jest.MockedFunction<typeof createWritable>;
const mockedLogger = Logger as jest.MockedClass<typeof Logger>;
const mockedReporter = Reporter as jest.MockedClass<typeof Reporter>;
const mockedFetch: jest.MockedFunction<typeof fetch> = fetch as jest.MockedFunction<typeof fetch>;

let context: Context;

const createMockSupplierInfo = () => {
    const returnBody = { name: 'test name', email: 'test@bahag.com' } as unknown as Body;
    mockedFetch.mockImplementation(() => {
        return new Promise((resolve) => {
            resolve(({
                ok: true,
                status: 200,
                json: () => {
                    return returnBody;
                },
                text: () => {
                    return Promise.resolve('{"access_token":"tokenHere"}');
                }
            }) as unknown as Response);
        });
    });
};

const createMockSupplierInfoWithError = () => {
    mockedFetch.mockImplementation(() => {
        return new Promise((resolve) => {
            resolve(({
                ok: false,
                status: 400
            }) as unknown as Response);
        });
    });
};

describe('Context', () => {
    const mockDate = new Date(2023, 4, 1);

    beforeEach(() => {
        context = new Context();
        process.env.PROJECT_ID = 'my-project';
        process.env.GENERAL_PROJECT_ID = 'my-general-project';
        (mockedReporter.getInstance as jest.MockedFunction<typeof mockedReporter.getInstance>).mockReturnValue(new Reporter());
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.resetAllMocks();
        jest.useRealTimers();
        mockCreateWritable.mockRestore();
    });

    it('Should be constructed', () => {
        expect(new Context()).toBeTruthy();
    });

    it('Should setup', async () => {
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        await expect(context.setup()).resolves.toEqual(undefined);
    });

    it('Should log error on failed sftp connection', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        jest.spyOn(SftpClient.prototype, 'connect').mockRejectedValue(new Error('ERROR'));
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        await expect(context.setup()).resolves.toEqual(undefined);
        expect(mockedLogger.getInstance().logError).toHaveBeenCalledWith('ERROR', 'sftp-collector');

    });

    it('Should be constructed and teared down', async () => {
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        await expect(context.setup()).resolves.toEqual(undefined);
        await expect(context.teardown()).resolves.toEqual(undefined);
        await expect(Repository.prototype.teardown).toHaveBeenCalled();
    });

    it('Should adjust supplierId for dev (test) files', async () => {
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({ modifyTime: mockDate.getTime() } as FileStats);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        await context.setup();
        const supplierId = context.getSupplierId('stock_123456_DE_20220330150345.csv', 's_sm-ds_t');
        expect(supplierId).toEqual('123456');
    });

    it('Should adjust supplierId for prod (sm) files', async () => {
        process.env.environment = 'prod';
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({ modifyTime: mockDate.getTime() } as FileStats);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        await context.setup();
        const supplierId = context.getSupplierId('stock_123456_DE_20220330150345.csv', 's_sm-ds_p');
        expect(supplierId).toEqual('123456');
    });

    it('Should pass folder name as supplierId if no supplier ID was found in internal file', async () => {
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({ modifyTime: mockDate.getTime() } as FileStats);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        await context.setup();
        const supplierId = context.getSupplierId('stock_123G456_DE_20220330150345.csv', 'bahag.com');
        expect(supplierId).toEqual('bahag.com');
    });

    it('Should validate a correct old enough csv file', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        jest.spyOn(SftpClient.prototype, 'delete').mockResolvedValue('some string');
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({
            modifyTime: mockDate.getTime() - context.maximumFileAge + 1,
            size: 1
        } as FileStats);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Repository.prototype, 'getSupplierState').mockResolvedValue(true);
        await context.setup();
        const valid = await context.validateFile('stock_123456_DE_20220330150345.csv', '123456', '123456');
        expect(valid).toBeTruthy();
        expect(Repository.prototype.getSupplierState).toBeCalledWith('123456', 'DE', 'csv');
        //should not delete file
        expect(SftpClient.prototype.delete).toBeCalledTimes(0);
    });

    it('Should validate a correct old enough csv file mixed case', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        jest.spyOn(SftpClient.prototype, 'delete').mockResolvedValue('some string');
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({
            modifyTime: mockDate.getTime() - context.maximumFileAge + 1,
            size: 1
        } as FileStats);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Repository.prototype, 'getSupplierState').mockResolvedValue(true);
        await context.setup();
        const valid = await context.validateFile('Stock_123456_DE_20220330150345.CSV', '123456', '123456');
        expect(valid).toBeTruthy();
        expect(Repository.prototype.getSupplierState).toBeCalledWith('123456', 'DE', 'csv');
        //Should not delete file
        expect(SftpClient.prototype.delete).toBeCalledTimes(0);
    });

    it('Should validate a correct old enough xlsx file', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        jest.spyOn(SftpClient.prototype, 'delete').mockResolvedValue('some string');
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({
            modifyTime: mockDate.getTime() - context.maximumFileAge + 1,
            size: 1
        } as FileStats);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Repository.prototype, 'getSupplierState').mockResolvedValue(true);
        await context.setup();
        const valid = await context.validateFile('stock_123456_DE_20220330150345.xlsx', '123456', '123456');
        expect(valid).toBeTruthy();
        expect(Repository.prototype.getSupplierState).toBeCalledWith('123456', 'DE', 'xlsx');
        expect(SftpClient.prototype.delete).toBeCalledTimes(0);
    });

    it('Should validate a correct above minimum file aged csv file', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        jest.spyOn(SftpClient.prototype, 'delete').mockResolvedValue('some string');
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({
            modifyTime: mockDate.getTime() - context.minimumFileAge - 1,
            size: 1
        } as FileStats);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Repository.prototype, 'getSupplierState').mockResolvedValue(true);
        await context.setup();
        const valid = await context.validateFile('stock_123456_DE_20220330150345.csv', '123456', '123456');
        expect(valid).toBeTruthy();
        expect(Repository.prototype.getSupplierState).toBeCalledWith('123456', 'DE', 'csv');
        //should not delete file
        expect(SftpClient.prototype.delete).toBeCalledTimes(0);
    });

    it('Should invalidate a correct too new file', async () => {
        Object.defineProperty(constants, 'DELAY', { value: 10 });
        Object.defineProperty(constants, 'TIMEOUT', { value: 10 });
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2023-04-01T12:00:00.000Z'));
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        jest.spyOn(SftpClient.prototype, 'delete').mockResolvedValue('some string');
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue(
            {
                modifyTime: (new Date('2023-04-01T12:00:00.000Z')).getTime() - 10,
                size: 1280
            } as FileStats
        );
        jest.spyOn(Repository.prototype, 'getSupplierState').mockResolvedValue(true);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Context.prototype, 'getAuthToken').mockResolvedValue('IamAToken');
        jest.spyOn(Context.prototype, 'getSupplierInfo').mockResolvedValue({ email: 'testEmail', name: 'test name' });
        await context.setup();
        const valid = await context.validateFile('stock_123456_DE_20220330150345.csv', '123456', '123456');
        expect(valid).toBeFalsy();
        expect(Logger.prototype.logNotice).toBeCalledWith('File stock_123456_DE_20220330150345.csv is less than 20sec old', 'sftp-collector');
        expect(SftpClient.prototype.rename).toBeCalledTimes(0);
        expect(SftpClient.prototype.delete).toBeCalledTimes(0);
    });

    it('Should delete a too old file', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        jest.spyOn(SftpClient.prototype, 'delete').mockResolvedValue('some string');
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({
            modifyTime: mockDate.getTime() - context.maximumFileAge - 1,
            size: 1
        } as FileStats);
        jest.spyOn(Repository.prototype, 'getSupplierState').mockResolvedValue(true);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        await context.setup();

        await context.deleteOutdatedFiles('stock_123456_DE_20220330150345.csv', '123456');
        expect(SftpClient.prototype.delete).toBeCalledTimes(1);
    });

    it('Should invalidate a correct old enough file for wrong supplier', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        (mockedReporter.getInstance as jest.MockedFunction<typeof mockedReporter.getInstance>).mockReturnValue(new Reporter());
        createMockSupplierInfo();
        jest.spyOn(Context.prototype, 'getSupplierEmail').mockResolvedValue('test@test.de');
        jest.spyOn(SftpClient.prototype, 'delete').mockResolvedValue('some string');
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({
            modifyTime: mockDate.getTime() - context.minimumFileAge - 1,
            size: 1
        } as FileStats);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Repository.prototype, 'getSupplierState').mockResolvedValue(true);
        jest.spyOn(Publisher.prototype, 'publishToMailSender').mockImplementation((mailPubsubData: MailPubSubData) => {
            return Promise.resolve();
        });
        await context.setup();
        const valid = await context.validateFile('stock_123456_DE_20220330150345.csv', '654321', '654321');
        expect(valid).toBeFalsy();
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledTimes(1);
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledWith(expect.objectContaining(
            { supplierEmail: DEFAULT_MAIL_PROPERTIES.supplierManagement })
        );
        expect(SftpClient.prototype.delete).toBeCalledTimes(0);
    });

    it('Should invalidate a correct old enough file for inactive supplier', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        createMockSupplierInfo();
        jest.spyOn(Context.prototype, 'getSupplierEmail').mockResolvedValue('test@test.de');
        jest.spyOn(SftpClient.prototype, 'delete').mockResolvedValue('some string');
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({
            modifyTime: mockDate.getTime() - context.minimumFileAge - 1,
            size: 1
        } as FileStats);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Publisher.prototype, 'publishToMailSender').mockImplementation((mailPubSubData: MailPubSubData) => {
            return Promise.resolve();
        });
        await context.setup();
        const valid = await context.validateFile('stock_123456_DE_20220330150345.csv', '123456', '123456');
        expect(valid).toBeFalsy();
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledTimes(1);
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledWith(expect.objectContaining({ supplierEmail: 'test@test.de' }));
        expect(SftpClient.prototype.delete).toBeCalledTimes(0);
    });

    it('Should reject a file with wrong file name', async () => {
        (mockedReporter.getInstance as jest.MockedFunction<typeof mockedReporter.getInstance>).mockReturnValue(new Reporter());
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        createMockSupplierInfo();
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({ modifyTime: 31, size: 10 } as FileStats);
        jest.spyOn(Context.prototype, 'getSupplierEmail').mockResolvedValue('test@test.de');
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Publisher.prototype, 'publishToMailSender').mockImplementation((mailPubSubData: MailPubSubData) => {
            return Promise.resolve();
        });
        await context.setup();
        const valid = await context.validateFile('stock_123456_de_20220330150345.xcsv', '123456', '123456');
        expect(valid).toBeFalsy();
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledTimes(1);
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledWith(expect.objectContaining(
            { supplierEmail: 'test@test.de' })
        );
    });

    it('Should invalidate a file with size 0', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        createMockSupplierInfo();
        jest.spyOn(Context.prototype, 'getSupplierEmail').mockResolvedValue('test@test.de');
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({ modifyTime: 0, size: 0 } as FileStats);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Publisher.prototype, 'publishToMailSender').mockImplementation((mailPubSubData: MailPubSubData) => {
            return Promise.resolve();
        });
        await context.setup();
        const valid = await context.validateFile('stock_123456_DE_20220330150345.csv', '123456', '123456');
        expect(valid).toBeFalsy();
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledTimes(1);
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledWith(expect.objectContaining({ supplierEmail: 'test@test.de' }));
    });

    it('Should validate a file with size above 0', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({ modifyTime: 0, size: 1 } as FileStats);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Repository.prototype, 'getSupplierState').mockResolvedValue(true);
        await context.setup();
        const valid = await context.validateFile('stock_123456_DE_20220330150345.csv', '123456', '123456');
        expect(valid).toBeTruthy();
    });

    it('Should invalidate file of an unauthorized supplier', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        createMockSupplierInfo();
        jest.spyOn(Context.prototype, 'getSupplierEmail').mockResolvedValue('test@test.de');
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({ modifyTime: 0, size: 1 } as FileStats);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Repository.prototype, 'getSupplierState').mockResolvedValue(false);
        jest.spyOn(Publisher.prototype, 'publishToMailSender').mockImplementation((mailPubSubData: MailPubSubData) => {
            return Promise.resolve();
        });
        jest.spyOn(Context.prototype, 'renameFileOnSftp').mockResolvedValue({} as Promise<void>);
        await context.setup();
        const valid = await context.validateFile('stock_123456_DE_20220330150345.csv', '123456', '123456');
        expect(valid).toBeFalsy();
        expect(Repository.prototype.getSupplierState).toBeCalledWith('123456', 'DE', 'csv');
        expect(Logger.prototype.logNotice).toBeCalledWith('Supplier 123456 is not authorized to send stock_123456_DE_20220330150345.csv', 'sftp-collector');
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledTimes(1);
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledWith(expect.objectContaining(
            { supplierEmail: 'test@test.de' })
        );
        expect(Context.prototype.renameFileOnSftp).toHaveBeenCalledTimes(1);
    });

    it('Should invalidate file with unexpected supplierId', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        (mockedReporter.getInstance as jest.MockedFunction<typeof mockedReporter.getInstance>).mockReturnValue(new Reporter());
        createMockSupplierInfo();
        jest.spyOn(Context.prototype, 'getSupplierEmail').mockResolvedValue('test@test.de');
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({ modifyTime: 0, size: 1 } as FileStats);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Repository.prototype, 'getSupplierState').mockResolvedValue(false);
        jest.spyOn(Context.prototype, 'renameFileOnSftp').mockResolvedValue({} as Promise<void>);
        jest.spyOn(Publisher.prototype, 'publishToMailSender').mockImplementation((mailPubSubData: MailPubSubData) => {
            return Promise.resolve();
        });
        await context.setup();
        const valid = await context.validateFile('stock_12356_DE_20220330150345.csv', '123456', '123456');
        expect(valid).toBeFalsy();
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledTimes(1);
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledWith(expect.objectContaining(
            { supplierEmail: DEFAULT_MAIL_PROPERTIES.supplierManagement }
        ));
        expect(Context.prototype.renameFileOnSftp).toHaveBeenCalledTimes(1);
    });

    it('Should invalidate file with prefix unauthorized', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        jest.spyOn(Context.prototype, 'getSupplierEmail').mockResolvedValue('test@test.de');
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({ modifyTime: 0, size: 1 } as FileStats);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Publisher.prototype, 'publishToMailSender').mockImplementation(
            (mailPubSubData: MailPubSubData) => {
                return Promise.resolve();
            }
        );
        await context.setup();
        const valid = await context.validateFile('UNAUTHORIZED_stock_12356_DE_20220330150345.csv', '123456', '123456');
        expect(valid).toBeFalsy();
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledTimes(0);
    });

    it('Should successfully add a Transmission', async () => {
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Repository.prototype, 'addTransmission').mockResolvedValue([{ id: 666 }]);
        jest.spyOn(Context.prototype, 'getInboundMethod');
        await context.setup();
        const result = await context.addTransmission('123456', 'stock_123456_DE_20220330150345.csv', '123456');
        expect(Repository.prototype.addTransmission).toBeCalledWith(expect.objectContaining(
            { inboundChannel: 'csv', status: 'INITIATED', supplierNumber: '123456', inboundMethod: 'SFTP' })
        );
        expect(context.getInboundMethod).toBeCalledWith('123456');
        expect(result).toEqual(666);
    });

    it('Should resolve Transmission Method to the right folders on dev', async () => {
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        process.env.environment = 'dev';
        await context.setup();
        expect(context.getInboundMethod('123456')).toBe('SFTP');
        expect(context.getInboundMethod('s_ds-test-supplier_p')).toBe('Upload');
        expect(context.getInboundMethod('s_sm-ds_t')).toBe('Upload');
        expect(() => {
            return context.getInboundMethod('s_sm-ds_p');
        }).toThrow('Invalid supplierFolder: s_sm-ds_p');
        expect(() => {
            return context.getInboundMethod('foobar');
        }).toThrow('Invalid supplierFolder: foobar');
    });

    it('Should resolve Transmission Method to the right folders on prod', async () => {
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        process.env.environment = 'prod';
        await context.setup();
        expect(context.getInboundMethod('123456')).toBe('SFTP');
        expect(context.getInboundMethod('s_sm-ds_p')).toBe('Upload');
        expect(() => {
            return context.getInboundMethod('s_sm-ds_t');
        }).toThrow('Invalid supplierFolder: s_sm-ds_t');
        expect(() => {
            return context.getInboundMethod('s_ds-test-supplier_p');
        }).toThrow('Invalid supplierFolder: s_ds-test-supplier_p');
    });

    it('Should return 0 on add Transmission Error', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Repository.prototype, 'addTransmission').mockRejectedValue(new Error('Foobar'));
        await context.setup();
        const result = await context.addTransmission('123456', 'stock_123456_DE_20220330150345.csv', '123456');
        expect(result).toEqual(0);
    });

    it('Should Call UpdateTransmission correctly', async () => {
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Repository.prototype, 'updateTransmission').mockImplementation(() => Promise.resolve());
        await context.setup();
        await context.updateTransmission(666, '/file/path.csv', Status.SUCCESS);
        expect(Repository.prototype.updateTransmission).toBeCalledWith(666, Status.SUCCESS, '/file/path.csv');
    });

    it('Should Call sFTP List correctly from getSupplierId', async () => {
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(SftpClient.prototype, 'list').mockResolvedValue([{ name: 'foo' }, { name: 'bar' }] as FileInfo[]);
        await context.setup();
        const result = await context.getSupplierFolders();
        expect(SftpClient.prototype.list).toBeCalledWith('/EAI/s_ds-inventory-inbox_p/data/');
        expect(result.length).toBe(2);
        expect(result[0]).toBe('foo');
        expect(result[1]).toBe('bar');
    });

    it('Should Ignore Supplier Folders on DEV', async () => {
        process.env.environment = 'dev';
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(SftpClient.prototype, 'list').mockResolvedValue([
            { name: '123456' },
            { name: '654321' },
            { name: 's_ds-test-supplier_p' },
            { name: 's_sm-ds_p' },
            { name: 's_sm-ds_t' }
        ] as FileInfo[]);
        await context.setup();
        const result = await context.getSupplierFolders();
        expect(SftpClient.prototype.list).toBeCalledWith('/EAI/s_ds-inventory-inbox_p/data/');
        expect(result.length).toBe(3);
        expect(result).toContain('s_ds-test-supplier_p');
        expect(result).toContain('s_sm-ds_p');
        expect(result).toContain('s_sm-ds_t');
        expect(result).not.toContain('123456');
        expect(result).not.toContain('654321');
    });

    it('Should not Ignore Supplier Folders on PROD', async () => {
        process.env.environment = 'prod';
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(SftpClient.prototype, 'list').mockResolvedValue([
            { name: '123456' },
            { name: '654321' },
            { name: 's_ds-test-supplier_p' },
            { name: 's_sm-ds_p' },
            { name: 's_sm-ds_t' }
        ] as FileInfo[]);
        await context.setup();
        const result = await context.getSupplierFolders();
        expect(SftpClient.prototype.list).toBeCalledWith('/EAI/s_ds-inventory-inbox_p/data/');
        expect(result.length).toBe(5);
        expect(result).toContain('s_ds-test-supplier_p');
        expect(result).toContain('s_sm-ds_p');
        expect(result).toContain('s_sm-ds_t');
        expect(result).toContain('123456');
        expect(result).toContain('654321');
    });

    it('Should Call sFTP List correctly from getFileList', async () => {
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(SftpClient.prototype, 'list').mockResolvedValue([{ name: 'foo.csv' }, { name: 'bar.csv' }] as FileInfo[]);
        await context.setup();
        const result = await context.getFileList('123456');
        expect(SftpClient.prototype.list).toBeCalledWith('/EAI/s_ds-inventory-inbox_p/data/123456/data');
        expect(result.length).toBe(2);
        expect(result[0]).toBe('foo.csv');
        expect(result[1]).toBe('bar.csv');
    });

    it('Should write a csv file correctly that came from sFTP', async () => {
        process.env.INBOUND_CSV_BUCKET_NAME = 'bucket-name';
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(SftpClient.prototype, 'get').mockImplementation((path: string, dst: Writable) => {
            return Promise.resolve('a string');
        });
        await context.setup();
        const result = await context.copyFileToBucket('123456', 'stock_123456_DE_20220330161810.csv', 666);
        expect(result).toEqual('gs://bucket-name/123456/stock_123456_DE_20220330161810_666.csv');
    });

    it('Should write a xlsx file correctly that came from sFTP', async () => {
        process.env.INBOUND_XLSX_BUCKET_NAME = 'bucket-name';
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(SftpClient.prototype, 'get').mockImplementation((path: string, dst: Writable) => {
            return Promise.resolve('a string');
        });
        await context.setup();
        const result = await context.copyFileToBucket('123456', 'stock_123456_DE_20220330161810.xlsx', 666);
        expect(result).toEqual('gs://bucket-name/123456/stock_123456_DE_20220330161810_666.xlsx');
    });

    it('Should write files correctly with variety of file extensions', async () => {
        process.env.INBOUND_CSV_BUCKET_NAME = 'csv-bucket-name';
        process.env.INBOUND_XLSX_BUCKET_NAME = 'xlsx-bucket-name';
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(SftpClient.prototype, 'get').mockImplementation((path: string, dst: Writable) => {
            return Promise.resolve('a string');
        });
        await context.setup();
        const expectedCsv = 'gs://csv-bucket-name/123456/stock_123456_DE_20220330161810_666.csv';
        const expectedXlsx = 'gs://xlsx-bucket-name/123456/stock_123456_DE_20220330161810_666.xlsx';
        const tests = [
            { extension: 'csv', expectation: expectedCsv },
            { extension: 'CSV', expectation: expectedCsv },
            { extension: 'Csv', expectation: expectedCsv },
            { extension: 'xlsx', expectation: expectedXlsx },
            { extension: 'XLSX', expectation: expectedXlsx },
            { extension: 'Xlsx', expectation: expectedXlsx },
        ];
        for (const test of tests) {
            const result = await context.copyFileToBucket('123456', `stock_123456_DE_20220330161810.${test.extension}`, 666);
            expect(result).toEqual(test.expectation);
        }
    });

    it('Should throw error on sFTP failure', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        process.env.INBOUND_CSV_BUCKET_NAME = 'bucket-name';
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(SftpClient.prototype, 'get').mockRejectedValue(new Error('foobar'));
        await context.setup();
        await expect(context.copyFileToBucket('123456', 'stock_123456_DE_20220330161810.csv', 666))
            .rejects
            .toThrow('Error writing file to storage: /EAI/s_ds-inventory-inbox_p/data/123456/data/stock_123456_DE_20220330161810.csv.');
    });

    it('Should Call sFTP delete correctly from deleteFileFromSftp', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        process.env.INBOUND_CSV_BUCKET_NAME = 'bucket-name';
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(SftpClient.prototype, 'delete').mockResolvedValue('some string');
        await context.deleteFileFromSftp('123456', 'filename.csv');
        expect(SftpClient.prototype.delete).toBeCalledWith('/EAI/s_ds-inventory-inbox_p/data/123456/data/filename.csv', false);
    });

    it('Should Call sFTP delete with noNonExistentFileError=true from deleteFileFromSftp', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        process.env.INBOUND_CSV_BUCKET_NAME = 'bucket-name';
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(SftpClient.prototype, 'delete').mockResolvedValue('some string');
        await context.deleteFileFromSftp('123456', 'filename.csv', true);
        expect(SftpClient.prototype.delete).toBeCalledWith('/EAI/s_ds-inventory-inbox_p/data/123456/data/filename.csv', true);
    });

    it('Should not validate a supplier id in file name different than supplier folder name', async () => {
        (mockedReporter.getInstance as jest.MockedFunction<typeof mockedReporter.getInstance>).mockReturnValue(new Reporter());
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        createMockSupplierInfo();
        jest.spyOn(Context.prototype, 'getSupplierEmail').mockResolvedValue('test@test.de');
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({ modifyTime: 0, size: 1 } as FileStats);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Publisher.prototype, 'publishToMailSender').mockImplementation((mailPubSubData: MailPubSubData) => {
            return Promise.resolve();
        });
        jest.spyOn(Context.prototype, 'renameFileOnSftp').mockResolvedValue({} as Promise<void>);
        jest.spyOn(Repository.prototype, 'getSupplierState').mockResolvedValue(true);
        await context.setup();
        const valid = await context.validateFile('stock_123456_DE_20220330150345.xlsx', '123456', '223456');
        expect(valid).toBeFalsy();
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledTimes(1);
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledWith(
            expect.objectContaining({ supplierEmail: DEFAULT_MAIL_PROPERTIES.supplierManagement })
        );
    });

    it('Should invalidate no supplier name', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        (mockedReporter.getInstance as jest.MockedFunction<typeof mockedReporter.getInstance>).mockReturnValue(new Reporter());
        createMockSupplierInfo();
        jest.spyOn(Context.prototype, 'getSupplierEmail').mockResolvedValue('test@test.de');
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({ modifyTime: 0, size: 1 } as FileStats);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Repository.prototype, 'getSupplierState').mockResolvedValue(false);
        jest.spyOn(Publisher.prototype, 'publishToMailSender').mockImplementation((mailPubSubData: MailPubSubData) => {
            return Promise.resolve();
        });

        await context.setup();
        const valid = await context.validateFile('stock_DE_20220330150345.csv', '123456', '123456');
        expect(valid).toBeFalsy();
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledTimes(1);
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledWith(expect.objectContaining(
            { supplierEmail: 'test@test.de' })
        );
    });

    it('Should not invalidate no supplier name once supplier info having an error', async () => {
        jest.useRealTimers();
        Object.defineProperty(constants, 'DELAY', { value: 10 });
        Object.defineProperty(constants, 'TIMEOUT', { value: 10 });

        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        (mockedReporter.getInstance as jest.MockedFunction<typeof mockedReporter.getInstance>).mockReturnValue(new Reporter());
        createMockSupplierInfoWithError();
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({ modifyTime: 0, size: 1 } as FileStats);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Repository.prototype, 'getSupplierState').mockResolvedValue(false);
        jest.spyOn(Publisher.prototype, 'publishToMailSender').mockImplementation(
            (mailPubSubData: MailPubSubData) => {
                return Promise.resolve();
            }
        );

        await context.setup();
        await expect(context.validateFile('stock_DE_20220330150345.csv', '123456', '123456')).rejects.toThrow();
    });

    it('Should retry on error during write file', async () => {
        process.env.INBOUND_CSV_BUCKET_NAME = 'bucket-name';
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Context.prototype, 'getSupplierId').mockImplementation(() => {
            return '123456';
        });
        jest.spyOn(SftpClient.prototype, 'get').mockImplementation(() => {
            throw new Error('File is broken');
        });

        await expect(context.copyFileToBucket('123456', 'stock_123456_DE_20220330161810.csv', 666)).rejects.toThrow('Error writing file to storage: /EAI/s_ds-inventory-inbox_p/data/123456/data/stock_123456_DE_20220330161810.csv.');
        expect(mockedLogger.getInstance().logError).toHaveBeenCalledTimes(3);
        expect(mockedLogger.getInstance().logError).toHaveBeenNthCalledWith(1, 'File is broken on 1 attempt', 'sftp-collector');
        expect(mockedLogger.getInstance().logError).toHaveBeenNthCalledWith(2, 'File is broken on 2 attempt', 'sftp-collector');
        expect(mockedLogger.getInstance().logError).toHaveBeenNthCalledWith(3, 'File is broken on 3 attempt', 'sftp-collector');
        expect(mockedLogger.getInstance().logWarning).toHaveBeenCalledTimes(1);
        expect(mockedLogger.getInstance().logWarning).toHaveBeenNthCalledWith(1, 'Teams alert has sent successfully', 'sftp-collector');
    });

    it('Should get supplier details', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        process.env.SUPPLIER_MASTERDATA_SERVICE_URL = 'https://foo.bar';
        process.env.OAUTH_URL = 'https://foo.bar';
        process.env.OAUTH_USERNAME = 'superUser';
        process.env.OAUTH_PASSWORD = 'superPassword';
        process.env.OAUTH_CLIENT_ID = 'superClientId';
        const response = {
            headers: { get: () => 'application/json' },
            ok: true,
            redirected: true,
            status: 200,
            statusText: 'OK',
            type: 'basic',
            url: 'test',
            json: jest.fn().mockReturnValue({ name: 'test name', }),
        } as unknown as Response;

        jest.spyOn(Context.prototype, 'getSupplierEmail').mockResolvedValue('test@test.de');
        jest.spyOn(retry, 'fetchRetry').mockResolvedValue(response);
        jest.spyOn(Context.prototype, 'getAuthToken').mockResolvedValue('IamAToken');
        const supplierDetails = await context.getSupplierInfo('105897');
        expect(supplierDetails).toEqual({ name: 'test name', email: 'test@test.de' });
    });

    it('Should get supplier email', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        jest.spyOn(Firestore.prototype, 'collection').mockReturnValue({
            doc: jest.fn().mockReturnValue({
                get: jest.fn().mockReturnValue({
                    exists: true,
                    data: () => ({ emailInvrpt: 'bar' }),
                }),
            }),
        } as unknown as CollectionReference);
        jest.spyOn(Firestore.prototype, 'terminate').mockResolvedValue();
        const result = await context.getSupplierEmail('105897');
        expect(result).toEqual('bar');
    });

    it('Should get supplier email failure', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        jest.spyOn(Firestore.prototype, 'collection').mockReturnValue({
            doc: jest.fn().mockReturnValue({
                get: jest.fn().mockReturnValue({
                    exists: false,
                }),
            }),
        } as unknown as CollectionReference);
        const result = context.getSupplierEmail('105897');
        await expect(result).rejects.toEqual(new Error());
    });

    it('Should set supplier management email', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        jest.spyOn(Firestore.prototype, 'collection').mockReturnValue({
            doc: jest.fn().mockReturnValue({
                get: jest.fn().mockReturnValue({
                    exists: true,
                    data: () => ({ name: 'foo', email: 'no-invrpt@e.mail' }),
                }),
            }),
        } as unknown as CollectionReference);
        jest.spyOn(Firestore.prototype, 'terminate').mockResolvedValue();
        const result = await context.getSupplierEmail('105897');
        expect(result).toEqual(DEFAULT_MAIL_PROPERTIES.supplierManagement);
    });

    it('Should skip all checks if file is newer than 30 seconds', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2023-08-14T12:00:30.000Z'));
        const fileModificationTime = new Date('2023-08-14T12:00:10.000Z').getTime();
        (mockedReporter.getInstance as jest.MockedFunction<typeof mockedReporter.getInstance>).mockReturnValue(new Reporter());
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        createMockSupplierInfo();

        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({
            modifyTime: fileModificationTime,
            size: 10
        } as FileStats);
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        await context.setup();
        const valid = await context.validateFile('stock_123456_de_20220330150345.xcsv', '123456', '123456');
        expect(valid).toBeFalsy();
    });

    it('Should send email in case of file size equals zero', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2023-08-14T12:00:30.000Z'));
        const fileModificationTime = new Date('2023-08-14T11:59:59.000Z').getTime();
        (mockedReporter.getInstance as jest.MockedFunction<typeof mockedReporter.getInstance>).mockReturnValue(new Reporter());
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        createMockSupplierInfo();

        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({
            modifyTime: fileModificationTime,
            size: 0
        } as FileStats);
        jest.spyOn(Context.prototype, 'getSupplierEmail').mockResolvedValue('test@test.de');
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Publisher.prototype, 'publishToMailSender').mockImplementation((mailPubsubData: MailPubSubData) => {
            return Promise.resolve();
        });

        const valid = await context.validateFile('stock_123456_DE_20220330150345.csv', '123456', '123456');
        expect(valid).toBeFalsy();
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledTimes(1);
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledWith({
            dynamicTemplateData: {
                country: 'DE',
                error: 'Die Datei stock_123456_DE_20220330150345.csv hat eine Dateigröße von Null',
                file: 'stock_123456_DE_20220330150345.csv',
                project: 'ds-inventory',
                subject: 'Fehler Bestandsmeldung Dropshipping - Dateigröße',
                supplierName: 'test name',
                supplierNumber: '123456',
                time: '8/14/2023, 12:00:30 PM'
            },
            mailType: 'file',
            subject: 'Fehler Bestandsmeldung Dropshipping - Dateigröße',
            supplierEmail: 'test@test.de'
        });
    });

    it('Should return invalid date for given time stamp', async () => {
        let result = context.checkTimestamp('20232809083914');
        expect(result).toEqual(false);
        result = context.checkTimestamp('123');
        expect(result).toEqual(false);
        result = context.checkTimestamp('');
        expect(result).toEqual(false);
    });

    it('Should return valid date for given time stamp', async () => {
        const result = context.checkTimestamp('20230928083914');
        expect(result).toEqual(true);
    });

    it('Should send email in case of invalid timestamp', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2023-08-14T12:00:30.000Z'));
        const fileModificationTime = new Date('2023-08-14T11:59:59.000Z').getTime();
        (mockedReporter.getInstance as jest.MockedFunction<typeof mockedReporter.getInstance>).mockReturnValue(new Reporter());
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        createMockSupplierInfo();

        jest.spyOn(SftpClient.prototype, 'stat').mockResolvedValue({
            modifyTime: fileModificationTime,
            size: 0
        } as FileStats);
        jest.spyOn(Context.prototype, 'getSupplierEmail').mockResolvedValue('test@test.de');
        jest.spyOn(SftpClient.prototype, 'connect').mockResolvedValue({} as SFTPWrapper);
        jest.spyOn(Repository.prototype, 'createPool').mockImplementation(() => {
            return Promise.resolve();
        });
        jest.spyOn(Publisher.prototype, 'publishToMailSender').mockImplementation((mailPubsubData: MailPubSubData) => {
            return Promise.resolve();
        });

        const valid = await context.validateFile('stock_123456_DE_20223330150345.csv', '123456', '123456');
        expect(valid).toBeFalsy();
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledTimes(1);
        expect(Publisher.prototype.publishToMailSender).toHaveBeenCalledWith({
            dynamicTemplateData: {
                country: 'DE',
                error: 'Der Dateiname stock_123456_DE_20223330150345.csv bei der Ablage auf dem SFTP-Server entspricht nicht dem erwarteten Schema: stock_{supplierID}_{country}_{dateTime}.{ending} Die Zeitangabe 20223330150345 ist ungültig. Die Eingabe muss ein gültiges Datum im Format YYYYMMDDHHMMSS beinhalten. Bitte prüfen Sie die Angaben.',
                file: 'stock_123456_DE_20223330150345.csv',
                project: 'ds-inventory',
                subject: 'Fehler Bestandsmeldung Dropshipping - Dateiname',
                supplierName: 'test name',
                supplierNumber: '123456',
                time: '8/14/2023, 12:00:30 PM'
            },
            mailType: 'file',
            subject: 'Fehler Bestandsmeldung Dropshipping - Dateiname',
            supplierEmail: 'test@test.de'
        });
    });
});
