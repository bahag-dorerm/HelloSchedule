import { Logger } from '@bahag/npm-structured-logger';
import { Context } from './context';
import { collectFromSftp } from './index';
import { PubsubEvent, Status } from './interface/interfaces';

jest.mock('./context');
jest.mock('@bahag/npm-structured-logger');

function createPubSubEvent(): PubsubEvent {
    const data = {
        data: '',
    };
    return {
        eventId: '',
        eventType: '',
        resource: '',
        timestamp: new Date(),
        data: Buffer.from(JSON.stringify(data)).toString('base64')
    };
}

const mockedLogger = Logger as jest.MockedClass<typeof Logger>;

describe('Collect files from sftp', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.resetAllMocks();
    });

    it('Should resolve', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        jest.spyOn(Context.prototype, 'getSupplierFolders').mockResolvedValue(['123456', '654321']);
        jest.spyOn(Context.prototype, 'getFileList').mockResolvedValue(['a', 'b']);
        jest.spyOn(Context.prototype, 'validateFile').mockResolvedValue(true);
        jest.spyOn(Context.prototype, 'addTransmission').mockImplementation((supplierId: string) => Promise.resolve(42));
        jest.spyOn(Context.prototype, 'copyFileToBucket').mockImplementation((supplierId: string, fileName: string, id: number) => {
            return Promise.resolve(`gs://${supplierId}/${fileName}/${id}`);
        });
        jest.spyOn(Context.prototype, 'updateTransmission').mockImplementation((transmissionId: number, filePath: string, status: Status) => Promise.resolve());
        jest.spyOn(Context.prototype, 'deleteFileFromSftp').mockResolvedValue('file deleted');
        jest.spyOn(Context.prototype, 'teardown').mockImplementation(() => Promise.resolve());
        Context.prototype.ignoredFolders = ['s_sm-ds_p'];
        await expect(collectFromSftp(createPubSubEvent())).resolves.toEqual(undefined);
        expect(mockedLogger.getInstance().logNotice).toBeCalledTimes(4);
        expect(mockedLogger.getInstance().logNotice).toHaveBeenNthCalledWith(1, 'file deleted', 'sftp-collector');
        expect(mockedLogger.getInstance().logNotice).toHaveBeenNthCalledWith(2, 'file deleted', 'sftp-collector');
        expect(mockedLogger.getInstance().logNotice).toHaveBeenNthCalledWith(3, 'file deleted', 'sftp-collector');
        expect(mockedLogger.getInstance().logNotice).toHaveBeenNthCalledWith(4, 'file deleted', 'sftp-collector');
    });

    it('Should reject on error with DB', async () => {
        const error = new Error('Foobar');
        jest.spyOn(Context.prototype, 'setup').mockRejectedValue(error);
        await expect(collectFromSftp(createPubSubEvent())).rejects.toEqual(error);
    });

    it('Should resolve with empty suppliers list in sFTP', async () => {
        jest.spyOn(Context.prototype, 'getSupplierFolders').mockResolvedValue([]);
        await expect(collectFromSftp(createPubSubEvent())).resolves.toEqual(undefined);
    });

    it('Should resolve with suppliers having no files', async () => {
        jest.spyOn(Context.prototype, 'getSupplierFolders').mockResolvedValue(['123456', '654321']);
        jest.spyOn(Context.prototype, 'getFileList').mockResolvedValue([]);
        Context.prototype.ignoredFolders = ['s_sm-ds_p'];
        await expect(collectFromSftp(createPubSubEvent())).resolves.toEqual(undefined);
    });

    it('Should reject with copyFileToBucket Error', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        jest.spyOn(Context.prototype, 'getSupplierFolders').mockResolvedValue(['123456']);
        jest.spyOn(Context.prototype, 'getFileList').mockResolvedValue(['a']);
        jest.spyOn(Context.prototype, 'validateFile').mockResolvedValue(true);
        jest.spyOn(Context.prototype, 'addTransmission').mockImplementation((supplierId: string) => Promise.resolve(42));
        jest.spyOn(Context.prototype, 'teardown').mockImplementation(() => Promise.resolve());

        jest.spyOn(Context.prototype, 'copyFileToBucket').mockRejectedValue(new Error('Error writing file to storage: '));
        jest.spyOn(Context.prototype, 'updateTransmission');
        jest.spyOn(Context.prototype, 'deleteFileFromSftp');
        Context.prototype.ignoredFolders = ['s_sm-ds_p'];
        const result = await collectFromSftp(createPubSubEvent());
        expect(mockedLogger.getInstance().logError).toBeCalledWith('Error writing file to storage: ', 'sftp-collector');
        expect(Context.prototype.updateTransmission).toBeCalledWith(42, 'NA', 'FAILED');
        expect(Context.prototype.updateTransmission).toBeCalledTimes(1);
        expect(Context.prototype.deleteFileFromSftp).not.toHaveBeenCalled();
        expect(result).toBeUndefined();
    });

    it('Should reject with updateTransmission Error', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        jest.spyOn(Context.prototype, 'getSupplierFolders').mockResolvedValue(['123456']);
        jest.spyOn(Context.prototype, 'getFileList').mockResolvedValue(['a']);
        jest.spyOn(Context.prototype, 'validateFile').mockResolvedValue(true);
        jest.spyOn(Context.prototype, 'copyFileToBucket').mockResolvedValue('filePath.csv');
        jest.spyOn(Context.prototype, 'addTransmission').mockImplementation((supplierId: string) => Promise.resolve(42));
        jest.spyOn(Context.prototype, 'teardown').mockImplementation(() => Promise.resolve());
        jest.spyOn(Context.prototype, 'updateTransmission').mockImplementation(async () => {
            throw new Error('crap');
        });
        jest.spyOn(Context.prototype, 'deleteFileFromSftp');
        Context.prototype.ignoredFolders = ['s_sm-ds_p'];
        const result = await collectFromSftp(createPubSubEvent());
        expect(Context.prototype.deleteFileFromSftp).not.toHaveBeenCalled();
        expect(mockedLogger.getInstance().logError).toHaveBeenCalledWith('crap', 'sftp-collector');
        expect(result).toBeUndefined();
    });

    it('Should reject with deleteFileFromSftp Error', async () => {
        (mockedLogger.getInstance as jest.MockedFunction<typeof mockedLogger.getInstance>).mockReturnValue(new Logger());
        jest.spyOn(Context.prototype, 'getSupplierFolders').mockResolvedValue(['123456']);
        jest.spyOn(Context.prototype, 'getFileList').mockResolvedValue(['a']);
        jest.spyOn(Context.prototype, 'validateFile').mockResolvedValue(true);
        jest.spyOn(Context.prototype, 'copyFileToBucket').mockResolvedValue('filePath.csv');
        jest.spyOn(Context.prototype, 'addTransmission').mockImplementation((supplierId: string) => Promise.resolve(42));
        jest.spyOn(Context.prototype, 'teardown').mockImplementation(() => Promise.resolve());
        jest.spyOn(Context.prototype, 'updateTransmission');
        jest.spyOn(Context.prototype, 'deleteFileFromSftp').mockImplementation(() => {
            throw new Error('Error deleting file');
        });
        Context.prototype.ignoredFolders = ['s_sm-ds_p'];
        const result = await collectFromSftp(createPubSubEvent());
        expect(Context.prototype.deleteFileFromSftp).toHaveBeenCalled();
        expect(mockedLogger.getInstance().logError).toBeCalledWith('Error deleting file', 'sftp-collector');
        expect(result).toBeUndefined();
    });
});
